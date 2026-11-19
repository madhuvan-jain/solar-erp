import { useEffect, useState, type FormEvent } from 'react';
import { BRAND } from '../../config/brand';
import { BrandLogo } from '../components/BrandLogo';
import type { Backend } from '../../lib/store';
import { CloudBackend } from '../../lib/store/cloud';
import { isValidEmail, isValidPhone } from '../../lib/validate';
import { errorText } from '../components/feedback';
import { enquiryBusiness } from '../../lib/subscription';

/**
 * Public page you can link from your website or social media. New enquiries become leads.
 * Cloud mode: the link names the business (#/enquiry?b=<business id>; Settings → General shows it).
 */
export function EnquiryPage({ backend }: { backend: Backend }) {
  const [v, setV] = useState({ name: '', phone: '', email: '', city: '', message: '', website: '' });
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);
  const business = enquiryBusiness();
  const [company, setCompany] = useState('');
  useEffect(() => {
    if (business && backend instanceof CloudBackend) void backend.enquiryBusinessName(business).then(setCompany).catch(() => {});
  }, [backend, business]);
  const set = (k: keyof typeof v) => (e: { target: { value: string } }) => { const val = e.target.value; setV((s) => ({ ...s, [k]: val })); };

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setErr('');
    if (!v.name.trim()) return setErr('Please enter your name.');
    if (!isValidPhone(v.phone)) return setErr('Please enter a valid mobile number.');
    if (v.email && !isValidEmail(v.email)) return setErr('Please enter a valid email or leave it blank.');
    if (!(backend instanceof CloudBackend)) return setErr('Online enquiries are not enabled yet. Please call us instead.');
    setBusy(true);
    try {
      await backend.submitEnquiry({ ...v, name: v.name.trim().slice(0, 120), message: v.message.slice(0, 1000) }, business);
      setSent(true);
    } catch (x) { setErr(errorText(x)); } finally { setBusy(false); }
  };

  return (
    <div className="auth">
      <div className="card">
        {company
          ? <div className="brand" style={{ justifyContent: 'center' }}>{company}</div>
          : <div className="brand" style={{ justifyContent: 'center' }}><BrandLogo size={34} />{BRAND.name}</div>}
        {backend instanceof CloudBackend && !business ? (
          <div className="center"><h2>Enquiry form</h2><p className="muted">This link is not complete. Please ask the solar company for the link to its enquiry form, or call them.</p></div>
        ) : sent ? (
          <div className="center"><h2>Thank you!</h2><p className="muted">We received your enquiry and will call you soon.</p></div>
        ) : (
          <>
            <h2 className="center">Get a free solar quote</h2>
            {err && <div className="banner bad" role="alert">{err}</div>}
            <form onSubmit={submit} noValidate>
              <div className="field"><label htmlFor="e-name">Name *</label><input id="e-name" className="input" maxLength={120} value={v.name} onChange={set('name')} /></div>
              <div className="field"><label htmlFor="e-phone">Mobile *</label><input id="e-phone" className="input" type="tel" inputMode="tel" maxLength={16} value={v.phone} onChange={set('phone')} /></div>
              <div className="field"><label htmlFor="e-email">Email</label><input id="e-email" className="input" type="email" maxLength={120} value={v.email} onChange={set('email')} /></div>
              <div className="field"><label htmlFor="e-city">City</label><input id="e-city" className="input" maxLength={80} value={v.city} onChange={set('city')} /></div>
              {/* Hidden from people (and screen readers); bots that fill every field are ignored by the server. */}
              <div className="hp-field" aria-hidden="true"><label htmlFor="e-web">Website</label><input id="e-web" tabIndex={-1} autoComplete="off" value={v.website} onChange={set('website')} /></div>
              <div className="field"><label htmlFor="e-msg">Message (monthly bill, roof size…)</label><textarea id="e-msg" className="input" maxLength={1000} value={v.message} onChange={set('message')} /></div>
              <p className="muted small" style={{ margin: 0 }}>
                We use these details only to contact you about solar for your home or business. See our{' '}
                <a href="./privacy.html" target="_blank" rel="noreferrer">privacy policy</a>.
              </p>
              <button className="btn primary" disabled={busy}>{busy ? 'Sending…' : 'Send enquiry'}</button>
            </form>
          </>
        )}
      </div>
    </div>
  );
}
