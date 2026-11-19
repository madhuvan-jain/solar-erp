// Cloud mode: the free trial and the subscription (Settings → Subscription), the company code staff join with,
// the website enquiry link, and the banner at the top of every screen near and after the end.
// The database decides what is allowed (supabase/schema.sql); these screens only show it and start payments.
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useStore } from '../../lib/store';
import { BRAND } from '../../config/brand';
import { isAdmin } from '../../lib/rbac';
import { errorText, useFeedback } from '../components/feedback';
import {
  canPayHere, DEFAULT_PLANS, enquiryLink, inviteLink, planValue, payWithRazorpay, subState, type PaymentRow, type Plan,
} from '../../lib/subscription';

const day = (d: Date | string) => new Date(d).toLocaleDateString(BRAND.locale, { day: 'numeric', month: 'short', year: 'numeric' });
const rupees = (n: number) => '₹' + n.toLocaleString('en-IN');
const days = (n: number) => `${n} day${n === 1 ? '' : 's'}`;

async function copy(text: string, toast: (m: string, bad?: boolean) => void, what: string) {
  try { await navigator.clipboard.writeText(text); toast(`${what} copied`); } catch { toast(`Select the ${what.toLowerCase()} and copy it.`, true); }
}

/** At the top of every screen: the trial's last days, the plan's last week, and the read-only state after the end. */
export function SubscriptionBanner() {
  const store = useStore();
  const b = store.business;
  // Keep it current while the app stays open (the end can come during the day).
  useEffect(() => {
    let last = Date.now();
    const back = () => {
      if (document.visibilityState === 'visible' && Date.now() - last > 10 * 60000) { last = Date.now(); void store.refreshBusiness(); }
    };
    document.addEventListener('visibilitychange', back);
    const t = window.setInterval(() => { last = Date.now(); void store.refreshBusiness(); }, 60 * 60000);
    return () => { document.removeEventListener('visibilitychange', back); window.clearInterval(t); };
  }, [store]);
  if (!b) return null;
  const s = subState(b);
  const admin = isAdmin(store.user!.role);
  const pay = admin && canPayHere();
  if (!b.active || s.kind === 'ended') {
    return (
      <div className="sub-banner ended" role="alert">
        <span><strong>{b.paidUntil ? 'The subscription has ended' : b.trialRefused ? 'No free trial for this account' : 'The free trial has ended'}</strong>
          {b.trialRefused && !b.paidUntil ? ' — this email or mobile number has already had a free trial, so changes are paused.' : ' — changes are paused.'}
          {' '}Your data is safe: you can still view and export it.
          {!admin && ' Your admin can renew it.'}</span>
        {pay && <Link className="btn sm primary" to="/settings?tab=plan">Choose a plan</Link>}
      </div>
    );
  }
  if (!admin) return null;
  if (s.kind === 'trial') {
    return (
      <div className={'sub-banner' + (s.daysLeft <= 3 ? ' soon' : '')} role="status">
        <span>Free trial: <strong>{days(s.daysLeft)} left</strong> (until {day(s.endsAt)}).</span>
        {pay && <Link className="btn sm" to="/settings?tab=plan">See plans</Link>}
      </div>
    );
  }
  if (s.daysLeft <= 7) {
    return (
      <div className="sub-banner soon" role="status">
        <span>Your plan ends in <strong>{days(s.daysLeft)}</strong> ({day(s.endsAt)}).</span>
        {pay && <Link className="btn sm" to="/settings?tab=plan">Renew</Link>}
      </div>
    );
  }
  return null;
}

