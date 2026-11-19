# Security

> Template — have it reviewed by a lawyer before publishing.

**App:** SuryaSetu (“the App”), published by [Legal entity name]
**Effective date:** [Effective date]

This page explains how the App protects data, what it does not do yet, and how to report a security problem. It describes the software as it is today. We do not claim any security certification.

## How the App protects data

### Connections
- The App must be opened over **HTTPS**. If it is opened over plain `http://`, it shows a “Secure connection needed” screen and does not start, because browsers turn off the security features it relies on.
- In cloud mode, all traffic to the database, sign-in service and file storage uses HTTPS / secure WebSockets (TLS).
- The site sends **HSTS** (`Strict-Transport-Security: max-age=31536000`), so browsers keep using HTTPS for a year after a visit.
- The website is a set of static files served by the host (for example Netlify). The only server-side code of ours is the payment server (three Supabase Edge Functions) that creates payment orders and confirms payments.

### Cloud mode (Supabase)
- **Row-level security** is switched on for every table. The database checks every read, insert, update and delete against the signed-in user’s role, so the rules hold even if someone bypasses the screens and calls the API directly.
- **Roles:** admin, manager, sales, technician, accounts, and pending. Each role can read or change only the modules it needs. New sign-ups are **pending** and see nothing until an admin approves them.
- Only **admins and managers can delete** records. Only **admins** can change users and roles, change company settings, or restore a backup.
- **Many businesses, kept apart:** every record, person, file, counter and enquiry belongs to one business, and the database shows each person only their own business. A business is started by signing up without a company code (that person is its admin); staff join with the business's company code and see nothing until its admin approves them. Each business always keeps **at least one active admin**.
- **Subscription enforced in the database:** a business has a 15-day free trial, then a paid plan. After the end, the database refuses every change to business data (records, file uploads and deletions, restores, website enquiries) while reads and exports keep working; the admin can still manage people. The tables and functions that decide this cannot be changed from the website or the apps, so a modified app cannot unlock anything. One free trial per email address and per mobile number, remembered (as one-way hashes) even after deletion; optionally only with a mobile number confirmed by SMS.
- **Payments:** handled by Razorpay. The price comes from the database, never from the browser. A payment counts only after the payment server checks Razorpay's signature with a secret key that never leaves the server, and Razorpay confirms the payment was captured for that order and amount; each payment counts once. Webhooks are accepted only with a valid signature. Card, UPI and bank details go only to Razorpay.
- **Business rules are enforced in the database:** stock cannot go negative, payments cannot exceed the invoice balance, invoices cannot be deleted (only cancelled), document numbers are permanent, and records still used by other records cannot be deleted.
- **Edit conflicts are detected:** if two people edit the same record, the second save is warned instead of silently overwriting.
- **Files** go to a **private** storage bucket (20 MB limit per file). They open only through signed links that expire after 10 minutes.
- The public key in the App (the Supabase “anon” key) is meant to be public. The powerful `service_role` key is never placed in the App.
- **Passwords** are handled by Supabase Auth; the App never stores them. Minimum length is 8 characters. Email confirmation should stay switched on. Sign-in uses the PKCE flow so email links cannot be replayed.
- **Public enquiry form:** shows a link to the privacy policy, validates every field, limits each connection to 5 enquiries per hour and the whole site to 100 per hour, ignores repeat enquiries from the same mobile number within a day, and can only create new leads. It cannot read any data. For the per-connection limit it stores only an MD5 hash of the connection’s IP address (with a fixed prefix), not the address, for about a day.
- **Account deletion:** each user can delete their own account in Settings (database function `delete_my_account`), and an admin can delete another user (`admin_delete_user`). Both refuse to remove the last active admin.
- **Live updates** between users use the same read rules as the database.
- Supabase states that it encrypts stored data at rest. The Business chooses the data region; we recommend **Mumbai (ap-south-1)**.

### Device mode
- Nothing is sent to any server. Data stays in the browser on that device.
- Passwords and the admin recovery code are stored only as salted **PBKDF2-SHA-256** hashes with 100,000 iterations.
- **Important limit:** the sign-in protects the screen, not the stored data. The data itself is not encrypted on the device. Anyone who can open that browser profile, or copy it, could read it. Use a screen lock, a separate browser profile, and do not use device mode on shared computers.

