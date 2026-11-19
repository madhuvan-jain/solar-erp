# SuryaSetu — from this folder to live: website, subscriptions, Android app, iPhone app

This is the complete list of what is left, in order, to do on a computer where you have full access (internet,
your own accounts, git, installing software). Everything that could be done without your accounts is already done
(section 0). Tick the boxes as you go.

**How the business works now (version 1.2.0).** SuryaSetu is a service that many solar companies use, each in its
own private space ("business"):
- Anyone who signs up without a company code starts a business: **15 days free**, every feature, the whole team.
  One free trial per email address and per mobile number, also after deleting everything and signing up again.
- After that, the business's admin buys a plan on the website: **1 month ₹1,000 · 3 months ₹2,500 · 6 months
  ₹4,500 · 12 months ₹7,500** (GST included), paid through **Razorpay**.
- If no plan is bought, the business becomes **read-only**: everyone can still see, print and export everything,
  but no business data (records, files, restores, website enquiries) can be changed until a plan is bought. The admin
  can still manage people (approve, disable, delete, change the company code), so former staff can always be locked out.
- Staff join their company's business with its **company code** and the admin approves them.

All of this is enforced inside the database and the payment server, not in the app, so a changed website or a
"mod APK" cannot unlock anything (section 13 explains each risk and what stops it).

Time needed: about two days of work spread over 2–3 weeks. Most of the waiting is for Razorpay's account
activation, Google Play's review (and, with a personal Play account, its 14-day closed test) and Apple's review.

---

## 0. Already done and ready to use

