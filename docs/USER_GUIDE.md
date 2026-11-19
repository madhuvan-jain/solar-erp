# User guide

App: SuryaSetu (“the App”). This guide is for the people who use it every day: owners, office staff, sales, technicians and accounts.

What you can see depends on your role. If a button in this guide is missing for you, your role does not allow it. Ask your admin.

**Prefer watching?** The same guide is a 21-part video series in English and Hindi (folder `user video/`, ready for YouTube playlists): a tour, setup, leads to installation and payment, stock, purchase, subsidy, service, reports, backup and the phone app.

---

## 1. First setup (admin)

### 1.1 Sign in for the first time

**Cloud mode (shared online database)**
1. Open the App’s web address. It must start with `https://`.
2. Tap **Create account → Start my business**. Enter your name, your **business name**, email, mobile number and a password.
3. Open the confirmation email (check spam). Tap the link.
4. Sign in. You are the admin of your business, with a **15-day free trial** of every feature for your whole team.

**Device mode (data only on this device)**
1. Open the App. It asks you to **Create the admin account**.
2. Enter your name, email, **mobile number** (10 digits, required) and a password of 8 characters or more.
3. The App shows a **recovery code**. Write it down and keep it safe. It is the only way back in if you forget your password.

### 1.2 Company profile
**Settings → General** (settings are in tabs: General, Sales, Accounts, Purchase & stock, Documents & print, WhatsApp, Users & access, Subscription (cloud mode), Alerts, My account, Backup & data)

1. Enter the company name, GSTIN, PAN and **State**. The state decides CGST + SGST or IGST, so it must be right.
2. Enter phone, email, website and address.
3. Enter bank name, account number and IFSC. These print on invoices.
4. Tap **Save company profile**.
5. **Settings → Sales:** choose
   - **Auto-assign new leads:** new leads go to the sales person with the fewest open leads;
   - **Create a customer when a lead is Won**;
   - the **default surveyor** for new site surveys;
   - how many days a quotation is **valid for** (15 by default), the savings estimate and the default quotation terms.
6. **Settings → Accounts:** set **Payment terms (days)** (this sets the invoice due date), the default invoice terms and the declaration.
7. **Settings → Purchase & stock:** purchase order terms and the delivery challan note.

### 1.3 Print templates
**Settings → Documents & print**

1. Upload your **logo** and a **signature / stamp** image (PNG or JPG, under 1 MB).
2. Pick a **layout**: Classic, Modern or Compact. Pick an **accent colour**.
3. Add a tagline, for example “MNRE-empanelled rooftop solar installer”.
4. Enter your **UPI ID** (like `yourbusiness@okhdfcbank`). Tick **Print a UPI QR code** to show a pay-by-QR for the balance on invoices.
5. Add a footer line if you want one.
6. Tap **Save print settings**, then **Preview** to see a real document.

### 1.4 Add your team
**Cloud mode**
1. Open **Settings → Users & access**. At the top is your **company code** (8 letters and numbers). Tap **Copy invite link** and send it to your staff on WhatsApp, or tell them the code.
2. They open the link (or tap **Create account → Join my company** and type the code), fill in their details and confirm their email.
3. They see “Waiting for approval”.
4. You open **Settings → Users & access → Edit** on each person, choose a role (Manager, Sales, Technician, Accounts) and **Save**.
- If the code reaches the wrong people, tap **Change code**. The old code stops working; people who already joined are not affected.

**Device mode**
1. **Settings → Users & access → + Add user**.
2. Enter name, email, **mobile number** (required, one per person), role and a password. **Save**.
   - Or let staff do it themselves: on the sign-in page they tap **Create account**. The account shows as **Pending** in Settings → Users & access until you tap **Edit** and choose a role.

**When someone leaves**
- Untick **Active (can sign in)** to block them straight away, or
- Tap **Delete user** to remove their login for good. Their records stay.

### 1.4b Fine-tune what each person can do
- **Settings → Users & access → Edit → Access rights**: for each app choose No access, Viewer, User (own documents only), User (all documents) or Manager.
- Example: a salesperson who should see only their own leads → **CRM: User — own documents only**.
- Only managers of an app can delete in it. **Reset to the preset** undoes your changes.

