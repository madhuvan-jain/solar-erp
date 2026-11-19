# Feature list

App: SuryaSetu (“the App”). Business software for rooftop solar installers and EPC companies in India.

This list is for the sales and marketing team (what to promise) and the test team (what to check). It describes the App as built. Rules marked **Rule** are enforced by the App, and in cloud mode most are also enforced by the database.

Contents: [Apps](#apps) · [Views](#views-for-every-list) · [Printed documents](#printed-documents-and-pdfs) · [GST](#gst-rules) · [Numbering](#document-numbering) · [Roles](#roles-and-permissions) · [Offline and install](#offline-and-install) · [Device vs cloud](#device-mode-and-cloud-mode) · [Import, export, backup](#import-export-and-backup) · [Security](#security-and-privacy)

### Record pages: move between records and see the history

- **‹ ›** at the top of every record (and **Alt + ← / →**) go to the previous or next record in the list you came from, in the same order, search and filters; “3 / 20” shows where you are.
- **Activity** at the bottom of every record:
  - who created it and when;
  - every change, field by field, old → new (for example *Status: Draft → Sent*; line items as count and total);
  - **notes** from the team (a call, a promise, a reminder); Ctrl + Enter adds one;
  - **All / Notes / Changes** filter.
- The history is saved with the data, so it is in backups and, in cloud mode, shared with the team. A person sees the history only of records they can open; notes cannot be edited or deleted afterwards.

---

## Apps

The Home screen shows one tile per app. Each person sees only the apps their role can open.

### CRM — leads, customers, follow-ups

**Leads**
- Fields: name, phone, email, city, state, PIN code, address, source, segment, required capacity (kW), monthly electricity bill, stage, assigned to, next follow-up, notes.
- Sources: Website, Walk-in, Referral, Facebook, Instagram, Google, WhatsApp, Call, Exhibition, Other.
- Segments: Residential, Commercial, Industrial, Agriculture, Government.
- Stages: New → Contacted → Site Survey → Proposal Sent → Negotiation → Won / Lost.
- Number: `LD-0001`.
- Actions on a lead: WhatsApp, Convert to customer (or Open customer), Schedule survey.
- **Rule:** a warning appears if the phone number or email is already used by another lead. Phone numbers match in any format (+91, 0, spaces). You can save anyway after the warning.
- **Rule:** auto-assign (Settings). A new lead with no owner goes to the active Sales user who has the fewest open leads. If there are no Sales users, it goes to the person creating it.
- **Rule:** auto-create customer (Settings). Moving a lead to **Won** creates a customer from it. If a customer with the same phone or email exists, the lead is linked to that customer instead.
- **Rule:** the state is filled from the PIN code if left blank.
- Public **enquiry form** (`#/enquiry`, cloud mode only) creates a New lead with source Website.
  - It asks for name, mobile, email, city and a message, and links to the privacy policy.
  - Limits: 5 per hour per connection, 100 per hour for the whole site. A repeat from the same mobile within 24 hours is ignored.

**Customers**
- Fields: name, phone, email, city, address, PIN code, GSTIN, state, map latitude/longitude, electricity consumer number, segment, lifecycle (Prospect, Active Project, Installed, AMC, Inactive).
- Number: `CU-0001`.
- **Use my location** fills the map coordinates from the phone’s GPS, once, only when tapped.
- Actions: WhatsApp, **Statement (PDF)**, New quotation, New project, New ticket.
- The detail page lists everything linked to the customer (quotations, projects, invoices, tickets and so on).
- **Rule:** state is filled from the GSTIN (first two digits) or PIN code if left blank. If the GSTIN belongs to another state, saving is blocked.
- **Rule:** duplicate warning on phone and email.

**Activities & notes**
- Types: Call, Meeting, WhatsApp, Email, Visit, Note.
- Each has a subject, a linked lead and/or customer, a date and time, and details.

### Sales — site surveys and quotations

**Site surveys** (`SS-0001`)
- Linked to a lead. Records survey date, surveyor, roof type (RCC, Tin Shed, Asbestos, Ground Mount, Other), usable roof area (sq ft) and shading (None, Partial, Heavy).
- Also records sanctioned load, recommended capacity (kW), status (Scheduled, Completed, Cancelled), site photo and remarks.
- Prints as a **Site Survey Report**.

**Quotations** (`QT/26-27/0001`)
- Customer, lead, date, valid till, system size (kW), place of supply, line items, discount (₹), status (Draft, Sent, Accepted, Rejected, Expired), terms.
- Line items: pick a product to fill the description (name + specification), HSN, unit, sale price and GST %. Each line can also have its own discount %.
- On the quotation page each line shows the **product name as a link** to that product, with the description under it, plus unit and discount %.
- **Valid till** is filled in from Settings → Sales → *Quotation valid for (days)* (15 by default).
- **New quotation** on a lead (converts it to a customer first, carrying state and PIN code) and **Create quotation** on a site survey start a quotation that is already linked.
- **Confirm order:** the customer said yes. Marks the quotation Accepted, the lead Won, the customer an *Active Project*, and starts one installation project (name, kW, budget = quotation total, stage Planning). Pressing it again never makes a second project; **Open project** goes to it.
- **Convert to invoice:** creates a Draft invoice with the same items, discount and place of supply, and marks the quotation Accepted.
  - **Rule:** a quotation can be converted only once. After that, the button opens the invoice.
  - The invoice carries the project from the confirmed order.
  - Once invoiced, the quotation's lines, discount and customer are **locked**; make a new quotation for a revised offer.
  - Rejected or Expired quotations cannot be confirmed or invoiced (set them back to Sent first).
- The print can show **estimated generation, savings and simple payback**.
  - Formula: kW × units per kW per day × 365, times the tariff. Both values are set in Settings, with defaults of 4 units and ₹7.
  - The print notes that subsidy is not included.

### Projects — projects, milestones, tasks

**Projects** (`PR-0001`)
- Name, customer, capacity, stage, project manager, start date, target date, budget, actual cost, progress %, milestones checklist, notes.
- Stages: Planning, Design, Material Procurement, Installation, Testing, Net Metering, Handover, On Hold.
- Milestones: Site survey done, Design approved, Material procured, Installation done, Testing & QA, Net meter installed, Handover.
- Actions: Schedule installation, Add task, **Send material** (delivery challan), New invoice.
- Prints as a **Project Summary** showing:
  - billed and received;
  - material sent to site, valued at cost;
  - other expenses;
  - gross margin, and a list of material sent.

**Tasks** (`TK-0001`)
- Title, project, assignee, priority (Low, Medium, High, Urgent), status (To Do, In Progress, Review, Done), due date, description.

### Installation

**Installations** (`IN-0001`)
- Project, scheduled date, lead technician, team members, status (Scheduled, In Progress, Completed, Delayed, Cancelled).
- Checklist: Structure mounted, Panels fixed, Inverter installed, DC & AC cabling, Earthing & lightning arrester, System tested, Customer briefed.
- Site latitude/longitude (**Use my location** available), customer confirmed completion, customer rating (1–5), completion photo, remarks / delay reason.
- **Open in Google Maps** when coordinates are saved.
- Prints as an **Installation & Commissioning Certificate**.
- **📷 Site photo** on the installation page: the App's own GPS camera (see *Site photos* under Documents). The photo is filed on the installation, and on its customer and project.

### Inventory — products, stock, delivery challans

**Products**
- Name, SKU, category, brand, specification, warranty, unit, HSN/SAC, sale price and purchase cost (both before GST), GST %, low-stock level.
- Categories: Solar Panel, Inverter, Battery, Structure, Cable, BOS / Accessories, Service, Other.
- **GST and HSN from the category** (since 22 Sep 2025): Solar Panel 5% / 8541, Inverter 5% / 8504, Battery 18% / 8507, Structure 18% / 7308, Cable 18% / 8544, BOS / Accessories 18%, Service 18% / 9954, Other 18%. Changing the category moves an untouched rate and HSN along; anything typed is kept. GST % is required. A typed (custom) line on a document starts at 18%.
- Units: Nos, Watt, kW, Meter, Set, Kg, Job.
- **In stock** is worked out from stock movements.
- **Service — no stock kept:** tick it for work you sell or buy (installation, transport, liaisoning). Products in the Service category or with unit “Job” never keep stock either. Services never appear in stock, low-stock alerts or the stock valuation.
- **Stock card** on each product: in stock, **on order** (still due on open purchase orders), **average cost**, **stock value**, stock per warehouse, and the latest entries with their reason. Buttons:
  - **Count / adjust** (inventory managers): enter what you counted (everywhere or in one warehouse); the difference is saved as one entry with its reason (Opening stock, Count correction, Damage / scrap, Other) and a note.
  - **Move between warehouses:** one linked pair of entries; never more than is there.
- **Rule:** an SKU belongs to one product (refused, not just warned); a second product with the same name asks first.
- **Rule:** once stock was booked, the unit is fixed (10 panels never become 10 watts); a stocked product cannot be made a service while it has stock; a product used on any quotation, invoice, order or challan cannot be deleted.
- **Purchase orders** use the product's **purchase cost**, never its sale price; with no cost saved the line starts at 0 and says *Enter the purchase cost*.
- **CSV import** finds products by name or SKU. Sale price and cost are rates, so lists and exports do not add them up.

**Warehouses**
- Name and location. Stock is kept per warehouse. Settings → Purchase & stock → *Receive goods into* sets the default warehouse for purchase orders.

**Stock movements** (`SM-0001`)
- Product, warehouse, In or Out, quantity, **reason**, date, **cost per unit**, project dispatched to, serial numbers, reference (PO / challan).
- **Rule:** stock can never go below zero — overall, and in the warehouse it is taken from — whether by a new entry, an edit, moving an entry to another product, or a delete.
- **Rule:** entries made by a purchase order, challan or transfer belong to it: they cannot be edited or deleted on their own (change the document instead). This is checked by the app and by the database.
- **Rule:** only an inventory manager (or the admin) can add stock entries by hand. Normally stock comes in with purchase orders and goes out with challans.
- **Valuation:** moving average. Goods received are valued at the purchase-order price after line discounts (before GST); goods issued go out at the average cost at that moment, which is also what project costing uses. Entries without a cost use the product’s purchase cost.

**Delivery challans** (`DC/26-27/0001`)
- Project, customer (taken from the project if blank), from warehouse, date, vehicle number, transporter / driver, material lines, status (Draft, Dispatched, Delivered, Cancelled), notes.
- **Rule:** setting Dispatched or Delivered takes the product lines out of stock **once**, from the challan’s warehouse. Services are skipped.
- **Rule:** dispatch is blocked if any product does not have enough stock (in that warehouse). The message lists what is short.
- **Rule:** once stock is out, the lines and the warehouse cannot be changed, and the challan cannot go back to Draft. Cancel and make a new challan instead.
- **Material at site** card: what went out and has not come back. **Return from site** puts unused material back (part of it too), never more than went out less earlier returns, at the cost it went out at.
- **Rule:** cancelling a dispatched challan puts back exactly what is still out — from its real stock entries. A cancelled challan cannot be reopened. A challan that moved stock cannot be deleted.
- Prints as a **Delivery Challan**: no prices, approximate goods value, and a “Received by” signature box.

### Purchase — vendors and purchase orders

**Vendors**
- Name, contact person, phone, email, GSTIN, state, city, PIN code, what they supply, rating (1–5), contract end date, address.
- **Rule:** duplicate warning on phone and GSTIN. State is filled from the GSTIN, and a wrong state is blocked.

**Purchase orders** (`PO/26-27/0001`)
- Vendor, order date, expected delivery, items (priced at purchase cost), discount, status (Draft, Ordered, Partially Received, Received, Cancelled), notes.
- Computed: total, **paid** (from supplier payments) and **still to pay**. Filters *To pay* and *Paid in full* use these.
- **GST on purchase orders:** CGST + SGST if the vendor is in your state, IGST if not.
- **Receive into warehouse** (or the default from Settings).
- **Goods received** card with **Receive goods**: enter what actually arrived (part deliveries too) and the date. Each receipt adds stock at the order’s price; the status becomes *Partially Received* until everything has come, then *Received*. Choosing *Received* on the order adds everything still due.
- **Rule:** never more than is still due; goods are never received twice, also not when two people try at once.
- **Rule:** after the first receipt the items are locked and the order cannot be cancelled or set back to Draft / Ordered. An order with receipts cannot be deleted.
- **Rule:** receiving needs Inventory access as well as Purchase access (it changes stock). If an entry cannot be saved, the order is put back as it was.
- Action: **Record supplier payment** (filled with the vendor and what is still to pay).

**Supplier payments** (`SP/26-27/0001`)
- Purchase order, vendor, date, amount, mode (Bank Transfer, UPI, Cheque, Cash, Card), reference / UTR, notes.
- **Rule:** never more than is still to pay on the order; not on a cancelled order; the vendor must be the order's vendor (it is filled in from the order).
- **Rule:** an order with supplier payments cannot be cancelled or cut below what was paid; once goods are received, its discount and vendor are locked too.
- Each payment has a date, so Reports and the Dashboard place it in the right month. An amount typed on an order by an older version still counts, as *Paid earlier (no date)*.

### Accounts — invoices, payments, expenses

**Tax invoices** (`INV/26-27/0001`)
- Customer, project, invoice date, due date, place of supply, items, discount, status (Draft, Sent, Cancelled), notes.
- **A Draft has no number yet.** It is shown as *Draft invoice of 12/11/2026* and prints marked DRAFT. **Issue invoice** (or saving it as Sent, or recording its first payment) gives it the next number in the series, so drafts that are never sent leave no gaps in the numbering. An older draft takes the issue date (its due date moves with it).
- **Rule:** an invoice is issued only with a place of supply (chosen, or the customer's state); the Issue dialog asks when neither is known. A draft takes the tax type (CGST + SGST or IGST) that applies when it is issued.
- **Rule:** once issued, the lines, price, customer, place of supply and date are locked and it never goes back to Draft; a cancelled invoice stays cancelled and owes nothing (balance 0).
- Computed: total, balance due, payment status (Unpaid, Partially Paid, Paid). Payment status always comes from the recorded payments.
- **Rule:** due date defaults to invoice date + payment terms (Settings, default 15 days).
- **Rule:** invoices can **never be deleted**; they can only be cancelled.
  - **Cancel invoice** appears only when no payment has been recorded.
  - An invoice with payments cannot be cancelled.
- **Rule:** the total cannot be edited below the amount already received.
- **Rule:** an invoice cannot be moved to another financial year by changing its date.
- Actions: Issue invoice (drafts), Record payment (filled with the balance), Cancel invoice, Print / PDF, Share on WhatsApp.

**Payments received** (`RC/26-27/0001`)
- Invoice, date, amount, mode, kind (Payment or Advance), reference / UTR.
- Modes: Cash, UPI, Bank Transfer, Cheque, Card, Loan Disbursal, Subsidy.
- **Rule:** a payment cannot be more than the balance due. Payments cannot be made against a cancelled invoice.
- **Rule:** the first payment on a Draft invoice issues it: it is marked Sent and gets its number.
- Prints as a **Payment Receipt**: amount in words, invoice total, total received, balance.

**Expenses** (`EX-0001`)
- Description, category, amount, date, project, receipt file.
- Categories: Material, Labour, Transport, Salary, Rent, Utilities, Marketing, Office, Other.
- Prints as an **Expense Voucher**.

**Statement of account** (from a customer)
- Issued invoices (debit) and payments (credit), oldest first, with a running balance and a closing balance.
- Can be shared on WhatsApp with the outstanding amount.

### Subsidy — PM Surya Ghar applications

- Number: `SB-0001`.
- Customer, scheme (default “PM Surya Ghar”), portal application number, capacity, subsidy amount, applied on, remarks.
- **PM Surya Ghar amount worked out for you:** left empty, the capacity comes from the customer's project (or accepted quotation) and the amount from the scheme: ₹30,000/kW for the first 2 kW + ₹18,000 for the 3rd kW, at most ₹78,000; 10% more (at most ₹85,800) in the North-East, Himachal Pradesh, Uttarakhand, J&K, Ladakh, Andaman & Nicobar and Lakshadweep. It follows later changes of capacity; an amount you type is kept (housing societies get other rates).
- Status: Applied → Documents Verified → Under Review → Approved → Disbursed / Rejected.
- Document checklist: Aadhaar, Electricity bill, Bank passbook / cheque, Site photo, Net meter agreement, Commissioning report.
- This is a tracker only. It does not connect to the national portal.

### Solar loans

- Number: `LN-0001`.
- Customer, bank / lender, loan amount, interest % p.a., tenure (months), first EMI date, remarks.
- Status: Submitted, Verification, Approved, Disbursed, Repaying, Closed, Rejected.
- Document checklist: Personal details, Income proof, KYC, Bank statement, Quotation.
- **Monthly EMI** is calculated on a reducing balance; at 0% interest it is a simple division.
- Prints as **Loan Summary & EMI Schedule**:
  - month-by-month interest, principal and balance;
  - total interest and total payable;
  - a note that the lender’s sanction letter is final.

### Service — tickets and AMC

**Service tickets** (`TKT-0001`)
- Issue, customer, priority, assigned to, resolve-by date, description, resolution.
- Types: Complaint, Breakdown, Cleaning, AMC Visit, Query.
- Status: Open, Assigned, In Progress, Resolved, Closed.
- Prints as a **Service Report** with a customer signature box.

**AMC contracts** (`AMC-0001`)
- Customer, start and end date, visits per year, contract value, notes.
- Status: Active, Expired, Renewed, Cancelled.
- Prints as an **Annual Maintenance Contract**.

### Documents

- Name, category, customer, project, file (required), **valid until** (warranties, agreements), notes.
- Categories: KYC, Project, Agreement, Invoice, Subsidy, Warranty, Other.
- **Files view** (opens first): drop several files at once (or choose them; on a phone the camera is offered), then give them a category, customer, project and valid-until date in one go. Names come from the file names; the category is guessed from the name (e.g. “Aadhaar…” → KYC).
- Documents show as **cards** with a picture preview for photos and a tile for PDF, Word and Excel; **category chips** with counts filter them; ⬇ downloads.
- **Preview**: photos and PDFs open large inside the app, with ‹ › (or the arrow keys) to move through the documents, **Download** and **Open**. Other files are downloaded, never opened inside the app.
- **On records with a site** (customers, projects, leads, site surveys, installations, tickets, AMCs, delivery challans): a *Photos & documents* card lists theirs, with **📷 Site photo** and a place to drop files.

**Site photos — the App's own GPS camera**
- **📷 Take photo** in Documents, **📷 Site photo** on a record, and **📷 Camera** next to every photo field (survey site photo, installation completion photo, expense receipt, document file).
- Live camera in the App with the place shown while you aim: town, district and state, Plus Code, latitude/longitude with GPS accuracy (± m, green when good), date and time, and a note (filled with the record, e.g. *Installation IN-0014 · Ravi Kumar*, and editable). Switch front/back camera; **From gallery** for an existing photo; Retake or Use photo.
- The stamp burned into the photo: a mini map with a pin and nearby towns, the place, Plus Code, coordinates, date and time, the note, a *SuryaSetu Camera* badge and a QR code. The QR opens the spot on Google Maps, or a link you set in **Settings → Documents & print → Site photos** (for example your own app's page). A default note can be set there too.
- Place names work **offline**: about 7,200 Indian towns and all districts are bundled with the App. No map service or API key is used, so the mini map is the App's own map, not a satellite picture.
- The photo is saved as a document (*Site photo — Installation IN-0014 — Patna — 12/11/2026*, category Project) with its place, latitude, longitude and time, linked to the record, its customer and project. An empty site location on the record is filled from the photo.
- If the camera cannot be opened (permission refused, or an older phone), the phone's own camera opens instead and the stamp is still added. Without GPS the photo is stamped *Location not available*.
- **Alert** when a document's *valid until* date is within 30 days or has just passed.
- File types: images, PDF, Word, Excel, CSV, text.
- Size limit: 20 MB per file in cloud mode, 15 MB in device mode. Device mode keeps files in the browser’s file store (IndexedDB), apart from the records, so they do not fill the record storage. Backups include them.

### Team — employees and attendance

**Employees**
- Name, phone, email, designation, department, joining date, monthly salary, active.
- Departments: Sales, Projects, Installation, Service, Accounts, Purchase, Admin.
- **Rule:** duplicate warning on phone.

**Attendance**
- Employee, date, status (Present, Absent, Half Day, Leave, Late), check-in and check-out time.

### My dashboard (build your own)

- **Dashboard → + Create my dashboard**: start from the solar template or empty. One custom dashboard per person (for now), kept on this device. Once made, it opens first; **Default dashboard** is one tap away.
- **Items**: KPI tile (sum, average or count, optional target with progress bar, change vs the period before, click opens the filtered list), chart (bar, line, donut, bars; group by any field or by month / quarter / financial year; optional split), top list with share bars, latest records, India map, alerts, note.
- **Data for each item**: any record type the person may see, the measure, ready-made filters (the same as the lists), the date field that follows the dashboard period (or all time), top N.
- **+ Add item** is always beside the period buttons. **Customize**: edit (with a live preview), duplicate, remove; drag ⠿ to move or use ← →; drag the corner ◢ to resize on a 12-column grid (1–6 rows tall) or use the arrow keys; colours; **rename the dashboard** (the *Dashboard name* box, or ✎ next to the title); delete it.
- **Nothing is cut off:** an item whose content is longer than its box scrolls; charts with many bars keep a readable width and scroll sideways; **⤢ Open large** shows any chart, list, map or alert list full size, with the numbers in a table and more rows.
- Access rights apply: an item about data the person cannot see says so instead of showing numbers. On phones items stack one per row.

### Dashboard

- **+ Add item:** add your own charts, KPI tiles, top lists, records, map, alerts or notes to the default dashboard too; ✎ edits and ✕ removes them in Customize.
- **System sizes:** the *Installed* and *Active projects* tiles count systems by size (3 kW × 4, 5 kW × 2, 10 kW × 1…) with the kW total beside it, and the **Systems by size** chart compares installed and in-progress systems per size.
- **✎ Customize:** put the KPI cards and the sections (map, charts, follow-ups, installations) in your own order — drag ⠿ with a mouse, or use ↑ ↓ on a phone or keyboard — and hide or show any of them with 👁. **Reset order** goes back to the standard layout. The order is saved for each person: on the device, and in cloud mode with the account, so the same order shows on a phone and a computer.
- **Period filter:** This month, Last 3 months, This FY (default), Last 12 months, All time.
- **KPI cards** (each opens the matching list), shown according to role:
  - Invoiced and Collected, with a trend arrow against the previous period;
  - Receivables, with the amount overdue;
  - Open quotations: value and count of draft or sent;
  - New leads, with trend;
  - Conversion rate: won out of closed;
  - Installed kW and number of installations completed;
  - Active projects and kW in progress;
  - Open tickets.
- **India map:**
  - Shows **Sales ₹ by state** or **Customers**, with a toggle when the role can see both.
  - Customers are placed from saved coordinates, otherwise PIN code, otherwise city, otherwise state.
  - **Zoom changes the detail:** the whole of India shows one numbered bubble per state; zooming in (or picking a state) shows one bubble per city, named; zooming in further shows every customer, and customers at the same address fan out so each can be clicked.
  - **District names:** zoomed in or with a state chosen, every district is named (all 763, from GeoNames) — all of the chosen state's districts first, neighbouring ones fainter.
  - **State filter:** pick a state (the list shows how many customers each has) and the map flies to it, fades the other states and shows its cities. **All India** goes back.
  - City and state names are printed on the map and placed so they never overlap a bubble or each other; more cities appear as you zoom in.
  - Zoom with **+ / −**, double-click, Ctrl + mouse wheel, touchpad pinch or two-finger pinch on a phone; drag to move around.
  - The **Map** view of a list adds a side panel: top states, then the cities of the chosen state, then the customers in a city.
- **Needs attention:** the alert list.
- **Charts** (each can switch chart type):
  - cash flow by month (invoiced, collected, expenses);
  - sales by product category;
  - lead pipeline and lead sources;
  - projects by stage;
  - top customers.
- **Upcoming follow-ups** and **installation schedule**.

### Reports

Choose a From and To date. Sections appear according to role. Every table can be exported to CSV.

| Report | What it shows |
|---|---|
| Invoiced, collected, expenses and paid to suppliers by month | Chart and table; KPIs include **Paid to suppliers** and **Net cash** (collected − expenses − paid to suppliers) |
| Collections by month | Bars |
| Expenses by category | Bars |
| GST summary (sales) | Per invoice: customer GSTIN, taxable value, CGST, SGST, IGST, total. Draft and cancelled invoices are left out. |
| GST on purchases (input tax) | From purchase orders: vendor GSTIN, taxable value, taxes, status, plus an **indicative net GST**. The App notes that input credit depends on vendor invoices in GSTR-2B, so the CA must confirm it. |
| HSN-wise sales summary | HSN/SAC, GST %, taxable value, tax |
| Receivables ageing (today) | Per customer: Not yet due, 1–30, 31–60, 61–90, Over 90 days, total |
| Product-wise sales | Quantity and taxable value per product, plus a top-10 chart |
| Stock valuation (at cost) | Stock, cost, value, low-stock flag per product |
| Lead sources | Leads, won, win rate per source |

### Alerts

Shown on the Alerts page, on the dashboard (“Needs attention”) and as a count on the top bar. Each person sees only alerts for modules they can open. Items marked “own” show only to the assigned person, or to everyone if nobody is assigned.

**Choose your alerts:** Settings → Alerts → *Choose which alerts I get* is **off by default** (you get every alert your access allows). Switch it on and tick only the kinds you want; **Tick all / Untick all** help. The choice is per person and, in cloud mode, follows the account to every device.

| Alert | When |
|---|---|
| Unassigned new lead | Lead is New with no owner |
| Follow-up overdue / today (own) | Next follow-up date is past / today (not Won or Lost) |
| Task overdue (own) | Due date past and not Done |
| Project delayed | Target date past and stage not Handover or On Hold |
| Installation delayed / today | Status Delayed, or scheduled date past / today, and not Completed or Cancelled |
| Low stock | Stock at or below the low-stock level (if a level is set) |
| Payment overdue | Sent invoice past its due date with a balance |
| AMC expired / renewal due | Active AMC past its end date / ending within 30 days |
| EMI due | Disbursed or Repaying loan with an EMI in the next 7 days |
| Ticket overdue / urgent (own) | Resolve-by date past, or priority Urgent, and not Resolved or Closed |
| Subsidy pending 45+ days | Applied more than 45 days ago and not Disbursed or Rejected |

### Settings

Settings are split into tabs, one subject each; the open tab is part of the address (for example `#/settings?tab=sales`). On a phone the tabs become one sideways-scrolling row.

| Tab | Who | What |
|---|---|---|
| General | Admin | Company name, GSTIN, PAN, state (decides CGST+SGST or IGST), phone, email, website, address, bank name, account number, IFSC. Cloud mode: the link to this business's **website enquiry form** |
| Sales | Admin | **CRM:** auto-assign new leads, auto-create the customer on Won. **Site surveys:** default surveyor. **Quotations:** valid for (days), bank details on quotations, savings estimate (units per kW per day, tariff), default quotation terms |
| Accounts | Admin | Payment terms (days), default invoice terms, invoice declaration |
| Purchase & stock | Admin | Purchase order terms, delivery challan note |
| Documents & print | Admin | Logo, signature / stamp, layout (Classic, Modern, Compact), accent colour, tagline, UPI ID, UPI QR on invoices, footer line; live preview link |
| Users & access | Admin | Cloud mode: the **company code** staff join with, **Copy invite link**, **Change code**. List users with mobile numbers. Edit name, mobile, role, access rights, active. **Delete user.** In device mode also add users and set passwords |
| Subscription | Admin (cloud mode) | The trial or plan and its end date; on the website the four plans (1, 3, 6, 12 months: ₹1,000 / ₹2,500 / ₹4,500 / ₹7,500, GST included) with **Pay** through Razorpay, and the payments made. In the Android and iPhone apps the status only |
| Alerts | Everyone | Choose which alerts you get (see Alerts) |
| My account | Everyone | Mobile number (changing it needs a code sent to your email in cloud mode, or your current password in device mode), change password, appearance (System, Light, Dark), delete my account |
| Backup & data | Admin | Download backup (JSON), restore from backup, demo data (device mode) |

Non-admin users see only **Alerts** and **My account**.

### Home and search

- One tile per app the role can open, plus Dashboard, Reports, Alerts and Settings. Tiles show a count of open alerts.
- **Search everything:** name or title, document number, phone, email, city, GSTIN, SKU, subsidy application number.
- The top bar has Home (“All apps”, hidden on the home screen), the app’s tabs, the company name and logo, a bell that opens a short list of alerts, an **Offline** badge when there is no connection, and the account menu (profile, settings, switch account, sign out — with an “Are you sure?” step).

### Create without leaving the form

- Pickers for **customer, lead, project, product, vendor, warehouse and employee** end with **“+ Create new …”**. It opens a short popup with the key fields (“Show all fields” for the rest); the new record is picked straight away and the form underneath keeps everything typed so far.
- A product created from a document line takes the name, HSN, unit, GST and price already typed on the line (purchase orders fill the purchase cost).
- A customer created from a quotation for a lead starts with the lead’s name, phone, email, address and PIN code. A project created from a form takes that form’s customer.
- Same checks as the full form (required fields, phone, GSTIN, PIN, duplicates). On a duplicate it offers **Use** the existing record or **Create anyway**.
- Only shown where the role may create that record. For example, Sales can add a customer from a quotation but cannot add a product.

---

### WhatsApp

- **WhatsApp** button on leads, customers, vendors, staff, quotations, invoices, receipts, challans, site surveys, installations, tickets, AMCs, purchase orders and supplier payments; **Share on WhatsApp** on print pages.
- It goes to the right person (the customer, the lead behind a survey, the vendor of an order) on their **WhatsApp number** if one is saved, else their phone. Indian numbers in any form (+91, 0, spaces) and foreign numbers with their country code; landlines that can be recognised (011, 022, 0522…) get no button.
- The message fits the record now: a new-enquiry message for leads, the quotation with its kW and total, the invoice with balance and due date (with your UPI ID), a **payment reminder** once overdue, a thank-you when paid, the receipt, the customer's balance, survey and installation visits, dispatch with vehicle, service requests, AMC renewal, purchase orders and vendor payments.
- A dialog shows the number and the message, which can be changed, then **Open WhatsApp** opens the chat (WhatsApp app on phones and in the Android app, WhatsApp Web on computers). Nothing is sent automatically. What was sent is noted in the record's history.
- **Settings → WhatsApp:** the business WhatsApp number (printed on quotations and invoices) and the wording of all 16 messages, with fill-ins ({name}, {company}, {amount}, {balance}, {dueDate}, {upi}…); **Use Hindi messages** switches them all to Hindi.

## Search, filters, group by and favorites (every list)

Filters, grouping and saved searches, written for a solar business.

- **Views** (List, Board, Calendar, Pivot, Graph, Map) are icons beside the search box; the name shows on hover or keyboard focus.
- **Recently used & history** — the last 3 filter set-ups are at the top of the panel (one tap brings one back); **History** shows the last 7 with when they were used. Tap ☆ to keep one in **Favorites**, or tick several in History and **Add to favorites**.
- **Search box with facets.** Typing searches everything at once. The dropdown also offers **Search Phone for: …**, **Search City for: …** and so on; the choice becomes a chip in the box. Backspace removes the last chip.
- **Filters** (the funnel button). Filters in the same section are combined with OR, different sections with AND — e.g. *Stage: New or Contacted* **and** *Residential rooftop*. Each shows how many records match.
  - Every list: **Mine** (assigned to me / projects I manage / my installations…, not assigned, created by me), its **status/stage** values and a **period** (this month, last month, this quarter, this and last financial year, April–March).
  - Leads: open, proposal or negotiation; follow-up overdue / today / next 7 days / none planned; residential rooftop, commercial & industrial, agriculture (solar pumps), government; size up to 3 kW (PM Surya Ghar), 3–10 kW, above 10 kW; electricity bill ₹3,000+ or under ₹1,500; online, referral/walk-in, phone call.
  - Customers: type, lifecycle, B2B (GSTIN) / B2C, in our state (CGST + SGST) / other states (IGST), no PIN code, no electricity consumer no.
  - Site surveys: RCC / sheet / ground-mount roof, shade-free or shaded, recommended size.
  - Quotations: still valid, expiring in 7 days, past valid date; converted / accepted but not invoiced; system size; ₹1 lakh+ and ₹5 lakh+.
  - Projects: not started, under installation, waiting for net meter, handed over; delayed, due this month; over budget; size.
  - Installations: today, next 7 days, overdue; customer confirmed / not confirmed.
  - Products: category, out of stock, low stock, in stock, GST 5% / 18% / other.
  - Invoices: unpaid, partially paid, paid; overdue, due in 7 days; B2B / B2C; inter-state (IGST) / within the state.
  - Purchase orders: to receive, late delivery, not fully paid, paid. Tickets: open, urgent or high, overdue, type. AMC: ends in 30 days, ended not renewed. Subsidy: pending over 30 days. Loans: waiting for the bank, approved. Vendors, stock movements, payments, expenses, documents, staff and attendance have their own.
- **Live counts** — the number next to each filter is how many records you would see with it added, given the filters already chosen (0 is greyed).
- **Add custom filter** — any field, a condition and a value: *contains / is / is not / is set / is not set* for text and pick lists; *=, >, ≥, <, ≤, between* for numbers and money (e.g. **Balance due between ₹1,00,000 and ₹6,00,000**, **Required capacity ≥ 5 kW**); *on, before, after, between* for dates (any date range). Several custom filters combine with AND.
- **Group by** — one or two levels in the List view, by any pick list, person, linked record, city, or a date by **month, quarter or financial year** (Q1 = April–June). Each heading shows the count and the money total; click to open, or **Expand all / Collapse all**. Very large groups show the first 200 and say how many more. The same grouping is used when you switch to **Pivot** or **Graph**.
- **Select and act on many records** — tick rows (or *Select all N* matching), then **Export** just those, **Set stage/status**, **Assign to** a person, or **Delete** (only for managers of that app). Every change goes through the normal rules and access rights; anything refused (e.g. an invoice with payments cannot be cancelled) is listed afterwards and stays selected.
- **Favorites** — searches you starred, named after what they do (e.g. *Customer type: Residential rooftop · Group by: Stage*). **Default** makes one open by itself with the list; ✕ removes it. Saved per person on this device.
- The search is part of the page address, so Back, bookmarks and shared links keep it. Filters also apply to the Board, Calendar, Pivot, Graph and Map views and to exports (Excel, PDF, CSV).

## Views for every list

Every record type opens in **List** view. Other views appear where they make sense.

| View | Available for | What it does |
|---|---|---|
| List | All | Search, filter by status, sort by any column, 25 per page, **Export CSV**, **Import CSV** (if you can edit) |
| Board | Types with a status or stage | Columns per stage; drag cards, or use the **Move** dropdown on each card |
| Calendar | Types with a date (for example projects by target date, tickets by resolve-by, AMCs by end date) | Month calendar of records |
| Pivot | All | Group rows (and optionally columns) by any choice, person, link, yes/no or month; measure Count or any amount; export CSV |
| Graph | All | Same grouping as Pivot, shown as Bar, Line, Donut or horizontal Bars |
| Map | Types with an address or linked to a customer, project, lead or vendor | Records on the India map |

---

## Printed documents and PDFs

- **Tax invoice** (CGST Rules, rule 46): supplier and recipient GSTIN, state **with GST state code** (e.g. “10 - Bihar”), place of supply with code, **Reverse charge: No**, HSN/SAC summary with **CGST and SGST (or IGST) rate and amount per HSN and rate**, adding up exactly to the totals; amount in words; Original / Duplicate / Triplicate copies.
- Without a company GSTIN the bill is titled **Invoice** (not Tax Invoice) and the print screen says why. A **Draft** invoice prints marked “DRAFT — not a valid tax invoice”, without the payment QR.
- **Delivery challan** (rule 55): Original for Consignee / Duplicate for Transporter / Triplicate for Consigner; each line with rate, taxable value, GST rate and tax; place of supply; value of goods.
- **Payment receipt** shows the totals as they stood with that receipt, so a reprint later shows the same figures.
- **Installation certificate** is marked “Provisional” until the installation is Completed.
- **Project summary**: margin on the value before GST, issued invoices only.

Open a record → **Print / PDF** → **Print / Save as PDF**. The PDF file name is the document title, number and party name. Many documents also have **Share on WhatsApp**, which sends a short message with the amount; attach the saved PDF.

Every document carries:
- your logo, company name, tagline, address, contact details, GSTIN, PAN and state;
- the party’s name, address, PIN code, phone, GSTIN and consumer number;
- the document number and date;
- signature boxes, with your signature image if one is set;
- the footer line.

Cancelled documents show **CANCELLED**.

| Document | From | Contents |
|---|---|---|
| Quotation | Quotations | Items with HSN, qty, rate, line discount, GST %, totals, CGST+SGST or IGST, round off, amount in words, savings estimate, terms, optional bank details |
| Tax Invoice | Invoices | Original / Duplicate / Triplicate copy, place of supply, items, totals, received and balance due, HSN-wise tax table, bank details, **UPI QR for the balance** (if a valid UPI ID is set), terms, declaration |
| Payment Receipt | Payments | “Received with thanks” with amount in words, mode, reference, invoice total, total received, balance |
| Purchase Order | Purchase orders | Ship-to address, items at cost with GST, totals, PO terms |
| Delivery Challan | Delivery challans | Vehicle, transporter, from warehouse, material without prices, approximate goods value, challan note, “Received by” box |
| Installation & Commissioning Certificate | Installations | Certificate text with capacity, customer and project, details, site coordinates, checklist, notes, photo, customer signature |
| Site Survey Report | Site surveys | Survey details, remarks, photo, customer signature |
| Service Report | Tickets | Type, priority, status, engineer, details, resolution, customer signature |
| Annual Maintenance Contract | AMC contracts | Contract details and notes, customer signature |
| Project Summary | Projects | Details, billed, received, material at cost, expenses, gross margin, material sent to site, milestones |
| Loan Summary & EMI Schedule | Loans | Loan terms, EMI, total interest, total payable, month-by-month schedule, document checklist |
| Expense Voucher | Expenses | Details, amount in words, receipt image |
| Statement of Account | Customers | Debit / credit / running balance and closing balance |

---

## GST rules

- **GST rates** on items: 0, 5, 12, 18, 28%.
- **Intra-state vs inter-state:**
  - Sales documents compare your company state with the **place of supply**. Place of supply defaults to the customer’s state.
  - Purchase orders compare your state with the **vendor’s state**.
  - Same state → CGST + SGST, each half the rate. Different state → IGST.
  - If your company state is not set, CGST + SGST is used. Set it in Settings.
- **Tax type is frozen** when a document is saved. Later changes to the company or customer state do not change issued documents. It is worked out again only if you change the customer, place of supply or vendor.
- **Discounts:**
  - Each line can have a discount %.
  - A document discount (₹) is spread over the lines in proportion to their value, so GST is charged on the discounted amount.
- **Totals:**
  - Totals are rounded to the nearest rupee; the round-off is shown.
  - Amounts are kept to the paisa.
  - Amount in words uses lakh / crore.
- **HSN-wise summary** on every tax invoice and in Reports.
- **GSTIN check:** 15-character format. The first two digits must match the state.
- **State from PIN code:** a blank state is filled from the 6-digit PIN code.
- The App does **not** generate e-invoices (IRN), e-way bills or GST returns. Reports are aids for your CA.

## Document numbering

- Numbers are assigned when a record is first saved; **invoices are numbered when issued** (a Draft has none yet). Numbers never change and are never reused, and numbering carries on correctly after a backup restore.
- **Per financial year** (April–March, for example `26-27`): Quotation `QT/26-27/0001`, Invoice `INV/26-27/0001`, Receipt `RC/26-27/0001`, Purchase order `PO/26-27/0001`, Supplier payment `SP/26-27/0001`, Delivery challan `DC/26-27/0001`. Each year starts again at 0001.
- **Running numbers:** Lead `LD-`, Customer `CU-`, Survey `SS-`, Project `PR-`, Task `TK-`, Installation `IN-`, Stock movement `SM-`, Expense `EX-`, Subsidy `SB-`, Loan `LN-`, Ticket `TKT-`, AMC `AMC-`.
- **Rule:** changing a year-numbered document’s date into another financial year is blocked. Create a new document instead.

## Roles and permissions

The database enforces the same table in cloud mode (`src/lib/rbac.ts` = `public.can_access()`).

| App | Admin | Manager | Sales | Technician | Accounts |
|---|---|---|---|---|---|
| CRM | Edit | Edit | Edit | View | View |
| Sales (surveys, quotations) | Edit | Edit | Edit | Edit | Edit |
| Projects | Edit | Edit | View | Edit | View |
| Installation | Edit | Edit | — | Edit | — |
| Inventory | Edit | Edit | View | View | Edit |
| Purchase | Edit | Edit | — | — | Edit |
| Accounts (finance) | Edit | Edit | — | — | Edit |
| Subsidy | Edit | Edit | Edit | — | Edit |
| Solar Loans | Edit | Edit | Edit | — | Edit |
| Service | Edit | Edit | — | Edit | — |
| Documents | Edit | Edit | Edit | Edit | Edit |
| Team | Edit | Edit | — | — | Edit |
| Delete records | Yes | Yes | No | No | No |
| Users, company settings, print templates, restore backup | Yes | No | No | No | No |

- **Pending:** a new cloud sign-up has no access until an admin gives it a role.
- Company settings are readable by every approved role, because they print on documents.
- **Rule:** records still used by other records cannot be deleted (for example a customer with a quotation). The message says what uses it.
- **Rule:** there is always at least one active admin.
- **Rule:** if two people edit the same record, the second save is warned instead of overwriting.


### Access rights per person

- A **role** is a starting template. In **Settings → Users & access → Edit → Access rights** the admin can change any single app for one person:
  - **No access** — the app is hidden.
  - **Viewer — read only.**
  - **User — own documents only** — only records the person created or that name them (assigned to, project manager, surveyor, technician…). Offered for CRM, Sales, Projects, Installation, Service, Subsidy, Solar loans and Documents (not for shared books like stock, purchase, accounts and staff).
  - **User — all documents.**
  - **Manager — all documents, can delete.** Only managers of an app can delete in it.
- Users with changed rights show a **custom** badge; **Reset to the … preset** undoes the changes.
- The admin always has everything, plus users, company settings, backup/restore and demo data.
- The same rules are enforced in the data layer on the device and by the database in cloud mode (row-level security), not only by hiding buttons.
- Only the admin can add users or change roles, access rights or active status. Everyone can change their own name, mobile number and password.

### Sign-in: accounts on this device

- After signing in, the account (name and email only) is listed on this device's sign-in page, like a mail or social app: tap it and type the password. **Use another account**, **Create account** and ✕ to remove an account from the list.
- Untick **Show this account on this device next time** to not be listed. The app never stores passwords; deleting an account also removes it from the list.

## Fits every screen

- **Phone layout only on phones:** the app-style layout (bottom bar, round ＋ button, lists as cards) is used on touch phones. A small window on a computer keeps the computer layout. Settings → My account → Appearance → *Screen layout* can force *Computer layout* or *Phone layout* on a device.

- **Phones (from 320 px):** an app-style **bottom bar** (Home, Dashboard, Search, Alerts with count, Account), a round **＋** button on lists to add a record, a **⋯ More** menu for export, print and import, the **Save** bar stays at the bottom of forms, record buttons scroll sideways in one row, one-line top bar, app tiles two per row, lists shown as cards (title, status, key details, amount; tick to select; sort menu), line items as cards, controls wrap instead of sticking out, bigger touch targets.
- **Tablets:** two-column forms; quotation and invoice lines switch to cards below 980 px so ten columns are never squeezed.
- **Laptops to ultra-wide (up to 2560 px and beyond):** the page widens in steps (1320 → 1560 → 1840 → 2240 px) so more tiles, KPIs and charts fit side by side — three or four chart columns on big monitors — while forms keep a comfortable reading width.
- Checked automatically at 320, 375, 414, 600, 768, 1024, 1280, 1440, 1920 and 2560 px on 16 screens: nothing sticks out sideways.

## Offline and install

- Installable app (PWA) on Android (Chrome: Install app / Add to Home screen), iPhone / iPad (Safari: Share → Add to Home Screen) and Windows (Edge / Chrome install icon).
- **Android app (APK)**: `npm run apk` builds `SuryaSetu-<version>.apk` (Capacitor). It works offline in device mode; exports, backups and documents go to Android's *Save or send* sheet. Updates install over the old app and keep its data (same app id and signing key, higher version). Printing from inside the APK is not supported yet (use Export → PDF). See `docs/UPGRADING.md`.
- The App’s screens open without internet after the first visit. A new release is downloaded in the background and used automatically (no message) the next time the person opens another screen, or while the app is in the background with no form open; it never reloads while someone is typing.
- **Device mode** works fully offline.
- **Cloud mode** needs a connection to load and save data. An **Offline** badge shows when the connection drops.
- After a dropped connection, live updates reload everything once.
- Changes by other users appear live (cloud mode). Changes in another tab on the same device also appear (device mode).

## Online use

The website requires an internet connection and a configured Supabase project; it does not create device-only accounts or
save business records locally. All authorized staff share the same database from any internet-connected device. Configure
Supabase email confirmation and SMS verification before accepting sign-ups. A visible offline notice blocks app use when
the browser loses its network connection.

Cloud accounts require a confirmed email and a confirmed mobile number before business data is accessible. For a forgotten
password, choose either the email reset link or the SMS code. The password reset methods are alternatives, not cumulative
requirements.

## Import, export and backup

- **Export menu** on every list (what the list shows: same search, filters and order; or only the ticked records) and on every report table:
  - **Excel (.xlsx)** — real numbers, money and dates (sort, filter and add up straight away), long numbers such as account or consumer numbers kept exactly, bold frozen header with filters, a totals row for money columns;
  - **PDF** — A4 landscape with company name, title, filters, date and page numbers; ₹ and Hindi names print correctly;
  - **CSV** — plain text; phone numbers as “98765 43210”, dates as YYYY-MM-DD, date-times as YYYY-MM-DD HH:MM, formulas made harmless, readable by Excel (₹ and Hindi included). An exported CSV imports back (Yes/No, amounts with commas or ₹, and date-times are understood).

- **Demo data (testing only):** Settings → *Demo data* loads a fictional Patna solar company (about 785 records: 48 customers in 24 states, leads, quotations, invoices, payments, projects, stock, service, subsidy, loans, staff, plus 6 demo team members). Admin only, device mode only, never in cloud mode. Dates are moved to the day it is loaded. A **Demo data** badge shows in the top bar while it is loaded, and **Remove demo data** puts back what was on the device before.
- **CSV import** into any list you can edit:
  - Column headers can be the field label or key.
  - Linked records are matched by name or number, and users by name or email.
  - Dates can be DD/MM/YYYY.
  - Rows with errors or duplicates are skipped and listed afterwards.
- **Report CSVs** for GST, HSN, ageing, product sales and stock valuation.
- **Backup** (admin): Settings → Download backup gives a JSON file of all records and the document counters (and, in device mode, the attached files and the staff list: names, emails, mobiles, roles, access rights — no passwords).
- **Safety copies** (device mode): made daily, before an app update and before a restore or demo data; Settings → Backup & data lists the newest 14 with **Restore**. See `docs/UPGRADING.md`.
- **App updates never delete data:** older data is upgraded once after a safety copy; data from a newer version opens read-only; a damaged list is never overwritten.
- **Restore** (admin):
  - Each file is checked before anything changes.
  - Device mode replaces all data but keeps the users on the device; staff from the backup who are missing are added (the admin sets their passwords), and records keep pointing at the right person. Numbering never goes back. If the restore fails, the old data is put back.
  - Cloud mode adds or overwrites the records in the file and keeps everything else. Original numbers and dates are kept.

## Security and privacy

- HTTPS only. The App refuses to start on plain http.
- Cloud mode:
  - row-level security on every table, roles enforced in the database;
  - private file storage;
  - security headers (CSP, HSTS, no framing);
  - email confirmation;
  - each business completely separate from every other, checked by the database;
  - the subscription checked by the database on every change (a modified app or "mod APK" cannot unlock anything);
  - payments verified on the server (Razorpay signature with a secret key, payment confirmed with Razorpay, each payment counted once).
- Android and iPhone apps: the same Content-Security-Policy, built into the app (only the App's own code runs; network only to your Supabase project). No prices or payment links inside the store apps.
- Camera and location are used only when you take a site photo, and only after you allow them. Photos stay in your business's storage.
- Device mode: passwords stored as PBKDF2 hashes; nothing sent to any server.
- No ads, no analytics, no tracking. The India map uses data bundled with the App.
- **Delete my account** in Settings. Admins can delete users.
- Policy pages: `privacy.html`, `terms.html`, `pricing.html`, `delete-account.html`, `grievance.html`, linked from the sign-in screen.
- Details: `docs/publishing/SECURITY.md` and `docs/publishing/PRIVACY_POLICY.md`.
