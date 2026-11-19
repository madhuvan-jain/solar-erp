// WhatsApp messages: whom to message for a record, the number WhatsApp needs, and the text — from templates the
// admin can change (Settings → WhatsApp), in English or Hindi. Nothing is sent by the app itself: it opens WhatsApp
// (app or web) with the chat and the message ready, and the person sends it.
import type { Rec } from './schema';
import type { Store } from './store/store';
import { formatDate, todayIso } from './format';
import { money } from './money';
import { formatMobile, toMobile } from './validate';

/** The number as WhatsApp's links need it (country code, digits only), or null when it cannot be a WhatsApp number. */
export function waNumber(phone: unknown): string | null {
  const s = String(phone ?? '').trim();
  if (!s) return null;
  // Written with a country code (+…, 00…): India goes through the mobile check, other countries are kept as they are.
  if (/^(\+|00)/.test(s)) {
    const d = s.replace(/\D/g, '').replace(/^00/, '');
    if (d.startsWith('91')) { const m = toMobile(d.slice(2)); return m ? m.slice(1) : null; }
    return /^[1-9]\d{7,14}$/.test(d) ? d : null; // a country code never starts with 0
  }
  // Otherwise an Indian number: only mobiles (6–9…) have WhatsApp; landlines ("0612 2345678") do not.
  const m = toMobile(s);
  return m ? m.slice(1) : null;
}

/** "+91 98765 43210" for showing; other countries as +digits. */
export function waDisplay(num: string): string {
  return num.startsWith('91') && num.length === 12 ? formatMobile('+' + num) : '+' + num;
}

/** https://wa.me/… opens the chat in the WhatsApp app on phones (and the Android app) and WhatsApp Web on computers. */
export function waLink(phone: unknown, text = ''): string | null {
  const n = waNumber(phone);
  return n ? `https://wa.me/${n}${text ? '?text=' + encodeURIComponent(text) : ''}` : null;
}

export interface WaTemplate { key: string; label: string; en: string; hi: string }

