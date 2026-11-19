// Lessons 1–10. Narration: short sentences, the words on screen in English (the app's language) also in Hindi.
import { BASE, quiet } from '../engine.mjs';

const tile = (h, name) => h.page.locator('main a', { hasText: new RegExp('^' + name) }).first();
const btn = (h, name, exact = true) => h.page.getByRole('button', { name, exact }).first();
const link = (h, name, exact = true) => h.page.getByRole('link', { name, exact }).first();
const tab = (h, name) => h.page.getByRole('tab', { name, exact: true });
const save = async (h, entity) => { await h.click(btn(h, 'Save')); if (entity) await h.page.waitForURL(new RegExp(`#/m/${entity}/[0-9a-f-]{36}$`), { timeout: 15000 }); await h.wait(600); };
const list = async (h, entity, query = '') => { await h.go(`/m/${entity}${query}`, `[data-list="${entity}"]`); await h.page.locator('tbody tr.clickable, .board, .files-card, .empty').first().waitFor({ timeout: 15000 }).catch(() => {}); };
const row = (h, text) => h.page.locator('tbody tr.clickable', { hasText: text }).first();
const dialog = (h, name) => h.page.getByRole('dialog', name ? { name } : {}).first();

export const L01 = [
  {
    id: '01',
    title: { en: 'Welcome to SuryaSetu: a quick tour', hi: 'सूर्यसेतु में स्वागत: ऐप की एक झलक' },
    about: {
      en: 'What SuryaSetu is, the apps inside it, the Home screen, search, the Dashboard and alerts — a short tour before the detailed videos.',
      hi: 'सूर्यसेतु क्या है, इसके अंदर के ऐप, होम स्क्रीन, सर्च, डैशबोर्ड और अलर्ट — विस्तार वाले वीडियो से पहले एक छोटी झलक।',
    },
    tags: ['solar CRM', 'solar app tour', 'सोलर ऐप'],
    intro: { en: 'SuryaSetu video guide, part one. A quick tour of the app.', hi: 'सूर्यसेतु वीडियो गाइड, भाग एक। ऐप की एक झलक।' },
    scenes: [
      {
        ch: { en: 'The Home screen', hi: 'होम स्क्रीन' },
        en: 'SuryaSetu runs your whole solar business in one place: enquiries, site surveys, quotations, installation, stock, GST bills, subsidy and service. After you sign in, you see the Home screen.',
        hi: 'सूर्यसेतु आपका पूरा सोलर बिज़नेस एक जगह चलाता है: इन्क्वायरी, साइट सर्वे, कोटेशन, इंस्टॉलेशन, स्टॉक, GST बिल, सब्सिडी और सर्विस। साइन इन करने के बाद आपको होम स्क्रीन दिखती है।',
        act: async (h) => { await h.go('/', 'h1'); await h.show('h1', 1800); },
      },
      {
        en: 'Each tile is one app. CRM is for leads and customers. Sales has site surveys and quotations. Projects and Installation follow the work at site.',
        hi: 'हर टाइल एक ऐप है। CRM में लीड और कस्टमर हैं। Sales में साइट सर्वे और कोटेशन। Projects और Installation में साइट का काम।',
        act: async (h) => { for (const n of ['CRM', 'Sales', 'Projects', 'Installation']) await h.show(tile(h, n), 700); },
      },
      {
        en: 'Inventory and Purchase keep your stock and orders. Accounts has GST invoices and payments. Subsidy, Solar Loans and Service complete the picture.',
        hi: 'Inventory और Purchase में आपका स्टॉक और ऑर्डर। Accounts में GST बिल और पेमेंट। Subsidy, Solar Loans और Service बाकी काम संभालते हैं।',
        act: async (h) => { for (const n of ['Inventory', 'Purchase', 'Accounts', 'Subsidy', 'Solar Loans', 'Service']) await h.show(tile(h, n), 550); },
      },
      {
        ch: { en: 'Moving around', hi: 'ऐप में घूमना' },
        en: 'Open an app by tapping its tile. The menu at the top shows the lists inside it, like Leads, Customers and Activities.',
        hi: 'किसी ऐप को खोलने के लिए उसकी टाइल पर टैप करें। ऊपर का मेन्यू उसके अंदर की लिस्ट दिखाता है, जैसे Leads, Customers और Activities।',
        act: async (h) => {
          await h.click(tile(h, 'CRM'));
          await h.page.locator('[data-list="leads"]').waitFor();
          await h.show(h.page.getByRole('link', { name: 'Customers', exact: true }).first(), 900);
        },
      },
      {
        en: 'The grid button on the left always takes you to all the apps.',
        hi: 'बाईं ओर का ग्रिड बटन आपको हमेशा सभी ऐप्स पर ले जाता है।',
        act: async (h) => { await h.click(h.page.getByRole('link', { name: 'All apps' }).first()); await h.page.locator('h1').first().waitFor(); },
      },
      {
        ch: { en: 'Dashboard', hi: 'डैशबोर्ड' },
        en: 'The Dashboard shows how the business is doing: invoiced, collected, receivables, open quotations, new leads and installations, with charts and an India map of sales.',
        hi: 'डैशबोर्ड बताता है कि बिज़नेस कैसा चल रहा है: बिल, वसूली, बकाया, खुले कोटेशन, नए लीड और इंस्टॉलेशन, चार्ट और भारत के नक्शे के साथ।',
        act: async (h) => {
          await h.click(tile(h, 'Dashboard'));
          await h.page.locator('.kpi').first().waitFor();
          await h.show(h.page.locator('.kpi').nth(2), 1000);
          await h.scrollTo('.india-map');
          await h.wait(800);
          await h.top();
        },
      },
      {
        ch: { en: 'Alerts', hi: 'अलर्ट' },
        en: 'The bell shows what needs action today: overdue payments, follow-ups, delayed projects, low stock and expiring AMCs. Tap an alert to open that record.',
        hi: 'घंटी बताती है कि आज क्या करना है: बकाया पेमेंट, फॉलो-अप, देरी वाले प्रोजेक्ट, कम स्टॉक और खत्म होते AMC। किसी अलर्ट पर टैप करके वो रिकॉर्ड खोलें।',
        act: async (h) => {
          await h.click(h.page.getByRole('button', { name: /^Notifications/ }));
          await h.wait(1500);
          await h.page.keyboard.press('Escape');
          await h.wait(500);
        },
      },
      {
        ch: { en: 'Your account and settings', hi: 'अकाउंट और सेटिंग' },
        en: 'Your account menu is at the top right: your profile, settings and sign out. In the next videos we set up the company, then follow a customer from enquiry to installation and payment.',
        hi: 'ऊपर दाईं ओर आपका अकाउंट मेन्यू है: प्रोफ़ाइल, सेटिंग और साइन आउट। अगले वीडियो में हम कंपनी सेट करेंगे, फिर एक कस्टमर को इन्क्वायरी से इंस्टॉलेशन और पेमेंट तक ले जाएंगे।',
        act: async (h) => {
          await h.click(h.page.getByRole('button', { name: /^Account menu for/ }));
          await h.wait(1600);
          await h.page.keyboard.press('Escape');
        },
      },
    ],
  },
  {
    id: '02',
    title: { en: 'Getting started: create your account and install the app', hi: 'शुरुआत: अकाउंट बनाएं और ऐप इंस्टॉल करें' },
    about: {
      en: 'Open SuryaSetu in a browser, create the first account (you become the admin), keep the recovery code safe, sign out and back in, and install it on a phone or computer.',
      hi: 'ब्राउज़र में सूर्यसेतु खोलें, पहला अकाउंट बनाएं (आप एडमिन बनते हैं), रिकवरी कोड संभाल कर रखें, साइन आउट और साइन इन करें, और फ़ोन या कंप्यूटर पर इंस्टॉल करें।',
    },
    tags: ['sign up', 'install app', 'PWA'],
    intro: { en: 'Part two. Getting started.', hi: 'भाग दो। शुरुआत।' },
    setup: async (page) => { await page.goto(BASE); await page.getByLabel('Your name').waitFor(); },
    scenes: [
      {
        ch: { en: 'Create the first account', hi: 'पहला अकाउंट बनाना' },
        en: 'Open the SuryaSetu website in Chrome, Edge or Safari. The first time, it asks you to create an account. The person who creates it becomes the admin of the business.',
        hi: 'Chrome, Edge या Safari में सूर्यसेतु की वेबसाइट खोलें। पहली बार यह अकाउंट बनाने को कहता है। जो व्यक्ति अकाउंट बनाता है, वही बिज़नेस का एडमिन बनता है।',
        act: async (h) => { await h.show(h.page.locator('form').first(), 1800); },
      },
      {
        en: 'Type your name, email and 10-digit mobile number, then choose a password of at least eight characters and type it again.',
        hi: 'अपना नाम, ईमेल और 10 अंकों का मोबाइल नंबर लिखें, फिर कम से कम आठ अक्षरों का पासवर्ड चुनें और उसे दोबारा लिखें।',
        act: async (h) => {
          await h.type(h.page.getByLabel('Your name'), 'Asha Verma');
          await h.type(h.page.getByLabel('Email'), 'asha@suryoday.example', { delay: 35 });
          await h.type(h.page.getByLabel('Mobile number'), '9835012345');
          await h.type(h.page.getByLabel('Password', { exact: true }), 'Surya@2026');
          await h.type(h.page.getByLabel('Confirm password'), 'Surya@2026');
        },
      },
      {
        en: 'Tap Create account. You get a recovery code. Write it down or take a photo and keep it safe: it lets the admin back in if the password is ever forgotten.',
        hi: 'Create account पर टैप करें। आपको एक रिकवरी कोड मिलता है। इसे लिख लें या फ़ोटो ले कर सुरक्षित रखें: पासवर्ड भूलने पर इसी से एडमिन दोबारा अंदर आ सकता है।',
        act: async (h) => {
          await h.click(btn(h, 'Create account'));
          await h.page.getByLabel('I have saved this code').waitFor();
          await h.show(h.page.getByText(/^[A-Z0-9]{4,6}-[A-Z0-9]{4,6}$/).first(), 1800);
        },
      },
      {
        en: 'Tick that you have saved the code and continue. You are in, on the Home screen of your own business.',
        hi: 'टिक करें कि आपने कोड सेव कर लिया है और Continue दबाएं। अब आप अपने बिज़नेस की होम स्क्रीन पर हैं।',
        act: async (h) => {
          await h.click(h.page.getByLabel('I have saved this code'));
          await h.click(btn(h, 'Continue'));
          await h.page.getByRole('heading', { name: /Hello/ }).waitFor();
          await h.wait(1200);
        },
      },
      {
        ch: { en: 'Sign out and sign in', hi: 'साइन आउट और साइन इन' },
        en: 'To sign out, open the account menu at the top right and choose Sign out. Next time, pick your account and type your password. Forgot it? Use Forgot password on the sign-in screen.',
        hi: 'साइन आउट करने के लिए ऊपर दाईं ओर अकाउंट मेन्यू खोलें और Sign out चुनें। अगली बार अपना अकाउंट चुनें और पासवर्ड लिखें। भूल गए? साइन-इन स्क्रीन पर Forgot password इस्तेमाल करें।',
        act: async (h) => {
          await h.click(h.page.getByRole('button', { name: /^Account menu for/ }));
          await h.click(dialog(h, 'Account').getByRole('button', { name: 'Sign out' }));
          await h.click(dialog(h, 'Sign out?').getByRole('button', { name: 'Sign out' }));
          await h.page.getByRole('heading', { name: /Choose an account|Sign in/ }).waitFor();
          await h.wait(1500);
        },
      },
      {
        ch: { en: 'Install on a phone or computer', hi: 'फ़ोन या कंप्यूटर पर इंस्टॉल करें' },
        en: 'To install it like an app: on Android, open the website in Chrome, tap the three-dot menu and choose Install app. On iPhone, use Share, then Add to Home Screen. On a computer, click the install icon in the address bar. Your company can also give you the Android app file.',
        hi: 'इसे ऐप की तरह इंस्टॉल करने के लिए: Android पर Chrome में वेबसाइट खोलें, तीन बिंदु वाले मेन्यू में Install app चुनें। iPhone पर Share, फिर Add to Home Screen। कंप्यूटर पर एड्रेस बार में इंस्टॉल आइकन क्लिक करें। आपकी कंपनी Android ऐप की फ़ाइल भी दे सकती है।',
        act: async (h) => { await h.wait(1500); },
      },
    ],
  },
  {
    id: '03',
    title: { en: 'Company setup: profile, GST, print, WhatsApp', hi: 'कंपनी सेटअप: प्रोफ़ाइल, GST, प्रिंट, WhatsApp' },
    about: {
      en: 'Settings for the admin: company profile and GSTIN, sales and quotation defaults, payment terms, warehouse for deliveries, print templates with logo and UPI, site-photo QR and WhatsApp messages.',
      hi: 'एडमिन के लिए सेटिंग: कंपनी प्रोफ़ाइल और GSTIN, सेल्स और कोटेशन की डिफ़ॉल्ट, पेमेंट की शर्तें, डिलीवरी का गोदाम, लोगो और UPI वाले प्रिंट टेम्पलेट, साइट-फ़ोटो QR और WhatsApp मैसेज।',
    },
    tags: ['GST invoice settings', 'company profile'],
    intro: { en: 'Part three. Setting up your company.', hi: 'भाग तीन। अपनी कंपनी सेट करना।' },
    scenes: [
      {
        ch: { en: 'Company profile and GSTIN', hi: 'कंपनी प्रोफ़ाइल और GSTIN' },
        en: 'Open Settings from the Home screen. The General tab is your company profile: name, GSTIN, PAN, state, phone, email, bank details and address. These print on every quotation and invoice.',
        hi: 'होम स्क्रीन से Settings खोलें। General टैब आपकी कंपनी प्रोफ़ाइल है: नाम, GSTIN, PAN, राज्य, फ़ोन, ईमेल, बैंक की जानकारी और पता। ये हर कोटेशन और बिल पर छपते हैं।',
        act: async (h) => {
          await h.click(tile(h, 'Settings'));
          await h.page.locator('#s-companyName').waitFor();
          for (const id of ['#s-companyName', '#s-gstin', '#s-state', '#s-bankName']) await h.show(id, 600);
        },
      },
      {
        en: 'The state matters: it decides CGST plus SGST for customers in your state, and IGST for others. If you type the GSTIN, the state is filled in from it. Change what you need and save.',
        hi: 'राज्य ज़रूरी है: इसी से तय होता है कि आपके राज्य के कस्टमर पर CGST और SGST लगेगा, और बाकी पर IGST। GSTIN लिखने पर राज्य अपने आप भर जाता है। जो बदलना है बदलें और Save करें।',
        act: async (h) => {
          await h.type('#s-phone', '0612 2201234');
          await h.click(btn(h, 'Save company profile'));
          await h.page.getByText('Settings saved').first().waitFor();
          await h.wait(800);
        },
      },
      {
        ch: { en: 'Sales and accounts', hi: 'सेल्स और अकाउंट्स' },
        en: 'The Sales tab sets how long quotations stay valid, the default terms, and the generation and savings estimate printed on quotations: units per kilowatt per day and your electricity tariff.',
        hi: 'Sales टैब में तय होता है कि कोटेशन कितने दिन मान्य रहे, डिफ़ॉल्ट शर्तें, और कोटेशन पर छपने वाला बिजली उत्पादन और बचत का अनुमान: प्रति किलोवाट प्रति दिन यूनिट और आपका बिजली टैरिफ़।',
        act: async (h) => { await h.click(tab(h, 'Sales')); await h.show('#p-units', 900); await h.show('#p-tariff', 900); },
      },
      {
        en: 'The Accounts tab has the payment terms that set each invoice\'s due date. Purchase and stock chooses the warehouse where deliveries go.',
        hi: 'Accounts टैब में पेमेंट की शर्तें हैं, जिनसे हर बिल की ड्यू डेट बनती है। Purchase & stock में वो गोदाम चुनें जहाँ डिलीवरी आती है।',
        act: async (h) => { await h.click(tab(h, 'Accounts')); await h.wait(1000); await h.click(tab(h, 'Purchase & stock')); await h.wait(1000); },
      },
      {
        ch: { en: 'Print templates and UPI', hi: 'प्रिंट टेम्पलेट और UPI' },
        en: 'Documents and print is where you add your logo and signature, choose a print layout and colour, and your UPI ID. With a UPI ID, every invoice prints a QR code for the amount due, so customers can pay by scanning.',
        hi: 'Documents & print में अपना लोगो और साइन जोड़ें, प्रिंट का लेआउट और रंग चुनें, और अपना UPI ID डालें। UPI ID होने पर हर बिल पर बकाया राशि का QR कोड छपता है, कस्टमर स्कैन करके पेमेंट कर सकते हैं।',
        act: async (h) => { await h.click(tab(h, 'Documents & print')); await h.wait(800); await h.scrollTo(h.page.getByText('Site photos (camera)').first()); await h.wait(800); await h.top(); },
      },
      {
        ch: { en: 'WhatsApp messages', hi: 'WhatsApp मैसेज' },
        en: 'In the WhatsApp tab, enter your business WhatsApp number, which prints on quotations and invoices. Below are the messages the WhatsApp button uses. One tap switches them all to Hindi, and you can change any of them.',
        hi: 'WhatsApp टैब में अपना बिज़नेस WhatsApp नंबर डालें, जो कोटेशन और बिल पर छपता है। नीचे वो मैसेज हैं जो WhatsApp बटन इस्तेमाल करता है। एक टैप से सब हिंदी में हो जाते हैं, और आप कोई भी मैसेज बदल सकते हैं।',
        act: async (h) => {
          await h.click(tab(h, 'WhatsApp'));
          await h.type('#w-number', '98350 12345');
          await h.click(btn(h, 'Use Hindi messages'));
          await h.scrollTo('#w-quotation');
          await h.wait(1000);
          await h.click(btn(h, 'Save WhatsApp settings'));
          await h.page.getByText('Settings saved').first().waitFor();
        },
      },
    ],
  },
  {
    id: '04',
    title: { en: 'Team members, roles and access rights', hi: 'टीम, रोल और एक्सेस के अधिकार' },
    about: {
      en: 'Add your sales people, technicians and accounts staff, choose their role, fine-tune what each person can see or change, disable someone who left, and set your own password and appearance.',
      hi: 'अपने सेल्स, टेक्नीशियन और अकाउंट्स स्टाफ़ को जोड़ें, उनका रोल चुनें, हर व्यक्ति क्या देख या बदल सकता है तय करें, छोड़ चुके व्यक्ति को बंद करें, और अपना पासवर्ड और दिखावट सेट करें।',
    },
    tags: ['user roles', 'staff access'],
    intro: { en: 'Part four. Your team and what each person can do.', hi: 'भाग चार। आपकी टीम और हर व्यक्ति क्या कर सकता है।' },
    scenes: [
      {
        ch: { en: 'Add a team member', hi: 'टीम मेंबर जोड़ें' },
        en: 'Go to Settings, then Users and access. Everyone who uses SuryaSetu has their own login. Tap Add user.',
        hi: 'Settings में जाएं, फिर Users & access। सूर्यसेतु इस्तेमाल करने वाले हर व्यक्ति का अपना लॉगिन होता है। Add user पर टैप करें।',
        act: async (h) => { await h.go('/settings?tab=users', 'table'); await h.wait(800); await h.click(btn(h, '+ Add user')); },
      },
      {
        en: 'Fill in the name, email and mobile, and choose a role: Sales for the sales team, Technician for site staff, Accounts for billing, Manager for supervisors. Set a first password and save.',
        hi: 'नाम, ईमेल और मोबाइल भरें, और रोल चुनें: सेल्स टीम के लिए Sales, साइट स्टाफ़ के लिए Technician, बिलिंग के लिए Accounts, सुपरवाइज़र के लिए Manager। पहला पासवर्ड रखें और Save करें।',
        act: async (h) => {
          await h.type('#u-name', 'Priya Kumari Sales');
          await h.type('#u-email', 'priya.sales@suryoday.example', { delay: 30 });
          await h.type('#u-phone', '9431000777');
          await h.select('#u-role', 'sales');
          await h.type('#u-pass', 'Staff@12345');
          await h.click(dialog(h).getByRole('button', { name: 'Save' }));
          await h.page.getByText(/User saved/).first().waitFor();
        },
      },
      {
        ch: { en: 'Access rights', hi: 'एक्सेस के अधिकार' },
        en: 'Each role comes with sensible access. To fine-tune it, edit the person. For each app choose none, read only, own records only, all, or manager. Own records only means a sales person sees just their own leads.',
        hi: 'हर रोल के साथ सही एक्सेस पहले से मिलता है। बदलने के लिए उस व्यक्ति को Edit करें। हर ऐप के लिए चुनें: कुछ नहीं, सिर्फ़ देखना, सिर्फ़ अपने रिकॉर्ड, सब, या मैनेजर। सिर्फ़ अपने रिकॉर्ड का मतलब है सेल्स वाला सिर्फ़ अपने लीड देखेगा।',
        act: async (h) => {
          await h.click(h.page.getByRole('row', { name: /Priya Kumari Sales/ }).getByRole('button', { name: 'Edit' }));
          const d = dialog(h, 'Edit user');
          await h.select(d.getByLabel('Access to CRM'), 'own');
          await h.click(d.getByRole('button', { name: 'Save' }));
          await h.page.getByText(/User saved/).first().waitFor();
        },
      },
      {
        en: 'When someone leaves, edit them and untick Active. They can no longer sign in, but everything they did stays in the records.',
        hi: 'जब कोई नौकरी छोड़ दे, तो उसे Edit करके Active का टिक हटा दें। वो साइन इन नहीं कर पाएगा, लेकिन उसका किया सब काम रिकॉर्ड में रहेगा।',
        act: async (h) => {
          await h.click(h.page.getByRole('row', { name: /Priya Kumari Sales/ }).getByRole('button', { name: 'Edit' }));
          await h.show(dialog(h, 'Edit user').getByLabel('Active (can sign in)'), 1400);
          await h.page.keyboard.press('Escape');
        },
      },
      {
        ch: { en: 'My account', hi: 'मेरा अकाउंट' },
        en: 'Under My account, anyone can change their own password and mobile number, and choose light or dark mode and the screen layout.',
        hi: 'My account में हर कोई अपना पासवर्ड और मोबाइल नंबर बदल सकता है, और लाइट या डार्क मोड और स्क्रीन लेआउट चुन सकता है।',
        act: async (h) => { await h.click(tab(h, 'My account')); await h.wait(1200); await h.scrollTo(h.page.getByText('Appearance').first()); await h.wait(900); },
      },
    ],
  },
  {
    id: '05',
    title: { en: 'Leads: capture enquiries and follow up', hi: 'लीड: इन्क्वायरी दर्ज करें और फॉलो-अप करें' },
    about: {
      en: 'Add a new solar enquiry, see duplicates, plan the next follow-up, move leads through the stages on the board, add notes, message them on WhatsApp and convert a lead into a customer.',
      hi: 'नई सोलर इन्क्वायरी जोड़ें, डुप्लिकेट देखें, अगला फॉलो-अप तय करें, बोर्ड पर लीड को स्टेज में आगे बढ़ाएं, नोट जोड़ें, WhatsApp करें और लीड को कस्टमर बनाएं।',
    },
    tags: ['solar leads', 'lead management', 'CRM'],
    intro: { en: 'Part five. Leads: every enquiry, followed up.', hi: 'भाग पाँच। लीड: हर इन्क्वायरी का फॉलो-अप।' },
    scenes: [
      {
        ch: { en: 'Add a lead', hi: 'लीड जोड़ें' },
        en: 'Every enquiry is a lead, from a call, walk-in, referral, Facebook or your website. Open CRM, then Leads, and tap New Lead.',
        hi: 'हर इन्क्वायरी एक लीड है, चाहे कॉल से आए, दुकान पर, रेफ़रल से, Facebook से या वेबसाइट से। CRM खोलें, फिर Leads, और New Lead पर टैप करें।',
        act: async (h) => { await list(h, 'leads'); await h.click(link(h, '+ New Lead').or(btn(h, '+ New Lead'))); await h.page.locator('form[data-form="leads"]').waitFor(); },
      },
      {
        en: 'Type the name and phone. Add the city, where the lead came from, the capacity they need and their monthly electricity bill. These help you plan the right system.',
        hi: 'नाम और फ़ोन लिखें। शहर, लीड कहाँ से आया, कितनी क्षमता चाहिए और महीने का बिजली बिल भी डालें। इनसे सही सिस्टम तय करने में मदद मिलती है।',
        act: async (h) => {
          await h.type('#f-name', 'Vikram Singh');
          await h.type('#f-phone', '9876501234');
          await h.type('#f-city', 'Patna');
          await h.select('#f-source', 'Referral');
          await h.type('#f-capacityKw', '3');
          await h.type('#f-monthlyBill', '3500');
        },
      },
      {
        en: 'Assign it to a sales person and set the next follow-up date and time. The follow-up appears on the Dashboard and in alerts on that day. Save.',
        hi: 'इसे किसी सेल्स वाले को असाइन करें और अगले फॉलो-अप की तारीख़ और समय डालें। उस दिन फॉलो-अप डैशबोर्ड और अलर्ट में दिखेगा। Save करें।',
        act: async (h) => {
          await h.selectText('#f-assignedTo', 'Priya');
          await h.fill('#f-nextFollowUp', '2026-11-18T11:00');
          await save(h, 'leads');
        },
      },
      {
        ch: { en: 'Notes and WhatsApp', hi: 'नोट और WhatsApp' },
        en: 'On the lead page, write a note after every call: what was promised, what they asked. The history keeps every note and change with who did it and when.',
        hi: 'लीड पेज पर हर कॉल के बाद नोट लिखें: क्या वादा हुआ, उन्होंने क्या पूछा। हिस्ट्री में हर नोट और बदलाव रहता है, किसने और कब किया।',
        act: async (h) => {
          await h.type(h.page.getByPlaceholder(/Write a note/), 'Called: wants a 3 kW on-grid system. Site visit on Saturday.', { delay: 25 });
          await h.click(btn(h, 'Add note'));
          await h.wait(800);
        },
      },
      {
        en: 'The WhatsApp button opens a ready message for this lead. You can change the words, then Open WhatsApp sends you to the chat, and the message is noted in the history.',
        hi: 'WhatsApp बटन इस लीड के लिए तैयार मैसेज खोलता है। आप शब्द बदल सकते हैं, फिर Open WhatsApp आपको चैट पर ले जाता है, और मैसेज हिस्ट्री में दर्ज हो जाता है।',
        act: async (h) => {
          await h.click(btn(h, 'WhatsApp'));
          await h.show(dialog(h).getByLabel('Message'), 1800);
          await h.click(dialog(h).getByRole('button', { name: 'Cancel' }));
        },
      },
      {
        ch: { en: 'The lead board', hi: 'लीड बोर्ड' },
        en: 'The Board view shows leads by stage: New, Contacted, Site Visit, Quoted, Won and Lost. Move a card to the next stage as the deal progresses.',
        hi: 'Board व्यू में लीड स्टेज के हिसाब से दिखते हैं: New, Contacted, Site Visit, Quoted, Won और Lost। सौदा आगे बढ़ने पर कार्ड को अगली स्टेज में ले जाएं।',
        act: async (h) => {
          await list(h, 'leads', '?view=board');
          await h.page.locator('.board').waitFor();
          await h.select(h.page.getByLabel('Move Vikram Singh').first(), 'Contacted');
          await h.wait(1200);
        },
      },
      {
        ch: { en: 'Convert to customer', hi: 'कस्टमर बनाएं' },
        en: 'When the lead is serious, open it and tap Convert to customer. The customer gets the name, phone, city and state from the lead. You can also go straight to Schedule survey or New quotation.',
        hi: 'जब लीड पक्का लगे, उसे खोलें और Convert to customer दबाएं। कस्टमर को लीड से नाम, फ़ोन, शहर और राज्य मिल जाते हैं। आप सीधे Schedule survey या New quotation भी कर सकते हैं।',
        act: async (h) => {
          await list(h, 'leads');
          await h.click(row(h, 'Vikram Singh'));
          await h.click(btn(h, 'Convert to customer'));
          await h.page.waitForURL(/#\/m\/customers\//);
          await h.wait(1500);
        },
      },
    ],
  },
  {
    id: '06',
    title: { en: 'Customers: one page for everything', hi: 'कस्टमर: हर जानकारी एक पेज पर' },
    about: {
      en: 'The customer page with all their quotations, invoices, projects and photos; the account statement; adding a customer with PIN code, GSTIN and GPS location; and the India map of customers.',
      hi: 'कस्टमर पेज पर उनके सभी कोटेशन, बिल, प्रोजेक्ट और फ़ोटो; खाता स्टेटमेंट; PIN कोड, GSTIN और GPS लोकेशन के साथ कस्टमर जोड़ना; और कस्टमरों का भारत का नक्शा।',
    },
    tags: ['customer management', 'account statement'],
    intro: { en: 'Part six. Customers.', hi: 'भाग छह। कस्टमर।' },
    scenes: [
      {
        ch: { en: 'The customer page', hi: 'कस्टमर पेज' },
        en: 'Customers are the homes and businesses you sell to. Open CRM, then Customers, and open one.',
        hi: 'कस्टमर वो घर और बिज़नेस हैं जिन्हें आप बेचते हैं। CRM खोलें, फिर Customers, और किसी एक को खोलें।',
        act: async (h) => { await list(h, 'customers'); await h.click(h.page.locator('tbody tr.clickable').nth(1)); await h.page.locator('h1').waitFor(); },
      },
      {
        en: 'Everything about them is on one page: contact details, segment and lifecycle, and below that their quotations, invoices, payments, projects, tickets, photos and documents.',
        hi: 'उनकी हर जानकारी एक पेज पर है: संपर्क, सेगमेंट और स्थिति, और नीचे उनके कोटेशन, बिल, पेमेंट, प्रोजेक्ट, टिकट, फ़ोटो और डॉक्यूमेंट।',
        act: async (h) => { await h.show('.dl', 900); await h.scrollTo(h.page.getByRole('heading', { name: /Photos & documents/ })); await h.wait(700); await h.page.mouse.wheel(0, 500); await h.wait(900); await h.top(); },
      },
      {
        ch: { en: 'Account statement', hi: 'खाता स्टेटमेंट' },
        en: 'Statement PDF lists every invoice and payment with the running balance. Print it, save it as PDF, or share it on WhatsApp to collect pending payments.',
        hi: 'Statement (PDF) में हर बिल और पेमेंट चलते बैलेंस के साथ दिखते हैं। इसे प्रिंट करें, PDF में सेव करें, या बकाया वसूलने के लिए WhatsApp पर भेजें।',
        act: async (h) => { await h.click(link(h, 'Statement (PDF)')); await h.page.locator('.doc').waitFor(); await h.wait(1200); await h.click(link(h, '← Back')); },
      },
      {
        ch: { en: 'Add a customer', hi: 'नया कस्टमर' },
        en: 'To add a customer, tap New Customer. Type the PIN code: if you leave the state empty, it is filled from the PIN code when you save. The state decides CGST plus SGST or IGST on their bills, and a business customer\'s GSTIN also gives it.',
        hi: 'कस्टमर जोड़ने के लिए New Customer दबाएं। PIN कोड लिखें: राज्य खाली छोड़ें तो Save करते समय PIN कोड से भर जाता है। राज्य से उनके बिल पर CGST और SGST या IGST तय होता है, और बिज़नेस कस्टमर का GSTIN भी राज्य बता देता है।',
        act: async (h) => {
          await list(h, 'customers');
          await h.click(link(h, '+ New Customer').or(btn(h, '+ New Customer')));
          await h.type('#f-name', 'Sunita Devi');
          await h.type('#f-phone', '9431012345');
          await h.type('#f-pincode', '800001');
          await h.page.locator('#f-pincode').blur();
          await h.wait(1200);
          await h.show('#f-state', 1000);
        },
      },
      {
        en: 'At the customer\'s site, tap Use my location to save the exact spot from the phone\'s GPS. Then save.',
        hi: 'कस्टमर की साइट पर Use my location दबाएं, फ़ोन के GPS से सही जगह सेव हो जाती है। फिर Save करें।',
        act: async (h) => { await h.click(btn(h, '📍 Use my location', false)); await h.wait(800); await save(h, 'customers'); },
      },
      {
        ch: { en: 'Customers on the map', hi: 'नक्शे पर कस्टमर' },
        en: 'The map view shows all your customers on the map of India. Choose a state to zoom in to its cities and each customer.',
        hi: 'मैप व्यू में आपके सभी कस्टमर भारत के नक्शे पर दिखते हैं। किसी राज्य को चुनें तो उसके शहर और हर कस्टमर दिखेंगे।',
        act: async (h) => { await list(h, 'customers', '?view=map'); await h.page.locator('.india-map path.map-state').first().waitFor(); await h.wait(800); await h.show('.india-map', 1600); },
      },
    ],
  },
  {
    id: '07',
    title: { en: 'Site survey and site photos with GPS', hi: 'साइट सर्वे और GPS वाली साइट फ़ोटो' },
    about: {
      en: 'Schedule a site survey from a lead, record the roof, shading and sanctioned load, and take site photos with the app\'s own GPS camera: place, map, coordinates, date and time stamped on the photo.',
      hi: 'लीड से साइट सर्वे तय करें, छत, छाया और स्वीकृत लोड दर्ज करें, और ऐप के अपने GPS कैमरे से साइट फ़ोटो लें: जगह, नक्शा, निर्देशांक, तारीख़ और समय फ़ोटो पर छपते हैं।',
    },
    tags: ['site survey', 'GPS camera', 'geotag photo'],
    intro: { en: 'Part seven. Site survey and site photos.', hi: 'भाग सात। साइट सर्वे और साइट फ़ोटो।' },
    scenes: [
      {
        ch: { en: 'Schedule a survey', hi: 'सर्वे तय करें' },
        en: 'Before quoting, someone visits the roof. Open the lead and tap Schedule survey. The lead is already filled in.',
        hi: 'कोटेशन से पहले कोई छत देखने जाता है। लीड खोलें और Schedule survey दबाएं। लीड पहले से भरा होता है।',
        act: async (h) => { await list(h, 'leads'); await h.click(row(h, 'Rahul Kumar')); await h.click(link(h, 'Schedule survey')); await h.page.locator('form[data-form="surveys"]').waitFor(); },
      },
      {
        en: 'Fill the survey date and the surveyor. At the site, record the roof type, the usable roof area, shading, the sanctioned load on the electricity bill, and the capacity you recommend.',
        hi: 'सर्वे की तारीख़ और सर्वेयर भरें। साइट पर छत का प्रकार, इस्तेमाल लायक छत का एरिया, छाया, बिजली बिल पर स्वीकृत लोड, और आपकी सुझाई क्षमता दर्ज करें।',
        act: async (h) => {
          await h.selectText('#f-surveyor', 'Priya');
          await h.select('#f-roofType', 'RCC');
          await h.type('#f-roofAreaSqft', '450');
          await h.select('#f-shading', 'None');
          await h.type('#f-sanctionedLoadKw', '5');
          await h.type('#f-recommendedKw', '3');
          await h.select('#f-status', 'Completed');
          await save(h, 'surveys');
        },
      },
      {
        ch: { en: 'The GPS camera', hi: 'GPS कैमरा' },
        en: 'Now the site photos. Tap Site photo. SuryaSetu\'s own camera opens and shows where you are: the town, district and state, the Plus Code, latitude and longitude, and how accurate the GPS is.',
        hi: 'अब साइट फ़ोटो। Site photo दबाएं। सूर्यसेतु का अपना कैमरा खुलता है और बताता है आप कहाँ हैं: शहर, ज़िला और राज्य, Plus Code, अक्षांश और देशांतर, और GPS कितना सटीक है।',
        act: async (h) => {
          await h.click(btn(h, '📷 Site photo'));
          await h.page.getByRole('dialog', { name: 'SuryaSetu Camera' }).getByText('Patna, Bihar, India').first().waitFor({ timeout: 20000 });
          await h.wait(1800);
        },
      },
      {
        en: 'Tap the round button to take the photo. The place, a small map, the coordinates, date and time, the job details and a QR code are stamped on it. Tap Use photo.',
        hi: 'फ़ोटो लेने के लिए गोल बटन दबाएं। जगह, छोटा नक्शा, निर्देशांक, तारीख़ और समय, काम की जानकारी और QR कोड फ़ोटो पर छप जाते हैं। Use photo दबाएं।',
        act: async (h) => {
          const cam = h.page.getByRole('dialog', { name: 'SuryaSetu Camera' });
          await h.click(cam.getByRole('button', { name: 'Take photo', exact: true }));
          await cam.getByRole('img').first().waitFor({ timeout: 15000 });
          await h.wait(2200);
          await h.click(cam.getByRole('button', { name: 'Use photo' }));
          await h.page.getByText(/Photo saved with its location/).first().waitFor({ timeout: 15000 });
        },
      },
      {
        en: 'The photo is saved on the survey, and also on the customer and the project, with its place and time. Tap it to see it large. Take as many as you need: roof, meter, inverter wall.',
        hi: 'फ़ोटो सर्वे पर सेव होती है, और कस्टमर और प्रोजेक्ट पर भी, अपनी जगह और समय के साथ। बड़ी देखने के लिए उस पर टैप करें। जितनी चाहिए उतनी लें: छत, मीटर, इन्वर्टर की दीवार।',
        act: async (h) => {
          await h.scrollTo(h.page.getByRole('heading', { name: /Photos & documents/ }));
          await h.click(h.page.locator('.files-open').first());
          await h.wait(2600);
          await h.page.keyboard.press('Escape');
        },
      },
    ],
  },
  {
    id: '08',
    title: { en: 'Quotations: GST quotes with savings', hi: 'कोटेशन: GST कोटेशन बचत के साथ' },
    about: {
      en: 'Make a quotation from a lead: system size, products from your list with GST, line and overall discount, print with the generation and savings estimate, share on WhatsApp and confirm the order.',
      hi: 'लीड से कोटेशन बनाएं: सिस्टम साइज़, लिस्ट से प्रोडक्ट GST के साथ, लाइन और कुल डिस्काउंट, उत्पादन और बचत अनुमान के साथ प्रिंट, WhatsApp पर भेजें और ऑर्डर पक्का करें।',
    },
    tags: ['solar quotation', 'GST quotation', 'solar quote format'],
    intro: { en: 'Part eight. Quotations.', hi: 'भाग आठ। कोटेशन।' },
    scenes: [
      {
        ch: { en: 'Start a quotation', hi: 'कोटेशन शुरू करें' },
        en: 'Open the lead and tap New quotation. The lead becomes a customer if it is not one yet, and the quotation opens with the customer filled in.',
        hi: 'लीड खोलें और New quotation दबाएं। लीड अभी कस्टमर नहीं है तो कस्टमर बन जाता है, और कोटेशन कस्टमर भरा हुआ खुलता है।',
        act: async (h) => { await list(h, 'leads'); await h.click(row(h, 'Rahul Kumar')); await h.click(btn(h, 'New quotation')); await h.page.locator('form[data-form="quotations"]').waitFor(); },
      },
      {
        en: 'Type the system size in kilowatts. Then add lines: choose a product and its description, HSN, unit, price and GST rate come from your product list. Panels and inverters carry five percent GST.',
        hi: 'सिस्टम साइज़ किलोवाट में लिखें। फिर लाइन जोड़ें: प्रोडक्ट चुनें, उसका विवरण, HSN, यूनिट, कीमत और GST आपकी प्रोडक्ट लिस्ट से आ जाते हैं। पैनल और इन्वर्टर पर पाँच प्रतिशत GST है।',
        act: async (h) => {
          await h.type('#f-systemKw', '3.27');
          await h.click(btn(h, '+ Add line'));
          await h.selectText(h.page.locator('.items-table [aria-label="Product for line 1"]').first(), 'Solar Panel 545');
          await h.type(h.page.getByLabel('Quantity line 1').first(), '6');
          await h.click(btn(h, '+ Add line'));
          await h.selectText(h.page.locator('.items-table [aria-label="Product for line 2"]').first(), 'On-grid Inverter 3 kW');
        },
      },
      {
        en: 'Add the structure, and installation, which is a service at eighteen percent. The totals below show the taxable value, CGST and SGST, or IGST for another state, and the round-off.',
        hi: 'स्ट्रक्चर और इंस्टॉलेशन जोड़ें, इंस्टॉलेशन सर्विस है, उस पर अठारह प्रतिशत। नीचे कुल में टैक्स योग्य राशि, CGST और SGST, या दूसरे राज्य के लिए IGST, और राउंड-ऑफ़ दिखते हैं।',
        act: async (h) => {
          await h.click(btn(h, '+ Add line'));
          await h.selectText(h.page.locator('.items-table [aria-label="Product for line 3"]').first(), 'GI Mounting Structure');
          await h.type(h.page.getByLabel('Quantity line 3').first(), '3');
          await h.click(btn(h, '+ Add line'));
          await h.selectText(h.page.locator('.items-table [aria-label="Product for line 4"]').first(), 'Installation & Commissioning');
          await h.type(h.page.getByLabel('Quantity line 4').first(), '3');
          await h.scrollTo('.totals, .doc-totals, table.totals');
          await h.wait(900);
        },
      },
      {
        en: 'Give a discount in rupees if you agreed one; GST is worked out after the discount. Save. The quotation gets its number, like QT slash 26-27.',
        hi: 'अगर डिस्काउंट तय हुआ है तो रुपये में डालें; GST डिस्काउंट के बाद लगता है। Save करें। कोटेशन को नंबर मिलता है, जैसे QT/26-27।',
        act: async (h) => { await h.type('#f-discount', '5000'); await save(h, 'quotations'); },
      },
      {
        ch: { en: 'Print and share', hi: 'प्रिंट और भेजना' },
        en: 'Print or save it as PDF. It shows your logo and GSTIN, the lines with HSN, taxes, amount in words, your bank details, and the estimated units per year, savings and payback for the customer.',
        hi: 'इसे प्रिंट करें या PDF में सेव करें। इसमें आपका लोगो और GSTIN, HSN वाली लाइनें, टैक्स, शब्दों में राशि, बैंक की जानकारी, और कस्टमर के लिए साल भर की यूनिट, बचत और पैसे वापसी का अनुमान दिखता है।',
        act: async (h) => { await h.click(link(h, 'Print / PDF')); await h.page.locator('.doc').waitFor(); await h.wait(900); await h.page.mouse.wheel(0, 700); await h.wait(1500); },
      },
      {
        en: 'Share on WhatsApp opens the quotation message for the customer. Save the PDF, open WhatsApp and attach it in the chat.',
        hi: 'Share on WhatsApp कस्टमर के लिए कोटेशन का मैसेज खोलता है। PDF सेव करें, WhatsApp खोलें और चैट में उसे अटैच करें।',
        act: async (h) => { await h.top(); await h.click(btn(h, 'Share on WhatsApp')); await h.wait(2200); await h.click(dialog(h).getByRole('button', { name: 'Cancel' })); await h.click(link(h, '← Back')); },
      },
      {
        ch: { en: 'Confirm the order', hi: 'ऑर्डर पक्का करें' },
        en: 'When the customer agrees, tap Confirm order. The quotation becomes Accepted, the lead Won, and a project is started for the installation.',
        hi: 'कस्टमर मान जाए तो Confirm order दबाएं। कोटेशन Accepted हो जाता है, लीड Won, और इंस्टॉलेशन का प्रोजेक्ट शुरू हो जाता है।',
        act: async (h) => { await h.click(btn(h, 'Confirm order')); await h.click(dialog(h).getByRole('button', { name: 'Confirm order' })); await h.page.getByText(/Order confirmed/).first().waitFor(); await h.wait(1200); },
      },
    ],
  },
  {
    id: '09',
    title: { en: 'GST invoices, payments and receipts', hi: 'GST बिल, पेमेंट और रसीद' },
    about: {
      en: 'Turn a quotation into an invoice, issue it with the next number, print the tax invoice with HSN summary and UPI QR, record part payments, print receipts and send payment reminders on WhatsApp.',
      hi: 'कोटेशन को बिल बनाएं, अगले नंबर के साथ जारी करें, HSN सारांश और UPI QR वाला टैक्स इनवॉइस प्रिंट करें, आंशिक पेमेंट दर्ज करें, रसीद प्रिंट करें और WhatsApp पर पेमेंट याद दिलाएं।',
    },
    tags: ['GST invoice', 'tax invoice', 'payment receipt', 'UPI QR invoice'],
    intro: { en: 'Part nine. GST invoices and payments.', hi: 'भाग नौ। GST बिल और पेमेंट।' },
    setup: async (page) => {
      // Off camera: the quotation for Rahul Kumar that this lesson invoices.
      const { signUp } = await import('../engine.mjs');
      await signUp(page);
      await page.evaluate(() => { location.hash = '/m/leads'; });
      await page.locator('tbody tr.clickable', { hasText: 'Rahul Kumar' }).first().click();
      await page.getByRole('button', { name: 'New quotation' }).click();
      await page.locator('#f-systemKw').fill('3.27');
      for (const [i, p, q] of [[1, 'Solar Panel 545', '6'], [2, 'On-grid Inverter 3 kW', '1'], [3, 'Installation & Commissioning', '3']]) {
        await page.getByRole('button', { name: '+ Add line' }).click();
        const sel = page.locator(`.items-table [aria-label="Product for line ${i}"]`).first();
        const v = await sel.locator('option').evaluateAll((os, t) => (os.find((o) => o.textContent.includes(t)) || {}).value, p);
        await sel.selectOption(v);
        await page.getByLabel(`Quantity line ${i}`).first().fill(q);
      }
      await page.getByRole('button', { name: 'Save', exact: true }).first().click();
      await page.waitForURL(/#\/m\/quotations\/[0-9a-f-]{36}$/);
      await quiet(page);
    },
    scenes: [
      {
        ch: { en: 'From quotation to invoice', hi: 'कोटेशन से बिल' },
        en: 'On the quotation, tap Convert to invoice. The invoice is made with the same lines and the order is confirmed. It starts as a Draft, without a number.',
        hi: 'कोटेशन पर Convert to invoice दबाएं। वही लाइनों के साथ बिल बन जाता है और ऑर्डर पक्का हो जाता है। यह ड्राफ़्ट के रूप में शुरू होता है, बिना नंबर के।',
        act: async (h) => { await h.click(btn(h, 'Convert to invoice')); await h.page.waitForURL(/#\/m\/invoices\//); await h.page.getByRole('heading', { name: /^Draft invoice of/ }).waitFor(); await h.wait(1200); },
      },
      {
        en: 'A draft can still be changed. When you send it to the customer, tap Issue invoice. It gets the next number in the series, so cancelled drafts never leave gaps. After that, its lines and price are locked, as GST rules need.',
        hi: 'ड्राफ़्ट अभी बदला जा सकता है। कस्टमर को भेजते समय Issue invoice दबाएं। इसे सीरीज़ का अगला नंबर मिलता है, इसलिए रद्द ड्राफ़्ट से नंबर में गैप नहीं आता। उसके बाद GST नियमों के अनुसार इसकी लाइनें और कीमत लॉक हो जाती हैं।',
        act: async (h) => {
          await h.click(btn(h, 'Issue invoice'));
          await h.wait(1500);
          await h.click(dialog(h).getByRole('button', { name: 'Issue invoice' }));
          await h.page.getByText(/issued/).first().waitFor();
          await h.wait(1200);
        },
      },
      {
        ch: { en: 'The tax invoice', hi: 'टैक्स इनवॉइस' },
        en: 'Print it. The tax invoice has your GSTIN, the customer\'s, the place of supply with its state code, HSN codes, CGST and SGST or IGST, the HSN summary, amount in words and a UPI QR code for the balance.',
        hi: 'इसे प्रिंट करें। टैक्स इनवॉइस में आपका और कस्टमर का GSTIN, राज्य कोड के साथ प्लेस ऑफ़ सप्लाई, HSN कोड, CGST और SGST या IGST, HSN सारांश, शब्दों में राशि और बकाया के लिए UPI QR कोड होता है।',
        act: async (h) => { await h.click(link(h, 'Print / PDF')); await h.page.locator('.doc').waitFor(); await h.wait(900); await h.page.mouse.wheel(0, 600); await h.wait(1500); await h.top(); await h.click(link(h, '← Back')); },
      },
      {
        ch: { en: 'Record a payment', hi: 'पेमेंट दर्ज करें' },
        en: 'When money comes in, tap Record payment. The balance is filled in; change it for a part payment. Choose how it was paid, add the UTR or cheque number, and save.',
        hi: 'पैसा आने पर Record payment दबाएं। बकाया राशि भरी होती है; आंशिक पेमेंट के लिए बदलें। कैसे पेमेंट हुआ चुनें, UTR या चेक नंबर डालें, और Save करें।',
        act: async (h) => {
          await h.click(link(h, 'Record payment'));
          await h.page.locator('form[data-form="payments"]').waitFor();
          await h.type('#f-amount', '100000');
          await h.select('#f-mode', 'UPI');
          await h.type('#f-reference', 'UTR 4521 7788 1203');
          await save(h, 'payments');
        },
      },
      {
        en: 'The receipt is ready to print or send. The invoice now shows Partially Paid and the balance due. When everything is paid, it shows Paid.',
        hi: 'रसीद प्रिंट करने या भेजने के लिए तैयार है। बिल पर अब Partially Paid और बकाया राशि दिखती है। पूरा पेमेंट होने पर Paid दिखता है।',
        act: async (h) => { await h.click(link(h, 'Print / PDF')); await h.page.locator('.doc').waitFor(); await h.wait(1600); await h.click(link(h, '← Back')); },
      },
      {
        ch: { en: 'Payment reminders', hi: 'पेमेंट रिमाइंडर' },
        en: 'For an overdue invoice, the WhatsApp button suggests a polite payment reminder with the amount, the due date and your UPI ID. Overdue invoices also appear in alerts.',
        hi: 'देय तिथि निकल चुके बिल पर WhatsApp बटन राशि, देय तिथि और आपके UPI ID के साथ एक विनम्र रिमाइंडर सुझाता है। ऐसे बिल अलर्ट में भी दिखते हैं।',
        act: async (h) => {
          await h.go('/alerts', 'h1');
          await h.click(h.page.getByText(/Payment overdue/).first());
          await h.page.waitForURL(/#\/m\/invoices\//);
          await h.click(btn(h, 'WhatsApp'));
          await h.wait(2400);
          await h.click(dialog(h).getByRole('button', { name: 'Cancel' }));
        },
      },
    ],
  },
  {
    id: '10',
    title: { en: 'Projects and tasks', hi: 'प्रोजेक्ट और काम' },
    about: {
      en: 'Follow every installation job from planning to handover: the project board by stage, milestones and progress, tasks for the team on a board, and the project summary with cost and margin.',
      hi: 'हर इंस्टॉलेशन का काम योजना से हैंडओवर तक देखें: स्टेज के हिसाब से प्रोजेक्ट बोर्ड, माइलस्टोन और प्रगति, टीम के काम बोर्ड पर, और लागत व मार्जिन के साथ प्रोजेक्ट सारांश।',
    },
    tags: ['solar project management', 'task board'],
    intro: { en: 'Part ten. Projects and tasks.', hi: 'भाग दस। प्रोजेक्ट और काम।' },
    scenes: [
      {
        ch: { en: 'The project board', hi: 'प्रोजेक्ट बोर्ड' },
        en: 'Every confirmed order becomes a project. The Board shows them by stage: planning, design, material procurement, installation, testing, net metering and handover.',
        hi: 'हर पक्का ऑर्डर एक प्रोजेक्ट बनता है। बोर्ड उन्हें स्टेज के हिसाब से दिखाता है: प्लानिंग, डिज़ाइन, सामान ख़रीद, इंस्टॉलेशन, टेस्टिंग, नेट मीटरिंग और हैंडओवर।',
        act: async (h) => { await list(h, 'projects', '?view=board'); await h.page.locator('.board').waitFor(); await h.wait(1200); await h.page.locator('.board').evaluate((b) => b.scrollBy({ left: 600, behavior: 'smooth' })); await h.wait(1200); },
      },
      {
        en: 'Open a project to see the customer, capacity, manager, target date, budget, progress and milestones, with buttons to schedule the installation, add a task, send material or make an invoice.',
        hi: 'प्रोजेक्ट खोलें तो कस्टमर, क्षमता, मैनेजर, लक्ष्य तारीख़, बजट, प्रगति और माइलस्टोन दिखते हैं, और इंस्टॉलेशन तय करने, काम जोड़ने, सामान भेजने या बिल बनाने के बटन।',
        act: async (h) => { await list(h, 'projects'); await h.click(h.page.locator('tbody tr.clickable').first()); await h.page.locator('.detail-actions').waitFor(); await h.show('.detail-actions', 1400); await h.scrollTo(h.page.getByText('Milestones').first()); await h.wait(900); await h.top(); },
      },
      {
        ch: { en: 'Milestones and progress', hi: 'माइलस्टोन और प्रगति' },
        en: 'Edit the project as work moves: tick the milestones done, update the stage and the progress percentage, and save.',
        hi: 'काम आगे बढ़ने पर प्रोजेक्ट Edit करें: पूरे हुए माइलस्टोन पर टिक करें, स्टेज और प्रगति प्रतिशत बदलें, और Save करें।',
        act: async (h) => {
          await h.click(link(h, 'Edit'));
          await h.page.locator('form[data-form="projects"]').waitFor();
          await h.scrollTo('#f-progress');
          await h.type('#f-progress', '60');
          await save(h, 'projects');
        },
      },
      {
        ch: { en: 'Tasks for the team', hi: 'टीम के काम' },
        en: 'Tap Add task for anything someone must do: order the structure, get the design approved, book the net meter. Give it a priority, a person and a due date.',
        hi: 'जो भी किसी को करना है उसके लिए Add task दबाएं: स्ट्रक्चर ऑर्डर करना, डिज़ाइन पास कराना, नेट मीटर बुक करना। प्राथमिकता, व्यक्ति और तारीख़ दें।',
        act: async (h) => {
          await h.click(link(h, 'Add task'));
          await h.page.locator('form[data-form="tasks"]').waitFor();
          await h.type('#f-title', 'Book net meter inspection');
          await h.select('#f-priority', 'High');
          await save(h, 'tasks');
        },
      },
      {
        en: 'The task board shows everyone\'s work as To do, In progress and Done. Move a card when the work is finished.',
        hi: 'टास्क बोर्ड पर सबका काम To do, In progress और Done में दिखता है। काम पूरा होने पर कार्ड आगे बढ़ाएं।',
        act: async (h) => { await list(h, 'tasks', '?view=board'); await h.page.locator('.board').waitFor(); await h.select(h.page.getByLabel('Move Book net meter inspection').first(), 'Done'); await h.wait(1200); },
      },
    ],
  },
];
