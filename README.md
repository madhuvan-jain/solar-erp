# SuryaSetu — Solar business manager

One app for a solar EPC business: leads → site survey → quotation → project → installation → invoice → payment → service/AMC,
plus inventory, vendors & purchase orders, subsidy (PM Surya Ghar) tracking, loans/EMI, documents, staff & attendance,
alerts and reports.

It is a **Progressive Web App (PWA)**. The same website works in any browser, and it can be installed like a normal app
on **Android, iPhone/iPad and Windows**. You don't need an app store for that, and it's free.

---

## 1. Run it on your computer

```bash
cd solar-erp
npm install
npm run dev          # open the http://localhost:5173 link it prints
```

The app requires an internet connection and a shared Supabase cloud project. Copy `.env.example` to `.env` and set
`VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`, and `VITE_PHONE_OTP=1` after configuring SMS verification. Without the
cloud settings, the app will explain that online setup is required rather than silently creating device-only data.

### Shared cloud data

| Mode | When | Where data lives |
|---|---|---|
| **Cloud mode** | Supabase keys set and internet available | Supabase database. Authorized staff on every phone and computer see the same business data live. |

---

## 2. Rename the app

```bash
npm run rename -- "Your Name"
npm run build
```

This updates the name on the sign-in screen, the sidebar, the browser tab and the installed-app icon label.

---

## 3. Put it online for free (cloud mode)

You need three free accounts. **Create them yourself** with your email: each one sends a verification email,
and the owner of the business should own the accounts.

