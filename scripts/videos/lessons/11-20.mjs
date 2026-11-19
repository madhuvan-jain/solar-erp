// Lessons 11–21.
import { fileURLToPath } from 'node:url';
import { BASE, quiet, signUp } from '../engine.mjs';

const tile = (h, name) => h.page.locator('main a', { hasText: new RegExp('^' + name) }).first();
const btn = (h, name, exact = true) => h.page.getByRole('button', { name, exact }).first();
const link = (h, name, exact = true) => h.page.getByRole('link', { name, exact }).first();
const tab = (h, name) => h.page.getByRole('tab', { name, exact: true });
const save = async (h, entity) => { await h.click(btn(h, 'Save')); if (entity) await h.page.waitForURL(new RegExp(`#/m/${entity}/[0-9a-f-]{36}$`), { timeout: 15000 }); await h.wait(600); };
const list = async (h, entity, query = '') => { await h.go(`/m/${entity}${query}`, `[data-list="${entity}"]`); await h.page.locator('tbody tr.clickable, .board, .files-card, .empty, .cal, .india-map').first().waitFor({ timeout: 15000 }).catch(() => {}); };
const row = (h, text) => h.page.locator('tbody tr.clickable', { hasText: text }).first();
const dialog = (h, name) => h.page.getByRole('dialog', name ? { name } : {}).first();
const newBtn = (h, label) => h.page.getByRole('link', { name: label, exact: true }).or(h.page.getByRole('button', { name: label, exact: true })).first();
const addLine = async (h, i, product, qty) => {
  await h.click(btn(h, '+ Add line'));
  await h.selectText(h.page.locator(`.items-table [aria-label="Product for line ${i}"]`).first(), product);
  if (qty) await h.type(h.page.getByLabel(`Quantity line ${i}`).first(), String(qty));
};
const ASSET = (f) => fileURLToPath(new URL(`../assets/${f}`, import.meta.url));