### 1.5 Products and warehouses
1. **Inventory → Warehouses → + New**. Add at least one.
2. **Inventory → Products → + New** for each panel, inverter, structure, cable and so on.
   - Choose the **category** first: it fills the GST % and HSN (panels and inverters 5%, batteries, structures, cables and services 18%). Check them with your CA.
   - Fill a unique SKU, sale price and **purchase cost** (before GST) and a low-stock level. Purchase orders use the purchase cost; without it their lines start at 0.
   - The unit (Nos, Meter, Set…) cannot be changed once stock was booked, so choose it carefully.
   - Add the specification (for example “545 Wp Mono PERC bifacial”) and warranty. These go on quotations.
   - For work you sell rather than stock (installation, transport), choose the category **Service** or tick **Service — no stock kept**.
3. Opening stock: open each product → **Count / adjust** → choose the warehouse, type what is there, reason **Opening stock** → **Save count**. (Only an inventory manager or the admin can enter stock by hand.)
4. **Settings → Purchase & stock → Receive goods into**: the warehouse where deliveries go when an order names none.

Tip: you can bring in many products or customers at once with **Import CSV** on the list (see section 4).

---

### 1.6 Free trial and subscription (cloud mode)
- Every new business gets **15 days free**, with every feature and any number of users. The admin sees the days left at the top of the screen.
- **Settings → Subscription** (on the website) shows your plan and the four plans: **1 month ₹1,000 · 3 months ₹2,500 · 6 months ₹4,500 · 12 months ₹7,500**, GST included. Tap **Pay**, and pay by UPI, card, net banking or wallet in the Razorpay window. The plan starts at once (or after your current trial or plan, so you never lose days).
- One plan covers your whole team. Plans do not renew by themselves.
- If the trial or plan ends, **nothing is lost**: everyone can still open, print and export everything, but changes pause until a plan is bought.
- The Android and iPhone apps show your plan's status; buy or renew on the website.

## 2. Daily work

### 2.1 Lead → survey → quotation → invoice → payment

**1. Add the lead**
- **CRM → Leads → + New Lead**. Name and phone are required.
- Enter the PIN code; the state fills itself.
- Set **Next follow-up** so you get a reminder.
- If the phone number already exists, the App warns you. Check before saving.
- Enquiries from your website form arrive here automatically, with source “Website”.

**2. Follow up**
- Open the lead → **WhatsApp**, or tap the phone number to call.
- Log the call in **CRM → Activities & Notes**.
- Move the stage on the **Board** view, or with the **Move** menu on each card.

**3. Site survey**
- On the lead, tap **Schedule survey**.
- At the site, fill roof type, usable area, shading, sanctioned load and recommended kW. Add a photo. Set status **Completed**.
- **Print / PDF** gives a Site Survey Report.

**4. Make the customer**
- Move the lead to **Won**, or tap **Convert to customer**.
- On the customer, add GSTIN (if any), the electricity consumer number and the PIN code.
- At the site, tap **Use my location** to save the map position. Allow location when the phone asks.

**5. Quotation**
- On the lead tap **New quotation** (it makes the customer for you if needed), on the survey tap **Create quotation**, or on the customer tap **New quotation**.
- Add lines: pick a product and the rate, HSN and GST fill themselves. Change qty, add a line discount % if needed.
- Enter system size (kW) so the print shows estimated generation, savings and payback.
- **Print / PDF**, or **Share on WhatsApp** and attach the PDF. Set status **Sent**.
- On the quotation, each product name is a link: tap it to open the product.

**5b. Confirm the order**
- When the customer agrees, tap **Confirm order** on the quotation. The quotation becomes Accepted, the lead Won, the customer an *Active Project*, and an installation **project** is started with the kW and the quotation total as budget. **Open project** takes you there (see 2.2).