/** Placeholders: {name} {company} {me} {number} {date} {amount} {balance} {dueDate} {system} {subject} {technician} {endDate} {vehicle} {po} {reference} {upi} {doc} */
export const WA_TEMPLATES: WaTemplate[] = [
  { key: 'greeting', label: 'Greeting (customers, vendors, staff)',
    en: 'Hello {name}, this is {me} from {company}.',
    hi: 'नमस्ते {name} जी, {company} की ओर से {me}।' },
  { key: 'lead', label: 'New enquiry (lead)',
    en: 'Hello {name}, thank you for your interest in solar. This is {me} from {company}. When can we visit your roof for a free site survey?',
    hi: 'नमस्ते {name} जी, सोलर में रुचि के लिए धन्यवाद। {company} से {me}। आपकी छत का मुफ़्त सर्वे कब करवा सकते हैं?' },
  { key: 'survey', label: 'Site survey visit',
    en: 'Dear {name}, our team will visit your site for the solar survey on {date}. — {company}',
    hi: 'नमस्ते {name} जी, हमारी टीम {date} को आपकी छत का सोलर सर्वे करने आएगी। — {company}' },
  { key: 'quotation', label: 'Quotation',
    en: 'Dear {name}, please find our quotation {number} for {system}: {amount}. — {company}',
    hi: 'नमस्ते {name} जी, {system} के लिए हमारा कोटेशन {number}: {amount}। — {company}' },
  { key: 'invoice', label: 'Invoice',
    en: 'Dear {name}, invoice {number} dated {date} for {amount} from {company}. Balance due {balance} by {dueDate}. {upi}',
    hi: 'नमस्ते {name} जी, {company} का बिल {number} ({date}) {amount} का है। बकाया {balance}, {dueDate} तक। {upi}' },
  { key: 'invoicePaid', label: 'Invoice (fully paid)',
    en: 'Dear {name}, invoice {number} dated {date} for {amount} from {company}. Fully paid — thank you!',
    hi: 'नमस्ते {name} जी, बिल {number} ({date}) {amount} का पूरा भुगतान मिल गया है — धन्यवाद! — {company}' },
  { key: 'reminder', label: 'Payment reminder (overdue invoice)',
    en: 'Dear {name}, a gentle reminder: {balance} is due on invoice {number} since {dueDate}. {upi}— {company}',
    hi: 'नमस्ते {name} जी, विनम्र अनुस्मारक: बिल {number} पर {balance} बकाया है ({dueDate} से)। {upi}— {company}' },
  { key: 'receipt', label: 'Payment receipt',
    en: 'Dear {name}, we have received {amount} (receipt {number}). Thank you! — {company}',
    hi: 'नमस्ते {name} जी, हमें {amount} प्राप्त हुए (रसीद {number})। धन्यवाद! — {company}' },
  { key: 'statement', label: 'Customer balance (statement)',
    en: 'Dear {name}, your outstanding balance with {company} is {balance}. {upi}',
    hi: 'नमस्ते {name} जी, {company} के साथ आपका बकाया {balance} है। {upi}' },
  { key: 'dispatch', label: 'Material dispatched (challan)',
    en: 'Dear {name}, material for your solar system has been dispatched: challan {number}, vehicle {vehicle}. — {company}',
    hi: 'नमस्ते {name} जी, आपके सोलर सिस्टम का सामान भेज दिया गया है: चालान {number}, गाड़ी {vehicle}। — {company}' },
  { key: 'installation', label: 'Installation visit',
    en: 'Dear {name}, your solar installation is scheduled on {date}. Our technician {technician} will call before coming. — {company}',
    hi: 'नमस्ते {name} जी, आपका सोलर इंस्टॉलेशन {date} को है। आने से पहले टेक्नीशियन {technician} कॉल करेंगे। — {company}' },
  { key: 'ticket', label: 'Service request',
    en: 'Dear {name}, we have registered your service request {number}: {subject}. We will attend to it soon. — {company}',
    hi: 'नमस्ते {name} जी, आपकी सर्विस शिकायत {number} ({subject}) दर्ज कर ली गई है। हम जल्द ठीक करेंगे। — {company}' },
  { key: 'amc', label: 'AMC renewal',
    en: 'Dear {name}, your AMC {number} is valid till {endDate}. Reply to renew it. — {company}',
    hi: 'नमस्ते {name} जी, आपका AMC {number} {endDate} तक मान्य है। नवीनीकरण के लिए जवाब दें। — {company}' },
  { key: 'purchaseOrder', label: 'Purchase order (to the vendor)',
    en: 'Hello {name}, purchase order {number} dated {date} for {amount} from {company}. Please confirm the delivery date.',
    hi: 'नमस्ते {name} जी, {company} की ओर से परचेज़ ऑर्डर {number} ({date}) {amount} का। कृपया डिलीवरी की तारीख़ बताएं।' },
  { key: 'supplierPayment', label: 'Payment to a vendor',
    en: 'Hello {name}, we have paid {amount} against purchase order {po} (reference {reference}). — {company}',
    hi: 'नमस्ते {name} जी, हमने परचेज़ ऑर्डर {po} के लिए {amount} का भुगतान किया है (रेफ़रेंस {reference})। — {company}' },
  { key: 'document', label: 'Any other document',
    en: 'Dear {name}, {doc} {number} from {company}.',
    hi: 'नमस्ते {name} जी, {company} की ओर से {doc} {number}।' },
];

const hasHindi = (t: string) => /[ऀ-ॿ]/.test(t);

/** Fills the placeholders; empty ones are dropped and the spacing and punctuation around them tidied. */
export function fillTemplate(template: string, vars: Record<string, string>): string {
  const out = template.replace(/\{(\w+)\}/g, (_, k: string) => String(vars[k] ?? '').trim());
  return out
    .replace(/\(\s*\)/g, '')            // "()" left by an empty value
    .replace(/[ \t]+([.,;:!?।)])/g, '$1') // no space before punctuation
    .replace(/\s{2,}/g, ' ')
    .replace(/\s+—\s*$/g, '')            // a trailing "— " with no company
    .trim();
}

export interface WaMessage { to: Rec; name: string; number: string; template: string; text: string }

const DOC_NAMES: Record<string, string> = { surveys: 'site survey', projects: 'project', installations: 'installation certificate', loans: 'loan', subsidies: 'subsidy application', documents: 'document' };

