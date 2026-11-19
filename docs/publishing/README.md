# Publishing, legal and store-listing documents

App: SuryaSetu (“the App”)

Everything you need to put the App on the web, on Google Play and on the Apple App Store. The legal documents are **templates**: have them reviewed by a lawyer before publishing.

## 1. Fill these placeholders first

Search for `[` in `docs/publishing/` and `public/*.html` and replace every placeholder in one pass.

| Placeholder | What to put | Example |
|---|---|---|
| `[Legal entity name]` | The registered name of the company or person publishing the App | Surya Tech Solutions Pvt Ltd |
| `[Registered address]` | Full registered address with PIN code | 2nd Floor, 12 MG Road, Pune, Maharashtra 411001 |
| `[Grievance Officer name]` | A named person resident in India who answers complaints | Priya Sharma |
| `[support email]` | A monitored mailbox for support, privacy, deletion and security reports | support@example.in |
| `[SMS provider name]` | The SMS company that sends one-time codes (only if `VITE_PHONE_OTP=1`); delete that sentence from the privacy policy if SMS codes are off | Twilio |
| `[phone]` | Support phone with country code | +91 98765 43210 |
| `[website URL]` | The HTTPS address of the deployed App, no trailing slash | https://app.example.in |
| `[Effective date]` | Date the documents take effect | 1 December 2026 |
| `[Jurisdiction city]` | City whose courts handle disputes | Pune |
| `[Lead retention period]` | How often unconverted leads are reviewed and deleted (Privacy Policy §8) | 24 months |
| `[Fees and refund terms]` | Your refund rule for a plan that has started (Terms §9 and `pricing.html` §7); the plans and prices themselves are already written in | fees for a plan that has already started are not refunded, except where the law requires it. |
| `[Liability cap amount]` | Liability cap if the customer paid nothing (Terms §13) | 10,000 |
| `[Copyright year]` | For the App Store copyright line | 2026 |
| `[Demo account email]` / `[Demo account password]` | A demo admin login for store reviewers (cloud mode, demo data only) | review@example.in |
| `[Play package id]` | Android package name, set once and never changed (section 5) | in.example.suryasetu |

The mailto link in `public/delete-account.html` contains `[support email]` inside the link; replace it there too.

**Renaming the App?** `npm run rename` does not touch these files. After renaming, also find-and-replace `SuryaSetu` in `docs/publishing/` and `public/*.html`, and update the store listings.

## 2. The documents

| File | Purpose | Where it must be published |
|---|---|---|
| [PRIVACY_POLICY.md](PRIVACY_POLICY.md) | What data the App handles, why, where, how long, and your rights (DPDP Act, IT Act) | `[website URL]/privacy.html` (from `public/privacy.html`). Required by Play and Apple. |
| [TERMS_OF_SERVICE.md](TERMS_OF_SERVICE.md) | Software terms between the publisher and the business using it, acceptable use, liability, governing law | `[website URL]/terms.html` (from `public/terms.html`) |
| [DATA_DELETION.md](DATA_DELETION.md) | How to request account and data deletion, what must be kept for tax law, timelines | `[website URL]/delete-account.html` (from `public/delete-account.html`). This is the Play “Delete account URL”. |
| [GRIEVANCE_REDRESSAL.md](GRIEVANCE_REDRESSAL.md) | Grievance Officer details and complaint timelines | `[website URL]/grievance.html` (from `public/grievance.html`) |
| [COOKIE_AND_STORAGE_NOTICE.md](COOKIE_AND_STORAGE_NOTICE.md) | Every item the App keeps in browser storage, and that there is no tracking | Optional on the website; a summary is already in the Privacy Policy §13 |
| [SECURITY.md](SECURITY.md) | How data is protected, known gaps, breach steps, responsible disclosure | Optional on the website; keep in the repository |
| [ACCESSIBILITY.md](ACCESSIBILITY.md) | Honest accessibility statement and contact | Optional on the website |
| [PLAY_STORE_LISTING.md](PLAY_STORE_LISTING.md) | Play title, descriptions, Data safety answers, content rating, app access | Paste into Play Console |
| [APP_STORE_LISTING.md](APP_STORE_LISTING.md) | App Store text, App Privacy answers, age rating, review notes, export compliance | Paste into App Store Connect |
| [RELEASE_NOTES.md](RELEASE_NOTES.md) | v1.0.0 notes for users and the stores | Play “Release notes”, App Store “What’s New” |
| [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md) | Open-source packages in the bundle and their licences | Keep in the repository; link from the website or store listing if you like |

