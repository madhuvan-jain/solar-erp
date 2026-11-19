# Release Notes

App: SuryaSetu (“the App”)

## Version 1.2.0 — your own business account, free trial and subscriptions ([Effective date])

### Store version (max 500 characters on Play)

```
Start your company's own private account in minutes and bring your whole team: staff join with your company code and you approve each one. Every company's data is kept completely separate. iPhone and iPad app. Clearer sign-up. Your data always stays available to view and export.
```

### Details
- **Your own business account:** "Create account → Start my business" sets up a private business for your company, with you as its admin. Staff choose "Join my company" and type the **company code** (or open your invite link); you approve them in Settings → Users & access. Change the code at any time.
- **Free trial and plans (website):** every new business gets 15 days free with every feature. Then plans of 1, 3, 6 or 12 months (₹1,000 / ₹2,500 / ₹4,500 / ₹7,500, GST included), paid on the website through Razorpay (UPI, cards, net banking, wallets) in **Settings → Subscription**. Paying early adds the new plan after the current one. No automatic renewal.
- **After a trial or plan ends:** nothing is lost. Everyone can still view, print and export everything; changes pause until a plan is bought.
- **Kept apart and secure:** each business sees only its own people, records, files, numbering and enquiries — checked by the database itself. Payments are verified on the server.
- **Website enquiry form per business:** Settings → General shows your form's link; enquiries arrive as leads in your business only.
- **iPhone and iPad app** (App Store).
- **Delete my account:** when the last person of a business deletes their account, the business and all its records are deleted too, and its uploaded files within 15 days (download a backup first).
- **New page:** Pricing, cancellation and refunds. Privacy policy and terms updated for payments.
- **Fix: the installed website opens without internet with its full look.** The offline copy used to keep the page but not its stylesheet and scripts, so after an update (or on a first install) it could open blank or unstyled when the connection was down. Every file of a version is now saved when that version installs.
- (Store version text above leaves out prices on purpose: store apps may not point to payment outside the store.)

## Version 1.1.0 — stock, documents, exports and safe updates ([Effective date])

### Store version (max 500 characters on Play)

```
Built-in GPS camera: site photos stamped with place, map, time and QR, filed on the job. Stock done properly: part deliveries, warehouses, returns, stock counts, average cost. Supplier payments. Draft invoices numbered only when issued. Documents app with previews and expiry alerts. Export to Excel, PDF or CSV. Every district on the India map. Dashboard items you can add and rename. Updates never touch your data: automatic safety copies.
```

