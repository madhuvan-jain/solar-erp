# Apple App Store Listing

App: SuryaSetu (“the App”). If you rename the App, update the name, text and screenshots here.

## Read this first

The iPhone app is the same app as the website, in a native wrapper made with **Capacitor**. The Xcode project is ready in `ios/` (app id, icon, splash screen, permission texts, encryption flag). Build it on a Mac with `npm run ios`; the steps are in `GO-LIVE-STEPS.md`, section 11. Apple's rules that matter:

- **Guideline 3.1 (payments):** businesses buy their plan on the website. The app is a free companion to that paid web service (guideline 3.1.3(f); and, as software for businesses and their staff, 3.1.3(c)). It must not sell anything or point to buying elsewhere. **The app already does this by itself:** inside the iPhone and Android apps there are no prices, no Pay or Subscribe buttons and no pricing links; only the status (“Free trial: 5 days left”, “changes are paused”). Keep prices and “subscribe on our website” out of the screenshots, the description and the reviewer notes' instructions to users.
- **Guideline 4.2 (Minimum Functionality):** Apple may reject an app that is “just a website in a box”. Show the native features in the review notes: the GPS camera with stamped photos, the iPhone share sheet for exports and backups, offline use.
- **Guideline 5.1.1(v) (Account deletion):** apps that let people create an account must let them delete it inside the app. **The App meets this:** **Settings → My account → Delete my account** (type DELETE to confirm) deletes the login and profile straight away; when the last person of a business deletes their account, the business and its records are deleted at once, and its uploaded files within 15 days. The only active admin must first make someone else an admin while others remain.
- **Guideline 2.1:** reviewers need a working demo account whose business has an active plan (give it a long free period, `GO-LIVE-STEPS.md` step 6), and must be able to reach every feature.

Before submitting, test on a real iPhone: sign-up, “Use my location”, the site camera, email confirmation, password reset, file upload, export and backup (share sheet), print / save as PDF, WhatsApp and phone links.

## App information

| Field | Value | Limit |
|---|---|---|
| Name | `SuryaSetu: Solar Business ERP` (29) | 30 |
| Subtitle | `Solar CRM, GST billing & AMC` (28) | 30 |
| Primary category | Business | |
| Secondary category | Productivity | |
| Support URL | [website URL]/grievance.html (or a support page with [support email] and [phone]) | |
| Marketing URL | [website URL] | |
| Privacy Policy URL | [website URL]/privacy.html | |
| Copyright | © [Copyright year] [Legal entity name] | |

**Promotional text** (max 170) — 151 characters

```
Leads, site surveys, GST quotations and invoices, installations, PM Surya Ghar subsidy, loans, stock and AMC service — one app for your solar business.
```

**Keywords** (max 100 bytes, comma-separated, no spaces needed) — 99 characters

```
solar,EPC,installer,rooftop,CRM,GST,invoice,quotation,inventory,subsidy,Surya Ghar,AMC,lead,billing
```

**Description** (max 4000)

```
Run your whole solar installation business from one app — from the first enquiry to the final AMC visit.

Made for rooftop solar installers and EPC companies in India.

• Home screen with search across everything
• List, board, calendar, pivot, graph and map views
• Dashboard with KPIs, period filter, charts and an India map of your customers

LEADS & CUSTOMERS
• Pipeline board from New to Won, duplicate warnings, follow-up reminders
• One-tap call and WhatsApp
• Website enquiry form that creates leads automatically
• CSV import and export

SITE SURVEY & QUOTATIONS
• Roof type, usable area, shading, sanctioned load and site photos
• GST quotations with discount and amount in words
• Print or save as PDF, and turn an accepted quote into an invoice

PROJECTS & INSTALLATION
• Stages from planning to net metering and handover
• Milestones, budget vs actual and a task board
• Installation checklist, site location and completion certificate
• Save a customer's site location with one tap

GST BILLING & PAYMENTS
• Invoices numbered per financial year, CGST + SGST or IGST
• Customer statement of account
• HSN summary, round-off, due dates and a UPI payment QR code
• Record UPI, bank, cash, cheque, loan and subsidy payments
• Balance due and expenses

REPORTS
• GST sales, GST on purchases and indicative net GST
• HSN summary, receivables ageing, product-wise sales, stock valuation
• CSV export for your CA

PRINT-READY DOCUMENTS
• Your logo, signature and colours; Classic, Modern or Compact layout
• Share on WhatsApp or save as PDF

INVENTORY & PURCHASE
• Stock in and out, delivery challans, serial numbers, low-stock alerts
• Vendors and GST purchase orders

PM SURYA GHAR SUBSIDY & SOLAR LOANS
• Application status and document checklists
• EMI calculator and EMI-due alerts

SERVICE & AMC
• Service tickets and AMC contracts with renewal alerts

DOCUMENTS & STAFF
• Agreements, KYC, warranty and project documents
• Employees and attendance

BUILT FOR TEAMS
• Roles for Admin, Manager, Sales, Technician and Accounts, enforced by the database
• New staff wait for admin approval
• Live updates between phones and computers

YOUR DATA
• Your company's own database, in the region you choose
• Download and restore backups
• No ads, no tracking, no analytics

Sign-in required. Create your company’s account, or join your company with its company code; the company’s admin approves each staff member.
```