The four `public/*.html` pages are copies of the matching Markdown files. If you change one, change the other.

## 3. Laws these documents are written around

- **Digital Personal Data Protection Act, 2023** and the **DPDP Rules, 2025** (notified November 2025; most duties start on dates set in the Rules, so check which apply now). The installing business is the Data Fiduciary for its customers’ and staff data. You provide the software, and act as a Data Processor if you host it.
- **Information Technology Act, 2000** and the **IT (Reasonable Security Practices and Procedures and Sensitive Personal Data or Information) Rules, 2011**: privacy policy, reasonable security, Grievance Officer (resolve within one month).
- **IT (Intermediary Guidelines and Digital Media Ethics Code) Rules, 2021**: if you host data for other businesses you may count as an intermediary; the documents follow its timelines (acknowledge in 24 hours, resolve in 15 days) as good practice.
- **CGST Act, 2017 (section 36)**: books and records must be kept until 72 months from the due date of the annual return for the year, longer if proceedings are pending. The App blocks invoice deletion for this reason.
- **Companies Act, 2013**: companies keep books of account for eight financial years.
- **CERT-In Directions (April 2022)**: report cyber incidents within 6 hours where they apply.
- **Consumer Protection (E-Commerce) Rules, 2020: not covered**, because the App does not sell goods or services to consumers online. It is business software; the enquiry form only asks a business to call back, and no order, payment or checkout happens in the App. If you later sell subscriptions online to individuals, or add online ordering for end customers, revisit this.
- **Aadhaar:** the App can store uploaded KYC copies. Advise businesses to keep masked Aadhaar copies only.

## 4. Things in the code to know before publishing

Checked against the code when these documents were last updated.

**Done (no action needed):**
- In-app account deletion: **Settings → Delete my account** (type DELETE), and admins can delete other users (**Settings → Users & roles → Edit → Delete user**). Database functions `delete_my_account()` and `admin_delete_user()`; the last active admin cannot be deleted.
- The enquiry form stores only an MD5 hash of the connection’s IP address (with a fixed prefix), for about a day, and shows a privacy-policy link.
- The sign-in screen links to Privacy, Terms, Delete account and Grievance.
- `netlify.toml` sends a Content-Security-Policy, HSTS, `X-Frame-Options: DENY`, `X-Content-Type-Options`, `Referrer-Policy` and `Permissions-Policy` (see SECURITY.md).
- The service worker caches only the App’s start page; `/privacy.html` and the other policy pages always come from the network.
- “Use my location” reads the device GPS once, only when tapped, on customer and installation forms.
- The India map uses bundled data only (`src/lib/geo/indiaMap.ts`) and shows its attribution under every map. Sources are in `docs/third-party/map-data-sources.md` and THIRD_PARTY_NOTICES.md.

**Closed in 1.1.0 (A–Z review):** files can be opened only by the uploader, the admin, or someone who may see a record that uses the file (KYC copies are as private as their document records); uploads go into the uploader's own folder with allowed file types only; files are deleted only by the admin or a manager in their own folder; stock entries must belong to a real purchase order, challan or matching transfer; the change history works in cloud mode; account deletion works for people who moved stock; the enquiry limit uses the real visitor address and has a hidden bot trap; an unconfirmed sign-up cannot hold a mobile number for more than a day.

**Supabase settings the security depends on (keep them on):** Authentication → *Confirm email* (the owner becomes admin only after confirming), *Secure password change* (asks for a recent sign-in before a new password), and *Leaked password protection* where your plan offers it.

**Still open:**
1. **Enquiry IP hashes are pseudonymous, not anonymous.** They use a secret per-database salt, but someone with full database access could still match them. They are kept only about a day.
2. Rows in `enquiry_log` older than a day are removed only when the next enquiry arrives; consider a scheduled clean-up if enquiries are rare.