### Details
- **GPS camera for site photos:** 📷 Site photo on customers, projects, leads, surveys, installations, tickets, AMCs and challans; 📷 Take photo in Documents; 📷 Camera beside every photo field. Live view with the town, district, state, Plus Code, coordinates and GPS accuracy; the photo is stamped with a mini map, place, coordinates, date and time, a note, the app badge and a QR code (opens Google Maps, or your own link from Settings → Documents & print → Site photos). Saved as a document with its place and time, on the record, its customer and project; fills an empty site location. Works offline (7,200 towns bundled); falls back to the phone's camera.
- **Draft invoices have no number until issued:** new *Issue invoice* button; saving as Sent or recording the first payment also issues it. Drafts that are never sent leave no gaps. (Cloud mode: re-run `supabase/schema.sql`.)
- **Supplier payments:** dated payments against purchase orders (*Record supplier payment*), never more than still to pay; orders show paid / still to pay; Reports and the Dashboard show *Paid to suppliers* by month and **Net cash** (collected − expenses − paid to suppliers). Amounts typed on orders by older versions still count, as *Paid earlier (no date)*.
- **GST and money rules tightened:** an issued invoice is locked (lines, price, customer, place of supply, date; never back to Draft; cancelled stays cancelled with no balance); invoices are issued only with a place of supply (asked when unknown) and take the tax type that applies at issue; a discount can no longer exceed the lines; converting a quotation confirms the order; a purchase order with supplier payments cannot be cancelled or cut below what was paid.
- **PM Surya Ghar amount worked out:** capacity from the customer's project, amount from the scheme slabs (incl. special category states).
- **Stock:** products used on documents cannot be deleted; challan returns go back to the warehouse the stock came from; no warehouse goes below zero by an edit or delete.
- **WhatsApp done properly:** the right person and message for every record (payment reminders, receipts, quotations, challans, visits, vendors), editable before opening WhatsApp, noted in history; Settings → WhatsApp with the business number and all messages (one tap for Hindi); separate WhatsApp numbers; landlines and foreign numbers handled; Share on WhatsApp explains attaching the PDF.
- **Products:** GST % and HSN follow the category (panels and inverters 5%, batteries, structures, cables and services 18%; typed lines start at 18%); SKU unique; unit fixed once stock is booked; purchase orders never take the sale price as cost; challans never bring back stock that never left; returns not dated before the challan; challan lines show the stock of their own warehouse; CSV import finds products by SKU; demo data keeps every warehouse at or above zero.
- **Staff in backups** (device mode): names, emails, mobiles, roles and access rights (no passwords); restoring on a new device adds them and keeps their records theirs.
- **Data safety:** backups carry the document counters, so a restore never re-issues an invoice or receipt number; a second tab signed into another business can no longer make the first tab write there; demo data in/out keeps your data and numbering exactly; Projects CSV re-import no longer duplicates; DD/MM/YYYY HH:mm accepted in imports.
- **Cloud database:** stricter checks (no NaN/Infinity tricks, totals checked against lines, numbering per series and year, stock only within its documents and warehouses, supplier payments within what is owed, issued invoices locked, "created by" kept on restore). Re-run `supabase/schema.sql`.
- **Android app security:** the website's Content-Security-Policy is now built into the APK; camera and location permissions added (asked only when used).
- **Stock:** receive goods on a purchase order as they arrive (part deliveries), per warehouse with a default; return unused material from site; move stock between warehouses; stock counts and damage with a reason; services keep no stock; entries made by an order or challan cannot be edited on their own; stock valued at moving average cost; low-stock alerts show what is on order; checked in the database too.
- **Documents:** Files view with drag and drop of several files, picture and PDF previews, category chips, download, valid-until date with alerts, documents on each customer and project. Device mode keeps files in the browser's file store (up to 15 MB each) and includes them in backups.
- **Export:** Excel (.xlsx), PDF and CSV from every list and report; CSV fixed (phone numbers, date-times, re-import).
- **Map:** all 763 district names when zoomed in.
- **Dashboard:** + Add item on both dashboards, rename your dashboard, items scroll and open large (⤢) with their numbers; Installed and Active projects count systems by size; Systems by size chart.
- **Phone layout** only on phones (Settings → Appearance → Screen layout to choose).
- **Safe updates:** data format recorded and upgraded once after a safety copy; daily safety copies with Restore; newer data opened read-only; damaged lists never overwritten; new versions take over automatically at a safe moment.
- **Android app (APK)** build added.
- **Room to grow (device mode):** records moved from the browser's ~5 MB local storage into IndexedDB, automatically and safely; tested with 32,000 records (start under half a second, screens under 0.2 s).
- **GST on prints:** state codes, reverse charge, CGST/SGST rates in the HSN summary that add up exactly to the totals; Draft invoices marked as drafts; delivery challans with values, tax and three copies; receipts show the figures as of that receipt.
- **Reports:** purchase GST counts goods actually received; HSN summary with quantity, unit code, B2B/B2C and each tax.
- **Fixes:** many from a full review — stock per warehouse never below zero, upload retries without copies, safe large backups, cloud restore of device files, CSV import column checks, and more.

## Version 1.0.0 — first release ([Effective date])

### Store version (paste into Play “Release notes” and App Store “What’s New”, max 500 characters on Play)