| Service | Used for | Free plan |
|---|---|---|
| [GitHub](https://github.com/signup) | Stores the code | Free |
| [Supabase](https://supabase.com/dashboard/sign-up) | Database, logins, file storage | 500 MB database, 1 GB files, 50k users. Free projects **pause after 7 days with no use**; open the app or the dashboard to resume. |
| [Netlify](https://app.netlify.com/signup) (sign up *with GitHub*) | Hosts the website | Free starter plan (Cloudflare Pages or Vercel work the same way: build `npm run build`, output `dist`) |

### Step A — Database (Supabase)

1. Supabase → **New project**. Pick region **Mumbai (ap-south-1)** and save the database password somewhere safe.
2. (Nothing to edit in the file.) Each company that signs up with **Start my business** gets its own separate business,
   with a 15-day free trial, and its founder as admin. Staff join with the company code and wait for approval.
3. Left menu → **SQL Editor** → **New query** → paste the whole file → **Run**. It should say "Success. No rows returned."
   It is safe to run again later, for example after an update.
4. **Authentication → Sign In / Providers → Email**: keep **Confirm email ON**.
5. **Authentication → URL Configuration**:
   - **Site URL** = your Netlify address from Step C, e.g. `https://suryasetu.netlify.app` (you can do this after Step C)
   - **Redirect URLs** → add `https://suryasetu.netlify.app/**`. Confirm-email and reset-password links need this.
6. **Project Settings → API**: copy the **Project URL** and the **anon public** key.
7. **Emails: set up an email sender. This is needed for real use.** Supabase's built-in sender only sends a few emails per
   hour, so sign-up and reset emails stop arriving once several staff sign up. Create a free account at
   [Brevo](https://www.brevo.com) or [Resend](https://resend.com). Then in Supabase → **Authentication → Emails → SMTP Settings**,
   enable custom SMTP with their host, port, user and password. You can test with the built-in sender first.

> The *anon* key is meant to be public; the database's row-level security protects your data.
> Never put the **service_role** key in the app.

### Step B — Code on GitHub

```bash
cd solar-erp
git init && git add . && git commit -m "Initial version"
# create an empty PRIVATE repository on github.com, then:
git remote add origin https://github.com/<your-user>/solar-erp.git
git branch -M main && git push -u origin main
```

### Step C — Website (Netlify)

1. Netlify → **Add new site → Import an existing project → GitHub** → pick the repository.
   The build settings are read from `netlify.toml`.
2. **Site configuration → Environment variables**: add
   - `VITE_SUPABASE_URL` = the Project URL
   - `VITE_SUPABASE_ANON_KEY` = the anon key
3. **Deploys → Trigger deploy**. Your site is live at `https://<name>.netlify.app`.
   You can change `<name>` under Site configuration → Change site name.
4. Paste that address into Supabase → Authentication → URL Configuration → Site URL.

### Step D — First login

1. Open the site → **Create account → Start my business** → open the confirmation email.
   That account is the admin of the new business (15-day free trial; plans and payments: `GO-LIVE-STEPS.md`, step 5b).
2. Staff open the invite link from **Settings → Users & access** (or **Create account → Join my company** with the company code) → they see "Waiting for approval".
3. Admin → **Settings → Users & roles** → Edit → choose their role (Sales, Technician, Accounts, Manager).
4. Admin → **Settings → Company profile**: add the company name, GSTIN, state and bank details. These print on invoices.
   **State** decides whether CGST + SGST or IGST is charged.

Every `git push` to `main` redeploys the site automatically.

---

### Step D2 — Mobile verification and password reset by SMS

For live cloud use, set up SMS verification before opening sign-up. Every cloud account must confirm its email by link
and its mobile number by SMS code. Password reset is less restrictive: each person can use **either** their email link
or their SMS code; they do not need both to reset a password.

1. **India: DLT registration first.** TRAI rules require every business that sends SMS in India to register on a DLT platform
   (Jio, Vodafone Idea, Airtel, BSNL…): the business itself, a 6-letter sender ID (header) and the OTP message template,
   e.g. `{#var#} is your SuryaSetu code. It is valid for 5 minutes. Do not share it.` Unregistered messages are blocked by the networks.
2. Create an account with an SMS provider that Supabase supports and that delivers DLT-registered OTPs in India
   (Supabase lists Twilio, Twilio Verify, MessageBird, Vonage and Textlocal). Enter your DLT entity ID and template ID there if it asks.
3. Supabase → **Authentication → Providers → Phone**: switch it on, choose the provider, paste its keys and the same
   message template (Supabase puts the code where the template has `{{ .Code }}`).
4. Netlify → **Site configuration → Environment variables**: add `VITE_PHONE_OTP` = `1`, then **Deploys → Trigger deploy**.

Test a full sign-up, email confirmation, mobile confirmation and both password-reset options before launch. The app blocks
cloud sign-up until SMS verification is configured, and blocks access for accounts whose email or mobile is unverified.
Each SMS costs money with your provider; Supabase also limits how often codes can be requested.

Device mode cannot send email or SMS (there is no server, and provider credentials must not be put in the browser).
There the admin's saved recovery code is the recovery route and staff must contact their admin.

### Step E — Backups (do not skip)

The Supabase free plan has **no automatic backups**, and it pauses a project after 7 days with no use. Opening the
site or the dashboard resumes it; no data is lost.

- **At least weekly:** Settings → **Download backup** and keep the file somewhere safe (Google Drive, a pen drive).
- **For a business you depend on:** Supabase Pro (about US$25/month) adds daily backups and no pausing.

Restoring a backup (Settings → Restore) is admin-only. It keeps the original document numbers, so numbering carries on correctly.

### If something goes wrong

| Problem | Fix |
|---|---|
| Sign-up / reset email never arrives | Check spam. Then set up custom SMTP (Step A.7). |
| "Waiting for approval" for the owner | The email in `app_config` must match exactly and be confirmed. Run in SQL Editor: `update profiles set role='admin' where email='you@…';` |
| Reset link opens the sign-in page | Add `https://<your-site>/**` to Redirect URLs (Step A.5). |
| "Secure connection needed" | Use the `https://` address. Browsers block what the app needs on `http://`. |
| Forgot admin password (device mode) | Sign-in page → "Use recovery code" (the code shown at setup). |

## 4. Install as an app (free)

| Device | How |
|---|---|
| **Android** (Chrome) | Open the site → ⋮ menu → **Install app** / **Add to Home screen** |
| **iPhone / iPad** (Safari) | Open the site → **Share** → **Add to Home Screen** |
| **Windows** (Edge or Chrome) | Open the site → the **Install** icon in the address bar (or ⋯ → Apps → Install) |

It opens full-screen with its own icon, like a native app.

### Optional: list it on the app stores (not free)

- **Google Play**: one-time **US$25** developer fee. Go to [pwabuilder.com](https://www.pwabuilder.com), enter your site URL and
  download the **Android package**. It is free to generate. Upload it in Play Console.
- **Apple App Store**: **US$99/year** Apple Developer membership. PWABuilder can also generate an iOS project,
  but building it needs a Mac with Xcode. Apple sometimes rejects apps that only wrap a website.

---

## 5. Website enquiry form

Share `https://<your-site>/#/enquiry` on your website, Google Business profile, Instagram bio or WhatsApp.
Each enquiry appears instantly as a **New lead (source: Website)** and is auto-assigned to a sales user. This needs cloud mode.

---

## 6. Day-to-day features

The full list is in **[docs/FEATURES.md](docs/FEATURES.md)**, and a staff guide is in **[docs/USER_GUIDE.md](docs/USER_GUIDE.md)**.
In short:

- **Home screen with one tile per app** (CRM, Sales, Projects, Installation, Inventory, Purchase, Accounts, Subsidy,
  Solar Loans, Service, Documents, Team, Dashboard, Reports, Alerts, Settings). Each app has its own menu bar.
  A search box finds any customer, invoice, phone number, GSTIN or SKU.
- **Every list has six views**: List, Board (drag or pick a stage), Calendar, Pivot (rows × columns × measure, CSV),
  Graph (bar, line, donut) and Map. CSV import and export, and printing.
- **Dashboard**:
  - KPIs with a trend against the previous period: invoiced, collected, receivables and overdue amounts,
    open quotations, new leads, conversion rate, kW installed, active projects and open tickets.
  - A period filter: this month, 3 months, this financial year, 12 months or all time.
  - An **India map** that shades states by sales or customers and shows customer dots. It uses
    Survey-of-India-style boundaries and is bundled with the app, so it works offline.
  - Charts you can switch between chart types, each with a table view.
- **Sales and purchase lines**:
  - Picking a product fills its description, HSN, unit, GST and price. Sales use the sale price; purchase orders use the cost.
  - Each line has its own discount %, and there is a document discount.
  - Sales documents warn when stock is short.
- **GST**:
  - CGST + SGST within the state and IGST across states, worked out from the customer's state for sales and the vendor's state for purchases.
  - Round-off, HSN summary, and the amount in words.
  - Numbering per financial year (`INV/26-27/0001`).
  - Issued invoices are cancelled, never deleted.
- **Delivery challans**: sending material to a site takes it out of stock once. Cancelling puts it back.
  Received purchase orders add stock once and are then locked.
- **13 printable documents (Print / Save as PDF)**:
  - Quotation, with generation, savings and payback estimates.
  - Tax invoice, with a UPI QR code for the balance, bank details and Original/Duplicate/Triplicate copies.
  - Receipt, purchase order, delivery challan, installation & commissioning certificate, site survey report,
    service report, AMC contract, customer statement of account, expense voucher, project summary with margin,
    and loan EMI schedule.
- **Print templates** (Settings): logo, signature or stamp, accent colour, layout (Classic, Modern or Compact),
  tagline, terms for each document, declaration and footer. Only one company per installation, with details set by the admin.
- **Reports**:
  - GST on sales and purchases (with an indicative net figure), HSN-wise summary and receivables ageing.
  - Product-wise sales, stock valuation, cash flow, expenses and lead sources. All of them export as CSV.
- **Location**: a PIN code fills the state. "Use my location" takes GPS at the site. Google Maps links.
- **Leads**: a duplicate-phone warning, follow-up reminders, WhatsApp and call buttons, auto-assign,
  and Won → customer. **Share on WhatsApp** from invoices, quotations, receipts and statements.
- **Safe for teams**: a second person editing the same record is warned instead of overwriting.
  The database enforces stock, payment and permission rules.
- **Roles**: Admin, Manager (only these two can delete), Sales, Technician and Accounts.
  Anyone can **delete their own account** in Settings, and admins can delete users.

---

## Documents for publishing

`docs/` contains everything needed to show, test and publish the app:

| File | For |
|---|---|
| `docs/FEATURES.md` | Feature list (sales, test team) |
| `docs/USER_GUIDE.md` | Staff guide |
| `docs/*-Brochure.pdf` | Product brochure with screenshots (`node scripts/brochure/make-brochure.mjs` rebuilds it) |
| `public/demo/demo-data.json` | Demo data for testing (Settings → Demo data). Same fictional company as the brochure; `npm run demo-data` rebuilds it |
| `docs/publishing/` | Privacy policy, terms, data deletion, cookie/storage notice, grievance officer, security, accessibility, Play Store and App Store listings, release notes, third-party licences, and a publishing checklist |
| `docs/third-party/map-data-sources.md` | Map data sources, licences and attribution |
| `public/privacy.html`, `terms.html`, `delete-account.html`, `grievance.html` | The same policies as web pages. They are deployed with the site, for store listings. |

Fill in the `[placeholders]` listed in `docs/publishing/README.md` before publishing.

---

## 7. Tests

```bash
npm test             # unit, UI and database-rule tests (the SQL runs in an in-memory Postgres)
npm run build
npm run e2e          # real-browser smoke test: a record in every module, every list/board/print page
npm run acceptance   # real-browser feature test: every feature, roles, backup, offline, phone (touch),
                     # challans, print templates, discounts, PIN/GPS location, views, search
                     # add BROWSER=firefox (or webkit) in front to use another browser
```

The first `npm run e2e` needs `npx playwright install chromium`.

## Project layout

```
src/modules/registry.ts   every module and its fields (add a field here and it appears in forms, lists, CSV)
src/lib/store/            data layer: device (local.ts) and cloud (cloud.ts) backends + business rules (store.ts)
src/lib/                  GST/EMI maths, validation, CSV, alerts, roles
src/lib/geo/              India map data (generated by scripts/build-india-map.mjs) and record locations
src/ui/                   screens
supabase/schema.sql       database, security rules, enquiry endpoint
```