Closed since the first review: deleting a record now also deletes its stored file (cloud mode); enquiry hashes now use a secret salt; the Android app now has the same Content-Security-Policy as the website (a meta tag added by `npm run apk`, every screen and the camera tested under it). Test it once more on a real phone with the signed APK before the Play release.

## 5. Publishing checklist

### Step 1 — Domain and HTTPS
- [ ] Choose the address. A custom domain (for example `app.example.in`) looks better in stores than `*.netlify.app`, and you cannot change a Play TWA’s domain later without a new release.
- [ ] Netlify → Domain management → add the domain → set the DNS records → wait for the free Let’s Encrypt certificate → turn on **Force HTTPS**.
- [ ] The App refuses to run on plain `http://`, so check `https://` works on a phone.

### Step 2 — Fill placeholders and review
- [ ] Replace every placeholder (section 1) in `docs/publishing/` and `public/*.html`.
- [ ] Have a lawyer review the Privacy Policy, Terms, Data Deletion and Grievance pages.
- [ ] Appoint the Grievance Officer and make sure `[support email]` is monitored daily (24-hour acknowledgement).

### Step 3 — Host the policy pages
- [ ] The four pages are in `public/`, so `npm run build` copies them to `dist/` and Netlify serves them as-is.
- [ ] Check after deploy: `[website URL]/privacy.html`, `/terms.html`, `/delete-account.html`, `/grievance.html` all open, on a phone, in light and dark mode.
- [ ] `netlify.toml` has **no redirects**, and there is no `public/_redirects` file, so nothing rewrites these URLs. (The App uses a hash router, `#/…`, so it never needs a catch-all redirect. If you add one later, add the HTML pages before it or use a non-forcing rule, because Netlify serves an existing file before a non-forced redirect.)
- [ ] Check the links on the sign-in screen (Privacy, Terms, Delete account, Grievance) and the privacy link on the enquiry form open the right pages.

### Step 4 — Supabase region and settings (cloud mode)
- [ ] Project region: **Mumbai (ap-south-1)**. It cannot be changed later without moving the data.
- [ ] Run `supabase/schema.sql` with the owner’s email on line 9.
- [ ] Authentication → Email: **Confirm email ON**. Set **Site URL** and **Redirect URLs** (`[website URL]/**`).
- [ ] Set up custom SMTP (Brevo, Resend or similar), and name it in your privacy policy if it is outside India.
- [ ] Never put the `service_role` key in the App or in Netlify variables.
- [ ] Turn on two-factor sign-in for the Supabase, Netlify and GitHub accounts.
- [ ] For a business you depend on, use a paid plan (daily backups, no pausing). Download a JSON backup weekly either way.
- [ ] Create the **demo account** for store reviewers: sign up with `[Demo account email]`, approve it as admin (or use a separate demo project), and fill it with demo data only.

### Step 5 — Google Play (Trusted Web Activity)
A Trusted Web Activity (TWA) opens your website full-screen inside an Android app, using Chrome.

1. [ ] Create a Google Play developer account (one-time US$25). Organisation accounts need a D-U-N-S number. Complete identity verification.
2. [ ] Build the Android package with **PWABuilder** (pwabuilder.com → enter `[website URL]` → Package for stores → Android) or **Bubblewrap**:
   ```bash
   npm i -g @bubblewrap/cli
   bubblewrap init --manifest [website URL]/manifest.webmanifest
   bubblewrap build        # produces app-release-bundle.aab and a signed APK
   ```
   - Package id: `[Play package id]`. It can never change.
   - App name and launcher name: from the manifest (`SuryaSetu`).
   - Start URL `/`, theme colour `#0f6b5c`, background `#f4f6f8`, icon `icon-512.png` (maskable icon included).
   - Leave notification delegation **off** (the App sends no push notifications). Location delegation is optional: with it off, Chrome asks for location permission itself when someone taps “Use my location”; with it on, add the Android location permission and keep the Data safety answers as they are.
