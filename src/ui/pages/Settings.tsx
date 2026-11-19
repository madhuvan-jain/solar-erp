import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useStore, type AppUser, type CompanySettings, type DataMap, type Role } from '../../lib/store';
import { ALERT_TYPES, alertPrefs, saveAlertPrefs, type AlertPrefs } from '../../lib/alerts';
import { accessOverrides, canRead, isAdmin, LEVEL_LABELS, LEVELS, levelOf, OWN_APPS, ROLE_LABELS, type Level } from '../../lib/rbac';
import { formatMobile, isValidEmail, isValidGstin, isValidPan, toMobile } from '../../lib/validate';
import { MobileForm } from './Auth';
import { buildBackup, dataUrlToBlob, openBackup } from '../../lib/backupFile';
import { downloadBytes } from '../../lib/exporters';
import { startBusy } from '../busy';
import { markDirty } from '../unsaved';
import { todayIso, uid } from '../../lib/format';
import { errorText, useDialogFocus, useFeedback } from '../components/feedback';
import { STATES } from '../../lib/states';
import { ENTITIES, MODULES } from '../../modules/registry';
import { ACTIVITY, SETTINGS, type FileRef } from '../../lib/store';
import { Link, useSearchParams } from 'react-router-dom';
import { isValidUpiId } from './PrintDoc';
import { FileLink } from '../components/FieldValue';
import { forgetAccount } from '../../lib/accounts';
import { layoutChoice, setLayoutChoice, type LayoutChoice } from '../useMedia';
import { APP_VERSION, DATA_FORMAT, migrate, REASON_LABEL, storageProtected, type SafetyCopyInfo } from '../../lib/store/safety';
import { countersBeforeDemo, dataBeforeDemo, DEMO_EVENT, demoState, keepBeforeDemo, prepareDemo, setDemoState, type DemoFile } from '../../lib/demo';
import type { Store } from '../../lib/store/store';
import { WA_TEMPLATES, waNumber } from '../../lib/whatsapp';
import { CompanyCodeCard, EnquiryLinkCard, SubscriptionCard } from './Subscription';
import { remapStaff, restoreStaff, staffForBackup, staffFromBackup, staffIdMap } from '../../lib/staff';

type Tab = 'general' | 'sales' | 'accounts' | 'purchase' | 'print' | 'whatsapp' | 'users' | 'plan' | 'alerts' | 'account' | 'data';

/** Settings in tabs, one subject per tab (like an ERP's settings screen). The tab is part of the address. */
export function Settings() {
  const store = useStore();
  const admin = isAdmin(store.user!.role);
  const [params, setParams] = useSearchParams();
  const tabs: { key: Tab; label: string; admin?: boolean }[] = [
    { key: 'general', label: 'General', admin: true },
    { key: 'sales', label: 'Sales', admin: true },
    { key: 'accounts', label: 'Accounts', admin: true },
    { key: 'purchase', label: 'Purchase & stock', admin: true },
    { key: 'print', label: 'Documents & print', admin: true },
    { key: 'whatsapp', label: 'WhatsApp', admin: true },
    { key: 'users', label: 'Users & access', admin: true },
    ...(store.business ? [{ key: 'plan' as const, label: 'Subscription', admin: true }] : []),
    { key: 'alerts', label: 'Alerts' },
    { key: 'account', label: 'My account' },
    { key: 'data', label: 'Backup & data', admin: true },
  ];
  const mine = tabs.filter((t) => !t.admin || admin);
  // The admin starts on the company; everyone else on their own account.
  const first: Tab = admin ? 'general' : 'account';
  const tab = mine.find((t) => t.key === params.get('tab'))?.key || first;
  // On a phone the tabs are one sideways-scrolling row: keep the open tab in view.
  const strip = useRef<HTMLElement>(null);
  useEffect(() => {
    const on = strip.current?.querySelector<HTMLElement>('[aria-selected="true"]');
    if (on && strip.current && strip.current.scrollWidth > strip.current.clientWidth) {
      const box = strip.current.getBoundingClientRect(), r = on.getBoundingClientRect();
      strip.current.scrollLeft += r.left - box.left - (box.width - r.width) / 2;
    }
  }, [tab]);
  return (
    <>
      <div className="page-head"><h1>Settings</h1><div className="spacer" />
        <span className="mode-pill">{store.mode === 'cloud' ? '☁ Cloud mode — shared database' : '💾 Device mode — data stays on this device'}</span>
      </div>
      <div className="settings-layout">
        <nav ref={strip} className="settings-tabs" role="tablist" aria-label="Settings sections">
          {mine.map((t) => (
            <button key={t.key} type="button" role="tab" id={`tab-${t.key}`} aria-selected={tab === t.key} aria-controls={`panel-${t.key}`}
              className={tab === t.key ? 'on' : ''} onClick={() => setParams(t.key === first ? {} : { tab: t.key }, { replace: true })}>{t.label}</button>
          ))}
        </nav>
        <div className="grid settings-panel" role="tabpanel" id={`panel-${tab}`} aria-labelledby={`tab-${tab}`}>
          {tab === 'general' && <><CompanyCard />{store.business && <EnquiryLinkCard />}</>}
          {tab === 'sales' && <SalesCard />}
          {tab === 'accounts' && <AccountsCard />}
          {tab === 'purchase' && <PurchaseCard />}
          {tab === 'print' && <><PrintCard /><PhotoCard /></>}
          {tab === 'whatsapp' && <WhatsAppCard />}
          {tab === 'users' && <>{store.business && <CompanyCodeCard />}<UsersCard /></>}
          {tab === 'plan' && <SubscriptionCard />}
          {tab === 'alerts' && <AlertsCard />}
          {tab === 'account' && <><MobileCard /><PasswordCard /><ThemeCard /><DeleteAccountCard /></>}
          {tab === 'data' && <><BackupCard /><SafetyCard />{store.mode === 'local' && <DemoDataCard />}</>}
        </div>
      </div>
    </>
  );
}

/** A card of company settings that saves only its own keys, so cards never overwrite each other. */
function SettingsForm({ title, intro, keys, saveLabel, children, check }: {
  title: string; intro?: string; keys: (keyof CompanySettings)[]; saveLabel: string;
  children: (v: CompanySettings, set: <K extends keyof CompanySettings>(k: K, val: CompanySettings[K]) => void) => ReactNode;
  check?: (v: CompanySettings) => string | null;
}) {
  const store = useStore();
  const { toast } = useFeedback();
  const [v, setV] = useState<CompanySettings>(store.settings());
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);
  // Typed but not saved yet: an automatic app update waits, and sign-out warns.
  useEffect(() => markDirty(dirty), [dirty]);
  const set = <K extends keyof CompanySettings>(k: K, val: CompanySettings[K]) => { setV((x) => ({ ...x, [k]: val })); setDirty(true); };
  const save = async () => {
    const problem = check?.(v);
    if (problem) return toast(problem, true);
    setSaving(true);
    try { await store.saveSettings(Object.fromEntries(keys.map((k) => [k, v[k]]))); setDirty(false); toast('Settings saved'); }
    catch (e) { toast(errorText(e), true); } finally { setSaving(false); }
  };
  return (
    <div className="card">
      <h2>{title}</h2>
      {intro && <p className="muted small">{intro}</p>}
      {children(v, set)}
      <div className="btn-row" style={{ marginTop: 14 }}><button className="btn primary" onClick={save} disabled={saving}>{saving ? 'Saving…' : saveLabel}</button></div>
    </div>
  );
}

const clampInt = (s: string, lo: number, hi: number) => (s === '' ? lo : Math.max(lo, Math.min(hi, Math.floor(Number(s) || 0))));

