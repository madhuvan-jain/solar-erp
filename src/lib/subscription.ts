// The subscription as the app sees it (cloud mode). The database decides everything (see supabase/schema.sql:
// businesses, plans, business_active): the app only shows it. A changed app cannot unlock anything — after the
// trial or paid period, the database itself refuses changes.
import { isNativeApp } from './nativeSave';

export interface BusinessInfo {
  id: string;
  name: string;
  /** The company code staff use to join; only the admin gets it. */
  joinCode: string | null;
  trialEnds: string;
  paidUntil: string | null;
  plan: string | null;
  active: boolean;
  /** This email or mobile number had a free trial before, so this business started without one. */
  trialRefused?: boolean;
  isOwner: boolean;
  /** The server's clock when this was read. */
  now: string;
}

export interface Plan { id: string; months: number; amountPaise: number; label: string }

export interface PaymentRow { orderId: string; plan: string; amountPaise: number; status: 'created' | 'paid' | 'failed'; createdAt: string; paidAt: string | null; periodStart: string | null; periodEnd: string | null; paymentId: string | null }

/** What the database holds (supabase/schema.sql), for showing the plans before they are loaded. Prices include GST. */
export const DEFAULT_PLANS: Plan[] = [
  { id: '1m', months: 1, amountPaise: 100000, label: '1 month' },
  { id: '3m', months: 3, amountPaise: 250000, label: '3 months' },
  { id: '6m', months: 6, amountPaise: 450000, label: '6 months' },
  { id: '12m', months: 12, amountPaise: 750000, label: '12 months' },
];

export const TRIAL_DAYS = 15;

/** The database's words when a change is refused after the trial or paid period (schema.sql ended_message). */
export const ENDED_MESSAGE = 'This business\'s free trial or subscription has ended, so changes are paused. Your data is safe: you can still view and export it.';
const DAY = 86400000;

export type SubState = { kind: 'trial' | 'paid' | 'ended'; endsAt: Date; daysLeft: number };

/** Trial, paid or ended, and how many days are left (rounded up: "1 day left" until the very end). */
export function subState(b: BusinessInfo, now = Date.now()): SubState {
  const trial = new Date(b.trialEnds).getTime();
  const paid = b.paidUntil ? new Date(b.paidUntil).getTime() : 0;
  const end = Math.max(trial, paid);
  const daysLeft = Math.max(0, Math.ceil((end - now) / DAY));
  const kind = end <= now ? 'ended' : paid > now && paid >= trial ? 'paid' : 'trial';
  return { kind, endsAt: new Date(end), daysLeft };
}

/** Price per month and the saving against paying monthly, in rupees. */
export function planValue(p: Plan, monthly: Plan | undefined = DEFAULT_PLANS[0]) {
  const rupees = p.amountPaise / 100;
  const perMonth = Math.round(rupees / p.months);
  const saving = monthly ? Math.max(0, (monthly.amountPaise / 100) * p.months - rupees) : 0;
  return { rupees, perMonth, saving };
}

/**
 * Paying inside the app is only on the website. The Play Store and App Store apps do not sell or point to
 * payment elsewhere (store rules); they show the status only, and the admin manages the plan on the website.
 */
export const canPayHere = (): boolean => !isNativeApp();

/**
 * The website's address for links people share (invite links, enquiry form): the public website when it is set
 * (always inside the Android / iPhone app, whose own address is "localhost"), otherwise this page's address.
 */
export function siteBase(): string {
  const site = (import.meta.env.VITE_PUBLIC_URL as string | undefined)?.trim().replace(/\/+$/, '');
  return site ? `${site}/` : `${location.origin}${location.pathname.replace(/[^/]*$/, '')}`;
}

/** The link for the website enquiry form of this business. */
export function enquiryLink(businessId: string, base = siteBase()): string {
  return `${base}#/enquiry?b=${businessId}`;
}

/** The invite link staff open to join this business (fills in the company code). */
export function inviteLink(code: string, base = siteBase()): string {
  return `${base}#/?join=${code}`;
}

/** The business id in an enquiry link (`#/enquiry?b=…` or `?b=…`), or ''. */
export function enquiryBusiness(hash = location.hash, search = location.search): string {
  const q = new URLSearchParams(hash.includes('?') ? hash.slice(hash.indexOf('?') + 1) : '');
  const b = q.get('b') || new URLSearchParams(search).get('b') || '';
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(b) ? b.toLowerCase() : '';
}

// ------------------------------------------------------------------ Razorpay Checkout (website only) ---

interface RazorpayResponse { razorpay_payment_id: string; razorpay_order_id: string; razorpay_signature: string }
interface RazorpayCtor { new (o: Record<string, unknown>): { open(): void; on(ev: string, cb: (r: { error?: { description?: string } }) => void): void } }

let loading: Promise<RazorpayCtor> | null = null;
/** Loads Razorpay's checkout script only when someone pays (allowed by the site's security policy, netlify.toml). */
export function loadRazorpay(): Promise<RazorpayCtor> {
  const w = window as unknown as { Razorpay?: RazorpayCtor };
  if (w.Razorpay) return Promise.resolve(w.Razorpay);
  loading ||= new Promise<RazorpayCtor>((resolve, reject) => {
    const s = document.createElement('script');
    s.src = 'https://checkout.razorpay.com/v1/checkout.js';
    s.async = true;
    s.onload = () => (w.Razorpay ? resolve(w.Razorpay) : reject(new Error('The payment window did not load.')));
    s.onerror = () => { loading = null; reject(new Error('The payment window did not load. Check the internet connection and try again.')); };
    document.head.appendChild(s);
  });
  return loading;
}

/**
 * Opens Razorpay Checkout for an order made by the server. Resolves with Razorpay's reply (to be verified by the
 * server — never trusted here), or null if the person closed the window.
 */
export async function payWithRazorpay(order: { orderId: string; amount: number; keyId: string; label: string },
  who: { name: string; email: string; phone?: string }, brand: { name: string; color?: string }): Promise<RazorpayResponse | null> {
  const Razorpay = await loadRazorpay();
  return new Promise((resolve, reject) => {
    // A failed attempt keeps Razorpay's window open so the person can try again (another UPI app, another card):
    // only when they close the window does the last failure count.
    let failed = '';
    const rp = new Razorpay({
      key: order.keyId, order_id: order.orderId, amount: order.amount, currency: 'INR',
      name: brand.name, description: `Subscription: ${order.label}`,
      prefill: { name: who.name, email: who.email, ...(who.phone ? { contact: who.phone } : {}) },
      theme: { color: brand.color || '#0f6b5c' },
      handler: (r: RazorpayResponse) => resolve(r),
      modal: {
        ondismiss: () => (failed ? reject(new Error(`${failed} If money was taken, it is refunded by your bank, or the plan is added within a few minutes.`)) : resolve(null)),
        confirm_close: true,
      },
    });
    rp.on('payment.failed', (r) => { failed = r.error?.description || 'The payment failed.'; });
    rp.open();
  });
}
