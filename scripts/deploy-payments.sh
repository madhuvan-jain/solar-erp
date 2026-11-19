#!/usr/bin/env bash
# Puts the payment server (supabase/functions/) on your Supabase project and gives it the Razorpay keys.
#   PROJECT_REF=abcdefghijklmnop bash scripts/deploy-payments.sh
# PROJECT_REF: Supabase → Project Settings → General → Project ID.
# The first time, sign the Supabase tool in:  npx supabase@3.1.0 login   (opens the browser)
# (The Supabase tool's version is fixed here because its options change between major versions; 3.1.0 was checked.)
#
# The keys are typed here (not shown, not saved in your shell history) and stored only as Supabase secrets.
# They never go into .env, the website or the app.
set -euo pipefail
cd "$(dirname "$0")/.."
: "${PROJECT_REF:?Set PROJECT_REF to your Supabase project id, e.g. PROJECT_REF=abcdefghijklmnop bash scripts/deploy-payments.sh}"
SB="npx --yes supabase@3.1.0"

if [ "${SKIP_SECRETS:-}" != "1" ]; then
  echo "Razorpay Dashboard → Account & Settings → API Keys (Test keys first, Live keys when you go live)."
  read -rp  "Razorpay Key Id (rzp_test_… or rzp_live_…): " KEY_ID
  read -rsp "Razorpay Key Secret (hidden): " KEY_SECRET; echo
  read -rsp "Webhook secret (any long random text; type the same in Razorpay → Webhooks) (hidden): " WEBHOOK; echo
  read -rp  "Your website address(es), comma-separated, e.g. https://app.yourcompany.in: " ORIGINS
  case "$KEY_ID" in rzp_test_*|rzp_live_*) ;; *) echo "That is not a Razorpay Key Id."; exit 1;; esac
  if [ "${KEY_ID#rzp_test_}" != "$KEY_ID" ]; then
    echo
    echo "  !! TEST MODE KEYS: payments are not real, and Razorpay's test window lets anyone press 'Success'."
    echo "  !! Use them only before customers can sign up. Run this script again with LIVE keys before launch."
    read -rp "  Continue with test keys? (yes/no) " OK; [ "$OK" = "yes" ] || exit 1
  fi
  [ ${#WEBHOOK} -ge 16 ] || { echo "Use a webhook secret of at least 16 characters."; exit 1; }
  ENVF="$(mktemp)"; chmod 600 "$ENVF"; trap 'rm -f "$ENVF"' EXIT
  printf 'RAZORPAY_KEY_ID=%s\nRAZORPAY_KEY_SECRET=%s\nRAZORPAY_WEBHOOK_SECRET=%s\nALLOWED_ORIGINS=%s\n' "$KEY_ID" "$KEY_SECRET" "$WEBHOOK" "$ORIGINS" > "$ENVF"
  $SB secrets set --remote="$PROJECT_REF" --env-file "$ENVF" --yes
fi

# --no-verify-jwt: Supabase's gateway check is switched off because each function checks the caller itself:
#   create-order and verify-payment ask Supabase Auth who the signed-in person is (and refuse anyone else);
#   razorpay-webhook accepts only requests signed with the webhook secret (Razorpay cannot sign in).
# (The gateway check can break with Supabase's newer signing keys and blocks the browser's CORS pre-check.)
$SB functions deploy create-order --remote="$PROJECT_REF" --use-api --no-verify-jwt --yes
$SB functions deploy verify-payment --remote="$PROJECT_REF" --use-api --no-verify-jwt --yes
$SB functions deploy razorpay-webhook --remote="$PROJECT_REF" --use-api --no-verify-jwt --yes

echo
echo "Done. In Razorpay Dashboard → Account & Settings → Webhooks → Add new webhook:"
echo "  URL:     https://$PROJECT_REF.supabase.co/functions/v1/razorpay-webhook"
echo "  Secret:  the webhook secret you typed above"
echo "  Events:  payment.captured and order.paid"