export const L11 = [
  {
    id: '11',
    title: { en: 'Products and stock', hi: 'प्रोडक्ट और स्टॉक' },
    about: {
      en: 'Your product list with GST and HSN from the category, stock per warehouse with average cost and value, opening stock and stock counts, moving stock between warehouses, and low-stock alerts.',
      hi: 'कैटेगरी से GST और HSN के साथ प्रोडक्ट लिस्ट, औसत लागत और मूल्य के साथ हर गोदाम का स्टॉक, शुरुआती स्टॉक और गिनती, गोदामों के बीच स्टॉक भेजना, और कम स्टॉक के अलर्ट।',
    },
    tags: ['solar inventory', 'stock management', 'HSN code solar panel'],
    intro: { en: 'Part eleven. Products and stock.', hi: 'भाग ग्यारह। प्रोडक्ट और स्टॉक।' },
    scenes: [
      {
        ch: { en: 'The product list', hi: 'प्रोडक्ट लिस्ट' },
        en: 'Open Inventory, then Products. This is everything you sell or buy: panels, inverters, batteries, structures, cables, and services like installation. The list shows the price and what is in stock.',
        hi: 'Inventory खोलें, फिर Products। यह वो सब है जो आप बेचते या ख़रीदते हैं: पैनल, इन्वर्टर, बैटरी, स्ट्रक्चर, केबल, और इंस्टॉलेशन जैसी सर्विस। लिस्ट में कीमत और स्टॉक दिखता है।',
        act: async (h) => { await list(h, 'products'); await h.wait(1500); },
      },
      {
        ch: { en: 'Add a product', hi: 'प्रोडक्ट जोड़ें' },
        en: 'Tap New Product. Give it a name and a unique SKU code. Choose the category first: for a solar panel, GST becomes five percent and the HSN 8541 by itself. Batteries, structures, cables and services get eighteen percent.',
        hi: 'New Product दबाएं। नाम और एक अलग SKU कोड दें। पहले कैटेगरी चुनें: सोलर पैनल के लिए GST अपने आप पाँच प्रतिशत और HSN 8541 हो जाता है। बैटरी, स्ट्रक्चर, केबल और सर्विस पर अठारह प्रतिशत।',
        act: async (h) => {
          await h.click(newBtn(h, '+ New Product'));
          await h.type('#f-name', 'Solar Panel 590 Wp TOPCon');
          await h.type('#f-sku', 'SP-590');
          await h.select('#f-category', 'Solar Panel');
          await h.show('#f-gstRate', 900);
          await h.show('#f-hsn', 900);
        },
      },
      {
        en: 'Add the brand and specification, the sale price and the purchase cost before GST, and the level at which you want a low-stock alert. Save.',
        hi: 'ब्रांड और स्पेसिफ़िकेशन, GST से पहले बिक्री कीमत और ख़रीद लागत, और किस स्तर पर कम स्टॉक का अलर्ट चाहिए, डालें। Save करें।',
        act: async (h) => {
          await h.type('#f-brand', 'SunVolt');
          await h.type('#f-specs', '590 Wp N-type TOPCon bifacial', { delay: 30 });
          await h.type('#f-price', '16500');
          await h.type('#f-cost', '13800');
          await h.type('#f-reorderLevel', '20');
          await save(h, 'products');
        },
      },
      {
        ch: { en: 'Opening stock and counts', hi: 'शुरुआती स्टॉक और गिनती' },
        en: 'The stock card shows stock in each warehouse, what is on order, the average cost and the stock value. To enter opening stock or a stock count, tap Count or adjust, choose where you counted, type the quantity and the reason.',
        hi: 'स्टॉक कार्ड में हर गोदाम का स्टॉक, ऑर्डर पर आने वाला सामान, औसत लागत और स्टॉक का मूल्य दिखता है। शुरुआती स्टॉक या गिनती के लिए Count / adjust दबाएं, जगह चुनें, मात्रा और कारण लिखें।',
        act: async (h) => {
          await h.click(btn(h, 'Count / adjust'));
          const d = dialog(h);
          await h.selectText(d.getByLabel('Where you counted'), 'Main Warehouse');
          await h.type(d.getByLabel('Counted quantity'), '40');
          await h.select(d.getByLabel('Reason'), 'Opening stock');
          await h.click(d.getByRole('button', { name: 'Save count' }));
          await h.wait(1200);
        },
      },
      {
        ch: { en: 'Move between warehouses', hi: 'गोदामों के बीच भेजना' },
        en: 'To send stock to another store, tap Move between warehouses, choose from and to, and the quantity. It can never move more than is there.',
        hi: 'दूसरे स्टोर में स्टॉक भेजने के लिए Move between warehouses दबाएं, कहाँ से और कहाँ तक, और मात्रा चुनें। जितना है उससे ज़्यादा कभी नहीं जा सकता।',
        act: async (h) => {
          await h.click(btn(h, 'Move between warehouses'));
          const d = dialog(h);
          await h.selectText(d.getByLabel('To'), 'Site Store');
          await h.type(d.getByLabel('Quantity'), '10');
          await h.click(d.getByRole('button', { name: 'Move stock' }));
          await h.wait(1500);
        },
      },
      {
        en: 'Every change is a stock entry with its reason: purchase receipts, deliveries to site, returns, transfers and counts. When stock falls to the alert level, it shows in alerts.',
        hi: 'हर बदलाव कारण के साथ एक स्टॉक एंट्री है: ख़रीद, साइट पर डिलीवरी, वापसी, ट्रांसफ़र और गिनती। जब स्टॉक अलर्ट स्तर तक गिरता है, तो अलर्ट में दिखता है।',
        act: async (h) => { await list(h, 'stockMoves'); await h.wait(1800); },
      },
    ],
  },
  {
    id: '12',
    title: { en: 'Delivery challans: material to site', hi: 'डिलीवरी चालान: साइट पर सामान' },
    about: {
      en: 'Send material from your warehouse to a project site with a GST delivery challan, take it out of stock automatically, print the challan and bring back unused material with Return from site.',
      hi: 'GST डिलीवरी चालान के साथ गोदाम से प्रोजेक्ट साइट पर सामान भेजें, स्टॉक से अपने आप घटाएं, चालान प्रिंट करें और Return from site से बचा सामान वापस लें।',
    },
    tags: ['delivery challan', 'material dispatch'],
    intro: { en: 'Part twelve. Delivery challans.', hi: 'भाग बारह। डिलीवरी चालान।' },
    scenes: [
      {
        ch: { en: 'Send material', hi: 'सामान भेजें' },
        en: 'Open the project and tap Send material. A delivery challan opens with the project and customer filled in.',
        hi: 'प्रोजेक्ट खोलें और Send material दबाएं। प्रोजेक्ट और कस्टमर भरे हुए डिलीवरी चालान खुलता है।',
        act: async (h) => { await list(h, 'projects'); await h.click(row(h, 'Patel Residence')); await h.click(link(h, 'Send material')); await h.page.locator('form[data-form="dispatches"]').waitFor(); },
      },
      {
        en: 'Choose the warehouse it leaves from, the vehicle number and the transporter. Add the material: each line shows how much is in stock in that warehouse.',
        hi: 'किस गोदाम से जा रहा है, गाड़ी नंबर और ट्रांसपोर्टर चुनें। सामान जोड़ें: हर लाइन पर दिखता है कि उस गोदाम में कितना स्टॉक है।',
        act: async (h) => {
          await h.selectText('#f-warehouseId', 'Main Warehouse');
          await h.type('#f-vehicleNo', 'BR01 GK 4521');
          await addLine(h, 1, 'Solar Panel 545', 15);
          await addLine(h, 2, 'On-grid Inverter 10 kW', 1);
          await h.wait(800);
        },
      },
      {
        en: 'Set the status to Dispatched when the vehicle leaves and save. The material goes out of stock once, from that warehouse. If anything is short, the app tells you before saving.',
        hi: 'गाड़ी निकलते समय स्टेटस Dispatched करें और Save करें। सामान उसी गोदाम के स्टॉक से एक बार घटता है। कुछ कम हो तो Save से पहले ऐप बता देता है।',
        act: async (h) => { await h.select('#f-status', 'Dispatched'); await save(h, 'dispatches'); await h.wait(800); },
      },
      {
        ch: { en: 'Print the challan', hi: 'चालान प्रिंट करें' },
        en: 'Print the delivery challan to send with the vehicle. It has the consignee, vehicle, HSN, values and tax, in three copies.',
        hi: 'गाड़ी के साथ भेजने के लिए डिलीवरी चालान प्रिंट करें। इसमें माल पाने वाला, गाड़ी, HSN, मूल्य और टैक्स होते हैं, तीन कॉपी में।',
        act: async (h) => { await h.click(link(h, 'Print / PDF')); await h.page.locator('.doc').waitFor(); await h.wait(1800); await h.click(link(h, '← Back')); },
      },
      {
        ch: { en: 'Return from site', hi: 'साइट से वापसी' },
        en: 'Material left over after installation? Under Material at site, tap Return from site, type what came back and put it back into stock.',
        hi: 'इंस्टॉलेशन के बाद सामान बच गया? Material at site में Return from site दबाएं, जो वापस आया वो लिखें और स्टॉक में वापस डालें।',
        act: async (h) => {
          await h.scrollTo(h.page.getByRole('heading', { name: 'Material at site' }));
          await h.click(btn(h, 'Return from site'));
          const d = dialog(h);
          await h.type(d.getByLabel(/^Quantity of Solar Panel/), '1');
          await h.click(d.getByRole('button', { name: 'Put back into stock' }));
          await h.wait(1500);
        },
      },
    ],
  },
  {
    id: '13',
    title: { en: 'Purchase: vendors, orders and supplier payments', hi: 'ख़रीद: वेंडर, ऑर्डर और सप्लायर पेमेंट' },
    about: {
      en: 'Add a vendor (the state comes from the GSTIN), make a purchase order at purchase cost with GST, receive goods in part deliveries into stock, and record dated payments to the supplier.',
      hi: 'वेंडर जोड़ें (राज्य GSTIN से आता है), GST के साथ ख़रीद लागत पर परचेज़ ऑर्डर बनाएं, आंशिक डिलीवरी में सामान स्टॉक में लें, और सप्लायर को तारीख़ के साथ पेमेंट दर्ज करें।',
    },
    tags: ['purchase order', 'vendor payment'],
    intro: { en: 'Part thirteen. Buying material.', hi: 'भाग तेरह। सामान की ख़रीद।' },
    scenes: [
      {
        ch: { en: 'Add a vendor', hi: 'वेंडर जोड़ें' },
        en: 'Open Purchase, then Vendors, and add your supplier. Type the GSTIN and the state is filled from it, which decides CGST and SGST or IGST on your orders.',
        hi: 'Purchase खोलें, फिर Vendors, और अपने सप्लायर को जोड़ें। GSTIN लिखें तो राज्य उसी से भर जाता है, जिससे आपके ऑर्डर पर CGST और SGST या IGST तय होता है।',
        act: async (h) => {
          await list(h, 'vendors');
          await h.click(newBtn(h, '+ New Vendor'));
          await h.type('#f-name', 'Ganga Solar Traders');
          await h.type('#f-phone', '9431055501');
          await h.type('#f-gstin', '10ABCDE1234F1Z5');
          await save(h, 'vendors');
        },
      },
      {
        ch: { en: 'Purchase order', hi: 'परचेज़ ऑर्डर' },
        en: 'Now a purchase order. Choose the vendor and add the products. Lines use your purchase cost, never your sale price. Set it to Ordered, save and send it.',
        hi: 'अब परचेज़ ऑर्डर। वेंडर चुनें और प्रोडक्ट जोड़ें। लाइनें आपकी ख़रीद लागत लेती हैं, बिक्री कीमत कभी नहीं। Ordered करें, Save करें और भेजें।',
        act: async (h) => {
          await list(h, 'purchaseOrders');
          await h.click(newBtn(h, '+ New Purchase Order'));
          await h.selectText('#f-vendorId', 'Ganga Solar Traders');
          await addLine(h, 1, 'Solar Panel 545', 30);
          await h.select('#f-status', 'Ordered');
          await save(h, 'purchaseOrders');
        },
      },
      {
        ch: { en: 'Receive goods', hi: 'सामान प्राप्त करें' },
        en: 'When the truck arrives, tap Receive goods and type what actually came. Part deliveries are fine: the order shows Partially Received and what is still due.',
        hi: 'ट्रक आने पर Receive goods दबाएं और जो सच में आया वो लिखें। आंशिक डिलीवरी ठीक है: ऑर्डर Partially Received और बाकी बचा सामान दिखाता है।',
        act: async (h) => {
          await h.click(btn(h, 'Receive goods'));
          const d = dialog(h);
          await h.type(d.getByLabel(/^Quantity of Solar Panel/), '20');
          await h.click(d.getByRole('button', { name: 'Add to stock' }));
          await h.wait(1800);
        },
      },
      {
        ch: { en: 'Pay the supplier', hi: 'सप्लायर को पेमेंट' },
        en: 'To pay the vendor, tap Record supplier payment. The amount still to pay is filled in; change it for a part payment, choose the mode and the UTR, and save. The order shows paid and still to pay.',
        hi: 'वेंडर को पेमेंट के लिए Record supplier payment दबाएं। बाकी राशि भरी होती है; आंशिक पेमेंट के लिए बदलें, तरीका और UTR चुनें, और Save करें। ऑर्डर पर दिया हुआ और बाकी दिखता है।',
        act: async (h) => {
          await h.click(link(h, 'Record supplier payment'));
          await h.page.locator('form[data-form="supplierPayments"]').waitFor();
          await h.type('#f-amount', '200000');
          await h.select('#f-mode', 'Bank Transfer');
          await h.type('#f-reference', 'UTR 7788 1203 4521');
          await save(h, 'supplierPayments');
          await h.click(h.page.locator('.dl a').first());
          await h.wait(1500);
        },
      },
    ],
  },
  {
    id: '14',
    title: { en: 'Installation: checklist, photos and certificate', hi: 'इंस्टॉलेशन: चेकलिस्ट, फ़ोटो और सर्टिफ़िकेट' },
    about: {
      en: 'Schedule the installation with the technician, tick the checklist at site, save the site location from GPS, take stamped photos, get the customer\'s confirmation and print the commissioning certificate.',
      hi: 'टेक्नीशियन के साथ इंस्टॉलेशन तय करें, साइट पर चेकलिस्ट टिक करें, GPS से साइट लोकेशन सेव करें, मुहर वाली फ़ोटो लें, कस्टमर की पुष्टि लें और कमीशनिंग सर्टिफ़िकेट प्रिंट करें।',
    },
    tags: ['solar installation checklist', 'commissioning certificate'],
    intro: { en: 'Part fourteen. Installation.', hi: 'भाग चौदह। इंस्टॉलेशन।' },
    scenes: [
      {
        ch: { en: 'Schedule the installation', hi: 'इंस्टॉलेशन तय करें' },
        en: 'On the project, tap Schedule installation. Choose the date and the lead technician, and the team members going to site.',
        hi: 'प्रोजेक्ट पर Schedule installation दबाएं। तारीख़, मुख्य टेक्नीशियन और साइट जाने वाली टीम चुनें।',
        act: async (h) => {
          await list(h, 'projects'); await h.click(row(h, 'Patel Residence')); await h.click(link(h, 'Schedule installation'));
          await h.page.locator('form[data-form="installations"]').waitFor();
          await h.selectText('#f-technician', 'Imran');
          await h.type('#f-team', 'Ravi Paswan, Manoj Thakur', { delay: 35 });
        },
      },
      {
        ch: { en: 'At the site', hi: 'साइट पर' },
        en: 'At the site, tick each step as it is done: structure, panels, inverter, cabling, earthing, testing, and briefing the customer. Tap Use my location to save the exact site position.',
        hi: 'साइट पर हर काम पूरा होते ही टिक करें: स्ट्रक्चर, पैनल, इन्वर्टर, केबलिंग, अर्थिंग, टेस्टिंग, और कस्टमर को समझाना। सही साइट लोकेशन के लिए Use my location दबाएं।',
        act: async (h) => {
          for (const c of ['Structure mounted', 'Panels fixed', 'Inverter installed', 'DC & AC cabling', 'Earthing & lightning arrester', 'System tested', 'Customer briefed']) await h.click(h.page.getByLabel(c), { after: 250 });
          await h.click(btn(h, '📍 Use my location', false));
        },
      },
      {
        en: 'When the customer is happy, tick Customer confirmed completion, give their rating, set the status to Completed and save.',
        hi: 'कस्टमर संतुष्ट हो तो Customer confirmed completion टिक करें, उनकी रेटिंग दें, स्टेटस Completed करें और Save करें।',
        act: async (h) => {
          await h.select('#f-status', 'Completed');
          await h.click(h.page.getByLabel('Customer confirmed completion'));
          await save(h, 'installations');
        },
      },
      {
        ch: { en: 'Photos and certificate', hi: 'फ़ोटो और सर्टिफ़िकेट' },
        en: 'Take the completion photos with Site photo: each is stamped with the place and time and filed on the installation, customer and project.',
        hi: 'Site photo से पूरा होने की फ़ोटो लें: हर फ़ोटो पर जगह और समय छपता है और वो इंस्टॉलेशन, कस्टमर और प्रोजेक्ट पर सेव होती है।',
        act: async (h) => {
          await h.click(btn(h, '📷 Site photo'));
          const cam = h.page.getByRole('dialog', { name: 'SuryaSetu Camera' });
          await cam.getByText(/Bihar, India/).first().waitFor({ timeout: 20000 });
          await h.wait(800);
          await h.click(cam.getByRole('button', { name: 'Take photo', exact: true }));
          await h.click(cam.getByRole('button', { name: 'Use photo' }));
          await h.page.getByText(/Photo saved with its location/).first().waitFor({ timeout: 15000 });
        },
      },
      {
        en: 'Print gives the Installation and Commissioning Certificate for the customer to sign, with the checklist and the system details.',
        hi: 'Print से कस्टमर के साइन के लिए इंस्टॉलेशन और कमीशनिंग सर्टिफ़िकेट मिलता है, चेकलिस्ट और सिस्टम की जानकारी के साथ।',
        act: async (h) => { await h.click(link(h, 'Print / PDF')); await h.page.locator('.doc').waitFor(); await h.wait(1500); await h.page.mouse.wheel(0, 500); await h.wait(1200); },
      },
    ],
  },
  {
    id: '15',
    title: { en: 'PM Surya Ghar subsidy and solar loans', hi: 'PM सूर्य घर सब्सिडी और सोलर लोन' },
    about: {
      en: 'Track PM Surya Ghar applications: the subsidy amount worked out from the kW (₹30,000 per kW up to 2 kW, ₹18,000 for the 3rd, at most ₹78,000), the document checklist and status; and solar loans with EMI.',
      hi: 'PM सूर्य घर आवेदन ट्रैक करें: kW से सब्सिडी अपने आप (2 kW तक ₹30,000 प्रति kW, तीसरे kW के ₹18,000, अधिकतम ₹78,000), डॉक्यूमेंट चेकलिस्ट और स्टेटस; और EMI के साथ सोलर लोन।',
    },
    tags: ['PM Surya Ghar', 'solar subsidy', 'rooftop solar subsidy', 'solar loan EMI', 'सोलर सब्सिडी'],
    intro: { en: 'Part fifteen. PM Surya Ghar subsidy and solar loans.', hi: 'भाग पंद्रह। PM सूर्य घर सब्सिडी और सोलर लोन।' },
    scenes: [
      {
        ch: { en: 'A subsidy application', hi: 'सब्सिडी आवेदन' },
        en: 'Open Subsidy and add an application. Choose the customer. The scheme is PM Surya Ghar. Type the application number from the national portal.',
        hi: 'Subsidy खोलें और नया आवेदन जोड़ें। कस्टमर चुनें। योजना PM सूर्य घर है। राष्ट्रीय पोर्टल का आवेदन नंबर लिखें।',
        act: async (h) => {
          await list(h, 'subsidies');
          await h.click(newBtn(h, '+ New Subsidy Application'));
          await h.selectText('#f-customerId', 'Hardik Patel');
          await h.type('#f-applicationNo', 'PMSG-GJ-2026-118842', { delay: 30 });
        },
      },
      {
        en: 'Leave capacity and amount empty: the capacity comes from the customer\'s project, and the subsidy from the scheme. Thirty thousand rupees per kilowatt up to two, eighteen thousand for the third, at most seventy-eight thousand. North-East, hill states and islands get ten percent more.',
        hi: 'क्षमता और राशि खाली छोड़ें: क्षमता कस्टमर के प्रोजेक्ट से और सब्सिडी योजना से आती है। दो किलोवाट तक तीस हज़ार रुपये प्रति किलोवाट, तीसरे के अठारह हज़ार, अधिकतम अठहत्तर हज़ार। पूर्वोत्तर, पहाड़ी राज्यों और द्वीपों में दस प्रतिशत ज़्यादा।',
        act: async (h) => { await h.show('#f-capacityKw', 900); await h.show('#f-amount', 1400); },
      },
      {
        en: 'Tick the documents as you submit them: Aadhaar, electricity bill, bank passbook, site photo, net meter agreement and commissioning report. Save.',
        hi: 'जमा करते ही डॉक्यूमेंट पर टिक करें: आधार, बिजली बिल, बैंक पासबुक, साइट फ़ोटो, नेट मीटर एग्रीमेंट और कमीशनिंग रिपोर्ट। Save करें।',
        act: async (h) => {
          for (const c of ['Aadhaar', 'Electricity bill', 'Bank passbook / cheque']) await h.click(h.page.getByLabel(c), { after: 300 });
          await save(h, 'subsidies');
          await h.show(h.page.locator('.dl > div', { has: h.page.locator('dt', { hasText: /^Subsidy amount$/ }) }), 1600);
        },
      },
      {
        en: 'Update the status as the portal moves: documents verified, under review, approved, disbursed. Applications pending for more than forty-five days show in alerts. The subsidy goes to the customer\'s bank account.',
        hi: 'पोर्टल पर आगे बढ़ने पर स्टेटस बदलें: डॉक्यूमेंट वेरिफ़ाइड, समीक्षा में, मंज़ूर, भुगतान हुआ। पैंतालीस दिन से ज़्यादा रुके आवेदन अलर्ट में दिखते हैं। सब्सिडी कस्टमर के बैंक खाते में जाती है।',
        act: async (h) => { await list(h, 'subsidies', '?view=board'); await h.wait(1800); },
      },
      {
        ch: { en: 'Solar loans', hi: 'सोलर लोन' },
        en: 'For customers buying on a loan, open Solar Loans and add one: the bank, amount, interest rate and tenure. The monthly EMI is worked out for you, and you track the status to disbursement.',
        hi: 'लोन पर ख़रीदने वाले कस्टमर के लिए Solar Loans खोलें और लोन जोड़ें: बैंक, राशि, ब्याज दर और अवधि। महीने की EMI अपने आप निकलती है, और आप भुगतान तक स्टेटस ट्रैक करते हैं।',
        act: async (h) => {
          await list(h, 'loans');
          await h.click(newBtn(h, '+ New Loan'));
          await h.selectText('#f-customerId', 'Hardik Patel');
          await h.type('#f-bank', 'State Bank of India');
          await h.type('#f-amount', '250000');
          await h.type('#f-ratePct', '7');
          await h.type('#f-tenureMonths', '60');
          await save(h, 'loans');
          await h.show(h.page.locator('.dl > div', { has: h.page.locator('dt', { hasText: /^Monthly EMI$/ }) }), 1500);
        },
      },
    ],
  },
  {
    id: '16',
    title: { en: 'Service tickets and AMC contracts', hi: 'सर्विस टिकट और AMC कॉन्ट्रैक्ट' },
    about: {
      en: 'Log complaints and breakdowns as tickets with priority and a technician, message the customer, resolve and close them; manage AMC contracts with visits and renewal alerts.',
      hi: 'शिकायत और ख़राबी को प्राथमिकता और टेक्नीशियन के साथ टिकट में दर्ज करें, कस्टमर को मैसेज करें, हल करके बंद करें; विज़िट और नवीनीकरण अलर्ट के साथ AMC कॉन्ट्रैक्ट संभालें।',
    },
    tags: ['solar service', 'AMC', 'complaint management'],
    intro: { en: 'Part sixteen. Service and AMC.', hi: 'भाग सोलह। सर्विस और AMC।' },
    scenes: [
      {
        ch: { en: 'A service ticket', hi: 'सर्विस टिकट' },
        en: 'When a customer calls with a problem, open Service and add a ticket: the issue, the customer, the type such as breakdown or cleaning, the priority, the technician and the date to resolve by.',
        hi: 'जब कस्टमर किसी समस्या के लिए कॉल करे, Service खोलें और टिकट जोड़ें: समस्या, कस्टमर, प्रकार जैसे ख़राबी या सफ़ाई, प्राथमिकता, टेक्नीशियन और हल करने की तारीख़।',
        act: async (h) => {
          await list(h, 'tickets');
          await h.click(newBtn(h, '+ New Ticket'));
          await h.type('#f-subject', 'Inverter shows grid fault in the morning', { delay: 30 });
          await h.selectText('#f-customerId', 'Hardik Patel');
          await h.select('#f-type', 'Breakdown');
          await h.select('#f-priority', 'High');
          await h.selectText('#f-assignedTo', 'Sunil');
          await save(h, 'tickets');
        },
      },
      {
        en: 'WhatsApp tells the customer their request is registered, with the ticket number. Urgent and overdue tickets show in alerts.',
        hi: 'WhatsApp से कस्टमर को बताएं कि उनकी शिकायत दर्ज हो गई है, टिकट नंबर के साथ। ज़रूरी और देरी वाले टिकट अलर्ट में दिखते हैं।',
        act: async (h) => { await h.click(btn(h, 'WhatsApp')); await h.wait(2200); await h.click(dialog(h).getByRole('button', { name: 'Cancel' })); },
      },
      {
        en: 'When it is fixed, edit the ticket, write what was done and set it to Resolved, then Closed.',
        hi: 'ठीक होने पर टिकट Edit करें, क्या किया लिखें और Resolved, फिर Closed करें।',
        act: async (h) => {
          await h.click(link(h, 'Edit'));
          await h.page.locator('form[data-form="tickets"]').waitFor();
          await h.select('#f-status', 'Resolved');
          await h.type('#f-resolution', 'Loose AC connector at the ACDB tightened; inverter tested OK.', { delay: 25 });
          await save(h, 'tickets');
        },
      },
      {
        ch: { en: 'AMC contracts', hi: 'AMC कॉन्ट्रैक्ट' },
        en: 'Annual maintenance contracts are under AMC: the customer, start and end dates, visits per year and the contract value. Thirty days before the end, a renewal alert reminds you, and WhatsApp has a renewal message ready.',
        hi: 'सालाना रखरखाव कॉन्ट्रैक्ट AMC में हैं: कस्टमर, शुरू और ख़त्म होने की तारीख़, साल में विज़िट और कॉन्ट्रैक्ट मूल्य। ख़त्म होने से तीस दिन पहले नवीनीकरण का अलर्ट आता है, और WhatsApp पर नवीनीकरण का मैसेज तैयार रहता है।',
        act: async (h) => {
          await list(h, 'amcs');
          await h.click(newBtn(h, '+ New AMC Contract'));
          await h.selectText('#f-customerId', 'Hardik Patel');
          await h.fill('#f-startDate', '2026-12-01');
          await h.fill('#f-endDate', '2027-11-30');
          await h.type('#f-amount', '6000');
          await save(h, 'amcs');
        },
      },
    ],
  },
  {
    id: '17',
    title: { en: 'Expenses, documents and your team', hi: 'ख़र्चे, डॉक्यूमेंट और आपकी टीम' },
    about: {
      en: 'Record expenses with a photo of the bill, keep KYC, agreements and warranties in Documents with expiry alerts, and manage employees and daily attendance.',
      hi: 'बिल की फ़ोटो के साथ ख़र्चे दर्ज करें, KYC, एग्रीमेंट और वारंटी Documents में समाप्ति अलर्ट के साथ रखें, और कर्मचारी और रोज़ की हाज़िरी संभालें।',
    },
    tags: ['expense tracking', 'document management', 'attendance'],
    intro: { en: 'Part seventeen. Expenses, documents and team.', hi: 'भाग सत्रह। ख़र्चे, डॉक्यूमेंट और टीम।' },
    scenes: [
      {
        ch: { en: 'Expenses', hi: 'ख़र्चे' },
        en: 'Every rupee spent goes into Accounts, Expenses: what it was for, the category like transport or labour, the amount, the project it belongs to and a photo of the bill.',
        hi: 'हर ख़र्च हुआ रुपया Accounts, Expenses में जाता है: किस लिए, ट्रांसपोर्ट या मज़दूरी जैसी कैटेगरी, राशि, किस प्रोजेक्ट का है और बिल की फ़ोटो।',
        act: async (h) => {
          await list(h, 'expenses');
          await h.click(newBtn(h, '+ New Expense'));
          await h.type('#f-description', 'Truck hire to Patel Residence site', { delay: 30 });
          await h.select('#f-category', 'Transport');
          await h.type('#f-amount', '2500');
          await save(h, 'expenses');
        },
      },
      {
        ch: { en: 'Documents', hi: 'डॉक्यूमेंट' },
        en: 'Documents keeps KYC copies, agreements, warranty cards and site photos. Drop several files at once, or choose them, then give them a category, the customer and a valid-until date.',
        hi: 'Documents में KYC कॉपी, एग्रीमेंट, वारंटी कार्ड और साइट फ़ोटो रहते हैं। कई फ़ाइलें एक साथ डालें या चुनें, फिर उन्हें कैटेगरी, कस्टमर और कब तक मान्य है, दें।',
        act: async (h) => {
          await list(h, 'documents');
          await h.pointAt(h.page.getByText('choose files').first());
          await h.page.locator('input[type=file][multiple]').first().setInputFiles(ASSET('warranty-card.pdf'));
          const d = dialog(h, /Add 1 document/);
          await d.waitFor();
          await h.wait(1200);
          await h.click(d.getByRole('button', { name: 'Add document' }));
          await h.page.getByText(/Added 1 document/).first().waitFor();
          await h.wait(800);
        },
      },
      {
        en: 'Category chips filter them, and tapping a card previews photos and PDFs. You get an alert thirty days before a warranty or agreement expires.',
        hi: 'कैटेगरी चिप से छाँटें, और कार्ड पर टैप करके फ़ोटो और PDF देखें। वारंटी या एग्रीमेंट ख़त्म होने से तीस दिन पहले अलर्ट मिलता है।',
        act: async (h) => { await h.show(h.page.locator('.files-card').first(), 1600); },
      },
      {
        ch: { en: 'Employees and attendance', hi: 'कर्मचारी और हाज़िरी' },
        en: 'Under Team, add your employees with their department, and mark attendance each day: present, absent, half day, leave or late, with check-in and check-out times.',
        hi: 'Team में अपने कर्मचारी उनके विभाग के साथ जोड़ें, और रोज़ हाज़िरी लगाएं: उपस्थित, अनुपस्थित, आधा दिन, छुट्टी या देर से, आने और जाने के समय के साथ।',
        act: async (h) => {
          await list(h, 'employees');
          await h.wait(1000);
          await list(h, 'attendance');
          await h.click(newBtn(h, '+ New Attendance'));
          await h.selectText('#f-employeeId', 'Sunil');
          await h.fill('#f-checkIn', '09:30');
          await h.fill('#f-checkOut', '18:15');
          await save(h, 'attendance');
        },
      },
    ],
  },
  {
    id: '18',
    title: { en: 'Lists like a pro: search, filters, views, export', hi: 'लिस्ट का पूरा इस्तेमाल: सर्च, फ़िल्टर, व्यू, एक्सपोर्ट' },
    about: {
      en: 'Every list works the same way: search, ready-made and custom filters, group by and favorites, board, calendar, pivot, graph and map views, selecting many records, and export to Excel, PDF or CSV and import.',
      hi: 'हर लिस्ट एक जैसी चलती है: सर्च, तैयार और अपने फ़िल्टर, ग्रुप और फ़ेवरेट, बोर्ड, कैलेंडर, पिवट, ग्राफ़ और मैप व्यू, कई रिकॉर्ड एक साथ चुनना, और Excel, PDF या CSV में एक्सपोर्ट और इम्पोर्ट।',
    },
    tags: ['export to Excel', 'filters'],
    intro: { en: 'Part eighteen. Getting more from every list.', hi: 'भाग अठारह। हर लिस्ट से ज़्यादा काम।' },
    scenes: [
      {
        ch: { en: 'Search and sort', hi: 'सर्च और क्रम' },
        en: 'Every list has a search box: type a name, phone number, city or document number. Tap a column heading to sort by it.',
        hi: 'हर लिस्ट में सर्च बॉक्स है: नाम, फ़ोन नंबर, शहर या डॉक्यूमेंट नंबर लिखें। किसी कॉलम के नाम पर टैप करके उसी से क्रम लगाएं।',
        act: async (h) => { await list(h, 'leads'); await h.type(h.page.getByLabel('Search', { exact: true }), 'Patna'); await h.wait(1200); await h.page.getByLabel('Search', { exact: true }).fill(''); await h.wait(600); },
      },
      {
        ch: { en: 'Filters and group by', hi: 'फ़िल्टर और ग्रुप' },
        en: 'The filter button has ready-made filters, like follow-up overdue or up to 3 kilowatts for PM Surya Ghar. You can add your own filter, group the list, and save it as a favorite.',
        hi: 'फ़िल्टर बटन में तैयार फ़िल्टर हैं, जैसे फॉलो-अप बाकी या PM सूर्य घर के लिए 3 किलोवाट तक। आप अपना फ़िल्टर जोड़ सकते हैं, लिस्ट को ग्रुप कर सकते हैं, और फ़ेवरेट में सेव कर सकते हैं।',
        act: async (h) => {
          await h.click(btn(h, 'Filters, group by and favorites'));
          const panel = dialog(h, 'Filters, group by and favorites');
          await h.click(panel.getByRole('button', { name: '＋ Add custom filter' }));
          const form = panel.getByRole('group', { name: 'Custom filter' });
          await h.select(form.getByLabel('Field'), { label: 'City' });
          await h.select(form.getByLabel('Condition'), { label: 'contains' });
          await h.type(form.getByLabel('Value'), 'patna');
          await h.click(form.getByRole('button', { name: 'Add filter' }));
          await h.page.keyboard.press('Escape');
          await h.wait(1200);
        },
      },
      {
        ch: { en: 'Views', hi: 'व्यू' },
        en: 'Change how you see the list: board by stage, calendar by date, pivot table, graph, or map. The same filters apply in every view.',
        hi: 'लिस्ट देखने का तरीका बदलें: स्टेज वाला बोर्ड, तारीख़ वाला कैलेंडर, पिवट टेबल, ग्राफ़ या मैप। हर व्यू में वही फ़िल्टर लागू रहते हैं।',
        act: async (h) => {
          for (const v of ['Board', 'Calendar', 'Pivot', 'Graph', 'Map']) {
            await h.click(h.page.locator('.view-switch').getByRole('button', { name: v }), { after: 1100 });
          }
          await h.click(h.page.locator('.view-switch').getByRole('button', { name: 'List' }));
        },
      },
      {
        ch: { en: 'Export and import', hi: 'एक्सपोर्ट और इम्पोर्ट' },
        en: 'Export saves the list as Excel, PDF or CSV. Import CSV brings in many records at once from Excel: it adds the good rows, skips duplicates and lists any errors.',
        hi: 'Export लिस्ट को Excel, PDF या CSV में सेव करता है। Import CSV से Excel की कई एंट्री एक साथ आ जाती हैं: सही लाइनें जुड़ती हैं, डुप्लिकेट छूट जाते हैं और गलतियों की लिस्ट मिलती है।',
        act: async (h) => { await h.click(btn(h, 'Export: choose a file type', false)); await h.wait(1500); await h.page.keyboard.press('Escape'); await h.show(btn(h, 'Import CSV'), 1200); },
      },
    ],
  },
  {
    id: '19',
    title: { en: 'Dashboard, reports and alerts', hi: 'डैशबोर्ड, रिपोर्ट और अलर्ट' },
    about: {
      en: 'Read the Dashboard for any period, build your own dashboard, use Reports for sales, collections, GST summaries, HSN, receivables ageing and stock value with export, and act on alerts.',
      hi: 'किसी भी अवधि का डैशबोर्ड देखें, अपना डैशबोर्ड बनाएं, बिक्री, वसूली, GST सारांश, HSN, बकाया और स्टॉक मूल्य के लिए रिपोर्ट एक्सपोर्ट के साथ देखें, और अलर्ट पर काम करें।',
    },
    tags: ['GST report', 'business dashboard', 'GSTR-1 summary'],
    intro: { en: 'Part nineteen. Dashboard, reports and alerts.', hi: 'भाग उन्नीस। डैशबोर्ड, रिपोर्ट और अलर्ट।' },
    scenes: [
      {
        ch: { en: 'Dashboard', hi: 'डैशबोर्ड' },
        en: 'On the Dashboard, choose the period: this month, last three months, this financial year or all time. The arrows compare with the same days of the period before. Tap a figure to open the records behind it.',
        hi: 'डैशबोर्ड पर अवधि चुनें: इस महीने, पिछले तीन महीने, इस वित्त वर्ष या शुरू से। तीर पिछली अवधि के उन्हीं दिनों से तुलना करते हैं। किसी आंकड़े पर टैप करके उसके रिकॉर्ड खोलें।',
        act: async (h) => { await h.go('/dashboard', '.kpi'); await h.click(btn(h, 'This month'), { after: 1000 }); await h.click(btn(h, 'This FY'), { after: 1000 }); await h.show(h.page.locator('.kpi').first(), 900); },
      },
      {
        en: 'Create my dashboard builds your own page with the charts and figures you care about, and Add item puts more on it.',
        hi: 'Create my dashboard से अपना पेज बनाएं, जिसमें वो चार्ट और आंकड़े हों जो आपके लिए ज़रूरी हैं, और Add item से और जोड़ें।',
        act: async (h) => { await h.show(btn(h, '+ Create my dashboard'), 1000); await h.show(btn(h, '+ Add item'), 1000); },
      },
      {
        ch: { en: 'Reports', hi: 'रिपोर्ट' },
        en: 'Reports takes a from and to date. You get invoiced, collected, expenses and paid to suppliers by month, the GST summary per invoice, GST on purchases, the HSN summary, receivables by age, product-wise sales, stock value and lead sources. Export any table for your CA.',
        hi: 'Reports में शुरू और अंत की तारीख़ दें। आपको महीने के हिसाब से बिल, वसूली, ख़र्च और सप्लायर को पेमेंट, हर बिल का GST सारांश, ख़रीद पर GST, HSN सारांश, बकाया की उम्र, प्रोडक्ट वार बिक्री, स्टॉक मूल्य और लीड के स्रोत मिलते हैं। CA के लिए कोई भी टेबल एक्सपोर्ट करें।',
        act: async (h) => {
          await h.go('/reports', '.kpi');
          await h.show('#r-from', 700);
          for (const t of ['GST summary', 'HSN', 'Receivables']) { const loc = h.page.getByText(new RegExp(t)).first(); if (await loc.count()) await h.scrollTo(loc); await h.wait(900); }
          await h.top();
        },
      },
      {
        ch: { en: 'Alerts', hi: 'अलर्ट' },
        en: 'Alerts lists everything that needs action, most urgent first. Each opens its record. In Settings, Alerts, each person chooses which alerts they want.',
        hi: 'Alerts में वो सब है जिस पर काम करना है, सबसे ज़रूरी पहले। हर अलर्ट अपना रिकॉर्ड खोलता है। Settings, Alerts में हर व्यक्ति चुनता है कि उसे कौन से अलर्ट चाहिए।',
        act: async (h) => { await h.go('/alerts', 'h1'); await h.wait(1500); await h.go('/settings?tab=alerts', 'h1'); await h.wait(1300); },
      },
    ],
  },
  {
    id: '20',
    title: { en: 'Backup, restore and keeping data safe', hi: 'बैकअप, रीस्टोर और डेटा की सुरक्षा' },
    about: {
      en: 'Download a backup every week, restore it on any device, use automatic safety copies, try the app with demo data, and know where your data lives in device mode and cloud mode.',
      hi: 'हर हफ़्ते बैकअप डाउनलोड करें, किसी भी डिवाइस पर रीस्टोर करें, अपने आप बनने वाली सेफ़्टी कॉपी इस्तेमाल करें, डेमो डेटा से ऐप आज़माएं, और जानें कि डिवाइस मोड और क्लाउड मोड में डेटा कहाँ रहता है।',
    },
    tags: ['data backup', 'restore'],
    intro: { en: 'Part twenty. Backup and data safety.', hi: 'भाग बीस। बैकअप और डेटा की सुरक्षा।' },
    scenes: [
      {
        ch: { en: 'Download a backup', hi: 'बैकअप डाउनलोड करें' },
        en: 'Open Settings, Backup and data. Download backup saves one file with all records, attached files, your staff list without passwords, and document numbering. Do it every week and keep it on Google Drive or a pen drive.',
        hi: 'Settings, Backup & data खोलें। Download backup एक फ़ाइल में सारे रिकॉर्ड, अटैच फ़ाइलें, बिना पासवर्ड के स्टाफ़ लिस्ट और डॉक्यूमेंट नंबरिंग सेव करता है। हर हफ़्ते करें और Google Drive या पेन ड्राइव में रखें।',
        act: async (h) => {
          await h.go('/settings?tab=data', 'h1');
          const [dl] = await Promise.all([h.page.waitForEvent('download', { timeout: 30000 }), h.click(btn(h, 'Download backup'))]);
          await dl.path();
          await h.wait(800);
        },
      },
      {
        ch: { en: 'Restore', hi: 'रीस्टोर' },
        en: 'Restore from backup puts a backup back, also on a new phone or computer. Staff from the backup are added; set their passwords under Users. Invoice numbers already given out are never issued again.',
        hi: 'Restore from backup बैकअप वापस डालता है, नए फ़ोन या कंप्यूटर पर भी। बैकअप का स्टाफ़ जुड़ जाता है; Users में उनके पासवर्ड रखें। जो बिल नंबर दिए जा चुके हैं, वो दोबारा कभी नहीं दिए जाते।',
        act: async (h) => { await h.show(btn(h, 'Restore from backup'), 1600); },
      },
      {
        ch: { en: 'Safety copies', hi: 'सेफ़्टी कॉपी' },
        en: 'The app also keeps safety copies by itself: every day, before an update and before a restore. If something goes wrong, go back to a copy with Restore.',
        hi: 'ऐप ख़ुद भी सेफ़्टी कॉपी रखता है: हर दिन, अपडेट से पहले और रीस्टोर से पहले। कुछ गड़बड़ हो तो Restore से किसी कॉपी पर वापस जाएं।',
        act: async (h) => { await h.click(btn(h, 'Make a safety copy now')); await h.wait(1500); },
      },
      {
        ch: { en: 'Demo data', hi: 'डेमो डेटा' },
        en: 'To try every screen, load the demo data of a sample solar company; your own data is kept aside and comes back when you remove the demo. In cloud mode, everything lives in one secure online database for the whole team.',
        hi: 'हर स्क्रीन आज़माने के लिए एक सैंपल सोलर कंपनी का डेमो डेटा लोड करें; आपका डेटा अलग रखा जाता है और डेमो हटाने पर वापस आ जाता है। क्लाउड मोड में पूरी टीम का सब कुछ एक सुरक्षित ऑनलाइन डेटाबेस में रहता है।',
        act: async (h) => { await h.scrollTo('#demo'); await h.wait(1800); },
      },
    ],
  },
  {
    id: '21',
    title: { en: 'Using SuryaSetu on your phone', hi: 'फ़ोन पर सूर्यसेतु का इस्तेमाल' },
    device: 'phone',
    about: {
      en: 'The phone layout: home tiles, the bar at the bottom, lists as cards, adding a lead at site, WhatsApp and calls in one tap, and the GPS camera for site photos.',
      hi: 'फ़ोन का लेआउट: होम टाइल, नीचे की पट्टी, कार्ड वाली लिस्ट, साइट पर लीड जोड़ना, एक टैप में WhatsApp और कॉल, और साइट फ़ोटो के लिए GPS कैमरा।',
    },
    tags: ['solar app mobile', 'field sales app'],
    intro: { en: 'Part twenty-one. SuryaSetu on your phone.', hi: 'भाग इक्कीस। फ़ोन पर सूर्यसेतु।' },
    scenes: [
      {
        ch: { en: 'The phone layout', hi: 'फ़ोन का लेआउट' },
        en: 'On a phone, SuryaSetu has its own layout. The Home screen shows your apps as tiles, and the bar at the bottom has Home, Dashboard, Search, Alerts and your account.',
        hi: 'फ़ोन पर सूर्यसेतु का अपना लेआउट है। होम स्क्रीन पर आपके ऐप टाइल के रूप में हैं, और नीचे की पट्टी में Home, Dashboard, Search, Alerts और आपका अकाउंट है।',
        act: async (h) => { await h.go('/', 'h1'); await h.wait(1200); await h.page.mouse.wheel(0, 400); await h.wait(1000); await h.top(); },
      },
      {
        en: 'Lists become cards that are easy to tap. Open a lead to call or WhatsApp in one tap.',
        hi: 'लिस्ट टैप करने में आसान कार्ड बन जाती हैं। लीड खोलें और एक टैप में कॉल या WhatsApp करें।',
        act: async (h) => {
          await h.click(tile(h, 'CRM'));
          await h.page.locator('[data-list="leads"]').waitFor();
          await h.wait(1000);
          await h.click(h.page.locator('tbody tr.clickable, .card-list a, .rec-card').first());
          await h.wait(800);
          await h.click(btn(h, 'WhatsApp'));
          await h.wait(2000);
          await h.click(dialog(h).getByRole('button', { name: 'Cancel' }));
        },
      },
      {
        ch: { en: 'Add a lead at site', hi: 'साइट पर लीड जोड़ें' },
        en: 'Meeting a new customer? Add the lead right there: the form is one column with big fields, and Save stays at the bottom of the screen.',
        hi: 'नए कस्टमर से मिल रहे हैं? वहीं लीड जोड़ें: फ़ॉर्म एक कॉलम में बड़े खानों वाला है, और Save स्क्रीन के नीचे रहता है।',
        act: async (h) => {
          await h.go('/m/leads/new', 'form[data-form="leads"]');
          await h.type('#f-name', 'Mohan Lal');
          await h.type('#f-phone', '9934012345');
          await h.type('#f-city', 'Hajipur');
          await save(h, 'leads');
        },
      },
      {
        ch: { en: 'Site photos', hi: 'साइट फ़ोटो' },
        en: 'On site, Site photo opens the camera with the GPS place, ready to stamp your photo. Install SuryaSetu on your phone so it opens full screen, like any app.',
        hi: 'साइट पर Site photo कैमरा खोलता है, GPS वाली जगह के साथ, फ़ोटो पर मुहर के लिए तैयार। सूर्यसेतु को फ़ोन पर इंस्टॉल करें ताकि वो किसी भी ऐप की तरह पूरी स्क्रीन पर खुले।',
        act: async (h) => {
          await h.click(btn(h, '📷 Site photo'));
          const cam = h.page.getByRole('dialog', { name: 'SuryaSetu Camera' });
          await cam.getByText(/Bihar, India/).first().waitFor({ timeout: 20000 });
          await h.wait(2000);
          await h.click(cam.getByRole('button', { name: 'Close camera' }));
        },
      },
    ],
  },
];