| What | Where |
|---|---|
| The app: website and installable app, device mode and cloud mode | this folder (`src/`) |
| **Subscriptions and many businesses** (new) | Database: `supabase/schema.sql` (businesses, 15-day trial, plans and prices, read-only after the end, company codes, payments). Payment server: `supabase/functions/` (create-order, verify-payment, razorpay-webhook). Screens: sign-up "Start my business / Join my company", trial banner, **Settings → Subscription**, company code in Settings → Users & access, enquiry link in Settings → General |
| **iPhone / iPad app project** (new) | `ios/` (Capacitor, Xcode project with icon, splash, camera / location / photo texts, encryption flag); build on a Mac with `npm run ios` (section 11) |
| **Pricing, cancellation and refunds page** (new) | `public/pricing.html`. Razorpay asks for it before it activates payments |
| Tests | 328 unit tests (45 on the database rules alone: isolation between businesses, trial, read-only, repeat free trials, payment tampering, upgrade of old data; 14 on the payment server, which runs the real functions end to end against the real database rules with a simulated Razorpay: forged signatures, someone else's order, short payments, tampered webhooks, repeats), smoke and 71 acceptance checks in Chrome and Firefox, crawl, fuzz and speed tests (`npm test`, `npm run e2e`, `npm run acceptance`, `npm run crawl`). All passed on the last run |
| Database for cloud mode | `supabase/schema.sql`: tables, security rules and checks; safe to run again, and it moves older single-company data into one business by itself |
| Website hosting settings | `netlify.toml`: build, security headers (CSP, HSTS; Razorpay allowed only where checkout needs it), caching for updates |
| Android project | `android/`: Capacitor, camera and location permissions, its own security policy |
| Build commands | `npm run android-tools`, `npm run apk`, `npm run aab` (Android); `npm run ios` (iPhone, on a Mac); `bash scripts/deploy-payments.sh` (payment server) |
| Policy pages for the website and stores | `public/privacy.html` (now with payments), `terms.html` (now with fees), `pricing.html`, `delete-account.html`, `grievance.html` |
| Store texts and policy texts | `docs/publishing/`: Play listing, data safety answers, App Store listing, release notes, security notes |
| Your details in one file | `go-live/my-details.json` + `node scripts/fill-details.mjs`: fills every placeholder, the website address for the app and, if wanted, your own Android package id |
| Google Play graphics | `go-live/play-store/`: 8 phone screenshots 1080×1920, feature graphic 1024×500, icon 512×512 (remake: `node scripts/store-assets.mjs`) |
| Video guide, English and Hindi | `user video/`: 21 + 21 videos with thumbnails, captions and the playlist texts; see `user video/README.md` |
| `.gitignore` | keeps the signing key, `.env`, build output and the 600 MB of videos out of git |

**Not possible here, so left for you:**
- creating accounts: GitHub, domain, Supabase, Netlify, Razorpay, Google Play, Apple, email;
- any git operation;
- downloading Java and the Android SDK, building the Android app; building the iPhone app (Apple allows that only on a Mac);
- deploying the payment server, uploading anything.

---

## 1. What you need before starting

| Item | Cost (approx.) | Notes |
|---|---|---|
| A computer with Linux, macOS or Windows (WSL), 8 GB RAM, 10 GB free | — | Node 20, git |
| Domain name, e.g. `app.yourcompany.in` | ₹700–1,000 a year | GoDaddy, Hostinger, Namecheap… |
| GitHub account (public repository) | free | |
| Supabase (cloud database + payment server) | Free to start; **Pro ₹2,100/month (US$25)** needed for a real business | The free plan pauses after a week without use and has no daily backups |
| Netlify (website hosting) | free | |
| Email sending (SMTP) for sign-up and password emails | free tier: Brevo, Resend or Zoho ZeptoMail | Required: Supabase's built-in email only reaches your own team's addresses |
| **Razorpay account** (payments) | Free to open; **about 2% of each payment** + GST on that fee (check razorpay.com/pricing) | Needs KYC: PAN, bank account, business proof (GST certificate, Udyam or shop licence), and the live website with its policy pages |
| **GST registration** for your own business | — | Prices include 18% GST. Above ₹20 lakh a year of sales (and usually from the start for online services to businesses), you must register, file returns and issue GST invoices. Ask a CA |
| Google Play developer account | US$25 once | Personal or organisation (organisation needs a D-U-N-S number) |
| Two Android phones for testing (one old, one new) | — | |
| Optional: SMS codes (MSG91 or Twilio) with DLT registration | per SMS | Recommended: makes "one free trial per mobile number" proof against fake numbers |
| Optional: Apple App Store | US$99 a year, a Mac with Xcode, an iPhone for testing | Section 11 |

Decide now:
- **Name and package id.** The Android package id (now `in.suryasetu.erp`) **can never change** after the first Play upload; the same id is used for the iPhone app's bundle id. To use your own, for example `in.yourcompany.solar`, put it in `go-live/my-details.json` (step 3). To change the app's name: `npm run rename -- "NewName"`.
- **Prices.** They are in the database (`plans` table) and in `public/pricing.html`. To change them later, see section 12.

---

## 2. Move the project to your computer and into git

- [ ] Copy this whole `solar-erp` folder. You can leave out `node_modules/` and `dist/`, which are rebuilt.
- [ ] Install Node 20 (nodejs.org or `nvm install 20`) and git.
- [ ] In the folder:
  ```sh
  npm ci                      # installs the exact versions in package-lock.json
  npx playwright install      # browsers for the tests (optional, only to run the tests)
  npm test                    # 328 tests should pass
  npm run build               # makes dist/
  ```
- [x] Public repository: https://github.com/madhuvan-jain/solar-erp. The initial commit is on `main`; publish later changes with `git add`, `git commit` and `git push`.
  ```sh
  git add . && git commit -m "Describe your changes" && git push
  ```
  Check that `android/keystore.properties`, `*.jks`, `.env` and `user video/**/*.webm` are not in the commit (`git status`). `.gitignore` already excludes them.
- [ ] This repository is public, so anyone can view and clone the source. Never commit credentials, private customer data or deployment secrets; keep them in the appropriate provider's secret settings. Change repository visibility back to private if you no longer want the source publicly accessible.

## 3. Fill in your business details (10 minutes)

- [ ] Open `go-live/my-details.json` and fill every value. Examples and meanings are in `docs/publishing/README.md`, section 1:
  - legal name, registered address and Grievance Officer (a named person in India: IT Rules 2021);
  - support email and phone;
  - website address (with `https://`, no `/` at the end);
  - effective date and jurisdiction city;
  - **Fees and refund terms:** your refund rule for a plan that has started (a fair default is filled in); the plans and prices are already written into the terms and the pricing page;
  - demo account for the store reviewers;
  - `Play package id`: keep `in.suryasetu.erp` or set your own, once.
- [ ] Run:
  ```sh
  node scripts/fill-details.mjs --dry-run    # shows what will change
  node scripts/fill-details.mjs              # changes the files
  ```
- [ ] If you are **not** using SMS codes, delete the sentence with `[SMS provider name]` in `public/privacy.html` and `docs/publishing/PRIVACY_POLICY.md`.
- [ ] Read the five pages in `public/` once more (privacy, terms, pricing, delete account, grievance). Have a lawyer look at them if you can.
- [ ] Commit and push.

## 4. Cloud database: Supabase (30 minutes)

- [ ] Sign up at supabase.com → **New project**.
  - Region **Mumbai (ap-south-1)**.
  - Use a strong database password and keep it in a password manager.
  - Turn on **two-factor authentication** for your Supabase login (Account → Security). Do the same for every account in this guide.
- [ ] **SQL Editor** → paste all of `supabase/schema.sql` → **Run**.
  - It is safe to run again later. Every update with database changes needs it run again **before** the website (section 10).
- [ ] **Authentication → Sign In / Providers → Email:**
  - email sign-up on;
  - **Confirm email on** (important: no business starts without a real, confirmed email);
  - minimum password length 8.
- [ ] **Authentication → URL Configuration:**
  - Site URL: your website address;
  - Redirect URLs: `https://app.yourcompany.in/**`.
- [ ] **Authentication → Emails → SMTP Settings:** turn on custom SMTP with your email provider (host, port, user, password, sender `no-reply@yourcompany.in`). Without it, sign-up emails do not reach customers or staff.
- [ ] Required before launch: SMS verification, so every account confirms its real mobile number and password reset can use SMS as an alternative to email:
  1. Authentication → Providers → Phone, with MSG91 or Twilio (DLT template registered in India).
  2. Set `VITE_PHONE_OTP=1` in step 5.
  3. Once a test sign-up receives its SMS code, switch the trial rule on in SQL Editor: `update public.app_config set trial_needs_sms = true;`. From then on a new business's free trial starts only when its owner's mobile number is confirmed by SMS, and each number gets one trial.
  4. Before launch, test both email confirmation and mobile confirmation, then test password reset independently by email and by SMS. Cloud sign-up/access stays blocked until both identities are confirmed.
- [ ] **Project Settings → API:** copy the **Project URL** and the **anon public** key.
  - **Never** use or share the `service_role` key: it bypasses all security. The payment server gets it from Supabase by itself.
- [ ] **Project Settings → General:** copy the **Project ID** (for example `abcdefghijklmnop`). Step 5b needs it.
- [ ] Upgrade to **Pro** for daily backups and no pausing (needed once customers pay).
- [ ] Storage: the private `files` bucket was created by the schema. Check it under Storage.

## 5. The website live: Netlify and your domain (30 minutes)

- [ ] netlify.com → **Add new site → Import an existing project → GitHub** → choose the repository.
  - Netlify reads `netlify.toml` (build `npm run build`, publish `dist`, Node 20).
- [ ] **Site configuration → Environment variables:**
  - `VITE_SUPABASE_URL` = Project URL from step 4
  - `VITE_SUPABASE_ANON_KEY` = anon key from step 4
  - `VITE_PUBLIC_URL` = `https://app.yourcompany.in`
  - `VITE_PHONE_OTP` = `1` (required after SMS provider and DLT setup)
  - Nothing else. **Razorpay keys never go here**: anything starting with `VITE_` ends up in the website for everyone to read.
- [ ] **Deploy.** The first deploy takes 2–3 minutes.
- [ ] **Domain management → Add a domain** → `app.yourcompany.in`.
  - Add the DNS record your domain seller asks for, usually a CNAME to `<site>.netlify.app`.
  - Wait for the free HTTPS certificate, then turn on **Force HTTPS**.
- [ ] Put the same values in your local `.env`. Step 3 already wrote `VITE_PUBLIC_URL`; add the two Supabase values. They are needed when building the Android and iPhone apps.
- [ ] Check the security headers at securityheaders.com: grade A expected.

## 5b. Payments: Razorpay and the payment server (1 hour, plus Razorpay's activation: 2–7 days)

### Razorpay account
- [ ] Sign up at dashboard.razorpay.com with your business email. Turn on two-factor authentication.
- [ ] **Activate the account** (KYC): business type, PAN, GSTIN if you have one, bank account for payouts, and the **website**: `https://app.yourcompany.in`. Razorpay's team checks that the website shows:
  - what you sell and the prices → `https://app.yourcompany.in/pricing.html`;
  - Terms → `/terms.html`; Privacy → `/privacy.html`; Cancellation & refunds and Delivery → `/pricing.html` (sections 4, 6, 7); Contact → `/grievance.html` and the contact lines on every page.
  The website must be live with those pages (step 5) before you submit.
- [ ] While activation is pending you can do everything below with **Test mode** keys.
  **Never leave Test keys in place once customers can sign up:** in test mode Razorpay's window offers a "Success" button, so anyone could get a plan without paying. Step "Go live" below replaces them.

### The payment server (Supabase Edge Functions)
The three functions in `supabase/functions/` are the only place that can extend a subscription:
- `create-order`: the admin chose a plan → reads the price from the database → creates a Razorpay order for exactly that amount;
- `verify-payment`: checks Razorpay's signature with your secret, asks Razorpay that the money was really captured for that order and amount, then extends the plan once;
- `razorpay-webhook`: Razorpay tells it about each payment, so a plan is added even if the payer's browser closed.

- [ ] Razorpay Dashboard → (Test mode) → **Account & Settings → API Keys → Generate Key**. Keep the Key Id and Key Secret open.
- [ ] Choose a **webhook secret**: any long random text (for example from a password manager, 32 characters).
- [ ] On your computer, in the project folder:
  ```sh
  npx supabase@3.1.0 login                                    # once; opens the browser
  PROJECT_REF=<your project id> bash scripts/deploy-payments.sh
  ```
  It asks for the Key Id, Key Secret, webhook secret and your website address. They are typed hidden and stored only as Supabase secrets (Supabase → Edge Functions → Secrets), never in files.
- [ ] Razorpay Dashboard → **Account & Settings → Webhooks → Add new webhook**:
  - URL: `https://<your project id>.supabase.co/functions/v1/razorpay-webhook` (the script prints it);
  - Secret: the webhook secret;
  - Active events: **payment.captured** and **order.paid**.
- [ ] Razorpay → **Account & Settings → Payment capture**: automatic capture (the default). (The server also captures by itself if it finds a payment only authorised.)

### Test a payment (Test mode)
- [ ] On the live website, sign up a test business (step 6), open **Settings → Subscription → Pay ₹1,000**.
- [ ] In Razorpay's test window pay with UPI id `success@razorpay` (or a test card from Razorpay's docs, "Test card details").
- [ ] Expect "Thank you! Your plan is active until …", the plan in Settings → Subscription, and the payment in the **Payments** list. In Supabase → Table Editor → `subscription_payments` the row is `paid`.
- [ ] Try a failure (`failure@razorpay`): nothing changes, a clear message shows.
- [ ] Close the browser tab right after paying once: within a minute the webhook adds the plan anyway (Supabase → Edge Functions → razorpay-webhook → Logs shows `OK`).