```
First release. Run your solar business in one app: leads, site surveys, GST quotations and invoices with UPI QR, payments, projects, installation checklists, stock, delivery challans and purchase orders, PM Surya Ghar subsidy and loan tracking, service and AMC, and an India customer map. Team roles, live updates, backups, light or dark mode. No ads, no tracking.
```

### Full notes

**Getting around**
- Home screen with one tile per module your role can open, and search across all records.
- See records as a list, board, calendar, pivot table, graph or map.
- Dashboard with KPIs for a chosen period (this month, last 3 months, this FY, last 12 months, all time), charts, and an India map of customers or sales by state.

**Sales**
- Leads list and drag-and-drop pipeline board, with a Move menu on each card if you prefer not to drag.
- Duplicate phone and email warnings, follow-up reminders, one-tap call and WhatsApp.
- New leads can be auto-assigned to sales staff in turn. A “Won” lead becomes a customer automatically.
- Website enquiry form (`#/enquiry`) that turns enquiries into new leads (cloud mode).
- Site surveys with roof details and photos.
- GST quotations with discount and amount in words; print or save as PDF; turn an accepted quotation into an invoice.

**Projects and installation**
- Project stages, milestones, budget vs actual cost, and a task board.
- Installation schedule, checklist, site location link to Google Maps, customer confirmation and completion certificate.
- Save a customer’s site location with “Use my location” at the site, or type the coordinates. Without them, the map uses the PIN code or city.

**Billing**
- GST invoices numbered per financial year (for example INV/26-27/0001), CGST + SGST or IGST by place of supply, HSN summary and round-off.
- Optional UPI payment QR code on printed invoices.
- Payments by UPI, bank transfer, cash, cheque, card, loan disbursal or subsidy; overpayment is blocked.
- Issued invoices can be cancelled but never deleted.
- Customer statement of account with running balance, ready to print or share on WhatsApp.
- Purchase orders with GST (CGST + SGST or IGST from the vendor’s state).
- Expenses by project.
- Reports: collections, expenses by category, GST sales, GST on purchases with indicative net GST, HSN-wise summary, receivables ageing, product-wise sales, stock valuation and lead-source win rates. Every report exports to CSV.

**Printed documents**
- Your logo, signature or stamp, accent colour, tagline, terms and footer on every document.
- Classic, Modern or Compact layout.
- Quotations (with estimated generation, savings and payback), tax invoices (Original / Duplicate / Triplicate), payment receipts, purchase orders, delivery challans, installation certificates, survey and service reports, AMC contracts, loan EMI schedules, project summaries, expense vouchers and statements of account.

**Stock and purchase**
- Products with specifications and warranty, warehouses, stock in and out, serial numbers.
- Delivery challans for material sent to a site, with vehicle and transporter details.
- Low-stock alerts. Stock can never go below zero.
- Vendors and purchase orders; marking an order “Received” adds the items to stock.

**Subsidy, loans and service**
- PM Surya Ghar subsidy applications with status and document checklist.
- Solar loans with EMI calculator and EMI-due alerts.
- Service tickets and AMC contracts with renewal alerts.

**Documents and staff**
- Upload documents and photos (up to 20 MB each in cloud mode, 1.5 MB in device mode; 15 MB from 1.1.0).
- Employees and daily attendance.

**Team and data**
- Two ways to run: **cloud mode** (shared database for the whole team) or **device mode** (data stays on one device).
- Roles: Admin, Manager, Sales, Technician, Accounts. New staff wait for approval. Only admins and managers can delete.
- If two people edit the same record, the second person is warned instead of overwriting.
- Download a backup and restore it (admin only).
- Delete your own account in Settings → Delete my account; admins can delete other users.
- Links to the privacy policy, terms, account deletion and grievance pages on the sign-in screen and the enquiry form.
- Installs on Android, iPhone, iPad and Windows. Opens without internet once installed.
- Light, dark or system theme.

### Known limitations
- English only.
- Free Supabase projects have no automatic backups; download backups regularly.