3. [ ] **Signing key.** Bubblewrap or PWABuilder creates an upload key (`.keystore`). Back it up in two safe places with its passwords. Enrol in **Play App Signing** (Google holds the app signing key).
4. [ ] **Digital Asset Links.** Create `public/.well-known/assetlinks.json` so Android trusts your site and hides the browser bar:
   ```json
   [{
     "relation": ["delegate_permission/common.handle_all_urls"],
     "target": {
       "namespace": "android_app",
       "package_name": "[Play package id]",
       "sha256_cert_fingerprints": [
         "<SHA-256 of the Play App Signing key: Play Console → Test and release → App integrity>",
         "<SHA-256 of your upload key, for testing builds you install yourself>"
       ]
     }
   }]
   ```
   Deploy, then check that `[website URL]/.well-known/assetlinks.json` opens and that `dist/.well-known/assetlinks.json` exists after `npm run build`. If the address bar still shows in the app, the fingerprint is wrong.
5. [ ] Create the app in Play Console. Fill in **Store listing** from `PLAY_STORE_LISTING.md` (title ≤ 30, short description ≤ 80, full description ≤ 4000 characters).
6. [ ] Graphics:
   - App icon **512 × 512** PNG, 32-bit, up to 1 MB.
   - Feature graphic **1024 × 500** JPEG or 24-bit PNG (no transparency).
   - Phone screenshots: **2–8**, JPEG or 24-bit PNG, **16:9 or 9:16**, each side **320–3,840 px**, long side at most twice the short side. At least 4 at 1080 px or more for better placement.
   - Optional 7-inch and 10-inch tablet screenshots.
   - Demo data only in every image.
7. [ ] **App content:** privacy policy URL, ads = No, app access (demo account), content rating, target audience **18+**, Data safety, financial features = none, government app = no, account deletion URL = `[website URL]/delete-account.html`. All answers are in `PLAY_STORE_LISTING.md`.
8. [ ] **Testing track:** upload the `.aab` to **Internal testing**, install from the Play link, check sign-in, email links, uploads, print, WhatsApp and phone links, and that no browser bar shows. Then **Closed testing**: new personal accounts need at least 12 testers opted in for 14 days in a row before production access (check the current rule in Play Console).
9. [ ] Test **Settings → Delete my account** with a spare account, and admin **Delete user**, inside the Play build.
10. [ ] **Release:** Production → create release → paste notes from `RELEASE_NOTES.md` → staged rollout (for example 20%) → full rollout.
11. [ ] Each year, rebuild with the latest Bubblewrap/PWABuilder so the app meets Play’s target API level rule. Website updates reach the app straight away; a new Play release is only needed for wrapper changes.

**Only for one company’s staff?** Each deployment serves one business. If the Play app is only for your own staff, consider publishing it as a **private app through Managed Google Play** instead of a public listing. If you want to serve many installers from one public listing, the App would need multi-company support, which it does not have today.

### Step 6 — Apple App Store (native wrapper, with caveats)
Read the first section of `APP_STORE_LISTING.md`. In short:

- [ ] Decide whether you need the App Store at all. **Safari → Share → Add to Home Screen** already installs the App on iPhone and iPad for free.
- [ ] If yes: Apple Developer Program (US$99/year), a Mac with Xcode, and a wrapper: **PWABuilder iOS package** (quick, higher rejection risk under guideline 4.2) or **Capacitor** (more work, lets you add native features).
- [ ] Test **Settings → Delete my account** inside the wrapper (guideline 5.1.1(v)).
- [ ] No in-app purchases or prices in the iOS app.
- [ ] For a single company, consider **Custom App distribution through Apple Business Manager**.
- [ ] Fill App Store Connect from `APP_STORE_LISTING.md`: name, subtitle, promotional text, keywords, description, URLs, App Privacy, age rating 4+, review notes with the demo account, export compliance (`ITSAppUsesNonExemptEncryption` = false).
- [ ] Test with **TestFlight** first, then submit for review.

### Step 7 — After launch
- [ ] Answer grievances within 24 hours / 15 days. Keep a simple log of requests and replies.
- [ ] Handle deletion requests within the timelines in `DATA_DELETION.md`.
- [ ] Keep `THIRD_PARTY_NOTICES.md` current when dependencies change.
- [ ] Review the documents when the App changes (new data fields, new services, analytics, push notifications) and update the store Data safety / App Privacy answers at the same time.