### Go live
- [ ] After Razorpay activates the account: switch the dashboard to **Live mode** → generate **Live** API keys → add the same webhook in Live mode (Live and Test webhooks are separate).
- [ ] Run `PROJECT_REF=<id> bash scripts/deploy-payments.sh` again with the **live** keys (it replaces the secrets).
- [ ] Make one real ₹1,000 payment yourself, check it arrives, then refund it from the Razorpay dashboard if you like (section 12 explains what a refund does).
- [ ] Remove the test business you made (section 12, "remove a business").

## 6. First run of the live website (20 minutes)

Do these in this order, on the live address:

- [ ] Open the website → **Create account → Start my business**. Name, business name, email, mobile, password → confirm the email → sign in. You are the admin of a new business with a 15-day trial. (Every customer starts exactly like this.)
- [ ] Settings:
  - **General:** company name, GSTIN (fills the state), bank. Below it, the **Website enquiry form** link for that business.
  - **Documents & print:** logo, signature, UPI ID.
  - **WhatsApp:** business number and messages (Hindi if wanted).
  - **Sales:** quotation validity and the savings estimate.
  - **Subscription:** the trial, the four plans and their prices.
- [ ] Settings → **Users & access**: the **company code** and **invite link**. A colleague uses **Create account → Join my company** with the code (or opens the invite link), confirms the email, and you approve them and set their role.
- [ ] Create the **store reviewer demo business** with the demo email from step 3 (Start my business), load demo data in it, and give it a long free period so reviewers never meet a read-only app. In Supabase → SQL Editor:
  ```sql
  select public.vendor_extend((select business_id from profiles where lower(email) = lower('<demo email>')), 3650);
  ```
  Do not put real customer data in the reviewer business.