/** Settings → Subscription (admin, cloud mode). */
export function SubscriptionCard() {
  const store = useStore();
  const { toast } = useFeedback();
  const b = store.business;
  const [plans, setPlans] = useState<Plan[]>(DEFAULT_PLANS);
  const [history, setHistory] = useState<PaymentRow[] | null>(null);
  const [busy, setBusy] = useState('');
  const [note, setNote] = useState('');
  const pay = canPayHere();

  const loadHistory = () => { void store.backend.payments?.().then(setHistory).catch(() => setHistory([])); };
  useEffect(() => {
    void store.backend.plans?.().then((p) => { if (p.length) setPlans(p); }).catch(() => {});
    loadHistory();
    void store.refreshBusiness();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [store]);

  if (!b) return <div className="card"><h2>Subscription</h2><p className="muted">Loading…</p></div>;
  const s = subState(b);
  const monthly = plans.find((p) => p.months === 1);

  const buy = async (p: Plan) => {
    if (!store.backend.createOrder || !store.backend.verifyPayment) return;
    setBusy(p.id); setNote('');
    try {
      const order = await store.backend.createOrder(p.id);
      const me = store.user!;
      const r = await payWithRazorpay(order, { name: me.name, email: me.email, phone: me.phone?.replace(/^\+91/, '') }, { name: BRAND.name });
      if (!r) return; // closed the payment window
      setNote('Payment received. Confirming it…');
      try {
        const done = await store.backend.verifyPayment({ orderId: r.razorpay_order_id, paymentId: r.razorpay_payment_id, signature: r.razorpay_signature });
        toast(`Thank you! Your plan is active until ${day(done.paidUntil)}.`);
        setNote('');
      } catch (e) {
        // The webhook adds it even when this check could not finish (closed tab, network).
        setNote(`${errorText(e)} If money was taken, the plan is added automatically within a few minutes. Payment id: ${r.razorpay_payment_id}`);
      }
      await store.refreshBusiness();
      loadHistory();
    } catch (e) { toast(errorText(e), true); } finally { setBusy(''); }
  };

  const status = s.kind === 'ended' && b.trialRefused && !b.paidUntil
    ? <><span className="badge bad">No free trial</span> This email or mobile number has already had a free trial. Changes are paused until a plan starts; your data is safe and can be viewed and exported.</>
    : s.kind === 'ended'
    ? <><span className="badge bad">Ended</span> {b.paidUntil ? 'The subscription' : 'The free trial'} ended on {day(s.endsAt)}. Changes are paused; your data is safe and can be viewed and exported.</>
    : s.kind === 'trial'
      ? <><span className="badge info">Free trial</span> {days(s.daysLeft)} left — every feature until {day(s.endsAt)}.</>
      : <><span className="badge good">Active</span> {plans.find((p) => p.id === b.plan)?.label || 'Paid'} plan, until {day(s.endsAt)} ({days(s.daysLeft)} left).</>;

  return (
    <>
      <div className="card">
        <h2>Subscription</h2>
        <p className="sub-status">{status}</p>
        <p className="muted small">Business: <strong>{b.name || '—'}</strong>. One subscription covers the whole team — every user, every app, all your data.</p>
        {note && <div className="banner info" role="status">{note}</div>}
      </div>
      {pay && (
        <div className="card">
          <h2>Plans</h2>
          <p className="muted small">
            Prices include GST. {s.kind === 'ended' ? 'Your plan starts today.' : `Paying now adds the plan after ${s.kind === 'trial' ? 'the free trial' : 'your current plan'} ends (${day(s.endsAt)}) — you never lose days.`}
          </p>
          <div className="plan-grid">
            {plans.map((p) => {
              const v = planValue(p, monthly);
              const best = p.months === Math.max(...plans.map((x) => x.months));
              return (
                <div key={p.id} className={'plan' + (best ? ' best' : '')}>
                  {best && <span className="plan-tag">Best value</span>}
                  <h3>{p.label}</h3>
                  <div className="plan-price">{rupees(v.rupees)}</div>
                  <div className="muted small">{p.months > 1 ? `${rupees(v.perMonth)} a month` : 'billed monthly'}</div>
                  {v.saving > 0 ? <div className="plan-save">You save {rupees(v.saving)}</div> : <div className="plan-save none">&nbsp;</div>}
                  <button className={'btn' + (best ? ' primary' : '')} disabled={!!busy} onClick={() => void buy(p)}>
                    {busy === p.id ? 'Opening…' : `Pay ${rupees(v.rupees)}`}
                  </button>
                </div>
              );
            })}
          </div>
          <p className="muted small">
            Secure payment by Razorpay: UPI, cards, net banking and wallets. Card and bank details go to Razorpay only — never to us or this app.
            Razorpay emails you a receipt.
          </p>
        </div>
      )}
      {history && history.some((h) => h.status === 'paid') && (
        <div className="card">
          <h2>Payments</h2>
          <div className="table-wrap">
            <table>
              <thead><tr><th>Paid on</th><th>Plan</th><th className="num">Amount</th><th>Covers</th><th>Payment id</th></tr></thead>
              <tbody>
                {history.filter((h) => h.status === 'paid').map((h) => (
                  <tr key={h.orderId}>
                    <td>{h.paidAt ? day(h.paidAt) : '—'}</td>
                    <td>{plans.find((p) => p.id === h.plan)?.label || h.plan}</td>
                    <td className="num">{rupees(h.amountPaise / 100)}</td>
                    <td>{h.periodStart && h.periodEnd ? `${day(h.periodStart)} – ${day(h.periodEnd)}` : '—'}</td>
                    <td className="small mono">{h.paymentId || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </>
  );
}

/** Settings → Users & access (admin, cloud mode): the code and invite link staff use to join this business. */
export function CompanyCodeCard() {
  const store = useStore();
  const { toast, confirm } = useFeedback();
  const [busy, setBusy] = useState(false);
  const code = store.business?.joinCode;
  if (!code) return null;
  const invite = inviteLink(code);
  const change = async () => {
    const ok = await confirm({
      title: 'Change the company code?',
      body: 'The old code and invite link stop working. People who already joined are not affected. Share the new code with anyone who still needs to join.',
      okLabel: 'Change code',
    });
    if (!ok || !store.backend.regenerateJoinCode) return;
    setBusy(true);
    try { await store.backend.regenerateJoinCode(); await store.refreshBusiness(); toast('New company code made'); }
    catch (e) { toast(errorText(e), true); } finally { setBusy(false); }
  };
  return (
    <div className="card">
      <h2>Company code</h2>
      <p className="muted small">
        Staff join <strong>this</strong> business with this code: on the sign-in page they choose “Create account” → “Join my company”.
        Or send them the invite link. You approve each new person below before they see anything.
      </p>
      <div className="code-row">
        <span className="join-code mono" aria-label="Company code">{code}</span>
        <button className="btn sm" onClick={() => void copy(code, toast, 'Code')}>Copy code</button>
        <button className="btn sm" onClick={() => void copy(invite, toast, 'Invite link')}>Copy invite link</button>
        <button className="btn sm ghost" disabled={busy} onClick={() => void change()}>Change code</button>
      </div>
    </div>
  );
}

/** Settings → General (cloud mode): the link to this business's enquiry form, for its website and social media. */
export function EnquiryLinkCard() {
  const store = useStore();
  const { toast } = useFeedback();
  const b = store.business;
  if (!b) return null;
  const link = enquiryLink(b.id);
  return (
    <div className="card">
      <h2>Website enquiry form</h2>
      <p className="muted small">Put this link on your website, Google Business profile, Facebook or Instagram. Each enquiry arrives here as a new lead.</p>
      <div className="code-row">
        <input className="input" readOnly value={link} aria-label="Enquiry form link" onFocus={(e) => e.currentTarget.select()} />
        <button className="btn sm" onClick={() => void copy(link, toast, 'Link')}>Copy link</button>
      </div>
    </div>
  );
}

