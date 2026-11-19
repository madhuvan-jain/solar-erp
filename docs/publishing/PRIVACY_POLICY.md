# Privacy Policy

> Template — have it reviewed by a lawyer before publishing.

**App:** SuryaSetu (“the App”)
**Published by:** [Legal entity name], [Registered address] (“we”, “us”)
**Effective date:** [Effective date]
**Web address of this policy:** [website URL]/privacy.html

## 1. Who this policy is for

The App is business software for solar panel installers and solar EPC companies in India. A business (“the Business”) uses it to manage leads, customers, site surveys, quotations, projects, installations, stock, vendors, GST invoices, payments, expenses, subsidy and loan applications, service tickets, AMC contracts, documents and staff.

This policy explains what personal data the App handles, why, where it is kept, how long, and what rights you have. It covers:

- **Staff users** of the Business who sign in to the App.
- **Customers, leads, vendors and employees** of the Business whose details staff enter into the App.
- **Visitors** who send an enquiry through the App’s public enquiry form.

## 2. Who is responsible for your data

Each copy of the App serves **one business only**. Data from one business is never mixed with another’s.

- **The Business is the Data Fiduciary** (the “controller”) for the data of its customers, leads, vendors, employees and staff users. It decides what to record and why. Under the Digital Personal Data Protection Act, 2023 (“DPDP Act”) it is responsible for giving notice, getting consent where needed, and answering your requests.
- **We provide the software.** If we also run the hosting for the Business, we act as its **Data Processor** and handle data only on its instructions.
- If [Legal entity name] is itself the Business that uses this copy of the App, then we are the Data Fiduciary for all data in it.

If you are a customer of a solar business and want to know what it holds about you, contact that business first. You can also contact our Grievance Officer (section 12) and we will pass your request on or help you.

## 3. The two ways the App can store data

The Business chooses one of two modes when it sets up the App.

| | Device mode | Cloud mode |
|---|---|---|
| Where data is kept | Only in the web browser on that one phone or computer (browser “local storage”) | In a database run on Supabase (PostgreSQL database, sign-in service and file storage), in a data-centre region chosen by the Business. We recommend Mumbai (ap-south-1). |
| Sent over the internet? | No. Records, files and passwords stay on the device. | Yes, over encrypted HTTPS connections, between the device and the Business’s Supabase project. |
| Passwords | Stored only as a salted PBKDF2-SHA-256 hash (100,000 rounds) on the device | Handled by Supabase Auth. The App never stores your password itself. |
| Files (photos, documents) | Stored inside the browser (IndexedDB), up to 15 MB each | Stored in a private Supabase storage bucket, up to 20 MB each |
| Shared between staff? | No. Each device has its own data. | Yes. Approved staff see the same data, limited by their role. |

The website itself (the program code) is served as static files by a web host such as Netlify over HTTPS.

## 4. What data the App handles

The App only holds what staff type in, upload or import, plus what is needed to sign in.

**About customers and leads**
- Name, mobile number, email address, city, postal address, PIN code, state.
- GSTIN, electricity consumer number, customer segment, monthly electricity bill, required system size.
- Site survey details (roof type, roof area, shading, sanctioned load) and site photos.
- **Location of the customer’s site:** map latitude and longitude for a customer, and installation-site latitude and longitude. Staff either type these in, or tap **“Use my location”** while standing at the site. Only then does the browser ask for permission and read the device’s location once, and it is saved as that customer’s site location. The same happens when staff take a **site photo with the App’s camera**: the camera and the location are read only while the camera screen is open, after the device asks for permission, and the photo is stamped with the place, coordinates, date and time and saved as a document of that customer or job (with the place and coordinates as details). The App does not track staff or customers and does not read location in the background. Where no coordinates are saved, the App’s India map places the customer by PIN code or city. The map is drawn inside the App from map data that ships with it, so customer locations are not sent to any map service.
- Delivery challans for material sent to a site (vehicle number, transporter or driver name, items).
- Quotations, invoices, payments received (amount, mode, UPI/UTR reference), AMC contracts and service tickets.
- PM Surya Ghar subsidy application details (portal application number, amount, status, checklist of documents submitted).
- Solar loan details (bank or lender, loan amount, interest rate, tenure, EMI dates, status, checklist of documents).
- Uploaded documents. These may include KYC copies such as Aadhaar, electricity bills, bank passbook or cancelled cheque, agreements and warranty cards.
- Notes, call and visit logs, customer rating and confirmation of completed installation.