function SalesCard() {
  const store = useStore();
  const people = store.users.filter((u) => u.active && u.role !== 'pending');
  return (
    <SettingsForm title="Sales" saveLabel="Save sales settings"
      keys={['autoAssignLeads', 'autoCreateCustomer', 'defaultSurveyor', 'quoteValidDays', 'quoteTerms', 'showSavingsOnQuote', 'unitsPerKwPerDay', 'tariffPerUnit', 'showBankOnQuote']}
      check={(v) => (v.showSavingsOnQuote && !(Number(v.unitsPerKwPerDay) > 0) ? 'Enter the units generated per kW per day (about 4 in most of India), or switch off the estimate on quotations.'
        : v.showSavingsOnQuote && !(Number(v.tariffPerUnit) > 0) ? 'Enter the electricity tariff per unit, or switch off the estimate on quotations.'
        : !(Number(v.unitsPerKwPerDay) >= 0 && Number(v.unitsPerKwPerDay) <= 10) ? 'Units per kW per day must be between 0 and 10.'
        : !(Number(v.tariffPerUnit) >= 0 && Number(v.tariffPerUnit) <= 100) ? 'Tariff must be between 0 and 100 rupees per unit.' : null)}>
      {(v, set) => <>
        <h3 className="settings-sub">CRM — leads</h3>
        <div className="form-grid">
          <label className="check"><input type="checkbox" checked={v.autoAssignLeads} onChange={(e) => set('autoAssignLeads', e.target.checked)} /> Share new leads out: give each to the sales user with the fewest open leads</label>
          <label className="check"><input type="checkbox" checked={v.autoCreateCustomer} onChange={(e) => set('autoCreateCustomer', e.target.checked)} /> Create the customer automatically when a lead is marked Won</label>
        </div>
        <h3 className="settings-sub">Site surveys</h3>
        <div className="form-grid">
          <div className="field"><label htmlFor="s-surveyor">Default surveyor</label>
            <select id="s-surveyor" className="input" value={v.defaultSurveyor} onChange={(e) => set('defaultSurveyor', e.target.value)}>
              <option value="">— Whoever books it chooses —</option>
              {people.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
            </select>
            <span className="help">Filled in on new surveys; can be changed on each one.</span>
          </div>
        </div>
        <h3 className="settings-sub">Quotations</h3>
        <div className="form-grid">
          <div className="field"><label htmlFor="s-valid">Quotation valid for (days)</label>
            <input id="s-valid" className="input" type="number" min={0} max={365} value={v.quoteValidDays} onChange={(e) => set('quoteValidDays', clampInt(e.target.value, 0, 365))} />
            <span className="help">Sets “Valid till” on new quotations. 0 = leave it empty.</span></div>
          <label className="check"><input type="checkbox" checked={v.showBankOnQuote} onChange={(e) => set('showBankOnQuote', e.target.checked)} /> Show bank details on quotations</label>
          <label className="check"><input type="checkbox" checked={v.showSavingsOnQuote} onChange={(e) => set('showSavingsOnQuote', e.target.checked)} /> Show estimated generation, savings and payback on quotations</label>
          <div className="field"><label htmlFor="p-units">Units generated per kW per day</label>
            <input id="p-units" className="input" type="number" step="0.1" min={0} max={10} value={v.unitsPerKwPerDay} onChange={(e) => set('unitsPerKwPerDay', (e.target.value === '' ? '' : Number(e.target.value)) as number)} /></div>
          <div className="field"><label htmlFor="p-tariff">Electricity tariff (₹ per unit)</label>
            <input id="p-tariff" className="input" type="number" step="0.1" min={0} max={100} value={v.tariffPerUnit} onChange={(e) => set('tariffPerUnit', (e.target.value === '' ? '' : Number(e.target.value)) as number)} /></div>
          <div className="field wide"><label htmlFor="s-quoteTerms">Default quotation terms</label>
            <textarea id="s-quoteTerms" className="input" value={v.quoteTerms} onChange={(e) => set('quoteTerms', e.target.value)} /></div>
        </div>
      </>}
    </SettingsForm>
  );
}

function AccountsCard() {
  return (
    <SettingsForm title="Accounts — invoices and payments" saveLabel="Save accounts settings" keys={['paymentTermsDays', 'invoiceTerms', 'declaration']}>
      {(v, set) => (
        <div className="form-grid">
          <div className="field"><label htmlFor="s-terms">Payment terms (days) — sets the invoice due date</label>
            <input id="s-terms" className="input" type="number" min={0} max={365} value={v.paymentTermsDays} onChange={(e) => set('paymentTermsDays', clampInt(e.target.value, 0, 365))} /></div>
          <div className="field wide"><label htmlFor="s-invoiceTerms">Default invoice terms</label>
            <textarea id="s-invoiceTerms" className="input" value={v.invoiceTerms} onChange={(e) => set('invoiceTerms', e.target.value)} /></div>
          <div className="field wide"><label htmlFor="p-declaration">Invoice declaration</label>
            <textarea id="p-declaration" className="input" value={v.declaration} onChange={(e) => set('declaration', e.target.value)} /></div>
          <p className="muted small wide">Bank details are under General; the UPI pay-by-QR code under Documents &amp; print.</p>
        </div>
      )}
    </SettingsForm>
  );
}

function PurchaseCard() {
  const store = useStore();
  return (
    <SettingsForm title="Purchase & stock" saveLabel="Save purchase settings" keys={['poTerms', 'challanTerms', 'defaultWarehouse']}>
      {(v, set) => (
        <div className="form-grid">
          <div className="field"><label htmlFor="p-defaultWarehouse">Receive goods into</label>
            <select id="p-defaultWarehouse" className="input" value={v.defaultWarehouse || ''} onChange={(e) => set('defaultWarehouse', e.target.value)}>
              <option value="">— No particular warehouse —</option>
              {store.all('warehouses').map((w) => <option key={w.id} value={w.id}>{String(w.name)}</option>)}
            </select>
            <span className="help">Used when a purchase order does not name a warehouse.</span></div>
          <div className="field wide"><label htmlFor="p-poTerms">Purchase order terms</label>
            <textarea id="p-poTerms" className="input" value={v.poTerms} onChange={(e) => set('poTerms', e.target.value)} /></div>
          <div className="field wide"><label htmlFor="p-challanTerms">Delivery challan note</label>
            <textarea id="p-challanTerms" className="input" value={v.challanTerms} onChange={(e) => set('challanTerms', e.target.value)} /></div>
        </div>
      )}
    </SettingsForm>
  );
}

/** Off by default (every alert). Turned on, the person picks the kinds they want; saved for them on this device. */
function AlertsCard() {
  const store = useStore();
  const { toast } = useFeedback();
  const uid0 = store.user!.id;
  const [p, setP] = useState<AlertPrefs>(() => alertPrefs(uid0));
  const kinds = ALERT_TYPES.filter((t) => canRead(store.user, t.module));
  const save = (next: AlertPrefs) => { setP(next); saveAlertPrefs(uid0, next); };
  return (
    <div className="card">
      <h2>Alerts</h2>
      <p className="muted small">Alerts show on the bell, the home screen, the dashboard and the Alerts page. By default you get every kind your access allows.</p>
      <label className="switch-row">
        <input type="checkbox" role="switch" checked={p.custom} aria-describedby="al-help"
          onChange={(e) => { save({ ...p, custom: e.target.checked }); toast(e.target.checked ? 'Choose the alerts you want below' : 'You get every alert again'); }} />
        <span><strong>Choose which alerts I get</strong><span id="al-help" className="muted small">{p.custom ? ' — on: only the kinds ticked below' : ' — off: you get every alert'}</span></span>
      </label>
      {p.custom && (
        <fieldset className="alert-kinds">
          <legend>Show me</legend>
          {kinds.map((t) => (
            <label key={t.key} className="check">
              <input type="checkbox" checked={p.on.includes(t.key)} onChange={(e) => save({ ...p, on: e.target.checked ? [...p.on, t.key] : p.on.filter((k) => k !== t.key) })} /> {t.label}
            </label>
          ))}
          <div className="btn-row">
            <button type="button" className="btn sm" onClick={() => save({ ...p, on: ALERT_TYPES.map((t) => t.key) })}>Tick all</button>
            <button type="button" className="btn sm" onClick={() => save({ ...p, on: [] })}>Untick all</button>
          </div>
        </fieldset>
      )}
    </div>
  );
}

function CompanyCard() {
  const store = useStore();
  const { toast } = useFeedback();
  const [v, setV] = useState<CompanySettings>(store.settings());
  const [saving, setSaving] = useState(false);
  const set = (k: keyof CompanySettings, val: unknown) => setV((s) => ({ ...s, [k]: val }));
  const text = (k: keyof CompanySettings, label: string, opts: { area?: boolean; upper?: boolean } = {}) => (
    <div className={'field' + (opts.area ? ' wide' : '')}>
      <label htmlFor={'s-' + k}>{label}</label>
      {opts.area
        ? <textarea id={'s-' + k} className="input" value={String(v[k] ?? '')} onChange={(e) => set(k, e.target.value)} />
        : <input id={'s-' + k} className="input" value={String(v[k] ?? '')} onChange={(e) => set(k, opts.upper ? e.target.value.toUpperCase() : e.target.value)} />}
    </div>
  );
  const save = async () => {
    if (v.gstin && !isValidGstin(v.gstin)) return toast('GSTIN looks wrong — it must be 15 characters.', true);
    if (v.pan && !isValidPan(v.pan)) return toast('PAN looks wrong — e.g. ABCDE1234F.', true);
    if (v.email && !isValidEmail(v.email)) return toast('Company email looks wrong.', true);
    setSaving(true);
    // Only this card's fields, so it never overwrites print settings saved from the other card.
    const keys: (keyof CompanySettings)[] = ['companyName', 'gstin', 'pan', 'state', 'address', 'phone', 'email', 'website', 'bankName', 'accountNo', 'ifsc'];
    try { await store.saveSettings(Object.fromEntries(keys.map((k) => [k, v[k]]))); toast('Settings saved'); } catch (e) { toast(errorText(e), true); } finally { setSaving(false); }
  };
  return (
    <div className="card">
      <h2>Company profile</h2>
      <p className="muted small">Printed on quotations, invoices and receipts. “State” decides CGST+SGST vs IGST.</p>
      <div className="form-grid">
        {text('companyName', 'Company name')}
        {text('gstin', 'GSTIN', { upper: true })}
        {text('pan', 'PAN', { upper: true })}
        <div className="field"><label htmlFor="s-state">State (decides CGST+SGST or IGST)</label>
          <select id="s-state" className="input" value={v.state} onChange={(e) => set('state', e.target.value)}>
            <option value="">— Select —</option>
            {STATES.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
        </div>
        {text('phone', 'Phone')}
        {text('email', 'Email')}
        {text('website', 'Website')}
        {text('bankName', 'Bank name')}
        {text('accountNo', 'Account number')}
        {text('ifsc', 'IFSC', { upper: true })}
        {text('address', 'Address', { area: true })}
      </div>
      <div className="btn-row" style={{ marginTop: 14 }}><button className="btn primary" onClick={save} disabled={saving}>{saving ? 'Saving…' : 'Save company profile'}</button></div>
    </div>
  );
}

const TEMPLATES: { key: CompanySettings['printTemplate']; label: string }[] = [
  { key: 'classic', label: 'Classic — accent line under the header' },
  { key: 'modern', label: 'Modern — coloured header band' },
  { key: 'compact', label: 'Compact — smaller text, fits more per page' },
];

function ImagePicker({ id, label, value, onChange }: { id: string; label: string; value: FileRef | null; onChange: (v: FileRef | null) => void }) {
  const store = useStore();
  const { toast } = useFeedback();
  const [busy, setBusy] = useState(false);
  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
        {value && <FileLink file={value} />}
        {value && <button type="button" className="btn sm danger" onClick={() => onChange(null)}>Remove</button>}
        <input id={id} type="file" accept="image/png,image/jpeg,image/webp" disabled={busy} onChange={async (e) => {
          const f = e.target.files?.[0];
          e.target.value = '';
          if (!f) return;
          if (!/^image\/(png|jpeg|webp)$/.test(f.type)) return toast('Choose a PNG, JPG or WebP image.', true);
          if (f.size > 1024 * 1024) return toast('Images for documents must be under 1 MB.', true);
          setBusy(true);
          try { onChange(await store.backend.uploadFile(f)); } catch (x) { toast(errorText(x), true); } finally { setBusy(false); }
        }} />
        {busy && <span className="muted small">Uploading…</span>}
      </div>
    </div>
  );
}

/** What the app's camera prints on site photos. */
/** The business WhatsApp number and the wording of every message (English or Hindi, or the business's own). */
function WhatsAppCard() {
  const own = (v: CompanySettings, key: string) => (v.waTemplates || {})[key];
  return (
    <SettingsForm title="WhatsApp" saveLabel="Save WhatsApp settings" keys={['whatsapp', 'waTemplates']}
      intro="The WhatsApp button on customers, leads, quotations, invoices, receipts, challans, tickets and orders opens WhatsApp with one of these messages, ready to check and send. Nothing is sent without you."
      check={(v) => (v.whatsapp && !waNumber(v.whatsapp) ? 'The business WhatsApp number must be a mobile number (or include its country code, like +971…).' : null)}>
      {(v, set) => (<>
        <div className="form-grid">
          <div className="field"><label htmlFor="w-number">Business WhatsApp number</label>
            <input id="w-number" className="input" inputMode="tel" placeholder="98765 43210" value={v.whatsapp || ''} onChange={(e) => set('whatsapp', e.target.value)} />
            <span className="help">Printed on quotations and invoices so customers can message you. Leave empty if it is the same as your phone.</span></div>
        </div>
        <h3 className="settings-sub">Messages</h3>
        <p className="muted small">Fill-ins: {'{name}'} {'{company}'} {'{me}'} {'{number}'} {'{date}'} {'{amount}'} {'{balance}'} {'{dueDate}'} {'{system}'} {'{subject}'} {'{technician}'} {'{endDate}'} {'{vehicle}'} {'{po}'} {'{reference}'} {'{upi}'}. One that is empty for a record is left out.</p>
        <div className="btn-row" style={{ marginBottom: 10 }}>
          <button type="button" className="btn sm" onClick={() => set('waTemplates', Object.fromEntries(WA_TEMPLATES.map((t) => [t.key, t.hi])))}>Use Hindi messages</button>
          <button type="button" className="btn sm" onClick={() => set('waTemplates', {})}>Use English messages</button>
        </div>
        <div className="form-grid">
          {WA_TEMPLATES.map((t) => (
            <div key={t.key} className="field wide">
              <label htmlFor={`w-${t.key}`}>{t.label}</label>
              <textarea id={`w-${t.key}`} className="input" rows={2} value={own(v, t.key) ?? t.en}
                onChange={(e) => set('waTemplates', { ...(v.waTemplates || {}), [t.key]: e.target.value })} />
              {own(v, t.key) !== undefined && own(v, t.key) !== t.en && (
                <button type="button" className="btn ghost sm" style={{ alignSelf: 'flex-start' }} onClick={() => {
                  const next = { ...(v.waTemplates || {}) }; delete next[t.key]; set('waTemplates', next);
                }}>Back to the standard wording</button>
              )}
            </div>
          ))}
        </div>
      </>)}
    </SettingsForm>
  );
}

function PhotoCard() {
  return (
    <SettingsForm title="Site photos (camera)" saveLabel="Save photo settings" keys={['photoQrUrl', 'photoNote']}
      intro="Photos taken with the app’s camera are stamped with a map, the place, Plus Code, coordinates, date and time, a note and a QR code."
      check={(v) => (v.photoQrUrl && !/^https:\/\/\S+$/i.test(v.photoQrUrl.trim()) ? 'The QR link must start with https://' : null)}>
      {(v, set) => (
        <div className="form-grid">
          <div className="field wide"><label htmlFor="p-photoQrUrl">QR code opens</label>
            <input id="p-photoQrUrl" className="input" inputMode="url" placeholder="https://… (empty: the photo’s spot on a map)" value={v.photoQrUrl || ''} onChange={(e) => set('photoQrUrl', e.target.value)} />
            <span className="help">For example your app’s download page. Left empty, the QR opens the place where the photo was taken.</span></div>
          <div className="field wide"><label htmlFor="p-photoNote">Default note on photos</label>
            <input id="p-photoNote" className="input" maxLength={120} placeholder="Captured by SuryaSetu" value={v.photoNote || ''} onChange={(e) => set('photoNote', e.target.value)} />
            <span className="help">Photos taken from a record use that record instead (e.g. “Installation IN-0012 · Ravi Kumar”); it can be changed before taking the photo.</span></div>
        </div>
      )}
    </SettingsForm>
  );
}

function PrintCard() {
  const store = useStore();
  const { toast } = useFeedback();
  const [v, setV] = useState<CompanySettings>(store.settings());
  const [saving, setSaving] = useState(false);
  const set = <K extends keyof CompanySettings>(k: K, val: CompanySettings[K]) => setV((s) => ({ ...s, [k]: val }));
  const area = (k: keyof CompanySettings, label: string) => (
    <div className="field wide"><label htmlFor={'p-' + k}>{label}</label>
      <textarea id={'p-' + k} className="input" value={String(v[k] ?? '')} onChange={(e) => set(k, e.target.value as never)} /></div>
  );
  const sample = store.all('invoices').slice(-1)[0] || store.all('quotations').slice(-1)[0];
  const sampleKey = sample ? (store.all('invoices').includes(sample) ? 'invoices' : 'quotations') : '';
  const save = async () => {
    if (v.upiId && !isValidUpiId(v.upiId)) return toast('UPI ID looks wrong — it should look like name@bank.', true);
    if (!/^#[0-9a-f]{6}$/i.test(v.accentColor)) return toast('Choose a valid accent colour.', true);
    setSaving(true);
    try {
      await store.saveSettings({
        logo: v.logo, signature: v.signature, accentColor: v.accentColor, printTemplate: v.printTemplate, tagline: v.tagline.trim(),
        upiId: v.upiId.trim(), showUpiQr: v.showUpiQr, footerNote: v.footerNote,
      });
      toast('Print settings saved');
    } catch (e) { toast(errorText(e), true); } finally { setSaving(false); }
  };
  return (
    <div className="card">
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap', alignItems: 'baseline' }}>
        <h2>Print templates</h2>
        {sample && <Link className="small" to={`/print/${sampleKey}/${sample.id}`}>Preview on {String(sample.number)} →</Link>}
      </div>
      <p className="muted small">Used on every printed document and PDF: quotations, invoices, receipts, purchase orders, challans, certificates, reports.</p>
      <div className="form-grid">
        <ImagePicker id="p-logo" label="Logo (PNG/JPG, under 1 MB)" value={v.logo} onChange={(x) => set('logo', x)} />
        <ImagePicker id="p-sign" label="Signature / stamp image" value={v.signature} onChange={(x) => set('signature', x)} />
        <div className="field"><label htmlFor="p-tpl">Layout</label>
          <select id="p-tpl" className="input" value={v.printTemplate} onChange={(e) => set('printTemplate', e.target.value as CompanySettings['printTemplate'])}>
            {TEMPLATES.map((t) => <option key={t.key} value={t.key}>{t.label}</option>)}
          </select>
        </div>
        <div className="field"><label htmlFor="p-accent">Accent colour</label>
          <input id="p-accent" className="input" type="color" value={/^#[0-9a-f]{6}$/i.test(v.accentColor) ? v.accentColor : '#0f6b5c'} onChange={(e) => set('accentColor', e.target.value)} style={{ padding: 4, height: 40 }} />
        </div>
        <div className="field"><label htmlFor="p-tag">Tagline under the company name</label>
          <input id="p-tag" className="input" maxLength={120} placeholder="e.g. MNRE-empanelled rooftop solar installer" value={v.tagline} onChange={(e) => set('tagline', e.target.value)} /></div>
        <div className="field"><label htmlFor="p-upi">UPI ID (for the pay-by-QR code on invoices)</label>
          <input id="p-upi" className="input" placeholder="yourbusiness@okhdfcbank" value={v.upiId} onChange={(e) => set('upiId', e.target.value)} /></div>
        <label className="check"><input type="checkbox" checked={v.showUpiQr} onChange={(e) => set('showUpiQr', e.target.checked)} /> Print a UPI QR code for the balance due on invoices</label>
        {area('footerNote', 'Footer line on every document')}
      </div>
      <div className="btn-row" style={{ marginTop: 14 }}><button className="btn primary" onClick={save} disabled={saving}>{saving ? 'Saving…' : 'Save print settings'}</button></div>
    </div>
  );
}

function UsersCard() {
  const store = useStore();
  const { toast, confirm } = useFeedback();
  const [editing, setEditing] = useState<(AppUser & { password?: string }) | null>(null);
  const [busy, setBusy] = useState(false);
  const dlg = useDialogFocus(!!editing, () => setEditing(null));
  const local = store.mode === 'local';


  const save = async () => {
    if (!editing) return;
    if (!editing.name.trim()) return toast('Name is required.', true);
    if (!isValidEmail(editing.email)) return toast('Enter a valid email.', true);
    const isNew = !store.users.some((u) => u.id === editing.id);
    if (editing.phone?.trim() ? !toMobile(editing.phone) : isNew) return toast(editing.phone?.trim() ? 'Enter a valid 10-digit Indian mobile number.' : 'Mobile number is required.', true);
    setBusy(true);
    try {
      const { password, ...u } = editing;
      const phone = u.phone?.trim() ? toMobile(u.phone)! : undefined;
      const access = u.role === 'admin' ? {} : accessOverrides(u.role, Object.fromEntries(MODULES.map((m) => [m.key, levelOf(u, m.key)])));
      await store.backend.saveUser({ ...u, name: u.name.trim(), phone, access }, password || undefined);
      await store.refreshUsers();
      setEditing(null);
      toast('User saved');
    } catch (e) { toast(errorText(e), true); } finally { setBusy(false); }
  };

  return (
    <div className="card">
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap' }}>
        <h2>Users & roles</h2>
        {local && <button className="btn sm" onClick={() => setEditing({ id: uid(), name: '', email: '', phone: '', role: 'sales', active: true, password: '' })}>+ Add user</button>}
      </div>
      <p className="muted small">{local
        ? 'Add your staff here. (“Create account” on the sign-in page starts a separate business, not a login for this one.)'
        : 'Staff join with the company code above (sign-in page → “Create account” → “Join my company”). New accounts appear here as “Pending” — choose a role to give them access.'}</p>
      {store.users.some((u) => u.role === 'pending' && u.active) && (
        <div className="banner warn" role="status">{store.users.filter((u) => u.role === 'pending' && u.active).length} account(s) waiting for approval — tap Edit and choose a role.</div>
      )}
      <div className="table-wrap">
        <table>
          <thead><tr><th>Name</th><th>Email</th><th>Mobile</th><th>Role</th><th>Status</th><th /></tr></thead>
          <tbody>
            {store.users.map((u) => (
              <tr key={u.id}>
                <td>{u.name}{u.id === store.user!.id && <span className="muted small"> (you)</span>}</td>
                <td>{u.email}</td>
                <td>{u.phone ? formatMobile(u.phone) : <span className="badge warn">Missing</span>}</td>
                <td>{u.role === 'pending' ? <span className="badge warn">Pending</span> : u.role}
                  {u.access && Object.keys(u.access).length > 0 && <span className="badge info" title="Access rights changed for some apps"> custom</span>}</td>
                <td>{u.active ? <span className="badge good">Active</span> : <span className="badge bad">Disabled</span>}</td>
                <td><button className="btn sm" onClick={() => setEditing({ ...u })}>Edit</button></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {editing && (
        <div className="modal-back">
          <div ref={dlg} className="modal modal-form" role="dialog" aria-modal="true" aria-label="Edit user">
            <h2>{store.users.some((u) => u.id === editing.id) ? 'Edit user' : 'Add user'}</h2>
            <div style={{ display: 'grid', gap: 12 }}>
              <div className="field"><label htmlFor="u-name">Name</label><input id="u-name" className="input" value={editing.name} onChange={(e) => setEditing({ ...editing, name: e.target.value })} /></div>
              <div className="field"><label htmlFor="u-email">Email</label><input id="u-email" className="input" type="email" disabled={!local} value={editing.email} onChange={(e) => setEditing({ ...editing, email: e.target.value })} /></div>
              <div className="field"><label htmlFor="u-phone">Mobile number</label>
                <input id="u-phone" className="input" type="tel" inputMode="numeric" placeholder="98765 43210" value={editing.phone?.startsWith('+91') ? editing.phone.slice(3) : editing.phone || ''}
                  onChange={(e) => setEditing({ ...editing, phone: e.target.value.replace(/[^\d +-]/g, '') })} />
                <span className="help">{store.backend.phoneOtp && editing.id !== store.user!.id
                  ? 'Required. Password-reset codes go to the number the person confirmed themselves; ask them to update it in Settings.'
                  : 'Required. 10-digit Indian mobile number.'}</span>
              </div>
              <div className="field"><label htmlFor="u-role">Role</label>
                {/* A role is a starting template: choosing one resets every app to that role's access. */}
                <select id="u-role" className="input" value={editing.role} onChange={(e) => setEditing({ ...editing, role: e.target.value as Role, access: {} })}>
                  {(Object.keys(ROLE_LABELS) as Role[]).map((r) => <option key={r} value={r}>{ROLE_LABELS[r]}</option>)}
                </select>
              </div>
              <AccessRights user={editing} onChange={(access) => setEditing({ ...editing, access })} />
              <label className="check"><input type="checkbox" checked={editing.active} onChange={(e) => setEditing({ ...editing, active: e.target.checked })} /> Active (can sign in)</label>
              {local && <div className="field"><label htmlFor="u-pass">{store.users.some((u) => u.id === editing.id) ? 'New password (leave blank to keep)' : 'Password (min 8 characters)'}</label>
                <input id="u-pass" className="input" type="password" autoComplete="new-password" value={editing.password || ''} onChange={(e) => setEditing({ ...editing, password: e.target.value })} /></div>}
            </div>
            <div className="btn-row" style={{ justifyContent: 'flex-end', marginTop: 16 }}>
              {store.users.some((u) => u.id === editing.id) && editing.id !== store.user!.id && (
                <button className="btn danger" style={{ marginRight: 'auto' }} disabled={busy} onClick={async () => {
                  const ok = await confirm({ title: `Delete ${editing.name || editing.email}?`, body: 'Their login is removed for good. Records they created stay in the system. To only stop them signing in, untick “Active” instead.', okLabel: 'Delete user', danger: true });
                  if (!ok) return;
                  setBusy(true);
                  try { await store.backend.deleteUser(editing.id); forgetAccount(editing.email); await store.refreshUsers(); setEditing(null); toast('User deleted'); }
                  catch (e) { toast(errorText(e), true); } finally { setBusy(false); }
                }}>Delete user</button>
              )}
              <button className="btn" onClick={() => setEditing(null)}>Cancel</button>
              <button className="btn primary" onClick={save} disabled={busy}>{busy ? 'Saving…' : 'Save'}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/** Access rights: one level per app, starting from the role's preset. */
function AccessRights({ user, onChange }: { user: AppUser; onChange: (a: AppUser['access']) => void }) {
  if (user.role === 'admin') return <p className="muted small">The admin has full access to every app, plus users and settings.</p>;
  if (user.role === 'pending') return <p className="muted small">Pending accounts have no access. Choose a role first, then adjust single apps if needed.</p>;
  const set = (module: string, l: Level) => {
    const levels = Object.fromEntries(MODULES.map((m) => [m.key, m.key === module ? l : levelOf(user, m.key)]));
    onChange(accessOverrides(user.role, levels));
  };
  const custom = Object.keys(user.access || {}).length > 0;
  return (
    <fieldset className="access-rights">
      <legend>Access rights {custom && <span className="badge info">changed from the {user.role} preset</span>}</legend>
      <div className="access-grid">
        {MODULES.map((m) => (
          <label key={m.key}>
            <span>{m.label}</span>
            <select className="input" aria-label={`Access to ${m.label}`} value={levelOf(user, m.key)} onChange={(e) => set(m.key, e.target.value as Level)}>
              {LEVELS.filter((l) => l !== 'own' || OWN_APPS.has(m.key)).map((l) => <option key={l} value={l}>{LEVEL_LABELS[l]}</option>)}
            </select>
          </label>
        ))}
      </div>
      <p className="muted small">“Own documents only” shows only records the person created or that are assigned to them. Only managers of an app can delete in it.
        {custom && <> <button type="button" className="link-btn" onClick={() => onChange({})}>Reset to the {user.role} preset</button></>}</p>
    </fieldset>
  );
}

/** The signed-in user's own mobile number (confirmed by SMS code when that is switched on). */
function MobileCard() {
  const store = useStore();
  const { toast } = useFeedback();
  const [open, setOpen] = useState(false);
  const me = store.user!;
  return (
    <div className="card">
      <h2>My mobile number</h2>
      <p>{me.phone ? <strong>{formatMobile(me.phone)}</strong> : <span className="badge warn">Not added</span>}</p>
      <p className="muted small">{store.backend.phoneOtp ? 'Used to reset your password with an SMS code.' : 'Required for every account. Only you and the admin can see it.'}</p>
      {open
        ? <ChangeMobile hasNumber={!!me.phone} onCancel={() => setOpen(false)} onDone={async (phone) => {
            store.user = { ...me, phone };
            await store.refreshUsers();
            setOpen(false);
            toast('Mobile number saved');
          }} />
        : <button className="btn" onClick={() => setOpen(true)}>{me.phone ? 'Change mobile number' : 'Add mobile number'}</button>}
    </div>
  );
}

/**
 * Changing an existing number first proves it is you: a code sent to your email (cloud),
 * or your current password on this device, where no email can be sent.
 */
function ChangeMobile({ hasNumber, onDone, onCancel }: { hasNumber: boolean; onDone: (phone: string) => void; onCancel: () => void }) {
  const store = useStore();
  const b = store.backend;
  const [step, setStep] = useState<'prove' | 'number'>(hasNumber ? 'prove' : 'number');
  const [sentTo, setSentTo] = useState('');
  const [code, setCode] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const act = async (fn: () => Promise<void>) => { setError(''); setBusy(true); try { await fn(); } catch (e) { setError(errorText(e)); } finally { setBusy(false); } };
  if (step === 'number') return (
    <>
      <MobileForm backend={b} user={store.user!} proof={password ? { password } : undefined} onDone={onDone} submitLabel="Save new number" />
      <button type="button" className="btn ghost sm" onClick={onCancel}>Cancel</button>
    </>
  );
  return (
    <div className="prove-it">
      <p className="small"><strong>First confirm it is you.</strong> {b.identityCheck === 'email-code'
        ? 'We email you a one-time code.'
        : 'This app runs on this device and cannot send email, so enter your current password instead.'}</p>
      {error && <div className="banner bad" role="alert">{error}</div>}
      {b.identityCheck === 'email-code' ? (
        !sentTo ? (
          <button type="button" className="btn primary" disabled={busy} onClick={() => act(async () => { setSentTo(await b.sendEmailCode!()); })}>Email me a code</button>
        ) : <>
          <p className="muted small" role="status">Code sent to {sentTo}. It is valid for a few minutes.</p>
          <div className="field"><label htmlFor="m-email-code">Code from the email</label>
            <input id="m-email-code" className="input otp-input" inputMode="numeric" autoComplete="one-time-code" maxLength={8} value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))} /></div>
          <div className="btn-row">
            <button type="button" className="btn primary" disabled={busy || code.length < 4} onClick={() => act(async () => { await b.verifyEmailCode!(code); setStep('number'); })}>Confirm code</button>
            <button type="button" className="btn ghost sm" disabled={busy} onClick={() => act(async () => { setSentTo(await b.sendEmailCode!()); })}>Send a new code</button>
          </div>
        </>
      ) : <>
        <div className="field"><label htmlFor="m-password">Current password</label>
          <input id="m-password" className="input" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} /></div>
        <button type="button" className="btn primary" disabled={!password} onClick={() => setStep('number')}>Continue</button>
      </>}
      <button type="button" className="btn ghost sm" onClick={onCancel}>Cancel</button>
    </div>
  );
}

function PasswordCard() {
  const store = useStore();
  const { toast } = useFeedback();
  const [oldP, setOld] = useState('');
  const [newP, setNew] = useState('');
  const [conf, setConf] = useState('');
  const [busy, setBusy] = useState(false);
  const save = async () => {
    if (newP.length < 8) return toast('New password must be at least 8 characters.', true);
    if (newP !== conf) return toast('New passwords do not match.', true);
    setBusy(true);
    try { await store.backend.changePassword(oldP, newP); setOld(''); setNew(''); setConf(''); toast('Password changed'); }
    catch (e) { toast(errorText(e), true); } finally { setBusy(false); }
  };
  return (
    <div className="card">
      <h2>Change my password</h2>
      <div className="form-grid">
        <div className="field"><label htmlFor="p-old">Current password</label><input id="p-old" className="input" type="password" autoComplete="current-password" value={oldP} onChange={(e) => setOld(e.target.value)} /></div>
        <div className="field"><label htmlFor="p-new">New password</label><input id="p-new" className="input" type="password" autoComplete="new-password" value={newP} onChange={(e) => setNew(e.target.value)} /></div>
        <div className="field"><label htmlFor="p-conf">Confirm new password</label><input id="p-conf" className="input" type="password" autoComplete="new-password" value={conf} onChange={(e) => setConf(e.target.value)} /></div>
      </div>
      <div className="btn-row" style={{ marginTop: 14 }}><button className="btn" onClick={save} disabled={busy || !oldP}>Change password</button></div>
    </div>
  );
}

function DeleteAccountCard() {
  const store = useStore();
  const { toast } = useFeedback();
  const [typed, setTyped] = useState('');
  const [busy, setBusy] = useState(false);
  const go = async () => {
    setBusy(true);
    try {
      await store.backend.deleteMyAccount();
      forgetAccount(store.user!.email);
      store.clear();
      window.history.replaceState(null, '', window.location.pathname + '#/');
      window.location.reload();
    } catch (e) { toast(errorText(e), true); setBusy(false); }
  };
  return (
    <div className="card">
      <h2>Delete my account</h2>
      <p className="muted small">
        Removes your login and profile. Business records you created (leads, invoices…) stay, because the business must keep them for GST.
        {isAdmin(store.user!.role) && ' If you are the only admin, make someone else an admin first.'}
        {store.mode === 'cloud' && <> <strong>If you are the only person in your business, the business and all its records are deleted too</strong> (its uploaded files within 15 days) — download a backup first (Settings → Backup &amp; data).</>}
        {' '}See the <a href="./delete-account.html" target="_blank" rel="noreferrer">data deletion policy</a>.
      </p>
      <div className="field" style={{ maxWidth: 320 }}>
        <label htmlFor="del-confirm">Type DELETE to confirm</label>
        <input id="del-confirm" className="input" autoComplete="off" value={typed} onChange={(e) => setTyped(e.target.value)} />
      </div>
      <div className="btn-row" style={{ marginTop: 12 }}>
        <button className="btn danger" disabled={busy || typed.trim() !== 'DELETE'} onClick={() => void go()}>{busy ? 'Deleting…' : 'Delete my account'}</button>
      </div>
    </div>
  );
}

const THEME_KEY = 'ss1:theme';
export function applyStoredTheme() {
  try {
    const t = localStorage.getItem(THEME_KEY);
    if (t === 'light' || t === 'dark') document.documentElement.dataset.theme = t;
  } catch { /* storage blocked: follow the OS theme */ }
}

function ThemeCard() {
  const [theme, setTheme] = useState(() => document.documentElement.dataset.theme || 'system');
  const [layout, setLayout] = useState<LayoutChoice>(layoutChoice);
  const pick = (t: string) => {
    setTheme(t);
    if (t === 'system') delete document.documentElement.dataset.theme;
    else document.documentElement.dataset.theme = t;
    try { if (t === 'system') localStorage.removeItem(THEME_KEY); else localStorage.setItem(THEME_KEY, t); } catch { /* ignore */ }
  };
  return (
    <div className="card">
      <h2>Appearance</h2>
      <div className="btn-row">
        {['system', 'light', 'dark'].map((t) => <button key={t} className={'btn sm' + (theme === t ? ' primary' : '')} onClick={() => pick(t)}>{t[0].toUpperCase() + t.slice(1)}</button>)}
      </div>
      <h3 className="settings-sub">Screen layout on this device</h3>
      <div className="btn-row" role="group" aria-label="Screen layout">
        {([['auto', 'Automatic'], ['desktop', 'Computer layout'], ['phone', 'Phone layout']] as const).map(([k, label]) => (
          <button key={k} type="button" className={'btn sm' + (layout === k ? ' primary' : '')} aria-pressed={layout === k} onClick={() => { setLayout(k); setLayoutChoice(k); }}>{label}</button>
        ))}
      </div>
      <p className="muted small">Automatic: the phone layout (bottom bar, round + button, lists as cards) only on phones; a small window on a computer keeps the computer layout.</p>
    </div>
  );
}

/** The same records with device-file references replaced by uploaded ones (cloud restore). */
export function swapFileRefs(data: DataMap, moved: Map<string, FileRef>): DataMap {
  const walk = (v: unknown): unknown => {
    if (!v || typeof v !== 'object') return v;
    if (Array.isArray(v)) return v.map(walk);
    const o = v as Record<string, unknown>;
    if (typeof o.local === 'string' && moved.has(o.local)) return moved.get(o.local);
    return Object.fromEntries(Object.entries(o).map(([k, x]) => [k, walk(x)]));
  };
  return walk(data) as DataMap;
}

/** Every attachment referenced by the records (logo, signature, documents, photos…). */
export function fileRefsIn(data: DataMap): FileRef[] {
  const out: FileRef[] = [];
  const walk = (v: unknown) => {
    if (!v || typeof v !== 'object') return;
    if (Array.isArray(v)) { v.forEach(walk); return; }
    const o = v as Record<string, unknown>;
    if (typeof o.local === 'string' && typeof o.name === 'string') out.push(o as unknown as FileRef);
    else Object.values(o).forEach(walk);
  };
  Object.values(data).forEach(walk);
  return out;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const KNOWN = new Set([...ENTITIES.map((e) => e.key), SETTINGS, ACTIVITY]);

/** Structural check of a backup before anything is overwritten. Returns a reason, or null if it looks fine. */
export function backupProblem(data: unknown): string | null {
  if (!data || typeof data !== 'object' || Array.isArray(data)) return 'no data section';
  const seen = new Set<string>();
  for (const [entity, list] of Object.entries(data as Record<string, unknown>)) {
    if (!KNOWN.has(entity)) return `unknown section “${entity.slice(0, 40)}”`;
    if (!Array.isArray(list)) return `section “${entity}” is not a list`;
    for (const r of list as Record<string, unknown>[]) {
      if (!r || typeof r !== 'object') return `a record in “${entity}” is empty`;
      if (typeof r.id !== 'string' || !UUID.test(r.id)) return `a record in “${entity}” has an invalid id`;
      if (seen.has(r.id)) return `record ${r.id} appears twice`;
      seen.add(r.id);
      if (typeof r.createdAt !== 'string' || Number.isNaN(Date.parse(r.createdAt))) return `a record in “${entity}” has no valid creation date`;
      if (typeof r.updatedAt !== 'string' || Number.isNaN(Date.parse(r.updatedAt))) return `a record in “${entity}” has no valid update date`;
      if ('items' in r && r.items != null && (!Array.isArray(r.items) || r.items.some((it) => !it || typeof it !== 'object'))) {
        return `a record in “${entity}” has damaged line items`;
      }
    }
  }
  return null;
}

function BackupCard() {
  const store = useStore();
  const { toast, confirm } = useFeedback();
  const ref = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);

  const download = async () => {
    setBusy(true);
    const done = startBusy();
    try {
      const data = store.exportAll();
      // Device mode keeps attachments apart from the records; the backup carries them, read one at a time.
      const b = store.backend;
      const refs = b.exportFiles ? fileRefsIn(data) : [];
      async function* files(): AsyncGenerator<[string, string]> {
        const seen = new Set<string>();
        for (const r of refs) {
          if (!r.local || seen.has(r.local)) continue;
          seen.add(r.local);
          const one = await b.exportFiles!([r]);
          for (const [id, url] of Object.entries(one)) yield [id, url];
        }
      }
      // The document counters go along, so restoring this backup never hands out an invoice or receipt number twice.
      // Device mode: the staff (who they are and what they may do, never passwords) go along too.
      const users = store.mode === 'local' ? staffForBackup(store.users) : undefined;
      const blob = await buildBackup({ app: 'solar-erp', version: 1, format: DATA_FORMAT, appVersion: APP_VERSION, exportedAt: new Date().toISOString(), counters: b.counters?.(), users, data }, files());
      downloadBytes(`backup-${todayIso()}.json`, blob, 'application/json');
    } catch (e) { toast(errorText(e), true); } finally { done(); setBusy(false); }
  };

  const restore = async (file: File) => {
    let opened: Awaited<ReturnType<typeof openBackup>>;
    try { opened = await openBackup(file); } catch { return toast('That is not a valid backup file.', true); }
    const file0 = opened.head;
    const format = Number(file0?.format) || 1; // backups from before formats were recorded
    if (format > DATA_FORMAT) return toast(`This backup was made by a newer version of the app${file0.appVersion ? ` (${file0.appVersion})` : ''}. Update the app first, then restore it.`, true);
    // Older backups are upgraded first (the upgrade repairs what older versions left behind), then checked.
    let data: DataMap | undefined;
    try { data = migrate(file0!.data!, format); } catch { data = undefined; }
    const problem = data ? backupProblem(data) : backupProblem(file0?.data) || 'its records could not be read';
    if (problem || !data) return toast(`That is not a valid backup file: ${problem}`, true);
    const count = Object.values(data!).reduce((s, l) => s + l.length, 0);
    const ok = await confirm({
      title: 'Restore backup?',
      body: store.mode === 'local'
        ? `This REPLACES all data on this device with ${count} records from the backup. Users and passwords on this device are kept; staff in the backup who are not here yet are added (set their password under Users before they sign in).`
        : `This adds or overwrites ${count} records in the cloud database. Records not in the backup are kept.`,
      okLabel: 'Restore', danger: true,
    });
    if (!ok) return;
    setBusy(true);
    const done = startBusy();
    try {
      const b = store.backend;
      let restoreData = data!;
      // Device mode: the same people may have other ids on this device — point the records at them.
      const staff = store.mode === 'local' ? staffFromBackup(file0?.users) : [];
      restoreData = remapStaff(restoreData, staffIdMap(staff, store.users));
      if (b.importFiles) {
        // Device mode: the attachments go back into this device's file store, one by one.
        await opened.eachFile(async (id, url) => { await b.importFiles!({ [id]: url }); });
      } else {
        // Cloud mode: attachments from a device backup are uploaded, and the records are pointed at the uploads.
        const named = new Map(fileRefsIn(restoreData).map((r) => [String(r.local), r]));
        const moved = new Map<string, FileRef>();
        let failed = 0;
        await opened.eachFile(async (id, url) => {
          const blob = dataUrlToBlob(url);
          const ref = named.get(id);
          if (!blob || !ref) return;
          try { moved.set(id, await b.uploadFile(new File([blob], String(ref.name || 'file'), { type: blob.type }))); } catch { failed++; }
        });
        if (moved.size) restoreData = swapFileRefs(restoreData, moved);
        if (failed) toast(`${failed} attachment(s) could not be uploaded; their records are restored without the file.`, true);
      }
      const counters = file0?.counters && typeof file0.counters === 'object' ? file0.counters : undefined;
      await store.replaceAll(restoreData, { counters, keepCounters: !demoState() });
      await endDemo(store); // what was restored is the business's own data, not the demo
      const people = staff.length ? await restoreStaff(b, staff, store.users) : { added: 0, skipped: [] as string[] };
      if (people.added) await store.refreshUsers();
      toast(`Backup restored${people.added ? ` — ${people.added} staff account(s) added: set their passwords under Users` : ''}${people.skipped.length
        ? `. Not added (email or mobile already used on this device, or no mobile saved): ${people.skipped.join(', ')}` : ''}`, people.skipped.length > 0);
    } catch (e) { toast(errorText(e), true); } finally { done(); setBusy(false); }
  };

  return (
    <div className="card">
      <h2>Backup & restore</h2>
      <p className="muted small">
        {store.mode === 'local'
          ? 'Device mode: your data lives only in this browser. Clearing browser data deletes it. Download a backup regularly.'
          : 'Cloud mode: data is stored in your Supabase database. A local backup is still a good idea.'}
      </p>
      <div className="btn-row">
        <button className="btn" disabled={busy} onClick={() => void download()}>Download backup</button>
        <button className="btn danger" disabled={busy} onClick={() => ref.current?.click()}>{busy ? 'Restoring…' : 'Restore from backup'}</button>
        <input ref={ref} type="file" accept="application/json,.json" hidden onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; if (f) void restore(f); }} />
      </div>
    </div>
  );
}

/** Automatic safety copies on this device, the app version and whether the browser keeps the data. */
function SafetyCard() {
  const store = useStore();
  const { toast, confirm } = useFeedback();
  const b = store.backend;
  const [copies, setCopies] = useState<SafetyCopyInfo[] | null>(null);
  const [kept, setKept] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(false);
  const refresh = () => { void b.listSafetyCopies?.().then(setCopies, () => setCopies([])); };
  useEffect(() => { refresh(); void storageProtected().then(setKept); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const make = async () => {
    setBusy(true);
    try { await b.makeSafetyCopy!(); toast('Safety copy made'); refresh(); } catch (e) { toast(errorText(e), true); } finally { setBusy(false); }
  };
  const restore = async (c: SafetyCopyInfo) => {
    const ok = await confirm({
      title: 'Go back to this safety copy?',
      body: `The records on this device are replaced by the ${c.records} records saved on ${new Date(c.at).toLocaleString('en-IN')}. What is here now is copied aside first, so you can come back to it. Users and passwords are not changed.`,
      okLabel: 'Restore copy', danger: true,
    });
    if (!ok) return;
    setBusy(true);
    try { await b.restoreSafetyCopy!(c.id, { keepCounters: !demoState() }); await endDemo(store); await store.reload(); toast('Safety copy restored'); refresh(); } catch (e) { toast(errorText(e), true); } finally { setBusy(false); }
  };

  return (
    <div className="card">
      <h2>Keeping your data safe</h2>
      <ul className="plain-list small">
        <li>App version <strong>{APP_VERSION}</strong>, data format {DATA_FORMAT}. Installing a new version never deletes your records: older data is upgraded once, after a full safety copy is put aside.</li>
        {store.mode === 'local' && <li>{kept ? '✓ The browser has agreed to keep this app’s data even when the device is low on space.' : 'The browser may clear site data when the device is very low on space. Install the app (Add to Home screen) and download a backup now and then.'}</li>}
        {store.mode === 'cloud' && <li>Your records are in the cloud database, so updating the app or changing devices does not touch them.</li>}
      </ul>
      {b.listSafetyCopies && <>
        <h3 className="settings-sub">Safety copies on this device</h3>
        <p className="muted small">Made automatically once a day, before an app update and before a restore or demo data. The newest {14} are kept.</p>
        {copies === null ? <p className="muted">Loading…</p> : copies.length === 0 ? <p className="muted">No safety copies yet.</p> : (
          <div className="table-wrap"><table className="table">
            <thead><tr><th>When</th><th>Why</th><th className="num">Records</th><th>App</th><th /></tr></thead>
            <tbody>{copies.map((c) => (
              <tr key={c.id}><td>{new Date(c.at).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' })}</td><td>{REASON_LABEL[c.reason]}</td><td className="num">{c.records}</td><td>{c.appVersion}</td>
                <td><button type="button" className="btn sm" disabled={busy} onClick={() => void restore(c)}>Restore</button></td></tr>
            ))}</tbody>
          </table></div>
        )}
        <div className="btn-row"><button type="button" className="btn" disabled={busy} onClick={() => void make()}>Make a safety copy now</button></div>
      </>}
    </div>
  );
}

/** After a restore the data is the business's own: the demo flag goes, and so does the demo team. */
async function endDemo(store: Store) {
  const st = demoState();
  if (!st) return;
  for (const id of st.userIds || []) {
    if (id === store.user?.id) continue;
    try { await store.backend.deleteUser(id); } catch { /* already removed by hand */ }
  }
  await setDemoState(null);
  await store.refreshUsers();
}

/** Fills this device with a fictional company to try the app out; never offered in cloud mode. */
function DemoDataCard() {
  const store = useStore();
  const { toast, confirm } = useFeedback();
  const [busy, setBusy] = useState('');
  const [state, setState] = useState(demoState);
  // Restores and other tabs change it too: always show (and act on) what is true now.
  useEffect(() => { const h = () => setState(demoState()); window.addEventListener(DEMO_EVENT, h); window.addEventListener('storage', h); return () => { window.removeEventListener(DEMO_EVENT, h); window.removeEventListener('storage', h); }; }, []);
  const records = Object.entries(store.exportAll()).filter(([k]) => k !== SETTINGS).reduce((n, [, l]) => n + l.length, 0);

  const load = async () => {
    const ok = await confirm({
      title: 'Load demo data?',
      body: <>
        <p>For testing only. {records > 0
          ? <>This <strong>replaces the {records} records and the company profile on this device</strong> with</>
          : <>This fills this device with</>} a fictional company: about 780 records — customers across India, leads, quotations,
          invoices, payments, projects, stock, service and more.</p>
        <p>Six demo team members are added. They cannot sign in until you set a password for them under Users (useful to test roles).</p>
        <p>What is here now is kept aside and comes back when you choose “Remove demo data”.</p>
      </>,
      okLabel: 'Load demo data', danger: records > 0,
    });
    if (!ok) return;
    setBusy('load');
    const demoDone = startBusy();
    try {
      const res = await fetch(new URL('demo/demo-data.json', document.baseURI).href, { cache: 'no-store' });
      if (!res.ok) throw new Error('The demo data file could not be downloaded.');
      const file = (await res.json()) as DemoFile;
      // Each business gets its own demo team: reuse the ones already here (loading again), new ids otherwise.
      const mine = new Map(store.users.map((u) => [u.email.toLowerCase(), u.id]));
      const tag = (email: string) => email.replace('@', `+${store.user!.id.slice(0, 6)}@`).toLowerCase();
      const idMap: Record<string, string> = {};
      for (const u of file.users) idMap[u.id] = mine.get(u.email.toLowerCase()) || mine.get(tag(u.email)) || uid();
      const data = prepareDemo(file, store.user!.id, todayIso(), idMap);
      const problem = backupProblem(data);
      if (problem) throw new Error(`The demo data file is damaged: ${problem}.`);
      const cur = demoState();
      // What is here now (and its numbering) is put aside FIRST: if that fails, nothing is replaced.
      if (!cur) await keepBeforeDemo(store.exportAll(), store.backend.counters?.());
      const known = new Set(store.users.map((u) => u.email.toLowerCase()));
      const userIds = [...(cur?.userIds || [])];
      for (const u of file.users) {
        if (known.has(u.email.toLowerCase()) || known.has(tag(u.email))) continue;
        // A long random password nobody knows: demo users exist to be assigned work, not to sign in.
        const pw = Array.from(crypto.getRandomValues(new Uint8Array(18)), (b) => b.toString(16).padStart(2, '0')).join('');
        // Skip a demo number someone on this device already has (numbers are unique per account).
        const phone = u.phone && !store.users.some((x) => x.phone === u.phone) ? u.phone : `+9170000${String(Math.floor(Math.random() * 1e5)).padStart(5, '0')}`;
        const person = { id: idMap[u.id], name: u.name, phone, role: u.role as Role, active: true };
        // Logins are unique across all businesses on this device: another business may already have this demo team.
        try { await store.backend.saveUser({ ...person, email: u.email }, pw); }
        catch { await store.backend.saveUser({ ...person, email: tag(u.email) }, pw); }
        userIds.push(idMap[u.id]);
      }
      await store.replaceAll(data, { keepCounters: false });
      await store.refreshUsers();
      const next = { loadedAt: new Date().toISOString(), userIds, hasBefore: cur ? cur.hasBefore : true };
      await setDemoState(next);
      setState(next);
      toast(`Demo data loaded: ${Object.values(data).reduce((n, l) => n + l.length, 0)} records`);
    } catch (e) { toast(errorText(e), true); } finally { setBusy(''); demoDone(); }
  };

  const remove = async () => {
    const before = await dataBeforeDemo();
    const ok = await confirm({
      title: 'Remove demo data?',
      body: before
        ? 'All records on this device are replaced by what was here before the demo was loaded, and the demo team members are deleted. Anything you added while testing is lost.'
        : 'All records on this device are deleted and the demo team members are removed. Anything you added while testing is lost.',
      okLabel: 'Remove demo data', danger: true,
    });
    if (!ok) return;
    setBusy('remove');
    const demoDone = startBusy();
    try {
      const cur = demoState();
      await store.replaceAll(before || {}, { counters: countersBeforeDemo(), keepCounters: false });
      for (const id of cur?.userIds || []) {
        if (id === store.user!.id) continue;
        try { await store.backend.deleteUser(id); } catch { /* already removed by hand */ }
      }
      await store.refreshUsers();
      await setDemoState(null);
      setState(null);
      toast(before ? 'Demo data removed — your earlier data is back' : 'Demo data removed');
    } catch (e) { toast(errorText(e), true); } finally { setBusy(''); demoDone(); }
  };

  return (
    <div className="card" id="demo">
      <h2>Demo data <span className="badge warn">testing only</span></h2>
      <p className="muted small">
        Try every screen with a ready-made fictional company (Patna-based, customers in 24 states). Only in device mode, only on this device —
        never sent anywhere. Do not use it for real business.
      </p>
      {state && <div className="banner warn" role="status">Demo data is loaded on this device (since {new Date(state.loadedAt).toLocaleDateString('en-IN')}).</div>}
      <div className="btn-row">
        <button className="btn" disabled={!!busy} onClick={() => void load()}>{busy === 'load' ? 'Loading…' : state ? 'Reload demo data' : 'Load demo data'}</button>
        {state && <button className="btn danger" disabled={!!busy} onClick={() => void remove()}>{busy === 'remove' ? 'Removing…' : 'Remove demo data'}</button>}
      </div>
    </div>
  );
}

