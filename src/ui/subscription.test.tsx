import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { App } from './App';
import { LocalBackend } from '../lib/store/local';
import type { AppUser } from '../lib/store/types';
import { Store } from '../lib/store';
import { DEFAULT_PLANS, ENDED_MESSAGE, enquiryBusiness, enquiryLink, inviteLink, planValue, siteBase, subState, type BusinessInfo } from '../lib/subscription';

const DAY = 86400000;
const iso = (ms: number) => new Date(ms).toISOString();
const BIZ = '3f2a9c4e-1111-2222-3333-444455556666';

function business(over: Partial<BusinessInfo> = {}): BusinessInfo {
  return { id: BIZ, name: 'Sunrise Solar', joinCode: '7E2A9D4B', trialEnds: iso(Date.now() + 3 * DAY - 60000), paidUntil: null, plan: null, active: true, isOwner: true, now: iso(Date.now()), ...over };
}

/** Device storage dressed as the cloud: the business and payment calls answer like the server would. */
async function cloudBackend(b: BusinessInfo) {
  const backend = new LocalBackend();
  await backend.setupAdmin('Boss', 'boss@example.com', 'password123', '9876543210');
  let info = b;
  const calls: { order?: string; verify?: unknown } = {};
  Object.assign(backend, {
    mode: 'cloud', phoneOtp: true,
    needsSetup: async () => false,
    mobileStatus: async (u: AppUser) => (u.phone ? 'verified' : 'missing'),
    businessInfo: async () => info,
    plans: async () => DEFAULT_PLANS,
    payments: async () => [],
    regenerateJoinCode: async () => { info = { ...info, joinCode: 'AB12CD34' }; return 'AB12CD34'; },
    async createOrder(plan: string) { calls.order = plan; return { orderId: 'order_TEST123456', amount: 750000, keyId: 'rzp_test_x', label: '12 months' }; },
    async verifyPayment(r: unknown) {
      calls.verify = r;
      const paidUntil = iso(new Date(info.trialEnds).getTime() + 365 * DAY);
      info = { ...info, paidUntil, plan: '12m', active: true };
      return { paidUntil };
    },
  });
  return { backend, calls, set: (n: Partial<BusinessInfo>) => { info = { ...info, ...n }; } };
}