**About employees and staff users**
- Employee name, phone, email, designation, department, joining date, monthly salary and attendance (date, status, check-in and check-out time).
- Staff user accounts: name, email address, mobile number (required for every account; only the person and the admin can see it), role (admin, manager, sales, technician, accounts, or pending approval), whether the account is active, and when it was created.

**About vendors**
- Vendor name, contact person, phone, email, GSTIN, state, city, PIN code, address, rating, contract end date and purchase orders.

**About the Business itself**
- Company name, address, phone, email, website, GSTIN, PAN, state, bank account details (bank name, account number, IFSC) and UPI ID. These print on quotations and invoices. If the Business turns it on, invoices show a UPI payment QR code made inside the App from the UPI ID and the amount due.

**From the public enquiry form** (cloud mode only)
- Name, mobile number, and optionally email, city and a message. This becomes a new lead for the Business.
- To stop spam, the database briefly records a **code made from the IP address** of the connection that sent the enquiry, and the time. The code is a one-way hash (MD5 of the address combined with a secret random value unique to this database), so the address itself is not stored and cannot be worked out from the code without that secret. We still treat it as personal data. It is used only to limit each connection to 5 enquiries per hour. Entries older than one day are deleted the next time any enquiry is received. If the same mobile number has already enquired in the last 24 hours, the new enquiry is ignored.

**Subscription and payments** (cloud mode)
- For each business: its name, its company code, the dates of its free trial and paid period, and its plan.
- To give one free trial per person, a one-way code (a salted hash) made from the email address and the mobile number of each person who started a free trial. The address and number cannot be read back from it. It is kept after the account is deleted, only to recognise a repeat free trial.
- For each payment: the plan, the amount, the date, the period it pays for, and the order and payment ids from Razorpay. This is kept for our accounts and tax records.
- Payments are made on the Razorpay payment page. Card, UPI and bank details go to **Razorpay** (Razorpay Software Pvt. Ltd., a payment aggregator authorised by the Reserve Bank of India) and are handled under its own privacy policy. We never see or store them. The admin’s name, email and mobile number are passed to Razorpay to fill in the payment page.

**Technical data**
- When you use cloud mode, Supabase and the web host receive the technical details every website receives: IP address, browser type, the time of the request and the address requested. They keep standard service logs under their own policies. The App itself does not add tracking to these.

**What the App does not do**
- No advertising, no ad networks, no analytics, no tracking cookies and no third-party tracking code.
- It does not read your contacts, SMS, call log, photo gallery (other than files you pick) or microphone. It uses the camera only while you take a site photo, and reads device location only when you tap “Use my location” or have the App’s camera open, as described above. Town names for the photo stamp come from data inside the App, so locations are not sent to any map service.
- It does not sell or rent personal data.

## 5. Why the data is used

The data is used only to run the Business’s work in the App:

- To manage enquiries, follow-ups, site surveys, quotations, projects, installations and after-sales service.
- To issue GST invoices and receipts, record payments and expenses, and prepare GST and collection reports.
- To track PM Surya Ghar subsidy and solar loan applications for customers.
- To manage stock, vendors and purchase orders.
- To manage staff accounts, roles, attendance and salaries.
- To sign users in, keep accounts secure and send account emails (email confirmation and password reset) in cloud mode.
- In cloud mode with SMS codes switched on: to send one-time codes by SMS that confirm a user’s mobile number and reset a forgotten password. The number and the code are passed to the SMS provider the Business chose in Supabase ([SMS provider name]) only to deliver that message.
- To meet legal duties, such as keeping tax records.

**Legal basis.** Under the DPDP Act, personal data may be processed with consent, or for certain “legitimate uses”, such as data a person gives voluntarily for a specific purpose, employment-related purposes, and compliance with law. The Business must decide which applies to each kind of data and give a notice where the Act requires it. For example, a person who sends the enquiry form gives their details so the Business can call them back.

## 6. Who can see the data

- **Staff of the Business**, according to their role. In cloud mode, the database itself enforces these rules (row-level security), not just the screens. New sign-ups have no access until an admin approves them.
- **Service providers** that host the App for the Business (in cloud mode): Supabase (database, sign-in and file storage), the web host (for example Netlify, which serves the program files), and, if the Business sets one up, an email-sending service (for example Brevo or Resend) for confirmation and password-reset emails. They process data on the Business’s behalf.
- **Razorpay**, only when an admin pays for a subscription: the details listed under “Subscription and payments”.
- **Other apps you choose to open.** Tapping a WhatsApp button opens WhatsApp (wa.me) with the phone number and any pre-filled text. Tapping a phone number opens your dialler. Tapping an email opens your email app. “Open in Google Maps” sends the saved site coordinates to Google Maps. Scanning an invoice’s UPI QR code opens the payer’s own UPI app. These happen only when you tap them, and those services’ own privacy policies apply.
- **Authorities**, when the law requires it, for example tax authorities or a court order.