- [ ] Check the main paths once on a phone over HTTPS:
  1. lead → survey with **Site photo**, which needs HTTPS for camera and GPS;
  2. quotation → confirm order → invoice → issue → payment → print;
  3. WhatsApp from a lead;
  4. install the app from Chrome's menu;
  5. a backup download;
  6. the enquiry form link from Settings → General: an enquiry arrives as a lead **in that business only**.
- [ ] Open the policy pages: `/privacy.html`, `/terms.html`, `/pricing.html`, `/delete-account.html`, `/grievance.html`.

The website is now live and can take paying customers. They can use it in any browser and install it from Chrome or Safari.

## 7. The Android app (half a day the first time)

### 7a. Upgrade the Android part for Google Play's target API (do this first)

Google Play only accepts apps that target a recent Android version:
- since 31 Aug 2025: **API 35** (Android 15) for new apps and updates;
- from Aug 2026 it is expected to be **API 36**. Check the current rule in Play Console → *Policy status* or *App bundle explorer*.

This project is on **Capacitor 6, target API 34**, which is too old for a new Play app. Upgrade (this also upgrades the iPhone part):

```sh
npm i @capacitor/core@latest @capacitor/android@latest @capacitor/ios@latest @capacitor/filesystem@latest @capacitor/share@latest
npm i -D @capacitor/cli@latest
npx cap migrate                      # updates the android/ and ios/ projects (Gradle, SDK versions, Xcode settings)
```

- [ ] Open `android/variables.gradle`. `targetSdkVersion` and `compileSdkVersion` must be at least what Play asks for (35 or 36). `npx cap migrate` sets the values its version supports.
- [ ] Note the Java version the new Capacitor needs (Capacitor 7: Java 21). Then:
  ```sh
  JAVA_MAJOR=21 ANDROID_PLATFORM=35 BUILD_TOOLS=35.0.0 npm run android-tools    # use 36 / 36.0.0 if Play asks for 36
  export JAVA_MAJOR=21                                                           # so npm run apk / aab use that Java
  ```
- [ ] Run `npm test` and `npm run build` again: the web part does not change.
- [ ] Commit. If anything fails, the Capacitor upgrade guide on capacitorjs.com lists each version's changes.

(The older tools, Java 17 and API 34, still build an APK for installing directly while you are still testing the app; only Play needs the upgrade.)

### 7b. Build the app (cloud mode)

- [ ] `.env` holds the Supabase URL, the anon key and `VITE_PUBLIC_URL` (step 5). The app is built with them, so it uses the same cloud database as the website.
- [ ] Raise `version` in `package.json` for every release (1.2.0 → 1.2.1 → 1.3.0). It becomes the Android `versionCode`.
- [ ] Build:
  ```sh
  npm run apk     # ../SuryaSetu-<version>.apk — for installing directly on test phones
  npm run aab     # ../SuryaSetu-<version>.aab — for Google Play
  ```
  These commands also build the app's security policy into it.
- [ ] **The first build creates the signing key:** `android/suryasetu-release.jks` and `android/keystore.properties` (its password).
  - **Back up both files now** in two safe places, for example an encrypted pen drive and a password manager.
  - They are your Play **upload key**. If you lose them, Google Play can reset the upload key through support. But copies of the app installed directly from an APK can then never be updated.
  - Nobody else can publish an update of your app without this key (section 13, "mod APK").

### 7c. Test on two real phones

- [ ] Install the APK (allow "Install unknown apps" once).
- [ ] Sign in with a staff account, then check:
  - create and edit records;
  - **Site photo**: allow camera and location; the photo is stamped and saved;
  - **WhatsApp** opens the chat in the WhatsApp app;
  - call links;
  - export Excel and PDF, and a backup, which opens Android's *Save or send* sheet;
  - documents open;
  - dark mode;
  - no internet: screens still open, and an Offline badge shows.