### In the App’s code
- Text you enter is shown as text, not run as code (React escapes all output; the App does not inject raw HTML).
- CSV exports guard against spreadsheet “formula injection” (cells starting with `=`, `+`, `-` or `@`).
- Backups are checked before restore, and a failed restore on a device puts the old data back.
- The offline cache (service worker) stores only the App’s program files, never database replies or uploaded files. Only the App’s own start page is cached for offline use; other pages, such as the policy pages, always come from the network.
- No ads, analytics or third-party scripts are loaded. The only production libraries are React, React Router, the Supabase client and a small QR-code generator (see Third-Party Notices).

## Known gaps (planned work)

We list these so the Business can judge the risk:

- **Files are not limited by module.** Any approved user (any role except pending) can open any stored file if they have its link path. Records that list the files are still role-limited.
- **No two-factor sign-in** in the App yet.
- **No detailed audit log.** Records keep who created them and when they were last changed, not a full history.
- **Enquiry hashes** are MD5 of the IP address plus a secret random value created per database (`app_config.enquiry_salt`, not readable through the API). Someone with full database access (who can read the secret) could still match an address by trying every one, so they are kept for about a day only.
- **Supabase free plan** has no automatic backups and pauses after 7 days of no use. Download backups regularly, or use a paid plan.

### Security headers (`netlify.toml`)

Every page is sent with these headers:

| Header | Value and effect |
|---|---|
| `Content-Security-Policy` | `default-src 'self'`; scripts only from the site itself (`script-src 'self'`, no inline scripts); styles from the site and inline styles; images from the site, `data:`, `blob:` and `https://*.supabase.co`; network connections only to the site, `https://*.supabase.co` and `wss://*.supabase.co`; frames only from the site, `blob:` and `data:`; `object-src 'none'`; `base-uri 'self'`; `form-action 'self'`; `frame-ancestors 'none'`; manifest and service worker only from the site. This blocks most cross-site scripting and stops data being sent anywhere except Supabase. |
| `X-Frame-Options` | `DENY`: other sites cannot show the App in a frame (clickjacking). |
| `X-Content-Type-Options` | `nosniff` |
| `Referrer-Policy` | `strict-origin-when-cross-origin`: other sites see only the domain, not the page address. |
| `Permissions-Policy` | `geolocation=(self)` and `camera=(self)`: only the App itself may ask for location and the camera (for “Use my location” and site photos); `microphone=()`, `payment=()` (switched off). |
| `Strict-Transport-Security` | `max-age=31536000` |

**Android app:** a native app gets no HTTP headers, so the build puts the same policy into the app's page as a `<meta http-equiv="Content-Security-Policy">` tag (`APP_CSP` in `vite.config.ts`, added only when `CAP_BUILD=1`, which `npm run apk` sets). It is the website policy without `frame-ancestors` (not allowed in a meta tag) and with `media-src 'self' blob:` and `worker-src 'self' blob:`. Every screen and the camera were tested under it with no blocked requests.

If you move the database away from `*.supabase.co`, or add any outside service, update both CSPs (`netlify.toml` and `APP_CSP`) first or the App will stop loading data.

## What the Business must do

- Keep admin accounts secure, and keep the company code among your staff (change it in Settings → Users & access if it spreads). Remove access the day someone leaves (Settings → Users & roles → untick Active).
- Give each person the lowest role they need.
- Keep email confirmation on, set up a proper email sender (SMTP), and keep the Supabase dashboard password and database password private. Turn on two-factor sign-in for your Supabase, Netlify and GitHub accounts.
- Store backup files safely. They contain all your data.
- Collect only the documents you need. Prefer masked Aadhaar copies.

## If there is a data breach

The Business, with our help where we host the App, will:

1. Contain the problem (disable accounts, rotate keys, restore from backup if needed).
2. Inform the **Data Protection Board of India** and each affected person, as the Digital Personal Data Protection Act, 2023 and the rules under it require. The DPDP Rules, 2025 set out what the notices must contain and a time limit for the detailed report to the Board (72 hours); check the current text with your lawyer.
3. Report the cyber incident to **CERT-In** where its directions of April 2022 apply (they require reporting within 6 hours of noticing it).

## Report a security problem (responsible disclosure)

Email **[support email]** with the subject **Security report**. Please include the steps to reproduce, what you could access, and how to contact you.

- We acknowledge reports within 24 hours and aim to fix serious issues within 30 days.
- Please test only with accounts you own, do not view, change or delete other people’s data, do not run denial-of-service or spam tests, and give us reasonable time to fix the issue before telling anyone else.
- We will not take legal action against good-faith research that follows these rules.
- We do not run a paid bug bounty.

Contact: [Legal entity name], [Registered address] · [support email] · [phone]