**6. Invoice**
- On the quotation, tap **Convert to invoice**. This makes a Draft invoice with the same lines, linked to the project. If the order was not confirmed yet, converting confirms it (quotation Accepted, lead Won, customer an active project).
- A draft has **no invoice number yet** (it shows as *Draft invoice of <date>* and prints marked DRAFT), so drafts you never send leave no gap in your numbers.
- When you send it to the customer, tap **Issue invoice**. It gets the next number (for example `INV/26-27/0001`), today's date if the draft is older (the due date moves with it), and becomes Sent. Recording a payment on a draft issues it too.
- If the customer has no state saved, the Issue dialog asks for the **place of supply** (where the system is installed), starting from your own state. It decides CGST + SGST or IGST.
- After that the quotation's lines, discount and customer are locked. For a changed offer, make a new quotation.
- Check the place of supply. It decides CGST + SGST or IGST.
- Print the **Original for Recipient** copy (you can also pick Duplicate or Triplicate).
- If a UPI ID is set, the invoice shows a QR code for the balance.

**7. Payment**
- On the invoice, tap **Record payment**. The balance is filled in.
- Choose the mode (UPI, Bank Transfer, Cash, Cheque, Card, Loan Disbursal, Subsidy). Add the UTR / reference. **Save**.
- The invoice shows Partially Paid or Paid. Print the **Payment Receipt** if the customer wants one.
- To see everything a customer owes: open the customer → **Statement (PDF)**.

**Mistake on an invoice?** You cannot delete an invoice, because GST law needs it kept.
- A **draft** can be edited freely.
- An **issued** invoice keeps its lines, price, customer, place of supply and date (only notes, due date and terms can still change). Tap **Cancel invoice** and make a new one. A cancelled invoice stays cancelled and owes nothing.
- If a payment is recorded, delete the payment first (admin or manager), then cancel.

### 2.2 Project → material → installation → certificate

**1. Project**
- On the customer, tap **New project**. Set capacity, project manager, target date and budget.
- Tick milestones as they happen. Move the stage on the Board.

**2. Tasks**
- On the project, tap **Add task**. Give it to a person with a due date.

**3. Send material (delivery challan)**
- On the project, tap **Send material**.
- Choose the warehouse, vehicle number and transporter. Add the material lines.
- Print the **Delivery Challan** and send it with the vehicle.
- When the vehicle leaves, set status **Dispatched**. The stock goes down automatically, from that warehouse.
- If there is not enough stock there, the App tells you what is short.
- Material that comes back unused: on the challan, **Material at site → Return from site**, enter what came back. It goes back into stock.
- If the trip is called off, set **Cancelled**; everything still out comes back.

**4. Installation**
- On the project, tap **Schedule installation**. Choose the date and lead technician.
- On site: tick the checklist, tap **Use my location**, add the completion photo and the customer’s rating.
- **Site photos with location:** on the installation, tap **📷 Site photo** (see *Site photos* in 2.6). Each photo is stamped with the place, GPS position, date and time, and filed on the installation, customer and project.
- Tick **Customer confirmed completion** and set status **Completed**.

**5. Certificate**
- On the installation, **Print / PDF** gives the **Installation & Commissioning Certificate** for the customer to sign.

**6. Bill and close**
- On the project, tap **New invoice** if you bill in stages.
- Record expenses (labour, transport) in **Accounts → Expenses** with the project selected.
- The project’s **Print / PDF** shows billed, received, material cost, expenses and margin.

### 2.3 Buying material: purchase order → received

1. **Purchase → Vendors → + New**. The GSTIN fills the state.
2. **Purchase → Purchase Orders → + New**. Pick products; the rate fills with the purchase cost. GST is CGST + SGST or IGST by the vendor’s state.
3. Choose **Receive into warehouse**. Print or share the PO. Set status **Ordered**.
4. When goods arrive, open the order → **Goods received → Receive goods**, enter what actually came and the date → **Add to stock**. Part deliveries are fine: the order shows *Partially Received* and what is still due, until everything has come. (Setting the status to **Received** adds everything still due in one go.)
5. After the first delivery the order's items cannot be changed. For extra material, make a new order.
6. When you pay the vendor, open the order → **Record supplier payment**. The vendor and the amount still to pay are filled in; change the amount for a part payment, choose the mode (Bank Transfer, UPI, Cheque, Cash, Card), add the UTR / reference → **Save**. The order shows **Paid** and **Still to pay**; the App refuses a payment above what is still to pay.
   - All payments: **Purchase → Supplier Payments**. Reports and the Dashboard show *Paid to suppliers* by month.