- [ ] **Subscription in the app:** the trial banner shows the days left, but there are **no prices, no Pay buttons and no links to pay** (store rules, section 8f). Settings → Subscription shows the status only. With a read-only business (ask yourself to end a test business's trial, section 12), the app shows "changes are paused" and every save is refused with that message.
- [ ] Update test: install this version, add data, raise the version, build again, install over it. The data must still be there.

## 8. Google Play (accounts: 1–2 days; review: a few days; personal accounts also 14 days of testing)

### 8a. Developer account
- [ ] play.google.com/console → sign up (US$25) → choose **Personal** or **Organisation**.
  - **Organisation** needs a D-U-N-S number (free, a few days) and shows your company name. It does not need the 12-tester closed test.
  - **Personal** accounts created after Nov 2023 must run a **closed test with at least 12 testers for 14 days in a row** before production.
- [ ] Complete identity verification. Turn on 2-step verification for the Google account.

### 8b. Create the app
- [ ] **Create app.** Name: SuryaSetu (or yours). Default language English (India). **App**, **Free** (the download is free; businesses subscribe on your website), accept the declarations.
- [ ] **App signing:** keep **Play App Signing** on. Your `.aab` is signed with the upload key from 7b.

### 8c. Store listing
Everything is in `docs/publishing/PLAY_STORE_LISTING.md` and `go-live/play-store/`.
- [ ] App name, short description and full description: copy from `PLAY_STORE_LISTING.md`.
- [ ] App icon: `go-live/play-store/icon-512.png`.
- [ ] Feature graphic: `go-live/play-store/feature-graphic-1024x500.png`.
- [ ] Phone screenshots: the 8 files `go-live/play-store/phone-*.png`. You can add tablet screenshots later if you want.
- [ ] Category: **Business**. Contact email and website: from step 3.
- [ ] Optional: a Hindi (hi-IN) listing translation, and the YouTube link of video 01 as the promo video.
- [ ] Do not write prices or "buy on our website" in the Play listing or in the app (8f).

### 8d. App content (Policy → App content)
- [ ] **Privacy policy:** `https://app.yourcompany.in/privacy.html`.
- [ ] **App access:** "All or some functionality is restricted". Give the demo reviewer email and password (step 6; its business has the long free period) and the steps from `PLAY_STORE_LISTING.md`.
- [ ] **Ads:** No.
- [ ] **Content rating:** fill the questionnaire (a business and productivity app with no violence, gambling or user chat with strangers). Expect "Everyone" or 3+.
- [ ] **Target audience:** 18 and over.
- [ ] **Data safety:** copy the answers from `PLAY_STORE_LISTING.md` → *Data safety*. They cover name, email, phone, customer data, the business's subscription status, photos, precise location only when you take a site photo or tap Use my location, encrypted in transit, and deletion on request.
- [ ] **Account deletion:** in-app (Settings → My account → Delete my account) and the web page `https://app.yourcompany.in/delete-account.html`.
- [ ] Government app: No. Financial features: None (it tracks loans, it does not give them). Health: No. News: No.

### 8e. Testing tracks, then production
- [ ] **Internal testing:** upload `SuryaSetu-<version>.aab`, add yourself and colleagues, install from the opt-in link and repeat the phone tests (7c).
  - If Play reports a problem, read the message; for example, "target API" means do 7a.
  - Also check the 16 KB page-size check in *App bundle explorer*. Recent Capacitor versions pass it.
- [ ] **Closed testing** (personal accounts: at least 12 testers opted in for 14 days in a row). Fix anything the **pre-launch report** shows.
- [ ] **Production:** create a release with the same `.aab` (or a newer one), release notes from `docs/publishing/RELEASE_NOTES.md`, countries India (and others if needed), **staged rollout 20%** → send for review.
- [ ] After approval, raise the rollout to 100%. Add the Play Store link on your website and in WhatsApp messages.

### 8f. Google Play and paid subscriptions: what keeps the app within the rules
Google Play's Payments policy requires Google Play Billing for digital services **bought inside the app**. SuryaSetu's app never sells anything:
- the store app (Android and iPhone) shows **no prices, no Pay buttons and no links or words pointing to payment elsewhere**. This is automatic: the app knows it runs inside a store app and hides them;
- businesses buy their plan on your **website**, and the app only shows the status ("Free trial: 5 days left", "changes are paused");
- this "use in the app what you bought elsewhere" model is how Netflix and most business software (SaaS) apps work.

Rules change (and differ by country, for example India's user-choice billing). Before each submission, read Play Console → Policy → *Payments policy*. If Google ever asks you to sell inside the app, the options are Google Play Billing (Google takes 15% of subscriptions) or user-choice billing; both need extra work in the app.

You may tell customers about prices **outside** the app: your website, WhatsApp, email, phone calls.

## 9. The video guide on YouTube (2–3 hours)

- [ ] Follow `user video/README.md`: two playlists (English and Hindi), 21 videos each, uploaded in order.
  - For each video: thumbnail, captions (`.srt`), and the title, description and tags from `playlist.md`.
- [ ] Add your website and Play Store links at the top of every description.
- [ ] The videos show device mode with demo data. Sign-up now offers "Start my business" and "Join my company" in cloud mode; add a short note in the description of video 02 if you like: "On our website, choose Start my business for your free 15-day trial."

## 10. After launch: how every update goes out

Keep `docs/UPGRADING.md` at hand. For every new version:

1. Raise `version` in `package.json`.
2. Run the tests: `npm test`, `npm run e2e`, `npm run acceptance` (and `BROWSER=firefox npm run acceptance`).
3. **If `supabase/schema.sql` changed: run it in Supabase first**, then step 4. Older apps keep working with the new database. A new app on an old database may not.
4. **If `supabase/functions/` changed:** `SKIP_SECRETS=1 PROJECT_REF=<id> bash scripts/deploy-payments.sh` (keeps the keys, deploys the new code).
5. Website: push to GitHub. Netlify deploys by itself, and open apps switch to the new version on their own.
6. Android: `npm run aab` → Play Console → Production → new release.
7. iPhone: `npm run ios` on the Mac → Archive → upload → App Store Connect → new version (section 11).
8. Remind customers to download a backup before big updates (device mode).

Also:
- **Backups.** Supabase Pro keeps daily backups. Also download one from Settings → Backup & data each week for your own business.
- **Security reports** go to your support email. See `docs/publishing/SECURITY.md` and section 13.
- **Grievances** must be answered within the times in `public/grievance.html` (IT Rules 2021). Personal data requests follow India's DPDP Act: correct, export or delete on request.
- **Keep safe:** the signing key and its password, the Supabase database password, the Razorpay keys, and the Netlify, GitHub, Play, Apple, Razorpay and domain logins (all with two-factor authentication).

## 11. Apple App Store (iPhone and iPad) — about a day the first time, plus Apple's review

The website already installs on iPhones (Safari → Share → Add to Home Screen). The App Store app is the same app in an iPhone wrapper. **The iPhone project is ready in `ios/`** (made here with Capacitor): app id, icon, splash screen, the camera / location / photo permission texts Apple requires, and the encryption flag. Apple only lets apps be built on a Mac, so the last steps are yours.

### 11a. What you need
- [ ] A **Mac** (any Mac from about 2019 on, macOS 14 or newer) with **Xcode** from the Mac App Store (open it once and accept the licence). Without a Mac: a cloud Mac (MacinCloud, about US$1/hour) or a CI service with macOS (Codemagic, GitHub Actions macOS runners).
- [ ] **CocoaPods:** `brew install cocoapods` (or `sudo gem install cocoapods`).
- [ ] Node 20 on the Mac, and this project with your `.env` (step 5).
- [ ] An **iPhone** for testing.
- [ ] **Apple Developer Program**: developer.apple.com → Enroll (US$99 a year). As an **organisation** (needs a D-U-N-S number; shows your company name, recommended) or as an individual. Approval takes 1–2 days. Turn on two-factor authentication for the Apple ID.

### 11b. Build and run it on your iPhone
- [ ] On the Mac, in the project folder:
  ```sh
  npm ci
  npm run ios          # = bash scripts/build-ios.sh: builds the pages with the app's security policy,
                       #   copies them into ios/, runs pod install, sets the version, opens Xcode
  ```
- [ ] In Xcode: select **App** in the left list → **Signing & Capabilities** → tick *Automatically manage signing* → **Team**: your developer team. The Bundle Identifier is `in.suryasetu.erp`, or your own id if you set one in step 3 (`fill-details.mjs` changes it in the Xcode project too).
- [ ] Connect the iPhone, pick it at the top of Xcode, press **▶ Run**. (The first time, on the iPhone: Settings → General → VPN & Device Management → trust your developer certificate.)
- [ ] On the iPhone, check what 7c lists for Android, plus:
  - Site photo asks for the camera and then for location, with the texts from `ios/App/App/Info.plist`;
  - Export / Backup opens the iPhone's share sheet (Save to Files, WhatsApp, Mail);
  - email confirmation and password-reset links open the website (`VITE_PUBLIC_URL`);
  - the subscription shows the status only, with no prices or Pay buttons (11e).

### 11c. App Store Connect
- [ ] appstoreconnect.apple.com → **Apps → + → New App**: platform iOS, name SuryaSetu, primary language English (India) or English (UK), bundle id `in.suryasetu.erp`, SKU `suryasetu-ios`, full access.
- [ ] **App Information:** category **Business**, content rights (no third-party content), age rating questionnaire (all "None" → 4+).
- [ ] **Pricing and Availability:** Price **Free**; countries: India (and others if needed).
- [ ] **App Privacy:** privacy policy URL `https://app.yourcompany.in/privacy.html`, then the data types from `docs/publishing/APP_STORE_LISTING.md` → *App Privacy*.
- [ ] **Version page:** screenshots (6.9-inch iPhone: 1320×2868 or 1290×2796; iPad 13-inch if iPad is supported), promotional text, description and keywords from `APP_STORE_LISTING.md`, support URL (`/grievance.html`), marketing URL (your website).
  - Screenshots: in Xcode run the app on the "iPhone 16 Pro Max" simulator with the demo business and press ⌘S, or take them on a real iPhone of that size.
- [ ] **App Review Information:** the demo account (step 6, with its long free period) and the reviewer notes from `APP_STORE_LISTING.md`.

### 11d. Upload, TestFlight, review
- [ ] Xcode → set the device at the top to **Any iOS Device (arm64)** → **Product → Archive** → in the Organizer, **Distribute App → App Store Connect → Upload**.
- [ ] After 10–30 minutes the build appears in App Store Connect → **TestFlight**. Answer the export question (the app already says it uses only standard encryption). Add yourself and colleagues as internal testers and install with the **TestFlight** app.
- [ ] Version page → **Build** → choose the build → **Add for Review → Submit**. Review usually takes 1–3 days.
- [ ] Each later version: raise `version` in `package.json`, `npm run ios` (the build number rises by itself), Archive, Upload, new version in App Store Connect.

### 11e. Apple's rules that matter for this app
- **Payments (guidelines 3.1.1, 3.1.3(f) "free stand-alone apps" and 3.1.3(c) "enterprise services"):** an app that is a free companion to a paid web service may skip Apple's in-app purchase **as long as nothing is sold in the app and there is no call to action to buy elsewhere**. The iPhone app already hides prices, Pay buttons and pricing links (the same switch as Android, 8f). Do not put "subscribe on our website" text in the app, the screenshots or the App Store description. If Apple asks for in-app purchase anyway, the options are Apple's in-app purchase (15–30%) for the iPhone app, or reviewer notes explaining the business-to-business model; reply in App Store Connect → Resolution Center.
- **4.2 Minimum functionality:** Apple rejects "a website in a box". Point the reviewer to the native features: the GPS camera with stamped photos, the share sheet for exports and backups, offline use.
- **5.1.1(v) Account deletion:** Settings → My account → Delete my account deletes the login at once (and the whole business when it is the last person).
- **2.1 Completeness:** the demo account must work for the whole review, with an active plan (step 6).

## 12. Running the subscription business (your daily tools)

All of these are done by you, the provider, in **Supabase → SQL Editor**. (Nobody can run them from the website or the apps.)

```sql
-- All businesses: who, since when, trial end, paid until, plan, number of people
select b.name, b.created_at::date as since, b.trial_ends::date as trial_ends, b.paid_until::date as paid_until, b.plan,
       (select count(*) from profiles p where p.business_id = b.id) as people,
       (select email from profiles p where p.id = b.owner_id) as owner_email
from businesses b order by b.created_at desc;

-- Ending in the next 5 days (call or email them: "your plan ends on …")
select b.name, (select email from profiles p where p.id = b.owner_id) as owner_email,
       greatest(b.trial_ends, coalesce(b.paid_until, b.trial_ends))::date as ends
from businesses b
where greatest(b.trial_ends, coalesce(b.paid_until, b.trial_ends)) between now() and now() + interval '5 days';

-- Payments received (also in the Razorpay dashboard); kept even when the business was deleted later
select sp.paid_at::date, coalesce(b.name, sp.business_name) as business, sp.plan, sp.amount_paise / 100 as rupees, sp.payment_id
from subscription_payments sp left join businesses b on b.id = sp.business_id
where sp.status = 'paid' order by sp.paid_at desc;

-- Give a business extra days (goodwill, a payment by bank transfer or cash, the reviewer account)
select public.vendor_extend('<business id>', 30);

-- Change prices (in paise: ₹1,000 = 100000). Also change public/pricing.html, terms §9 and src/lib/subscription.ts (DEFAULT_PLANS).
update plans set amount_paise = 120000 where id = '1m';

-- Stop selling a plan (it disappears from Settings → Subscription)
update plans set active = false where id = '3m';

-- End a test business's trial now (to see the read-only state)
update businesses set trial_ends = now(), paid_until = null where id = '<business id>';

-- Remove a business completely (its people stay as logins; delete them in Authentication → Users if wanted)
delete from businesses where id = '<business id>';

-- Uploaded files of businesses that were deleted (do this every week or two; the deletion page promises 15 days).
-- Each line is a folder in Storage → files: open it there and delete it. (Supabase does not allow deleting stored
-- files from SQL.) Files of businesses that still exist are never listed, even those of staff who left.
select split_part(o.name, '/', 1) as folder, count(*) as files
from storage.objects o
left join user_business ub on ub.user_id::text = split_part(o.name, '/', 1)
where o.bucket_id = 'files'
  and (ub.business_id is null or not exists (select 1 from businesses b where b.id = ub.business_id))
group by 1 order by 1;
```

- **Refunds:** refund in the Razorpay dashboard (Transactions → Payments → Refund). A refund does **not** shorten the plan by itself; if you refund in full, also shorten it: `update businesses set paid_until = now() where id = '<business id>';`.
- **GST invoices:** Razorpay's receipt is not a GST tax invoice. If you are GST-registered, issue a GST invoice for each payment (your accounting software, or Razorpay Invoices), with the customer's GSTIN when they give it. Ask a CA about the place-of-supply and e-invoicing rules for your turnover.
- **Reminders:** the app shows the days left to the admin in the last days of the trial or plan. You may also email or WhatsApp them (outside the app) with your website's pricing link.
- **Failed or stuck payments:** if a customer says "money taken, plan not added", look in Supabase → Edge Functions → razorpay-webhook → Logs and in `subscription_payments` (`created` = never confirmed). If Razorpay shows the payment captured, run `select public.apply_subscription_payment('<order_…>', '<pay_…>', <amount in paise>);` once (it does nothing if already applied).

## 13. Security: what can happen, and what stops it

The rule behind everything: **whatever decides money or access runs on your server** (the Supabase database and the payment functions), never in the website or the app. A browser or a phone runs code its owner can read and change, as on every website and app in the world, so that code holds no secrets and decides nothing. It only shows what the server allows.

| What someone might try | What would happen | What stops it (already built) | What you should do |
|---|---|---|---|
| **Copy your code** ("code chori"): save the website's files, or unpack the APK | They get the screens' code (minified, hard to read), but no secrets and none of your data | The value is on the server: database rules, payment functions, your customers' data, your Supabase project and keys. A copy pointed at your server gets nothing extra; a copy on their own server is an empty product without your customers. The anon key in the website is public by design and opens nothing on its own | Keep the GitHub repository **private**; turn on 2FA everywhere. Your software is protected by the Copyright Act, 1957 (as a literary work) and your Terms §7 and §11. Keep the dated git history and consider registering the copyright (copyright.gov.in) for strong proof. If someone publishes a copy: Google Play's and Apple's intellectual-property complaint forms, a DMCA notice to the host, and a lawyer's notice |
| **Mod APK**: a changed app that "unlocks premium", hides the banner or fakes "active" | It shows "active" on that phone, but **every save is refused by the database** ("changes are paused"), because the database checks the subscription on every write. There is nothing in the app to unlock | Database rules and triggers (tested: insert, update, delete, files, restore and enquiries are all refused when a business is not active; the tables and functions that decide it cannot be changed from any app) | Nothing more is needed for the subscription. Tell customers to install only from Play / App Store / your website |
| **Fake app** that copies your look to steal passwords (phishing) | Staff type passwords into someone else's app | Google Play App Signing and your upload key: nobody can publish an update of *your* app; Android refuses an update signed with another key | Publish only under your developer account; put the official Play and App Store links on your website; report impostors in Play Console / to Apple |
| **Change the price** in the browser before paying | — | The server reads the price from the `plans` table and creates the Razorpay order for exactly that amount; the browser only says which plan | — |
| **Fake a successful payment** (send a made-up "payment id") | — | The payment is accepted only if Razorpay's signature matches your **secret key** (never sent to the browser) **and** Razorpay itself confirms the payment is captured, for that order, in rupees, for the full amount | Never put the Razorpay Key Secret anywhere except `deploy-payments.sh` |
| **Use one payment twice**, or send the webhook twice | — | Each order and each payment id counts once (unique in the database, row locked while applying); repeats return "already applied" | — |
| **Fake a webhook** call | — | The webhook acts only on requests signed with your webhook secret | Use a long random webhook secret |
| **Call the billing functions directly** or edit the `businesses` table to extend the trial | — | Only the payment server (service role) may call them; the app's login can only *read* its own business (tested). The payment server's two app-facing functions refuse anyone Supabase Auth does not confirm as signed in | Never share the `service_role` key |
| **Endless free trials** (sign up again every 15 days, or delete everything, sign up again and restore the backup) | Free use for ever | The database remembers every email and mobile number that had a free trial (as one-way hashes), **also after the account and business are deleted**: the same email or number starts with no trial, and a business without an active trial or plan cannot restore a backup either (tested) | A new email plus a **made-up** number would still get a trial: turn on SMS codes and `trial_needs_sms` (step 4), so each trial needs a real SIM |
| **Account sharing** ("one login for everyone", as people do with Netflix) | — | Not worth it: one plan covers **every user** of a business, so each staff member simply gets their own login, with their own role | If you ever charge per user, add a user limit in the database at that time |
| **See another company's data** | — | Every record, person, file, counter and enquiry belongs to one business, and the database shows each person only their own business (tested: reading, changing, deleting, planting records, files, stock, numbering, people, phone numbers). A file belongs to the business of whoever uploaded it, so a file path copied into another business's record opens nothing (tested). The company code is shown only to the admin | — |
| **A staff member leaves** or loses a phone | They could still sign in | The admin disables or deletes the user (Settings → Users & access); from that moment the database refuses that login everything, even on a phone that is still signed in | Ask staff to use a screen lock |
| **Leaked keys** | Depends on the key | The anon key is public by design. The `service_role` key and the Razorpay secrets live only in Supabase's secret store | If one leaks: Supabase → Project Settings → API → roll the key; Razorpay → regenerate keys, then run `deploy-payments.sh` again |
| **Guess passwords, spam sign-ups or enquiries** | — | Supabase Auth's rate limits; email confirmation; enquiry form limits (5 per hour per connection, 1 per mobile per day, hidden bot field) | Keep Supabase's rate limits on (Authentication → Rate Limits). (Supabase's CAPTCHA option would also need a change in the app's sign-in screen; do not switch it on by itself) |
| **Inject code** (XSS) into a page | — | The Content-Security-Policy lets the page run only its own code (and Razorpay's checkout, only for paying); React escapes all text | Keep `netlify.toml`'s headers |
| **Lose the database** | Lost data | Supabase Pro daily backups | Weekly backup download; optional Point-in-Time Recovery add-on |

What is honestly **not** possible: no app can stop someone photographing a screen, or a person with a login copying what they are allowed to see. Make sure only the right people have logins and the right roles.

Optional extra hardening (not needed for the subscription to be safe):
- **Play Integrity API** (Android) and **App Attest** (iPhone) to refuse requests from changed apps. Useful against automated abuse; they need a small server check.
- **Code obfuscation** beyond minification. It slows down copying a little, does not stop it, and makes errors harder to debug; usually not worth it.
- A yearly **security review** by an outside tester (CERT-In empanelled auditors in India) once you have many paying customers.

---

### Quick checklist

- [ ] 2 Project on your computer, tests pass, pushed to a **private** GitHub repository
- [ ] 3 `go-live/my-details.json` filled, `node scripts/fill-details.mjs` run
- [ ] 4 Supabase: schema run, email confirmation on, auth URLs, custom SMTP, URL, anon key and project id copied, Pro plan, 2FA
- [ ] 5 Netlify: env vars (no Razorpay keys there), deployed, domain with HTTPS
- [ ] 5b Razorpay: account activated; payment server deployed with `deploy-payments.sh`; webhook added; test payment, then live keys
- [ ] 6 Your own business set up; colleague joined with the company code; reviewer demo business with a long free period
- [ ] 7 Capacitor upgraded for Play's target API; `.aab` built; **signing key backed up twice**; tested on two phones (no prices in the app)
- [ ] 8 Play: account, listing, app content, internal → closed → production
- [ ] 9 YouTube playlists uploaded
- [ ] 10 Update routine understood (schema first, then payment functions, then website, then apps)
- [ ] 11 iPhone: Apple Developer account, `npm run ios` on a Mac, tested on an iPhone, TestFlight, review
- [ ] 12 Provider SQL queries saved in Supabase (SQL Editor → save each as a snippet)
- [ ] 13 Security table read; 2FA on every account; keys only where this guide says

(`SuryaSetu-Go-Live-Guide.pdf` in this folder is the older version of this guide; this file and `GO-LIVE-STEPS.pdf` replace it. After editing this file, make the PDF again with `node scripts/make-guide-pdf.mjs`.)