/** Whom a record's WhatsApp message goes to, which template fits it now, and the message. Null: no WhatsApp number. */
export function waMessage(store: Store, entity: string, rec: Rec, today = todayIso()): WaMessage | null {
  const get = (e: string, id: unknown) => (id ? store.get(e, id) : undefined);
  const customerOf = (r: Rec | undefined): Rec | undefined => r && (get('customers', r.customerId) || customerOf(get('projects', r.projectId)));
  let to: Rec | undefined;
  if (['leads', 'customers', 'vendors', 'employees'].includes(entity)) to = rec;
  else if (entity === 'purchaseOrders' || entity === 'supplierPayments') to = get('vendors', rec.vendorId) || get('vendors', get('purchaseOrders', rec.purchaseOrderId)?.vendorId);
  else if (entity === 'surveys') to = get('leads', rec.leadId);
  else if (entity === 'payments') to = customerOf(get('invoices', rec.invoiceId));
  else if (entity === 'installations') to = customerOf(get('projects', rec.projectId));
  else to = customerOf(rec);
  if (!to) return null;
  const number = waNumber(to.whatsapp) || waNumber(to.phone);
  if (!number) return null;

  const s = store.settings();
  let key = 'document';
  const v: Record<string, string> = {
    name: String(to.name || '').trim(), company: s.companyName || '', me: store.user?.name || '',
    number: String(rec.number || ''), date: '', amount: '', balance: '', dueDate: '', system: '', subject: String(rec.subject || ''),
    technician: rec.technician ? store.userName(rec.technician) : '', endDate: rec.endDate ? formatDate(rec.endDate) : '',
    vehicle: String(rec.vehicleNo || ''), reference: String(rec.reference || ''), upi: '', doc: DOC_NAMES[entity] || 'document',
  };
  const upi = s.upiId ? `UPI: ${s.upiId}.` : '';
  if (entity === 'leads') key = 'lead';
  else if (entity === 'customers') {
    const bal = store.balanceOf(rec.id);
    if (bal > 0.005) { key = 'statement'; v.balance = money(bal); v.upi = upi; } else key = 'greeting';
  } else if (entity === 'vendors' || entity === 'employees') key = 'greeting';
  else if (entity === 'quotations') { key = 'quotation'; v.date = formatDate(rec.date); v.amount = money(store.computed('quotations', rec).grandTotal); }
  else if (entity === 'invoices') {
    const c = store.computed('invoices', rec);
    v.date = formatDate(rec.date); v.amount = money(c.grandTotal); v.balance = money(c.balance); v.dueDate = rec.dueDate ? formatDate(rec.dueDate) : '';
    if (rec.status !== 'Cancelled' && rec.number && c.balance <= 0.005) key = 'invoicePaid';
    else if (rec.number && rec.dueDate && String(rec.dueDate) < today && c.balance > 0.005) { key = 'reminder'; v.upi = upi; }
    else { key = 'invoice'; v.upi = c.balance > 0.005 ? upi : ''; }
  } else if (entity === 'payments') { key = 'receipt'; v.amount = money(rec.amount); }
  else if (entity === 'surveys') { key = 'survey'; v.date = formatDate(rec.surveyDate); }
  else if (entity === 'installations') { key = 'installation'; v.date = formatDate(rec.scheduledDate); }
  else if (entity === 'tickets') key = 'ticket';
  else if (entity === 'amcs') key = 'amc';
  else if (entity === 'dispatches') key = 'dispatch';
  else if (entity === 'purchaseOrders') { key = 'purchaseOrder'; v.date = formatDate(rec.date); v.amount = money(store.computed('purchaseOrders', rec).grandTotal); }
  else if (entity === 'supplierPayments') { key = 'supplierPayment'; v.amount = money(rec.amount); v.po = String(get('purchaseOrders', rec.purchaseOrderId)?.number || ''); }
  if (v.date === '—') v.date = '';
  const template = waTemplate(store, key);
  const kw = Number(rec.systemKw) || 0;
  v.system = hasHindi(template) ? (kw ? `${kw} kW सोलर सिस्टम` : 'सोलर सिस्टम') : (kw ? `a ${kw} kW solar system` : 'your solar system');
  return { to, name: v.name, number, template: key, text: fillTemplate(template, v) };
}

/** The business's own wording for a template, else the default (English). */
export function waTemplate(store: Store, key: string): string {
  const own = (store.settings().waTemplates || {})[key];
  return own && own.trim() ? own : WA_TEMPLATES.find((t) => t.key === key)?.en || '';
}