**Stock on a product:** open the product to see stock per warehouse, what is on order, the average cost and the stock value, and the latest entries. **Count / adjust** books a stock count (or damage), **Move between warehouses** moves stock from one store to another. Entries made by an order, challan or transfer cannot be edited on their own — change the order or challan instead.

### 2.4 Service tickets and AMC

**Tickets**
1. On the customer, tap **New ticket**. Choose type (Complaint, Breakdown, Cleaning, AMC Visit, Query) and priority.
2. Assign a technician and a **Resolve by** date.
3. The technician updates the status and writes the resolution.
4. **Print / PDF** gives a Service Report for the customer to sign.

**AMC contracts**
1. **Service → AMC Contracts → + New**. Enter start and end date, visits per year and value.
2. The App warns you 30 days before the end date. After renewing, set the old contract to **Renewed** and make a new one.

### 2.5 Subsidy and loan tracking

**PM Surya Ghar subsidy**
1. **Subsidy → + New**. Choose the customer. Enter the portal application number and date applied. Leave capacity and amount empty for PM Surya Ghar: the capacity comes from the customer's project or accepted quotation, and the amount from the scheme (₹30,000/kW up to 2 kW + ₹18,000 for the 3rd kW, at most ₹78,000; 10% more in the North-East, hill states and island UTs). Type the amount yourself for a housing society or another scheme.
2. Tick each document as you submit it.
3. Update the status as the portal moves (Documents Verified, Under Review, Approved, Disbursed).
4. The App alerts you if an application is pending for more than 45 days.
5. Under PM Surya Ghar the subsidy is paid into the **customer's own bank account**, so the customer pays you the full invoice. Only where a scheme pays the installer (some state schemes), record it as a payment with mode **Subsidy** on the invoice.

**Solar loans**
1. **Solar Loans → + New**. Enter bank, amount, interest % and tenure. The monthly EMI is calculated.
2. Tick documents. Update the status.
3. Enter the first EMI date. The App reminds you 7 days before each EMI.
4. **Print / PDF** gives an EMI schedule for the customer.
5. When the bank pays you, record a payment with mode **Loan Disbursal**.

### 2.6 Documents and team

- **Documents:** drop files onto the page (or tap **choose files**; on a phone you can take a photo). Several at once is fine: give them a category, customer, project and — for warranties and agreements — a **valid until** date, then **Add**.
  - Tap a document's picture to preview it large (photos and PDFs), ‹ › to go through them, **⬇ Download** to save it.
  - The category chips at the top filter by KYC, Project, Warranty and so on.
  - On a customer, project, lead, survey, installation, ticket, AMC or challan, the **Photos & documents** card shows only theirs, and files dropped there are filed under it.