describe('subscription helpers', () => {
  it('trial, paid and ended, with days left rounded up', () => {
    const now = Date.parse('2026-11-14T10:00:00Z');
    expect(subState(business({ trialEnds: iso(now + 15 * DAY) }), now)).toMatchObject({ kind: 'trial', daysLeft: 15 });
    expect(subState(business({ trialEnds: iso(now + 60000) }), now)).toMatchObject({ kind: 'trial', daysLeft: 1 });
    expect(subState(business({ trialEnds: iso(now - DAY) }), now)).toMatchObject({ kind: 'ended', daysLeft: 0 });
    expect(subState(business({ trialEnds: iso(now - DAY), paidUntil: iso(now + 30 * DAY) }), now)).toMatchObject({ kind: 'paid', daysLeft: 30 });
    // Paid during the trial: still "trial" until the trial ends, and the end is the paid date.
    const early = subState(business({ trialEnds: iso(now + 5 * DAY), paidUntil: iso(now + 35 * DAY) }), now);
    expect(early.kind).toBe('paid');
    expect(early.daysLeft).toBe(35);
  });

  it('plan prices: per month and the saving against monthly', () => {
    expect(DEFAULT_PLANS.map((p) => planValue(p))).toEqual([
      { rupees: 1000, perMonth: 1000, saving: 0 }, { rupees: 2500, perMonth: 833, saving: 500 },
      { rupees: 4500, perMonth: 750, saving: 1500 }, { rupees: 7500, perMonth: 625, saving: 4500 },
    ]);
  });

  it('enquiry links name the business; anything else is ignored', () => {
    expect(enquiryLink(BIZ, 'https://app.example.in/')).toBe(`https://app.example.in/#/enquiry?b=${BIZ}`);
    expect(inviteLink('7E2A9D4B', 'https://app.example.in/')).toBe('https://app.example.in/#/?join=7E2A9D4B');
    expect(siteBase()).toMatch(/^https?:\/\/[^#]+\/$/);
    expect(enquiryBusiness(`#/enquiry?b=${BIZ.toUpperCase()}`, '')).toBe(BIZ);
    expect(enquiryBusiness('#/enquiry', `?b=${BIZ}`)).toBe(BIZ);
    expect(enquiryBusiness('#/enquiry?b=1 or 1=1', '')).toBe('');
    expect(enquiryBusiness('#/enquiry', '')).toBe('');
  });
});

describe('app — subscription (cloud mode)', () => {
  beforeEach(() => { localStorage.clear(); window.location.hash = '#/'; });
  afterEach(() => { delete (window as { Razorpay?: unknown }).Razorpay; vi.restoreAllMocks(); });

  it('the trial banner, the plans with their prices, and paying with Razorpay', async () => {
    const { backend, calls } = await cloudBackend(business());
    let opened: Record<string, unknown> | null = null;
    (window as { Razorpay?: unknown }).Razorpay = class {
      constructor(public o: Record<string, unknown>) { opened = o; }
      on() {}
      open() { (this.o.handler as (r: unknown) => void)({ razorpay_payment_id: 'pay_TEST123456', razorpay_order_id: 'order_TEST123456', razorpay_signature: 'abc' }); }
    };
    render(<App backend={backend} />);
    const user = userEvent.setup();
    await screen.findByRole('heading', { name: /Hello, Boss/ });
    expect(await screen.findByText(/3 days left/)).toBeInTheDocument();
    await user.click(screen.getByRole('link', { name: 'See plans' }));
    await screen.findByRole('heading', { name: 'Plans' });
    for (const t of ['₹1,000', '₹2,500', '₹4,500', '₹7,500', 'You save ₹500', 'You save ₹1,500', 'You save ₹4,500', '₹625 a month'])
      expect(screen.getAllByText(t).length).toBeGreaterThan(0);
    expect(screen.getByText(/Paying now adds the plan after the free trial ends/)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Pay ₹7,500' }));
    expect(calls.order).toBe('12m');
    expect(opened).toMatchObject({ key: 'rzp_test_x', order_id: 'order_TEST123456', amount: 750000, currency: 'INR', prefill: { email: 'boss@example.com', contact: '9876543210' } });
    expect(calls.verify).toEqual({ orderId: 'order_TEST123456', paymentId: 'pay_TEST123456', signature: 'abc' });
    expect(await screen.findByText(/Thank you! Your plan is active until/)).toBeInTheDocument();
    expect(await screen.findByText(/12 months plan, until/)).toBeInTheDocument();
  });

  it('after the trial: a clear banner, everything readable, nothing changed', async () => {
    const { backend } = await cloudBackend(business({ trialEnds: iso(Date.now() - DAY), active: false }));
    render(<App backend={backend} />);
    await screen.findByRole('heading', { name: /Hello, Boss/ });
    const banner = (await screen.findAllByRole('alert')).find((a) => /free trial has ended/.test(a.textContent || ''))!;
    expect(banner).toHaveTextContent('changes are paused. Your data is safe');
    expect(within(banner).getByRole('link', { name: 'Choose a plan' })).toHaveAttribute('href', '#/settings?tab=plan');
    const store = new Store(backend);
    store.user = await backend.currentUser();
    await store.load();
    expect(store.readOnly).toBe(true);
    await expect(store.create('leads', { name: 'Late', phone: '9000000001' })).rejects.toThrow(ENDED_MESSAGE);
  });

  it('an email or mobile number that already had a free trial: a clear reason, read-only until a plan starts', async () => {
    const { backend } = await cloudBackend(business({ trialEnds: iso(Date.now() - 1000), active: false, trialRefused: true }));
    render(<App backend={backend} />);
    await screen.findByRole('heading', { name: /Hello, Boss/ });
    const banner = (await screen.findAllByRole('alert')).find((a) => /No free trial for this account/.test(a.textContent || ''))!;
    expect(banner).toHaveTextContent('this email or mobile number has already had a free trial, so changes are paused');
    window.location.hash = '#/settings?tab=plan';
    expect(await screen.findByText(/This email or mobile number has already had a free trial/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Pay ₹1,000' })).toBeInTheDocument(); // buying a plan still works
  });

  it('the company code and invite link are in Users & access; the enquiry link in General', async () => {
    const { backend } = await cloudBackend(business({ trialEnds: iso(Date.now() + 10 * DAY) }));
    render(<App backend={backend} />);
    const user = userEvent.setup(); // (gives the page a clipboard to copy into)
    await screen.findByRole('heading', { name: /Hello, Boss/ });
    window.location.hash = '#/settings?tab=users';
    expect(await screen.findByLabelText('Company code')).toHaveTextContent('7E2A9D4B');
    await user.click(screen.getByRole('button', { name: 'Copy invite link' }));
    expect(await navigator.clipboard.readText()).toMatch(/#\/\?join=7E2A9D4B$/);
    await user.click(screen.getByRole('button', { name: 'Change code' }));
    await user.click(within(screen.getByRole('dialog', { name: 'Change the company code?' })).getByRole('button', { name: 'Change code' }));
    expect(await screen.findByText('AB12CD34')).toBeInTheDocument();
    window.location.hash = '#/settings';
    expect(((await screen.findByLabelText('Enquiry form link')) as HTMLInputElement).value).toMatch(new RegExp(`/#/enquiry\\?b=${BIZ}$`));
  });

  it('inside the store apps (Android / iPhone) nothing is sold: status only, no prices, no pay buttons', async () => {
    (window as { Capacitor?: unknown }).Capacitor = { isNativePlatform: () => true };
    try {
      const { backend } = await cloudBackend(business());
      render(<App backend={backend} />);
      await screen.findByRole('heading', { name: /Hello, Boss/ });
      expect(await screen.findByText(/3 days left/)).toBeInTheDocument();
      expect(screen.queryByRole('link', { name: 'See plans' })).not.toBeInTheDocument();
      window.location.hash = '#/settings?tab=plan';
      await screen.findByRole('heading', { name: 'Subscription' });
      expect(screen.queryByRole('heading', { name: 'Plans' })).not.toBeInTheDocument();
      expect(screen.queryByText(/₹/)).not.toBeInTheDocument();
      expect(screen.queryByRole('button', { name: /^Pay / })).not.toBeInTheDocument();
    } finally { delete (window as { Capacitor?: unknown }).Capacitor; }
  });

  it('sign-up: start a business (name needed) or join one with its company code; an invite link fills the code', async () => {
    const { backend } = await cloudBackend(business());
    await backend.signOut();
    const signUp = vi.spyOn(backend, 'signUp').mockResolvedValue(null);
    window.location.hash = '#/?join=7e2a9d4b';
    render(<App backend={backend} />);
    const user = userEvent.setup();
    await screen.findByRole('heading', { name: 'Join your company' });
    expect(screen.getByLabelText('Company code')).toHaveValue('7E2A9D4B');
    await user.type(screen.getByLabelText('Your name'), 'Sita');
    await user.type(screen.getByLabelText('Email'), 'sita@example.com');
    await user.type(screen.getByLabelText('Mobile number'), '9431012345');
    await user.type(screen.getByLabelText('Password'), 'password123');
    await user.type(screen.getByLabelText('Confirm password'), 'password123');
    await user.click(screen.getByRole('button', { name: 'Create account' }));
    expect(signUp).toHaveBeenLastCalledWith('Sita', 'sita@example.com', 'password123', '9431012345', { joinCode: '7E2A9D4B' });
    expect(await screen.findByText(/Your admin then gives you access/)).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Create account' }));
    await user.click(screen.getByRole('button', { name: 'Start my business' }));
    await screen.findByRole('heading', { name: 'Start your free trial' });
    expect(screen.getByText(/Free for 15 days/)).toBeInTheDocument();
    await user.clear(screen.getByLabelText('Your name'));
    await user.type(screen.getByLabelText('Your name'), 'Ravi');
    await user.clear(screen.getByLabelText('Email'));
    await user.type(screen.getByLabelText('Email'), 'ravi@example.com');
    await user.clear(screen.getByLabelText('Mobile number'));
    await user.type(screen.getByLabelText('Mobile number'), '9431012346');
    await user.type(screen.getByLabelText('Password'), 'password123');
    await user.type(screen.getByLabelText('Confirm password'), 'password123');
    await user.click(screen.getByRole('button', { name: 'Create account' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Enter the business name.');
    await user.type(screen.getByLabelText('Business name'), 'Ravi Solar');
    await user.click(screen.getByRole('button', { name: 'Create account' }));
    expect(signUp).toHaveBeenLastCalledWith('Ravi', 'ravi@example.com', 'password123', '9431012346', { businessName: 'Ravi Solar' });
    expect(await screen.findByText(/15-day free trial/)).toBeInTheDocument();
  });
});