We do not share data for marketing and we do not sell it.

## 7. Where the data is kept

- **Device mode:** only on the device and in any backup files the admin downloads.
- **Cloud mode:** in the Supabase region the Business chooses. We recommend Mumbai (ap-south-1) so data stays in India. The web host may serve the program files from servers worldwide, but those files contain no customer data. An email-sending service, if used, may be outside India.

The DPDP Act allows transfer outside India except to countries the Central Government restricts by notification. The Business should check this list before choosing a region or provider.

## 8. How long data is kept

- **Invoices, receipts, payments, purchase orders, expenses and related records** are kept for as long as tax law requires. Under the Central Goods and Services Tax Act, 2017, registered persons must keep their books of account and records until **72 months (six years) from the due date of the annual return** for the year they relate to, and longer if an appeal, investigation or proceeding is pending. Companies must also keep books of account for eight financial years under the Companies Act, 2013. The App therefore **does not allow invoices to be deleted**; they can only be cancelled.
- **Leads that did not become customers:** until the Business deletes them, which it should do once they are no longer needed (we suggest a review every [Lead retention period]).
- **Customer and project records:** while the customer relationship, warranty or AMC continues, then for any period required by law.
- **Employee records:** for the period required by labour and tax laws.
- **Staff user accounts:** until the account is deleted.
- **Enquiry-form connection codes (hashed IP addresses):** about one day (see section 4).
- **Backup files** downloaded by an admin stay wherever the admin saves them until the admin deletes them. In device mode they also hold the staff list (names, emails, mobile numbers, roles and access rights, never passwords), so the admin should keep them as private as the records.

## 9. How data is protected

- All cloud connections use HTTPS (TLS encryption in transit).
- In cloud mode, row-level security in the database limits each role to the modules it needs. Only admins and managers can delete records. Only admins can change users, settings or restore a backup.
- Uploaded files in cloud mode are kept in a private storage bucket. They open through short-lived links (10 minutes).
- In device mode, passwords are stored only as salted PBKDF2 hashes. Note that in device mode the sign-in protects the screen, not the stored data: anyone who can open that device’s browser profile could read the data. Use a device lock.
- Supabase states that it encrypts stored data at rest.

No system is perfectly secure. If a personal data breach happens, the Business (with our help where we are its processor) will inform the Data Protection Board of India and the people affected, as the DPDP Act and its rules require, and report cyber incidents to CERT-In where its directions apply.

## 10. Your rights

Under the DPDP Act you have the right to:

- **Get information** about the personal data held about you and how it is used.
- **Correct, complete or update** your data.
- **Erase** your data when it is no longer needed for the purpose, unless the law requires it to be kept (for example tax invoices).
- **Withdraw consent** where processing is based on consent. This does not affect processing already done.
- **Have a grievance resolved**, by the Business or by us, before going to the Data Protection Board of India.
- **Nominate** another person to exercise your rights if you die or become unable to.

You can delete your own staff account inside the App: **Settings → Delete my account**. To use your other rights, see our Data Deletion page at [website URL]/delete-account.html, or write to [support email]. We may ask you to confirm your identity first. You also have a duty not to file false or frivolous complaints and not to impersonate others.

## 11. Children

The App is for businesses and their adult staff. It is not meant for anyone under 18. The Business should not record a child’s data without the verifiable consent of a parent or lawful guardian, as the DPDP Act requires. If you think a child’s data has been entered, contact us.

## 12. Grievance Officer

In line with the DPDP Act, the Information Technology Act, 2000 and the rules made under it:

**[Grievance Officer name]**, Grievance Officer
[Legal entity name], [Registered address]
Email: [support email] · Phone: [phone]

We acknowledge complaints within 24 hours and aim to resolve them within 15 days. Full details are at [website URL]/grievance.html.

## 13. Browser storage and cookies

The App does not use cookies for tracking. It uses the browser’s local storage to keep you signed in, to remember your light or dark theme, and (in device mode) to hold all the App’s data on that device. A service worker keeps a copy of the App’s program files so it can open without internet. It never stores your business records in that cache.

## 14. Changes to this policy

We may update this policy when the App or the law changes. We will change the effective date above and, for important changes, tell the Business’s admin by email before they take effect.

## 15. Contact

[Legal entity name], [Registered address]
Email: [support email] · Phone: [phone] · Website: [website URL]