- **Site photos (the App's GPS camera):** tap **📷 Site photo** on a record, **📷 Take photo** in Documents, or **📷 Camera** next to a photo field.
  1. Allow camera and location when asked (only the first time).
  2. Wait until the place and **± m** show; green means the GPS fix is good. Outdoors is best.
  3. Edit the note if you like (it is filled with the record, e.g. *Installation IN-0014 · Ravi Kumar*), then tap the round shutter. **⟲** switches to the front camera; **From gallery** uses a photo you already took.
  4. Check the photo → **Use photo** (or **Retake**).
  - The photo gets a stamp: a small map with a pin, the town, district and state, Plus Code, latitude/longitude, date and time, your note, a *SuryaSetu Camera* badge and a QR code. It is saved as a document with its place and time, and fills the record's site location if that was empty.
  - The QR opens the spot on Google Maps. To make it open your own app or page instead: **Settings → Documents & print → Site photos (camera)**, where you can also set a default note.
  - Town names work without internet. If the camera does not open, the phone's own camera opens instead and the stamp is still added.
  - You get an alert 30 days before a document's *valid until* date.
  - Keep Aadhaar copies masked (first 8 digits hidden).
  - Files can be up to 20 MB in cloud mode and 15 MB in device mode.
- **Team → Employees:** staff details and salary.
- **Team → Attendance:** mark each day Present, Absent, Half Day, Leave or Late, with check-in and check-out times.

---

## 3. Using the screens

### Moving between records and the activity history
- On any record, **‹ ›** at the top (or **Alt + ← / →** on a keyboard) open the previous or next record of the list you came from; "3 / 20" shows where you are.
- **Activity** at the bottom shows who created the record, every change (old → new) and the team's notes. Type a note and tap **Add note** (Ctrl + Enter on a computer). Use **All / Notes / Changes** to filter.

### Home, search and alerts
- The **Home** screen has a tile for each app. A number on a tile shows open alerts in that app.
- Use **Search everything** to find a customer, invoice number, phone, GSTIN, SKU or application number.
- The **bell** at the top opens a short list of the latest alerts; **See all alerts** opens the full list: overdue follow-ups, tasks, payments, delayed projects and installations, low stock, AMC renewals, EMIs, urgent tickets and old subsidy applications.
- **Fewer alerts?** **Settings → Alerts → Choose which alerts I get** (off by default, so you get them all). Switch it on and tick only the kinds you want.
- **Customer or product not in the list?** Open the picker and choose **+ Create new customer…** (or product, vendor, project…). Fill the popup and press **Create** — you stay on your quotation, invoice or order, and the new record is already selected.

### Search and filters
- Type in the search box to search everything. To search one field, pick **Search City for: …** (or Phone, Name…) from the list that appears.
- Tap the **funnel** for ready-made filters such as *Follow-up overdue*, *Up to 3 kW (PM Surya Ghar)*, *Waiting for net meter*, *Overdue* or *Low stock*. Pick several: inside one section they mean "or", across sections "and".
- **Group by** splits the list into headings with counts and totals (e.g. invoices by customer). Tap a heading to open it.
- **Recently used** keeps your last 7 searches. Tap the ☆ star on one to keep it under **Favorites**; tick *Open with this every time* to make it your default.
- Each chip in the search box has an × to remove it.

### Views
At the top of every list, pick a view:

| View | Use it to |
|---|---|
| **List** | Search, filter by status, sort by tapping a column header, export or import CSV |
| **Board** | See stages as columns. Drag a card, or use its **Move** menu. |
| **Calendar** | See records by date (follow-ups, installations, target dates, AMC end dates) |
| **Pivot** | Count or total records grouped by anything, for example quotations by status and month |
| **Graph** | The same as Pivot, as a bar, line or donut chart |
| **Map** | See records on the map of India |

### Dashboard
- Pick a period at the top: This month, Last 3 months, This FY, Last 12 months, All time.
- Tap any number card to open the list behind it. **Installed** and **Active projects** count systems by size (e.g. 3 kW × 4, 5 kW × 2) with the kW total; the **Systems by size** chart shows the same per size.
- The map shows sales by state or customers. Switch with **Sales ₹ / Customers**.
- On the map, choose a state in the list above it to zoom there and see its cities and the names of all its districts. Tap a city bubble to zoom in to each customer; tap a customer to open it. **All India** zooms back out.
- Each chart can switch type with the buttons on it.
- **✎ Customize** changes the order: drag ⠿ (mouse) or tap ↑ ↓ (phone), and 👁 hides or shows a card or section. Tap **Done**. **Reset order** goes back to the standard layout. In cloud mode the order is saved with your account, so your phone and computer show the same order.
- **+ Add item** adds your own chart, KPI, list, map or note (on the default dashboard and on your own).
- **+ Create my dashboard** builds your own dashboard (one per person) that opens first. To rename it, tap ✎ next to its name (or **Customize** and type in **Dashboard name**).
- A chart or list that does not fit its box scrolls; **⤢** opens it large with all its numbers.

### Reports
1. Open **Reports** and set From and To dates.
2. Use **Export ▾** on any table — **Excel**, **PDF** or **CSV** — to send it to your CA:
   - GST summary (sales), GST on purchases, HSN summary;
   - receivables ageing, product-wise sales, stock valuation.
3. “Indicative net GST” is only a guide. Your CA must check input credit against GSTR-2B.

---

## 4. Import, backup and restore

### Try the app with demo data (testing only)
- Admin, in device mode: **Settings → Backup & data → Load demo data**. A fictional company fills every screen.
- The orange **Demo data** badge at the top reminds you it is loaded. Do not enter real business in it.
- To test roles, open **Settings → Users & access**, pick a demo team member (e.g. Priya Kumari, Sales) and set a password, then sign in as them.
- **Remove demo data** deletes it and brings back what was there before.

### Import from Excel
1. In Excel, save your sheet as **CSV**.
2. Use the App’s field names as column headers (for example Name, Phone, City, PIN code). Common names such as *Mobile*, *GST No* and *PIN* are understood too.
3. Open the list → **Import CSV** → pick the file. The confirm box shows which columns will be imported and which will be **ignored** (rename those headers if they matter) → **Import**.
4. Dates as DD/MM/YYYY or YYYY-MM-DD.
5. Rows with mistakes, duplicates or the same row imported before are skipped, and the App lists them so you can fix them.

Tip: export a list first (**Export ▾ → CSV**) to get the right headers.

### Export a list
On any list, **Export ▾** saves exactly what the list shows (your search and filters), or only the ticked records:
- **Excel** — opens with numbers, money and dates ready to sort and add up;
- **PDF** — to share or print, with your company name and page numbers;
- **CSV** — plain text for other software, or to import back.

### Backup (admin) — do this every week
1. **Settings → Backup & data → Download backup**. In device mode the file also carries your attached documents and photos, your staff list (names, emails, mobiles, roles and access rights — never passwords) and your document numbering.
2. Keep the file somewhere safe (Google Drive, a pen drive). It contains all your data, so protect it.

### Safety copies and app updates (device mode)
- A new version of the app never deletes your records. If it stores data in a new way, it first puts a full **safety copy** aside, then upgrades the data once.
- The app also makes a safety copy **once a day**, and before every restore or demo data load. The newest 14 are kept on this device.
- **Settings → Backup & data → Keeping your data safe** lists them; **Restore** goes back to one (what is there now is copied aside first, so you can come back). **Make a safety copy now** before anything big.
- New versions install themselves: the app switches to the new version by itself, with no message, the next time they open another screen (or while the app is in the background with no form open). Nothing you are typing is lost.
- Safety copies live in this browser. They do not replace a downloaded backup.

### Restore (admin)
1. **Settings → Backup & data → Restore from backup** → pick the file → confirm.
2. In device mode this **replaces** everything on the device. Users and passwords already on the device are kept; staff in the backup who are not on this device yet are added — open **Settings → Users** and set a password for each before they sign in. Their records (created by them, assigned to them) stay theirs.
3. In cloud mode it adds or overwrites the records in the file; other records stay.
4. Document numbers carry on correctly after a restore: a number already given out (even after the backup was made) is never issued again.

---

## 5. On your phone

### Install the App
- **Android (Chrome):** open the App’s link → ⋮ menu → **Install app** or **Add to Home screen**.
- **iPhone / iPad (Safari):** open the link → **Share** → **Add to Home Screen**.
- **Windows (Edge or Chrome):** click the install icon in the address bar.

It then opens full-screen with its own icon.

**Android app (APK):** install `SuryaSetu-<version>.apk` (allow "install unknown apps" for your file manager once). It works offline in device mode. Exports, backups and documents open Android's **Save or send** sheet (save to Files or Drive, or send on WhatsApp). Install a newer APK over the old one to update: your data stays. Printing from inside the APK is not supported yet; use **Export ▾ → PDF**, or open the website in Chrome to print documents.

### Tips
- The **bar at the bottom** has Home, Dashboard, Search, Alerts and your Account. On a list, the round **＋** button adds a record and **⋯ More** has export, print and import. On forms, **Save** stays at the bottom of the screen.
- **Use my location** works best outdoors. Allow location when asked. If you said no by mistake, allow it in the browser’s site settings.
- Take site photos with the App's camera (**📷 Site photo**): they get the location stamp. Photos taken earlier can be added with **From gallery** or by dropping the files (up to 15 MB each in device mode).
- The phone layout is used on phones only. To change it on a device: **Settings → My account → Appearance → Screen layout** (Automatic, Computer layout, Phone layout).
- Tap any phone number to call. Tap **WhatsApp** to message.
- **WhatsApp** (on leads, customers, vendors, quotations, invoices, receipts, challans, surveys, installations, tickets, AMCs and purchase orders): tap it, check or change the message, tap **Open WhatsApp**, then press send in WhatsApp. The right message is chosen for you: a payment reminder for an overdue invoice, a thank-you for a paid one, the vendor for a purchase order. What you sent is noted in the record's history.
- To send a PDF on WhatsApp: on the print page tap **Share on WhatsApp** → **Print / Save as PDF** (choose *Save as PDF*) → **Open WhatsApp** → attach the saved PDF in the chat (📎 → Document).
- **Settings → WhatsApp** (admin): your business WhatsApp number (printed on quotations and invoices) and the wording of every message — one tap switches them all to Hindi, and each can be changed. Fill-ins like {name}, {amount} and {dueDate} are filled from the record.
- A customer, lead or vendor can have a separate **WhatsApp number** if it is not their phone. Landlines (e.g. 011…, 022…) have no WhatsApp, so no button is shown for them.
- Without internet, the screens still open. In cloud mode you need a connection to load and save; an **Offline** badge shows at the top.
- Dark mode: **Settings → My account → Appearance**.

---

## 6. Your account

- **Create account:** name, email, mobile number and password. In cloud mode you must confirm your email with the link we send and your mobile with an SMS code before using the app. On a device nothing can be emailed or texted, so neither is checked there.
- **Change password:** Settings → My account → Change my password.
- **Forgot password:** on the sign-in page tap **Forgot password?**, then pick **By email** or **By mobile number**.
  - Cloud, by email: open the link we email you.
  - Cloud, by mobile number: **Send code by SMS** → type the code → choose a new password. Email and SMS are alternatives; you only need one reset method.
  - Device mode: there is no server to send email or SMS from, so staff ask the admin for a new password; the admin enters their email **or** mobile number and the recovery code.
- **Mobile number:** required and verified for every cloud account. Change yours in **Settings → My account → Change mobile number**. In cloud mode, confirm it is you with the code emailed to you, then confirm the new number with an SMS code; in device mode type your current password. Accounts made before this was required are asked for it at the next sign-in.
- **Delete my account:** Settings → My account → Delete my account → type **DELETE** → tap the button.
  - Your login is removed at once.
  - Business records you created stay with the company.
  - If you are the only admin, make someone else an admin first.
- Policies: links at the bottom of the sign-in page (Privacy, Terms, Delete account, Grievance).

---

## 7. Troubleshooting

| Problem | What to do |
|---|---|
| “Secure connection needed” | Open the address starting with `https://`. |
| “Waiting for approval” | Ask the admin to give you a role in Settings → Users & access. |
| Sign-up or reset email never arrives | Check spam. The admin may need to set up an email sender (SMTP) in Supabase. |
| “You do not have permission to do this” | Your role cannot change this app. Ask a manager. |
| “Cannot delete: it is used by…” | Delete or change the linked records first. Only admins and managers can delete. |
| “Invoices cannot be deleted” | Cancel the invoice instead. Delete its payments first if it has any. |
| “Only N in stock” / “Not enough stock” | Add stock (Stock Movements → In, or receive the purchase order) before dispatching. |
| “Amount is more than the balance due” | The invoice is already paid up to that amount. Check earlier payments. |
| “…belongs to another financial year” | Do not move a numbered document into another year. Create a new one. |
| “This GSTIN is registered in …” | The state does not match the GSTIN. Fix the GSTIN or the state. |
| “Someone else saved this record while you were editing” | Their version is now loaded. Check it, then save again if your change is still needed. |
| Wrong tax type (IGST instead of CGST + SGST) | Check your company **State** in Settings and the **Place of supply** on the document. |
| No UPI QR on the invoice | Enter a valid UPI ID in Print templates and tick the QR option. The QR shows only when a balance is due. |
| “Device storage is full” | Remove large attachments, or move to cloud mode. |
| “Too many attempts” | Wait a few minutes and try again. |
| App looks old after an update | Close and reopen it. Updates load on the next start. |
| Data missing in device mode | Data lives only in that browser. If site data was cleared, restore your last backup. |
| Free cloud project “paused” | Open the App or the Supabase dashboard; it resumes and no data is lost. |

Still stuck? Contact your admin, or the support details on the Grievance page.