**What’s New:** copy from `RELEASE_NOTES.md`.

## Screenshots

Required: iPhone 6.9-inch display (for example 1320 × 2868 or 1290 × 2796 portrait). Apple scales these down for smaller iPhones. If the app runs on iPad, also add iPad 13-inch (2064 × 2752 or 2048 × 2732). Up to 10 per size. Check the current sizes in App Store Connect Help before uploading. Use demo data only.

## App Privacy (“nutrition label”)

**Do you or your third-party partners collect data from this app?** Yes (cloud mode).
**Used for tracking?** **No**, for every data type. The App has no ads, analytics, advertising identifiers or data brokers.
**Purpose for every type:** **App Functionality** only (not analytics, advertising, personalisation or developer marketing).

| Apple data type | Collected | Linked to the user | Tracking | Notes |
|---|---|---|---|---|
| Contact Info → Name | Yes | Yes | No | Staff and customer names |
| Contact Info → Email Address | Yes | Yes | No | Sign-in email, customer emails |
| Contact Info → Phone Number | Yes | Yes | No | Customers, leads, vendors, staff |
| Contact Info → Physical Address | Yes | Yes | No | Customer, vendor, company addresses |
| Financial Info → Other Financial Info | Yes | Yes | No | Invoices, payments, salaries, loan details |
| Location → Precise Location | Yes | Yes | No | Customer and installation-site coordinates, typed in or captured once with “Use my location”, and the place stamped on site photos taken with the App’s camera; never in the background |
| User Content → Photos or Videos | Yes | Yes | No | Site and completion photos |
| User Content → Other User Content | Yes | Yes | No | Notes, documents, enquiry messages |
| Identifiers → User ID | Yes | Yes | No | Account id |
| Purchases → Purchase History | Yes | Yes | No | The business's subscription plan and dates (bought on the website, not in the app) |
| Other Data → Other Data Types | Yes | Yes | No | GSTIN, electricity consumer number, KYC copies |

**Not collected:** Health & Fitness, Payment Info, Credit Info, Sensitive Info, Contacts, Emails or Text Messages, Audio, Gameplay Content, Customer Support, Browsing History, Search History, Device ID, Usage Data, Diagnostics, Coarse Location.

If you add crash reporting, analytics or push notifications to the wrapper later, update these answers.

## Age rating

Answer **None / No** to every content question (violence, sexual content, profanity, drugs, gambling, horror, medical, contests). Unrestricted web access: **No**. Messaging or chat: **No**. Advertising: **No**. Result: **4+**.

## App Review information

**Sign-in required:** Yes.

```
User name: [Demo account email]
Password:  [Demo account password]
```

**Notes for the reviewer:**

```
This app is business software for solar installation companies in India (leads, quotations, GST invoices, projects, installation, inventory, subsidy and loan tracking, service).

The demo account is the Admin of a demo business with demo data, so every module is visible from the menu. Staff join a business with its company code ("Create account" → "Join my company") and wait for the admin's approval; the demo account is already set up.

Account deletion: Settings → Delete my account → type DELETE → Delete my account. This deletes the login and profile immediately. Please test it with a second account you create, not the demo admin. The policy is at [website URL]/delete-account.html.

The app makes no in-app purchases and shows no prices or purchase links. It is business software licensed directly to companies (business-to-business); companies manage their subscription outside the app. The app only shows whether the company's plan is active.
It does not use the microphone or contacts. The camera is used only when the user takes a site photo (📷 Site photo on an installation, or 📷 Take photo in Documents). Location is used only when the user taps "Use my location" on a customer record, or while the camera is open, to save or stamp that site's position. Phone numbers open the dialler and WhatsApp buttons open WhatsApp only when tapped.

Contact: [Grievance Officer name], [support email], [phone].
```

## Export compliance

- **Does your app use encryption?** Yes, but only standard HTTPS/TLS provided by iOS for network connections (and the browser’s built-in Web Crypto for password hashing in device mode).
- This qualifies for the exemption for standard encryption. Add to `Info.plist`:

```xml
<key>ITSAppUsesNonExemptEncryption</key>
<false/>
```

- No proprietary or non-standard encryption, so no export documentation is needed. (Apple’s questions may change; answer what App Store Connect asks.)
