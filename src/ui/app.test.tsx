import { stored } from '../test/records';
import { describe, expect, it, beforeEach, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { App } from './App';
import { CloudSetupRequired } from './pages/Landing';
import { LocalBackend } from '../lib/store/local';
import { AppError, type AppUser } from '../lib/store/types';
import { Store } from '../lib/store';

async function setupAndRender() {
  window.location.hash = '#/';
  const backend = new LocalBackend();
  render(<App backend={backend} />);
  const user = userEvent.setup();
  await screen.findByText('Create the admin account');
  await user.type(screen.getByLabelText('Your name'), 'Madhu Admin');
  await user.type(screen.getByLabelText('Email'), 'admin@example.com');
  await user.type(screen.getByLabelText('Mobile number'), '98765 43210');
  await user.type(screen.getByLabelText('Password'), 'password123');
  await user.type(screen.getByLabelText('Confirm password'), 'password123');
  await user.click(screen.getByRole('button', { name: 'Create account' }));
  await screen.findByText('Save your recovery code');
  await user.click(screen.getByLabelText('I have saved this code'));
  await user.click(screen.getByRole('button', { name: 'Continue' }));
  await screen.findByRole('heading', { name: /Hello, Madhu/ });
  return { user, backend };
}

const go = (hash: string) => { window.location.hash = hash; };

/** Sign out from the account menu, saying yes to "Sign out?" (pre-app pages such as "Waiting for approval" have their own button). */
async function signOutUI(user: ReturnType<typeof userEvent.setup>) {
  const menu = screen.queryByRole('button', { name: /^Account menu for / });
  if (!menu) return user.click(screen.getByRole('button', { name: 'Sign out' }));
  await user.click(menu);
  await user.click(within(screen.getByRole('dialog', { name: 'Account' })).getByRole('button', { name: 'Sign out' }));
  await user.click(within(screen.getByRole('dialog', { name: 'Sign out?' })).getByRole('button', { name: 'Sign out' }));
}

/** Past the "Choose an account" list (accounts used on this device) to the plain email + password form. */
async function toEmailField(user: ReturnType<typeof userEvent.setup>) {
  await screen.findByRole('heading', { name: /Choose an account|Sign in/ });
  const other = screen.queryByRole('button', { name: 'Use another account' });
  if (other) await user.click(other);
  await screen.findByLabelText('Email');
}

describe('app', () => {
  beforeEach(() => { localStorage.clear(); });

  it('shows the trial landing page without cloud config and explains when sign-up is unavailable', async () => {
    render(<CloudSetupRequired />);
    const user = userEvent.setup();
    expect(await screen.findByRole('heading', { name: /Run your solar business from first lead to final payment/ })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Start your free trial now' }));
    expect(screen.getByRole('status')).toHaveTextContent(/Online sign-up is not set up yet/);
  });

  it('blocks the cloud-only landing page when the browser is offline', async () => {
    Object.defineProperty(navigator, 'onLine', { configurable: true, value: false });
    try {
      render(<CloudSetupRequired />);
      expect(await screen.findByRole('heading', { name: 'Internet connection required' })).toBeInTheDocument();
      Object.defineProperty(navigator, 'onLine', { configurable: true, value: true });
      window.dispatchEvent(new Event('online'));
      expect(await screen.findByRole('heading', { name: /Run your solar business from first lead to final payment/ })).toBeInTheDocument();
    } finally {
      Object.defineProperty(navigator, 'onLine', { configurable: true, value: true });
    }
  });

  it('first-run setup validates input', async () => {
    window.location.hash = '#/';
    render(<App backend={new LocalBackend()} />);
    const user = userEvent.setup();
    await screen.findByText('Create the admin account');
    await user.click(screen.getByRole('button', { name: 'Create account' }));
    expect(screen.getByRole('alert')).toHaveTextContent('Enter your name');
    await user.type(screen.getByLabelText('Your name'), 'A');
    await user.type(screen.getByLabelText('Email'), 'bad-email');
    await user.click(screen.getByRole('button', { name: 'Create account' }));
    expect(screen.getByRole('alert')).toHaveTextContent('valid email');
    await user.clear(screen.getByLabelText('Email'));
    await user.type(screen.getByLabelText('Email'), 'a@b.co');
    await user.click(screen.getByRole('button', { name: 'Create account' }));
    expect(screen.getByRole('alert')).toHaveTextContent('Enter your mobile number');
    await user.type(screen.getByLabelText('Mobile number'), '12345');
    await user.click(screen.getByRole('button', { name: 'Create account' }));
    expect(screen.getByRole('alert')).toHaveTextContent('valid 10-digit Indian mobile');
    await user.clear(screen.getByLabelText('Mobile number'));
    await user.type(screen.getByLabelText('Mobile number'), '9876543210');
    await user.type(screen.getByLabelText('Password'), 'password123');
    await user.type(screen.getByLabelText('Confirm password'), 'different1');
    await user.click(screen.getByRole('button', { name: 'Create account' }));
    expect(screen.getByRole('alert')).toHaveTextContent('do not match');
  });

  it('the public landing page routes trial requests to signup and sign-in requests to signin', async () => {
    window.location.hash = '#/';
    const backend = new LocalBackend();
    Object.assign(backend, { mode: 'cloud', phoneOtp: true, needsSetup: async () => false, currentUser: async () => null });
    render(<App backend={backend} landingPage />);
    const user = userEvent.setup();
    expect(await screen.findByRole('heading', { name: /Run your solar business from first lead to final payment/ })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Start your free trial now' }));
    expect(await screen.findByRole('heading', { name: 'Start your free trial' })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Back to home' }));
    await user.click(screen.getByRole('button', { name: 'Sign in' }));
    expect(await screen.findByRole('heading', { name: 'Sign in' })).toBeInTheDocument();
  });

  it('signs out and back in, rejecting a wrong password', async () => {
    const { user } = await setupAndRender();
    await signOutUI(user);
    await screen.findByRole('heading', { name: /Choose an account|Sign in/ });
    await toEmailField(user);
    await user.type(screen.getByLabelText('Email'), 'admin@example.com');
    await user.type(screen.getByLabelText('Password'), 'wrongpass1');
    await user.click(screen.getByRole('button', { name: 'Sign in' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Wrong email or password');
    await user.clear(screen.getByLabelText('Password'));
    await user.type(screen.getByLabelText('Password'), 'password123');
    await user.click(screen.getByRole('button', { name: 'Sign in' }));
    await screen.findByRole('heading', { name: /Hello, Madhu/ });
  });

  it('creates a lead with validation, warns on duplicate, and moves it on the board', async () => {
    const { user } = await setupAndRender();
    go('#/m/leads/new');
    await screen.findByRole('heading', { name: 'New Lead' });
    await user.click(screen.getAllByRole('button', { name: 'Save' })[0]);
    expect(await screen.findByText('Name is required')).toBeInTheDocument();
    expect(screen.getByText('Phone is required')).toBeInTheDocument();

    await user.type(screen.getByLabelText(/^Name/), 'Ravi Kumar');
    await user.type(screen.getByLabelText(/^Phone/), '98765 43210');
    await user.click(screen.getAllByRole('button', { name: 'Save' })[0]);
    await screen.findByRole('heading', { name: 'Ravi Kumar' });
    expect(screen.getAllByText(/LD-0001/).length).toBeGreaterThan(0);

    go('#/m/leads/new');
    await screen.findByRole('heading', { name: 'New Lead' });
    await user.type(screen.getByLabelText(/^Name/), 'Ravi again');
    await user.type(screen.getByLabelText(/^Phone/), '+91 9876543210');
    await user.click(screen.getAllByRole('button', { name: 'Save' })[0]);
    const dlg = await screen.findByRole('dialog');
    expect(dlg).toHaveTextContent('Possible duplicate');
    await user.click(within(dlg).getByRole('button', { name: 'Cancel' }));
    expect(screen.getByRole('heading', { name: 'New Lead' })).toBeInTheDocument();

    go('#/m/leads?view=board');
    const col = await screen.findByRole('region', { name: 'New' });
    expect(within(col).getByText('Ravi Kumar')).toBeInTheDocument();
    await user.selectOptions(within(col).getByLabelText('Move Ravi Kumar'), 'Contacted');
    const contacted = await screen.findByRole('region', { name: 'Contacted' });
    await waitFor(() => expect(within(contacted).getByText('Ravi Kumar')).toBeInTheDocument());
  });

  it('full sales-to-cash flow: customer → quotation → invoice → payments → print', async () => {
    const { user } = await setupAndRender();
    go('#/m/customers/new');
    await screen.findByRole('heading', { name: 'New Customer' });
    await user.type(screen.getByLabelText(/^Name/), 'Asha Devi');
    await user.type(screen.getByLabelText(/^Phone/), '9123456780');
    await user.click(screen.getAllByRole('button', { name: 'Save' })[0]);
    await screen.findByRole('heading', { name: 'Asha Devi' });

    await user.click(screen.getByRole('link', { name: 'New quotation' }));
    await screen.findByRole('heading', { name: 'New Quotation' });
    expect((screen.getByLabelText(/^Customer/) as HTMLSelectElement).selectedOptions[0].textContent).toContain('Asha Devi');
    await user.click(screen.getByRole('button', { name: '+ Add line' }));
    await user.type(screen.getByLabelText('Description line 1'), '3 kW rooftop system');
    await user.clear(screen.getByLabelText('Rate line 1'));
    await user.type(screen.getByLabelText('Rate line 1'), '150000');
    await user.clear(screen.getByLabelText('GST line 1'));
    await user.type(screen.getByLabelText('GST line 1'), '12');
    await user.click(screen.getAllByRole('button', { name: 'Save' })[0]);
    await screen.findByRole('heading', { name: /^QT\/\d{2}-\d{2}\/0001$/ });
    expect(screen.getAllByText('₹1,68,000.00').length).toBeGreaterThan(0);

    await user.click(screen.getByRole('button', { name: 'Convert to invoice' }));
    // A draft until it is issued: no number yet (it is given when the first payment marks it Sent).
    await screen.findByRole('heading', { name: /^Draft invoice of / });
    await user.click(screen.getByRole('link', { name: 'Record payment' }));
    await screen.findByRole('heading', { name: 'New Payment' });
    expect(screen.getByLabelText(/^Amount/)).toHaveValue(168000);
    await user.clear(screen.getByLabelText(/^Amount/));
    await user.type(screen.getByLabelText(/^Amount/), '200000');
    await user.click(screen.getAllByRole('button', { name: 'Save' })[0]);
    expect(await screen.findByText(/more than the balance due/)).toBeInTheDocument();
    await user.clear(screen.getByLabelText(/^Amount/));
    await user.type(screen.getByLabelText(/^Amount/), '68000');
    await user.click(screen.getAllByRole('button', { name: 'Save' })[0]);
    await screen.findByRole('heading', { name: /^RC\/\d{2}-\d{2}\/0001$/ });

    go('#/m/invoices');
    await screen.findByRole('heading', { name: 'Invoices' });
    expect(await screen.findByText('Partially Paid')).toBeInTheDocument();
    expect(screen.getByText('₹1,00,000.00')).toBeInTheDocument();
    expect(screen.getByText('INV/26-27/0001')).toBeInTheDocument();

    const inv = (await stored('invoices'))[0];
    go(`#/print/invoices/${inv.id}`);
    // No company GSTIN set up in this test: the bill is an "Invoice", not a "Tax Invoice", and the screen says why.
    expect(await screen.findByRole('heading', { name: 'Invoice' })).toBeInTheDocument();
    expect(screen.getByText(/Add your company GSTIN/)).toBeInTheDocument();
    expect(screen.getByText(/One Lakh Sixty Eight Thousand Rupees Only/)).toBeInTheDocument();
  });

  it('blocks deleting a customer that has invoices', async () => {
    const { user } = await setupAndRender();
    const s = new Store(new LocalBackend());
    await s.load();
    const c = await s.create('customers', { name: 'Busy', phone: '9000000001' });
    await s.create('projects', { name: 'Roof', customerId: c.id });
    // The record was written by another tab; the app picks it up from the storage event.
    window.dispatchEvent(new StorageEvent('storage', { key: 'ss1:data:projects' }));
    go(`#/m/customers/${c.id}`);
    await screen.findByRole('heading', { name: 'Busy' });
    await user.click(screen.getByRole('button', { name: 'Delete' }));
    expect(await screen.findByText(/Cannot delete: used by 1 projects/)).toBeInTheDocument();
  });

  it('restricts modules by role', async () => {
    const { user, backend } = await setupAndRender();
    await backend.saveUser({ id: 'tech1', name: 'Tech User', email: 'tech@example.com', phone: '+918100000001', role: 'technician', active: true }, 'password123');
    await signOutUI(user);
    await toEmailField(user);
    await user.type(screen.getByLabelText('Email'), 'tech@example.com');
    await user.type(screen.getByLabelText('Password'), 'password123');
    await user.click(screen.getByRole('button', { name: 'Sign in' }));
    await screen.findByRole('heading', { name: /Hello, Tech/ });
    // Home screen shows only the apps this role can open.
    expect(screen.queryByRole('link', { name: /^Accounts/ })).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: /^Installation/ })).toBeInTheDocument();
    go('#/m/invoices');
    expect(await screen.findByText(/Your role does not include this module/)).toBeInTheDocument();
    // Both pages show the same message, so leave in between to be sure the second check sees the new page.
    go('#/');
    await screen.findByRole('heading', { name: /Hello, Tech/ });
    go('#/m/leads/new');
    expect(await screen.findByText(/Your role does not include this module/)).toBeInTheDocument();
  });

  it('shows not-found for bad URLs and deleted records', async () => {
    await setupAndRender();
    go('#/m/nonsense');
    expect(await screen.findByText('This page does not exist.')).toBeInTheDocument();
    go('#/m/leads/does-not-exist');
    expect(await screen.findByText(/does not exist or was deleted/)).toBeInTheDocument();
    go('#/totally/unknown');
    expect(await screen.findByText('This page does not exist.')).toBeInTheDocument();
  });

  it('imports leads from CSV, skipping duplicates and bad rows', async () => {
    const { user } = await setupAndRender();
    go('#/m/leads');
    await screen.findByRole('heading', { name: 'Leads' });
    const csv = 'Name,Phone,City,Source\nA One,9000000001,Patna,facebook\nA Dup,+91 90000 00001,Patna,Website\n,9000000003,Gaya,Call\nB Two,9000000002,Gaya,Referral\n';
    const file = new File([csv], 'leads.csv', { type: 'text/csv' });
    const input = document.querySelector('input[type=file]') as HTMLInputElement;
    await user.upload(input, file);
    const dlg = await screen.findByRole('dialog');
    await user.click(within(dlg).getByRole('button', { name: 'Import' }));
    expect(await screen.findByText(/Imported 2\. Skipped 1 duplicate\(s\), 1 with errors/)).toBeInTheDocument();
    const errDlg = await screen.findByRole('dialog');
    expect(errDlg).toHaveTextContent('Row 4: Name is required');
    await user.click(within(errDlg).getByRole('button', { name: 'Close' }));
    expect(screen.getByText('A One')).toBeInTheDocument();
    expect(screen.getByText('Facebook')).toBeInTheDocument();
  });

  it('enquiry page works without login and explains when cloud is not set up', async () => {
    window.location.hash = '#/enquiry';
    render(<App backend={new LocalBackend()} />);
    const user = userEvent.setup();
    await screen.findByText('Get a free solar quote');
    await user.click(screen.getByRole('button', { name: 'Send enquiry' }));
    expect(screen.getByRole('alert')).toHaveTextContent('enter your name');
    await user.type(screen.getByLabelText('Name *'), 'Visitor');
    await user.type(screen.getByLabelText('Mobile *'), '9876543210');
    await user.click(screen.getByRole('button', { name: 'Send enquiry' }));
    expect(screen.getByRole('alert')).toHaveTextContent('not enabled yet');
  });

  it('closes an open confirm when the user navigates away, so it cannot act on the wrong record', async () => {
    const { user } = await setupAndRender();
    const s = new Store(new LocalBackend());
    await s.load();
    const lead = await s.create('leads', { name: 'Keep Me', phone: '9000000077' });
    window.dispatchEvent(new StorageEvent('storage', { key: 'ss1:data:leads' }));
    go(`#/m/leads/${lead.id}`);
    await screen.findByRole('heading', { name: 'Keep Me' });
    await user.click(screen.getByRole('button', { name: 'Delete' }));
    await screen.findByRole('dialog');
    await new Promise((r) => setTimeout(r, 650));
    go('#/m/leads');
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect((await stored('leads'))).toHaveLength(1);
  });

  it('invoices offer Cancel, never Delete; hidden fields never appear in forms', async () => {
    const { user } = await setupAndRender();
    const s = new Store(new LocalBackend());
    await s.load();
    const c = await s.create('customers', { name: 'Inv Cust', phone: '9000000078' });
    const inv = await s.create('invoices', { customerId: c.id, date: '2026-05-01', items: [{ description: 'x', qty: 1, rate: 100, gstRate: 0 }], status: 'Sent' });
    window.dispatchEvent(new StorageEvent('storage', { key: 'ss1:data:invoices' }));
    go(`#/m/invoices/${inv.id}`);
    await screen.findByRole('heading', { name: inv.number! });
    expect(screen.queryByRole('button', { name: 'Delete' })).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Cancel invoice' }));
    await user.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Cancel invoice' }));
    await waitFor(async () => expect((await stored('invoices'))[0].status).toBe('Cancelled'));
    go('#/m/quotations/new');
    await screen.findByRole('heading', { name: 'New Quotation' });
    expect(screen.queryByLabelText(/^Invoice/)).not.toBeInTheDocument();
    go('#/m/purchaseOrders/new');
    await screen.findByRole('heading', { name: 'New Purchase Order' });
    expect(screen.queryByLabelText(/Stock added to inventory/)).not.toBeInTheDocument();
  });

  it('related lists only show modules the role may read', async () => {
    const { user, backend } = await setupAndRender();
    const s = new Store(new LocalBackend());
    await s.load();
    const c = await s.create('customers', { name: 'Shared Cust', phone: '9000000079' });
    await s.create('invoices', { customerId: c.id, date: '2026-05-01', items: [{ description: 'x', qty: 1, rate: 100, gstRate: 0 }] });
    await s.create('projects', { name: 'Visible Project', customerId: c.id });
    await backend.saveUser({ id: 'tech2', name: 'Tech Two', email: 'tech2@example.com', phone: '+918100000002', role: 'technician', active: true }, 'password123');
    await signOutUI(user);
    await toEmailField(user);
    await user.type(screen.getByLabelText('Email'), 'tech2@example.com');
    await user.type(screen.getByLabelText('Password'), 'password123');
    await user.click(screen.getByRole('button', { name: 'Sign in' }));
    await screen.findByRole('heading', { name: /Hello, Tech/ });
    go(`#/m/customers/${c.id}`);
    await screen.findByRole('heading', { name: 'Shared Cust' });
    expect(screen.getByRole('heading', { name: /Projects \(1\)/ })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: /Invoices/ })).not.toBeInTheDocument();
  });

  it('after sign-out, the next user starts on the dashboard, not the previous page', async () => {
    const { user } = await setupAndRender();
    go('#/settings');
    await screen.findByRole('heading', { name: 'Settings' });
    await signOutUI(user);
    await toEmailField(user);
    await user.type(screen.getByLabelText('Email'), 'admin@example.com');
    await user.type(screen.getByLabelText('Password'), 'password123');
    await user.click(screen.getByRole('button', { name: 'Sign in' }));
    await screen.findByRole('heading', { name: /Hello, Madhu/ });
    expect(window.location.hash).toBe('#/');
  });

  it('opening a crafted attachment never runs script', async () => {
    const { user } = await setupAndRender();
    const s = new Store(new LocalBackend());
    await s.load();
    const evil = { name: 'x.png', size: 10, type: 'image/png', dataUrl: 'data:image/png," onerror="window.__pwned=1' };
    const d = await s.create('documents', { name: 'Evil', file: evil });
    window.dispatchEvent(new StorageEvent('storage', { key: 'ss1:data:documents' }));
    const fakeWin = { document: document.implementation.createHTMLDocument(''), opener: {}, close: vi.fn(), location: { href: '' } };
    const open = vi.spyOn(window, 'open').mockReturnValue(fakeWin as unknown as Window);
    go(`#/m/documents/${d.id}`);
    await screen.findByRole('heading', { name: 'Evil' });
    await user.click(screen.getByRole('button', { name: /x\.png/ }));
    expect(await screen.findByText(/damaged and cannot be opened/)).toBeInTheDocument();
    expect(fakeWin.document.body.innerHTML).toBe('');
    expect((window as unknown as { __pwned?: number }).__pwned).toBeUndefined();
    open.mockRestore();
  });

  it('admin can get back in with the recovery code', async () => {
    window.location.hash = '#/';
    const backend = new LocalBackend();
    const { recoveryCode } = await backend.setupAdmin('Boss', 'boss@example.com', 'password123', '9876543210');
    await backend.signOut();
    render(<App backend={backend} />);
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'Forgot password?' }));
    // Device mode cannot send email or SMS; make the recovery-code route explicit.
    expect(screen.getByText(/email and SMS password resets are unavailable/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'By email' })).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Recovery code')).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Reset with my recovery code' }));
    await user.type(screen.getByLabelText('Admin email or mobile number'), '+91 98765-43210'); // found by mobile number
    await user.type(screen.getByLabelText('Recovery code'), recoveryCode!);
    await user.type(screen.getByLabelText('New password'), 'brandnew123');
    await user.type(screen.getByLabelText('Confirm password'), 'brandnew123');
    await user.click(screen.getByRole('button', { name: 'Set new password' }));
    const shown = await screen.findByTestId('recovery-code');
    expect(shown.textContent).not.toBe(recoveryCode);
    await user.click(screen.getByLabelText('I have saved this code'));
    await user.click(screen.getByRole('button', { name: 'Continue' }));
    await screen.findByRole('heading', { name: /Hello, Boss/ });
  });

  it('warns instead of overwriting when someone else saved while the form was open', async () => {
    const { user } = await setupAndRender();
    const other = new Store(new LocalBackend());
    await other.load();
    const lead = await other.create('leads', { name: 'Race', phone: '9000000088' });
    window.dispatchEvent(new StorageEvent('storage', { key: 'ss1:data:leads' }));
    go(`#/m/leads/${lead.id}/edit`);
    await screen.findByRole('heading', { name: /^Edit/ });
    await other.load();
    await other.update('leads', lead.id, { status: 'Won', city: 'Gaya' }); // the other user
    window.dispatchEvent(new StorageEvent('storage', { key: 'ss1:data:leads' })); // live update arrives
    await new Promise((r) => setTimeout(r, 50));
    await user.type(screen.getByLabelText('Notes'), 'called back');
    await user.click(screen.getAllByRole('button', { name: 'Save' })[0]);
    expect((await screen.findAllByText(/Someone else saved this record/)).length).toBeGreaterThan(0);
    await user.click(screen.getAllByRole('button', { name: 'Save' })[0]);
    await screen.findByRole('heading', { name: 'Race' });
    const saved = (await stored('leads'))[0];
    expect(saved).toMatchObject({ status: 'Won', city: 'Gaya', notes: 'called back' }); // both changes kept
  });
});

describe('app — v2 features', () => {
  beforeEach(() => { localStorage.clear(); });

  async function seed(backend: LocalBackend) {
    const s = new Store(backend);
    s.user = await backend.currentUser();
    await s.load();
    await s.saveSettings({ companyName: 'Sun Power Pvt Ltd', gstin: '10AAKCN0009K1ZW', state: 'Bihar', upiId: 'sunpower@okicici', accountNo: '1234567890', bankName: 'SBI', ifsc: 'SBIN0000001' });
    const c = await s.create('customers', { name: 'Asha Verma', phone: '9811111111', city: 'Patna', state: 'Bihar', pincode: '800001' });
    const p = await s.create('products', { name: 'Panel 545', sku: 'P1', category: 'Solar Panel', price: 15000, gstRate: '12', hsn: '8541' });
    const inv = await s.create('invoices', { customerId: c.id, date: '2026-05-10', status: 'Sent', items: [{ productId: p.id, description: 'Panel 545', qty: 2, rate: 15000, gstRate: 12, hsn: '8541' }] });
    // The running app picks up data written elsewhere the same way it does for another tab.
    window.dispatchEvent(new StorageEvent('storage', { key: 'ss1:data:invoices' }));
    await new Promise((r) => setTimeout(r, 50));
    return { c, inv };
  }

  it('home screen lists apps and searches across records', async () => {
    const { user, backend } = await setupAndRender();
    await seed(backend);

    expect(screen.getByRole('link', { name: /^CRM/ })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /^Dashboard/ })).toBeInTheDocument();
    await user.type(screen.getByLabelText('Search everything'), '98111');
    expect(await screen.findByRole('option', { name: /Asha Verma/ })).toBeInTheDocument();
  });

  it('list offers pivot, graph and calendar views', async () => {
    const { user, backend } = await setupAndRender();
    await seed(backend);
    go('#/m/invoices?view=pivot');
    const pivot = await screen.findByRole('table');
    expect(within(pivot).getAllByText('Total').length).toBeGreaterThan(0);
    expect(within(pivot).getAllByText(/₹33,600/).length).toBeGreaterThan(0);
    await user.click(screen.getByRole('button', { name: 'Graph' }));
    expect(await screen.findByLabelText('Group by')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Calendar' }));
    expect(await screen.findByRole('grid')).toBeInTheDocument();
  });

  it('prints an invoice with UPI QR, bank details, HSN summary and balance', async () => {
    const { backend } = await setupAndRender();
    const { inv } = await seed(backend);
    go(`#/print/invoices/${inv.id}`);
    expect(await screen.findByText('Tax Invoice')).toBeInTheDocument();
    expect(screen.getByRole('img', { name: /UPI payment QR for ₹33,600/ })).toBeInTheDocument();
    expect(screen.getByText('Bank details')).toBeInTheDocument();
    expect(screen.getAllByText('8541').length).toBeGreaterThan(1);
    expect(screen.getByText(/Thirty Three Thousand Six Hundred Rupees Only/)).toBeInTheDocument();
    expect(document.title).toBe('Tax Invoice - INV-26-27-0001 - Asha Verma'); // the PDF file name
    // What GST rules ask of a tax invoice: state codes, reverse charge, and the CGST/SGST rates.
    expect(screen.getAllByText(/10 - Bihar/).length).toBeGreaterThan(0);
    expect(screen.getByText('Reverse charge')).toBeInTheDocument();
    expect(screen.getAllByText('6%').length).toBe(2); // CGST rate and SGST rate on the HSN line
  });

  it('customer statement shows a running balance', async () => {
    const { backend } = await setupAndRender();
    const { c } = await seed(backend);
    go(`#/print/customers/${c.id}`);
    expect(await screen.findByText('Statement of Account')).toBeInTheDocument();
    expect(screen.getByText(/Closing balance/)).toHaveTextContent('₹33,600');
  });

  it('a user can delete their own account, but not the only admin', async () => {
    const { user, backend } = await setupAndRender();
    go('#/settings?tab=account');
    await user.type(await screen.findByLabelText('Type DELETE to confirm'), 'DELETE');
    await user.click(screen.getByRole('button', { name: 'Delete my account' }));
    expect(await screen.findByText(/only one active admin|At least one active admin/i)).toBeInTheDocument();
    await backend.saveUser({ id: 's1', name: 'Sales One', email: 's1@example.com', phone: '+918100000003', role: 'sales', active: true }, 'password123');
    expect((await backend.listUsers()).length).toBe(2);
    await backend.signOut();
    await backend.signIn('s1@example.com', 'password123');
    await backend.deleteMyAccount();
    expect((await backend.listUsers()).map((u) => u.email)).toEqual(['admin@example.com']);
    await expect(backend.signIn('s1@example.com', 'password123')).rejects.toThrow(/Wrong/);
  });

  it('creates a customer and a product from inside a quotation, without leaving it', async () => {
    const { user } = await setupAndRender();
    go('#/m/quotations/new');
    await screen.findByRole('heading', { name: 'New Quotation' });

    // Customer picker → popup → the new customer is chosen on the quotation.
    await user.selectOptions(screen.getByLabelText(/^Customer/), '+ Create new customer…');
    const dlg = await screen.findByRole('dialog', { name: 'New customer' });
    await user.click(within(dlg).getByRole('button', { name: 'Create customer' }));
    expect((await within(dlg).findAllByText(/required/i)).length).toBeGreaterThan(0);
    await user.type(within(dlg).getByLabelText(/^Name/), 'Rohit Sinha');
    await user.type(within(dlg).getByLabelText(/^Phone/), '9822222222');
    await user.type(within(dlg).getByLabelText(/^PIN code/), '800001');
    await user.keyboard('{Enter}'); // saves the popup, not the quotation
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect((screen.getByLabelText(/^Customer/) as HTMLSelectElement).selectedOptions[0].textContent).toContain('Rohit Sinha');
    expect(screen.getByRole('heading', { name: 'New Quotation' })).toBeInTheDocument();
    const cust = (await stored('customers'))[0];
    expect(cust).toMatchObject({ name: 'Rohit Sinha', state: 'Bihar' });

    // Product picker on a line → popup pre-filled from the typed line → line filled from the product.
    await user.click(screen.getByRole('button', { name: '+ Add line' }));
    await user.type(screen.getByLabelText('Description line 1'), 'Panel 545 Wp');
    await user.clear(screen.getByLabelText('Rate line 1'));
    await user.type(screen.getByLabelText('Rate line 1'), '14000');
    await user.selectOptions(screen.getAllByLabelText('Product for line 1')[0], '+ Create new product…');
    const pdlg = await screen.findByRole('dialog', { name: 'New product' });
    expect(within(pdlg).getByLabelText(/^Name/)).toHaveValue('Panel 545 Wp');
    expect(within(pdlg).getByLabelText(/^Sale price/)).toHaveValue(14000);
    await user.type(within(pdlg).getByLabelText(/^SKU/), 'PNL-545');
    await user.type(within(pdlg).getByLabelText(/^HSN/), '8541');
    // A typed line starts at 18%; choosing the category Solar Panel brings it to 5% (the HSN typed is kept).
    await user.selectOptions(within(pdlg).getByLabelText(/^Category/), 'Solar Panel');
    expect(within(pdlg).getByLabelText(/^GST/)).toHaveValue('5');
    await user.click(within(pdlg).getByRole('button', { name: 'Create product' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect((screen.getAllByLabelText('Product for line 1')[0] as HTMLSelectElement).selectedOptions[0].textContent).toContain('Panel 545 Wp');
    expect(screen.getByLabelText('HSN line 1')).toHaveValue('8541');

    await user.click(screen.getAllByRole('button', { name: 'Save' })[0]);
    await screen.findByRole('heading', { name: /^QT\/\d{2}-\d{2}\/0001$/ });
    expect(screen.getAllByText('₹14,700.00').length).toBeGreaterThan(0);
  });

  it('popup offers the existing record on a duplicate, and copies a lead into a new customer', async () => {
    const { user, backend } = await setupAndRender();
    const { c } = await seed(backend);
    const s = new Store(backend);
    s.user = await backend.currentUser();
    await s.load();
    const lead = await s.create('leads', { name: 'Kavita Rao', phone: '9833333333', city: 'Gaya', pincode: '823001' });
    window.dispatchEvent(new StorageEvent('storage', { key: 'ss1:data:leads' }));
    await new Promise((r) => setTimeout(r, 50));

    go(`#/m/projects/new`);
    await screen.findByRole('heading', { name: 'New Project' });
    await user.selectOptions(screen.getByLabelText(/^Customer/), '+ Create new customer…');
    let dlg = await screen.findByRole('dialog', { name: 'New customer' });
    await user.type(within(dlg).getByLabelText(/^Name/), 'Asha V');
    await user.type(within(dlg).getByLabelText(/^Phone/), '9811111111');
    await user.click(within(dlg).getByRole('button', { name: 'Create customer' }));
    await user.click(await within(dlg).findByRole('button', { name: 'Use Asha Verma' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(screen.getByLabelText(/^Customer/)).toHaveValue(c.id);
    expect((await stored('customers'))).toHaveLength(1);

    go(`#/m/quotations/new?leadId=${lead.id}`);
    await screen.findByRole('heading', { name: 'New Quotation' });
    await user.selectOptions(screen.getByLabelText(/^Customer/), '+ Create new customer…');
    dlg = await screen.findByRole('dialog', { name: 'New customer' });
    expect(within(dlg).getByLabelText(/^Name/)).toHaveValue('Kavita Rao');
    expect(within(dlg).getByLabelText(/^Phone/)).toHaveValue('9833333333');
    expect(within(dlg).getByLabelText(/^PIN code/)).toHaveValue('823001');
    await user.click(within(dlg).getByRole('button', { name: 'Cancel' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(screen.getByLabelText(/^Customer/)).toHaveValue('');
  });

  it('only offers "Create new" where the role may create that record', async () => {
    const { user, backend } = await setupAndRender();
    await backend.saveUser({ id: 'sales1', name: 'Sales User', email: 'sales@example.com', phone: '+918100000004', role: 'sales', active: true }, 'password123');
    await signOutUI(user);
    await toEmailField(user);
    await user.type(screen.getByLabelText('Email'), 'sales@example.com');
    await user.type(screen.getByLabelText('Password'), 'password123');
    await user.click(screen.getByRole('button', { name: 'Sign in' }));
    await screen.findByRole('heading', { name: /Hello, Sales/ });
    go('#/m/quotations/new');
    await screen.findByRole('heading', { name: 'New Quotation' });
    // Sales may add customers (CRM) but only view products (Inventory).
    expect(within(screen.getByLabelText(/^Customer/)).getByRole('option', { name: '+ Create new customer…' })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: '+ Add line' }));
    expect(within(screen.getAllByLabelText('Product for line 1')[0]).queryByRole('option', { name: '+ Create new product…' })).not.toBeInTheDocument();
  });
});

describe('app — mobile number and SMS codes', () => {
  beforeEach(() => { localStorage.clear(); });

  it('an older account without a mobile number must add one after signing in', async () => {
    window.location.hash = '#/';
    const backend = new LocalBackend();
    await backend.setupAdmin('Boss', 'boss@example.com', 'password123', '9876543210');
    const users = JSON.parse(localStorage.getItem('ss1:users')!);
    delete users[0].phone;
    localStorage.setItem('ss1:users', JSON.stringify(users));
    render(<App backend={backend} />);
    const user = userEvent.setup();
    await screen.findByRole('heading', { name: 'Add your mobile number' });
    await user.type(screen.getByLabelText('Mobile number'), '123');
    await user.click(screen.getByRole('button', { name: 'Save and continue' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('valid 10-digit');
    await user.clear(screen.getByLabelText('Mobile number'));
    await user.type(screen.getByLabelText('Mobile number'), '70000 12345');
    await user.click(screen.getByRole('button', { name: 'Save and continue' }));
    await screen.findByRole('heading', { name: /Hello, Boss/ });
    window.location.hash = '#/settings?tab=account';
    expect(await screen.findByText('+91 70000 12345', { selector: 'strong' })).toBeInTheDocument();
  });

  it('after sign-out, "Create account" starts a completely new business with its own empty data', async () => {
    const { user, backend } = await setupAndRender();
    const s0 = new Store(backend); s0.user = await backend.currentUser(); await s0.load();
    await s0.create('customers', { name: 'Old Business Customer', phone: '9000000061' });
    await signOutUI(user);
    await screen.findByRole('heading', { name: /Choose an account|Sign in/ });
    await user.click(screen.getByRole('button', { name: 'Create account' }));
    await screen.findByRole('heading', { name: 'Create a new business account' });
    expect(screen.getByText(/separate, empty business/)).toBeInTheDocument();
    await user.type(screen.getByLabelText('Your name'), 'Neha Owner');
    await user.click(screen.getAllByRole('button', { name: 'Create account' }).find((b) => b.getAttribute('type') === 'submit')!);
    expect(await screen.findByRole('alert')).toHaveTextContent('Enter the business name');
    await user.type(screen.getByLabelText('Business name'), 'Neha Solar Works');
    await user.type(screen.getByLabelText('Email'), 'neha@example.com');
    await user.type(screen.getByLabelText('Mobile number'), '9431011111');
    await user.type(screen.getByLabelText('Password'), 'password123');
    await user.type(screen.getByLabelText('Confirm password'), 'password123');
    await user.click(screen.getAllByRole('button', { name: 'Create account' }).find((b) => b.getAttribute('type') === 'submit')!);
    // Own recovery code, then straight in as the admin of the new business — no approval needed.
    await screen.findByText('Save your recovery code');
    await user.click(screen.getByLabelText('I have saved this code'));
    await user.click(screen.getByRole('button', { name: 'Continue' }));
    await screen.findByRole('heading', { name: /Hello, Neha/ });
    expect(screen.getByRole('link', { name: /^Accounts/ })).toBeInTheDocument(); // admin: every app
    go('#/m/customers');
    expect(await screen.findByText(/No customers yet/)).toBeInTheDocument();
    expect(screen.queryByText('Old Business Customer')).not.toBeInTheDocument();
    go('#/settings');
    expect(await screen.findByDisplayValue('Neha Solar Works')).toBeInTheDocument();

    // The first business is untouched.
    await signOutUI(user);
    await toEmailField(user);
    await user.type(screen.getByLabelText('Email'), 'admin@example.com');
    await user.type(screen.getByLabelText('Password'), 'password123');
    await user.click(screen.getByRole('button', { name: 'Sign in' }));
    await screen.findByRole('heading', { name: /Hello, Madhu/ });
    go('#/m/customers');
    expect(await screen.findByText('Old Business Customer')).toBeInTheDocument();
  });

  it('admin adds a user only with a valid, unused mobile number', async () => {
    const { user } = await setupAndRender();
    window.location.hash = '#/settings?tab=users';
    await user.click(await screen.findByRole('button', { name: '+ Add user' }));
    const dlg = screen.getByRole('dialog', { name: 'Edit user' });
    await user.type(within(dlg).getByLabelText('Name'), 'Priya');
    await user.type(within(dlg).getByLabelText('Email'), 'priya@example.com');
    await user.type(within(dlg).getByLabelText(/^Password/), 'password123');
    await user.click(within(dlg).getByRole('button', { name: 'Save' }));
    expect(await screen.findByText('Mobile number is required.')).toBeInTheDocument();
    await user.type(within(dlg).getByLabelText('Mobile number'), '98765 43210'); // the admin's own number
    await user.click(within(dlg).getByRole('button', { name: 'Save' }));
    expect(await screen.findByText(/already used by another user/)).toBeInTheDocument();
    await user.clear(within(dlg).getByLabelText('Mobile number'));
    await user.type(within(dlg).getByLabelText('Mobile number'), '9431012345');
    await user.click(within(dlg).getByRole('button', { name: 'Save' }));
    expect(await screen.findByText('+91 94310 12345')).toBeInTheDocument();
  });

  /** Device storage with the cloud's SMS code behaviour, so the screens can be tested without Supabase. */
  async function smsBackend() {
    const b = new LocalBackend();
    await b.setupAdmin('Boss', 'boss@example.com', 'password123', '9876543210');
    const sent: string[] = [];
    let recovering = false;
    let confirmed: string | null = null;
    Object.assign(b, {
      mode: 'cloud', phoneOtp: true,
      needsSetup: async () => false,
      async sendResetCode(phone: string) { sent.push(phone); },
      async verifyResetCode(phone: string, code: string) {
        if (code !== '123456') throw new AppError('That code is wrong or has expired. Request a new one.');
        const u = JSON.parse(localStorage.getItem('ss1:users')!).find((x: AppUser) => x.phone === '+91' + phone.replace(/\D/g, '').slice(-10));
        if (!u) throw new AppError('That code is wrong or has expired. Request a new one.');
        localStorage.setItem('ss1:session', JSON.stringify(u.id));
        recovering = true;
      },
      isPasswordRecovery: async () => recovering,
      async setNewPassword(pw: string) { const me = (await b.currentUser())!; await b.saveUser(me, pw); recovering = false; },
      mobileStatus: async (u: AppUser) => (!u.phone ? 'missing' : confirmed === u.phone ? 'verified' : 'unverified'),
      async sendMobileCode(phone: string) { sent.push(phone); return 'sent'; },
      async confirmMobileCode(phone: string, code: string) {
        if (code !== '654321') throw new AppError('That code is wrong or has expired. Request a new one.');
        confirmed = '+91' + phone.replace(/\D/g, '').slice(-10);
        await b.setMyPhone(phone);
      },
    });
    return { b, sent, confirm: (p: string) => { confirmed = p; } };
  }

  it('cloud with SMS codes: forgot password → code by SMS → new password → signed in', async () => {
    window.location.hash = '#/';
    const { b, sent, confirm } = await smsBackend();
    confirm('+919876543210');
    await b.signOut();
    render(<App backend={b} />);
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'Forgot password?' }));
    await screen.findByRole('heading', { name: 'Forgot password' });
    await user.type(screen.getByLabelText('Mobile number'), '98765 43210');
    await user.click(screen.getByRole('button', { name: 'Send code by SMS' }));
    expect(await screen.findByRole('status')).toHaveTextContent(/If \+91 98765 43210 belongs to an account/);
    expect(sent).toEqual(['98765 43210']);
    expect(screen.getByRole('button', { name: /Send a new code in \d+s/ })).toBeDisabled();
    await user.type(screen.getByLabelText('Code from the SMS'), '111111');
    await user.click(screen.getByRole('button', { name: 'Verify code' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('wrong or has expired');
    await user.clear(screen.getByLabelText('Code from the SMS'));
    await user.type(screen.getByLabelText('Code from the SMS'), '123456');
    await user.click(screen.getByRole('button', { name: 'Verify code' }));
    await screen.findByRole('heading', { name: 'Choose a new password' });
    await user.type(screen.getByLabelText('New password'), 'brandnew123');
    await user.type(screen.getByLabelText('Confirm new password'), 'brandnew123');
    await user.click(screen.getByRole('button', { name: 'Save new password' }));
    await screen.findByRole('heading', { name: /Hello, Boss/ });
    await b.signOut();
    await expect(b.signIn('boss@example.com', 'brandnew123')).resolves.toMatchObject({ name: 'Boss' });
  });

  it('cloud with SMS codes: an unconfirmed number is confirmed with a code before going on; email reset is still offered', async () => {
    window.location.hash = '#/';
    const { b, sent } = await smsBackend();
    render(<App backend={b} />);
    const user = userEvent.setup();
    await screen.findByRole('heading', { name: 'Confirm your mobile number' });
    expect(screen.getByLabelText('Mobile number')).toHaveValue('9876543210');
    await user.click(screen.getByRole('button', { name: 'Send code by SMS' }));
    expect(sent).toEqual(['+919876543210']);
    await user.type(await screen.findByLabelText('Code from the SMS'), '654321');
    await user.click(screen.getByRole('button', { name: 'Confirm code' }));
    await screen.findByRole('heading', { name: /Hello, Boss/ });

    await signOutUI(user);
    await user.click(await screen.findByRole('button', { name: 'Forgot password?' }));
    await user.click(screen.getByRole('button', { name: /Reset by email/ }));
    await screen.findByRole('heading', { name: 'Reset password by email' });
    expect(screen.getByRole('button', { name: 'Reset with an SMS code instead' })).toBeInTheDocument();
  });

  it('cloud signup stays disabled until SMS verification is configured', async () => {
    window.location.hash = '#/';
    const backend = new LocalBackend();
    Object.assign(backend, {
      mode: 'cloud',
      phoneOtp: false,
      needsSetup: async () => false,
      currentUser: async () => null,
    });
    render(<App backend={backend} />);
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'Create account' }));
    expect(await screen.findByRole('status')).toHaveTextContent(/configures an SMS provider and enables mobile verification/);
    expect(screen.getByRole('button', { name: 'Create account' })).toBeDisabled();
  });

  it('cloud users cannot bypass mobile verification when SMS is not configured', async () => {
    window.location.hash = '#/';
    const backend = new LocalBackend();
    await backend.setupAdmin('Boss', 'boss@example.com', 'password123', '9876543210');
    Object.assign(backend, {
      mode: 'cloud',
      phoneOtp: false,
      mobileStatus: async () => 'unverified',
    });
    render(<App backend={backend} />);
    expect(await screen.findByRole('heading', { name: 'Confirm your mobile number' })).toBeInTheDocument();
    expect(screen.getByText(/access will remain blocked until verification is complete/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Save and continue' })).not.toBeInTheDocument();
  });
});

describe('app — accounts on this device and access rights', () => {
  beforeEach(() => { localStorage.clear(); });

  it('sign-in shows accounts used here (name and email only); pick one, type the password; remove one', async () => {
    const { user, backend } = await setupAndRender();
    await backend.saveUser({ id: 'u-s', name: 'Sita Sales', email: 'sita@example.com', phone: '+918100000099', role: 'sales', active: true }, 'password123');
    await signOutUI(user);
    await screen.findByRole('heading', { name: 'Choose an account' });
    await user.click(screen.getByRole('button', { name: 'Continue as Madhu Admin (admin@example.com)' }));
    expect(screen.queryByLabelText('Email')).not.toBeInTheDocument(); // the email comes from the account picked
    expect(screen.getByText('admin@example.com')).toBeInTheDocument();
    await user.type(screen.getByLabelText('Password'), 'password123');
    await user.click(screen.getByRole('button', { name: 'Sign in' }));
    await screen.findByRole('heading', { name: /Hello, Madhu/ });

    // Another person signs in on the same device, without letting it remember them.
    await signOutUI(user);
    await user.click(await screen.findByRole('button', { name: 'Use another account' }));
    await user.type(screen.getByLabelText('Email'), 'sita@example.com');
    await user.type(screen.getByLabelText('Password'), 'password123');
    await user.click(screen.getByLabelText(/Show this account on this device next time/));
    await user.click(screen.getByRole('button', { name: 'Sign in' }));
    await screen.findByRole('heading', { name: /Hello, Sita/ });
    await signOutUI(user);
    await screen.findByRole('heading', { name: 'Choose an account' });
    expect(screen.queryByRole('button', { name: /Sita/ })).not.toBeInTheDocument();

    // Passwords are never kept; removing an account takes it off the list.
    const stored = localStorage.getItem('ss1:accounts')!;
    expect(stored).toContain('admin@example.com');
    expect(stored).not.toMatch(/password/i);
    await user.click(screen.getByRole('button', { name: 'Remove admin@example.com from this device' }));
    await screen.findByRole('heading', { name: 'Sign in' });
    expect(screen.getByLabelText('Email')).toBeInTheDocument();
  });

  it('per-app access rights: admin changes single apps; "own documents only" hides other people\'s records', async () => {
    const { user, backend } = await setupAndRender();
    const s = new Store(backend);
    s.user = await backend.currentUser();
    await s.load();
    await backend.saveUser({ id: 'rep', name: 'Ravi Rep', email: 'ravi@example.com', phone: '+918100000098', role: 'sales', active: true }, 'password123');
    await s.refreshUsers();
    await s.saveSettings({ autoAssignLeads: false });
    await s.create('leads', { name: 'Admin Lead', phone: '9000000001' });
    await s.create('leads', { name: 'Ravi Assigned Lead', phone: '9000000002', assignedTo: 'rep' });
    // Sign in again so the running app sees the new user.
    await signOutUI(user);
    await user.click(await screen.findByRole('button', { name: /Continue as Madhu Admin/ }));
    await user.type(screen.getByLabelText('Password'), 'password123');
    await user.click(screen.getByRole('button', { name: 'Sign in' }));
    await screen.findByRole('heading', { name: /Hello, Madhu/ });

    go('#/settings?tab=users');
    const row = await screen.findByRole('row', { name: /Ravi Rep/ });
    await user.click(within(row).getByRole('button', { name: 'Edit' }));
    const dlg = screen.getByRole('dialog', { name: 'Edit user' });
    expect(within(dlg).getByLabelText('Access to CRM')).toHaveValue('all'); // the Sales preset
    expect(within(within(dlg).getByLabelText('Access to Accounts')).queryByRole('option', { name: /own documents/ })).not.toBeInTheDocument();
    await user.selectOptions(within(dlg).getByLabelText('Access to CRM'), 'own');
    await user.selectOptions(within(dlg).getByLabelText('Access to Inventory'), 'none');
    await user.click(within(dlg).getByRole('button', { name: 'Save' }));
    expect(await screen.findByText('custom')).toBeInTheDocument();
    expect((await backend.listUsers()).find((u) => u.id === 'rep')!.access).toEqual({ crm: 'own', inventory: 'none' });

    await signOutUI(user);
    await toEmailField(user);
    await user.type(screen.getByLabelText('Email'), 'ravi@example.com');
    await user.type(screen.getByLabelText('Password'), 'password123');
    await user.click(screen.getByRole('button', { name: 'Sign in' }));
    await screen.findByRole('heading', { name: /Hello, Ravi/ });
    expect(screen.queryByRole('link', { name: /^Inventory/ })).not.toBeInTheDocument();
    go('#/m/leads');
    expect(await screen.findByText('Ravi Assigned Lead')).toBeInTheDocument();
    expect(screen.queryByText('Admin Lead')).not.toBeInTheDocument();
    // A lead Ravi creates is his; deleting needs manager level, so there is no Delete button.
    go('#/m/leads/new');
    await screen.findByRole('heading', { name: 'New Lead' });
    await user.type(screen.getByLabelText(/^Name/), 'Ravi Own Lead');
    await user.type(screen.getByLabelText(/^Phone/), '9000000003');
    await user.click(screen.getAllByRole('button', { name: 'Save' })[0]);
    await screen.findByRole('heading', { name: 'Ravi Own Lead' });
    expect(screen.queryByRole('button', { name: 'Delete' })).not.toBeInTheDocument();
    go('#/settings');
    expect(await screen.findByRole('heading', { name: 'My mobile number' })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Users & roles' })).not.toBeInTheDocument();
  });

  it('device mode enforces rights in the data layer too, not only by hiding buttons', async () => {
    const b = new LocalBackend();
    await b.setupAdmin('Admin', 'admin@example.com', 'password123', '9876543210');
    await b.saveUser({ id: 'rep', name: 'Rep', email: 'rep@example.com', phone: '+918100000097', role: 'sales', active: true, access: { crm: 'own' } }, 'password123');
    const admin = new Store(b);
    admin.user = await b.currentUser();
    await admin.load();
    const other = await admin.create('customers', { name: 'Not yours', phone: '9000000011' });
    await b.signOut();
    await b.signIn('rep@example.com', 'password123');
    const rep = new Store(b);
    rep.user = await b.currentUser();
    await rep.load();
    expect(rep.all('customers')).toHaveLength(0);
    expect(rep.get('customers', other.id)).toBeUndefined();
    await expect(rep.update('customers', other.id, { name: 'Changed' })).rejects.toThrow(/no longer exists/);
    const own = await rep.create('customers', { name: 'Mine', phone: '9000000012' });
    expect(rep.all('customers').map((c) => c.name)).toEqual(['Mine']);
    await expect(rep.remove('customers', own.id)).rejects.toThrow(/Only a manager/);
    await expect(rep.saveSettings({ companyName: 'Hacked' })).rejects.toThrow(/Only the admin/);
    await expect(rep.replaceAll({})).rejects.toThrow(/Only the admin/);
    await expect(b.saveUser({ ...rep.user!, role: 'admin' })).rejects.toThrow(/Only the admin/);
    await expect(b.saveUser({ ...rep.user!, access: { crm: 'manager' } })).rejects.toThrow(/Only the admin/);
    await b.saveUser({ ...rep.user!, name: 'Rep Renamed' }); // own name is fine
    await b.changePassword('password123', 'password456');
  });
});

describe('app — top bar: notifications, account menu, sign out', () => {
  beforeEach(() => { localStorage.clear(); });

  it('bell opens a small notifications panel; Escape or a click outside closes it', async () => {
    const { user, backend } = await setupAndRender();
    const s = new Store(backend);
    s.user = await backend.currentUser();
    await s.load();
    await s.create('leads', { name: 'Late Lead', phone: '9000000021', nextFollowUp: '2020-01-01T10:00' });
    window.dispatchEvent(new StorageEvent('storage', { key: 'ss1:data:leads' }));
    const bell = await screen.findByRole('button', { name: /^Notifications \(1 need action\)/ });
    await user.click(bell);
    const panel = screen.getByRole('dialog', { name: 'Notifications' });
    expect(within(panel).getByText(/Follow-up overdue: Late Lead/)).toBeInTheDocument();
    expect(within(panel).getByRole('link', { name: 'See all notifications' })).toHaveAttribute('href', '#/alerts');
    expect(window.location.hash).toBe('#/'); // it did not leave the page
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog', { name: 'Notifications' })).not.toBeInTheDocument();
    expect(bell).toHaveFocus();
    await user.click(bell);
    await user.click(screen.getByRole('heading', { name: /Hello, Madhu/ }));
    expect(screen.queryByRole('dialog', { name: 'Notifications' })).not.toBeInTheDocument();
    // Opening one of them goes to the record and closes the panel.
    await user.click(bell);
    await user.click(within(screen.getByRole('dialog', { name: 'Notifications' })).getByRole('link', { name: /Late Lead/ }));
    await screen.findByRole('heading', { name: 'Late Lead' });
    expect(screen.queryByRole('dialog', { name: 'Notifications' })).not.toBeInTheDocument();
  });

  it('name opens an account menu with profile details and links; sign out asks first and Cancel keeps you in', async () => {
    const { user } = await setupAndRender();
    await user.click(screen.getByRole('button', { name: 'Account menu for Madhu Admin' }));
    const menu = screen.getByRole('dialog', { name: 'Account' });
    expect(within(menu).getByText('admin@example.com')).toBeInTheDocument();
    expect(within(menu).getByText('+91 98765 43210')).toBeInTheDocument();
    expect(within(menu).getByText('Admin')).toBeInTheDocument();
    await user.click(within(menu).getByRole('link', { name: 'My profile & settings' }));
    await screen.findByRole('heading', { name: 'Settings' });
    expect(screen.queryByRole('dialog', { name: 'Account' })).not.toBeInTheDocument();

    // The only way out is the account menu (no separate button in the top bar).
    expect(screen.queryByRole('button', { name: 'Sign out' })).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Account menu for Madhu Admin' }));
    await user.click(within(screen.getByRole('dialog', { name: 'Account' })).getByRole('button', { name: 'Sign out' }));
    const ask = screen.getByRole('dialog', { name: 'Sign out?' });
    expect(within(ask).getByText('admin@example.com')).toBeInTheDocument();
    await user.click(within(ask).getByRole('button', { name: 'Cancel' }));
    expect(screen.getByRole('heading', { name: 'Settings' })).toBeInTheDocument(); // still signed in

    await user.click(screen.getByRole('button', { name: 'Account menu for Madhu Admin' }));
    await user.click(within(screen.getByRole('dialog', { name: 'Account' })).getByRole('button', { name: 'Sign out' }));
    await user.click(within(screen.getByRole('dialog', { name: 'Sign out?' })).getByRole('button', { name: 'Sign out' }));
    await screen.findByRole('heading', { name: /Choose an account|Sign in/ });
  });
});

describe('app — list search: filters, group by, favorites', () => {
  beforeEach(() => { localStorage.clear(); });

  it('filters combine, show as facets, field search, group by with totals, and a default favorite', async () => {
    const { user, backend } = await setupAndRender();
    const s = new Store(backend);
    s.user = await backend.currentUser();
    await s.load();
    await s.saveSettings({ autoAssignLeads: false });
    await s.create('leads', { name: 'Asha Rooftop', phone: '9000000031', segment: 'Residential', capacityKw: 3, status: 'New', city: 'Patna' });
    await s.create('leads', { name: 'Mill Owner', phone: '9000000032', segment: 'Industrial', capacityKw: 50, status: 'Negotiation', city: 'Gaya' });
    await s.create('leads', { name: 'Farm Pump', phone: '8000000033', segment: 'Agriculture', capacityKw: 5, status: 'Won', city: 'Patna' });
    window.dispatchEvent(new StorageEvent('storage', { key: 'ss1:data:leads' }));

    go('#/m/leads');
    await screen.findByText('Asha Rooftop');
    await user.click(screen.getByRole('button', { name: 'Filters, group by and favorites' }));
    const panel = screen.getByRole('dialog', { name: 'Filters, group by and favorites' });
    await user.click(within(panel).getByRole('button', { name: /^Open leads/ }));
    expect(screen.queryByText('Farm Pump')).not.toBeInTheDocument();
    await user.click(within(panel).getByRole('button', { name: /^Up to 3 kW \(PM Surya Ghar\)/ }));
    await user.click(within(panel).getByRole('button', { name: /^Above 10 kW/ })); // same section: OR
    expect(screen.getByText('Asha Rooftop')).toBeInTheDocument();
    expect(screen.getByText('Mill Owner')).toBeInTheDocument();
    expect(screen.getByText('2 record(s)')).toBeInTheDocument();
    expect(window.location.hash).toContain('f=open%2CcapacityKw%3Aupto3%2CcapacityKw%3Aover10');
    // One facet per section in the search box; removing it removes those filters.
    await user.click(screen.getByRole('button', { name: 'Remove Required size: Up to 3 kW (PM Surya Ghar) or Above 10 kW (commercial)' }));
    expect(screen.getByText('2 record(s)')).toBeInTheDocument(); // only "Open leads" left

    // Field search: type, then choose the field.
    await user.keyboard('{Escape}');
    await user.type(screen.getByLabelText('Search'), 'Patna');
    await user.click(screen.getByRole('option', { name: /Search City for: Patna/ }));
    expect(screen.getByRole('button', { name: 'Remove City: Patna' })).toBeInTheDocument();
    expect(screen.getByText('1 record(s)')).toBeInTheDocument(); // open + in Patna
    await user.click(screen.getByRole('button', { name: 'Remove City: Patna' }));
    await user.click(screen.getByRole('button', { name: /^Remove Pipeline/ }));
    expect(screen.getByText('3 record(s)')).toBeInTheDocument();

    // Group by stage: collapsed headings with counts; click to open.
    await user.click(screen.getByRole('button', { name: 'Filters, group by and favorites' }));
    await user.click(within(screen.getByRole('dialog', { name: 'Filters, group by and favorites' })).getByRole('button', { name: 'Stage' }));
    await user.keyboard('{Escape}');
    const head = screen.getByRole('button', { name: /Stage: Negotiation 1/ });
    expect(screen.queryByText('Mill Owner')).not.toBeInTheDocument();
    await user.click(head);
    expect(screen.getByText('Mill Owner')).toBeInTheDocument();

    // Star it from "Recently used", make it the default: opening the list again applies it.
    await user.click(screen.getByRole('button', { name: 'Filters, group by and favorites' }));
    await user.click(within(screen.getByRole('dialog', { name: 'Filters, group by and favorites' })).getByRole('button', { name: /^Residential rooftop/ }));
    go('#/m/customers'); // leaving the list puts this search into the history
    await screen.findByRole('heading', { name: 'Customers' });
    go('#/m/leads?f=seg%3Ares&g=status');
    await screen.findByRole('button', { name: /Stage: New 1/ });
    await user.click(screen.getByRole('button', { name: 'Filters, group by and favorites' }));
    const p2 = screen.getByRole('dialog', { name: 'Filters, group by and favorites' });
    await user.click(within(within(p2).getByRole('group', { name: 'Recently used' })).getByRole('button', { name: 'Add to favorites: Customer type: Residential rooftop · Group by: Stage' }));
    const favs = within(p2).getByRole('group', { name: 'Favorite searches' });
    expect(within(favs).getByRole('button', { name: /^Customer type: Residential rooftop · Group by: Stage/ })).toBeInTheDocument();
    await user.click(within(favs).getByRole('button', { name: /^Open with .* every time/ }));
    expect(within(favs).getByRole('button', { name: /^Open with .* every time/, pressed: true })).toBeInTheDocument();
    go('#/m/customers');
    await screen.findByRole('heading', { name: 'Customers' });
    go('#/m/leads');
    expect(await screen.findByRole('button', { name: /Stage: New 1/ })).toBeInTheDocument();
    expect(screen.getByText('Residential rooftop')).toBeInTheDocument();
    expect(screen.getByText('1 record(s)')).toBeInTheDocument();
  });

  it('old ?status= links (dashboard) turn into the matching filter', async () => {
    const { backend } = await setupAndRender();
    const s = new Store(backend);
    s.user = await backend.currentUser();
    await s.load();
    await s.create('leads', { name: 'Won One', phone: '9000000041', status: 'Won' });
    await s.create('leads', { name: 'New One', phone: '9000000042', status: 'New' });
    window.dispatchEvent(new StorageEvent('storage', { key: 'ss1:data:leads' }));
    go('#/m/leads?status=Won');
    await screen.findByText('Won One');
    await waitFor(() => expect(window.location.hash).toContain('f=st%3AWon'));
    await waitFor(() => expect(screen.queryByText('New One')).not.toBeInTheDocument());
    expect(screen.getByRole('button', { name: 'Remove Stage: Won' })).toBeInTheDocument();
  });
});

describe('app — list search, part 2: custom filters, live counts, bulk actions', () => {
  beforeEach(() => { localStorage.clear(); });

  async function seedLeads(backend: LocalBackend) {
    const s = new Store(backend);
    s.user = await backend.currentUser();
    await s.load();
    await s.saveSettings({ autoAssignLeads: false });
    await s.create('leads', { name: 'Asha Rooftop', phone: '9000000051', segment: 'Residential', capacityKw: 3, status: 'New', monthlyBill: 2500 });
    await s.create('leads', { name: 'Mill Owner', phone: '9000000052', segment: 'Industrial', capacityKw: 50, status: 'New', monthlyBill: 90000 });
    await s.create('leads', { name: 'Farm Pump', phone: '9000000053', segment: 'Agriculture', capacityKw: 5, status: 'Won' });
    window.dispatchEvent(new StorageEvent('storage', { key: 'ss1:data:leads' }));
    return s;
  }

  it('custom filter "Required capacity (kW) is at least 5"; counts follow the other filters', async () => {
    const { user, backend } = await setupAndRender();
    await seedLeads(backend);
    go('#/m/leads');
    await screen.findByText('Asha Rooftop');
    await user.click(screen.getByRole('button', { name: 'Filters, group by and favorites' }));
    const panel = () => screen.getByRole('dialog', { name: 'Filters, group by and favorites' });
    // Before any filter: 2 of the 3 leads are "New".
    expect(within(within(panel()).getByRole('group', { name: 'Stage' })).getByRole('button', { name: /^New/ })).toHaveTextContent('2');
    await user.click(within(panel()).getByRole('button', { name: /^Residential rooftop/ }));
    // Counts now answer "how many would I see?": only 1 residential lead is New, none is Won.
    expect(within(within(panel()).getByRole('group', { name: 'Stage' })).getByRole('button', { name: /^New/ })).toHaveTextContent('1');
    expect(within(within(panel()).getByRole('group', { name: 'Stage' })).getByRole('button', { name: /^Won/ })).toHaveTextContent('0');
    await user.click(within(panel()).getByRole('button', { name: /^Residential rooftop/ }));

    await user.click(within(panel()).getByRole('button', { name: '＋ Add custom filter' }));
    const form = within(panel()).getByRole('group', { name: 'Custom filter' });
    await user.selectOptions(within(form).getByLabelText('Field'), 'Required capacity (kW)');
    await user.selectOptions(within(form).getByLabelText('Condition'), 'is at least');
    await user.type(within(form).getByLabelText('Value'), '5');
    await user.click(within(form).getByRole('button', { name: 'Add filter' }));
    expect(screen.getByRole('button', { name: 'Remove Required capacity (kW): ≥ 5' })).toBeInTheDocument();
    expect(screen.getByText('2 record(s)')).toBeInTheDocument();
    expect(screen.queryByText('Asha Rooftop')).not.toBeInTheDocument();
    expect(window.location.hash).toContain('c=capacityKw%7Cgte%7C5%7C');
  });

  it('select rows, then change stage / assign / export in one go; delete only for managers', async () => {
    const { user, backend } = await setupAndRender();
    await seedLeads(backend);
    go('#/m/leads');
    await screen.findByText('Asha Rooftop');
    await user.click(screen.getAllByRole('checkbox', { name: /^Select LD-/ })[0]);
    await user.click(screen.getByRole('button', { name: /^Select all 3/ }));
    const bar = screen.getByRole('region', { name: 'Selected records' });
    expect(within(bar).getByText('3 selected')).toBeInTheDocument();
    await user.selectOptions(within(bar).getByLabelText('Set Stage of selected'), 'Contacted');
    expect(await screen.findByText(/Stage → Contacted: 3 of 3 done/)).toBeInTheDocument();
    expect((await stored('leads')).every((l) => l.status === 'Contacted')).toBe(true);
    // Selection is cleared after a full success; pick one again and assign it.
    await user.click(screen.getAllByRole('checkbox', { name: /^Select LD-/ })[0]);
    await user.selectOptions(within(screen.getByRole('region', { name: 'Selected records' })).getByLabelText('Set Assigned to of selected'), 'Madhu Admin');
    expect(await screen.findByText(/Assigned to → Madhu Admin: 1 of 1 done/)).toBeInTheDocument();
    // The admin can delete; the confirm comes first.
    await user.click(screen.getAllByRole('checkbox', { name: /^Select LD-/ })[0]);
    await user.click(within(screen.getByRole('region', { name: 'Selected records' })).getByRole('button', { name: 'Delete' }));
    await user.click(within(screen.getByRole('dialog', { name: /Delete 1 lead\?/ })).getByRole('button', { name: 'Delete' }));
    expect(await screen.findByText(/Delete: 1 of 1 done/)).toBeInTheDocument();
    expect((await stored('leads'))).toHaveLength(2);

    // A sales user (CRM: all documents, not manager) gets no Delete in the bar.
    await backend.saveUser({ id: 'sx', name: 'Sam Sales', email: 'sam@example.com', phone: '+918100000096', role: 'sales', active: true }, 'password123');
    await signOutUI(user);
    await toEmailField(user);
    await user.type(screen.getByLabelText('Email'), 'sam@example.com');
    await user.type(screen.getByLabelText('Password'), 'password123');
    await user.click(screen.getByRole('button', { name: 'Sign in' }));
    await screen.findByRole('heading', { name: /Hello, Sam/ });
    go('#/m/leads');
    await user.click((await screen.findAllByRole('checkbox', { name: /^Select LD-/ }))[0]);
    const bar2 = screen.getByRole('region', { name: 'Selected records' });
    expect(within(bar2).getByRole('button', { name: 'Export: choose a file type' })).toBeInTheDocument();
    expect(within(bar2).queryByRole('button', { name: 'Delete' })).not.toBeInTheDocument();
  });

  it('Pivot uses the list\'s group by; grouped list has expand / collapse all', async () => {
    const { user, backend } = await setupAndRender();
    await seedLeads(backend);
    go('#/m/leads?g=segment');
    await screen.findByRole('button', { name: /Segment: Industrial 1/ });
    await user.click(screen.getByRole('button', { name: 'Expand all' }));
    expect(screen.getByText('Mill Owner')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Collapse all' }));
    expect(screen.queryByText('Mill Owner')).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Pivot' }));
    expect(await screen.findByLabelText('Rows')).toHaveValue('segment');
  });
});

describe('app — my dashboard, recent searches, view icons', () => {
  beforeEach(() => { localStorage.clear(); });

  it('create my dashboard from the template, add and resize an item; it opens first next time; delete returns to default', async () => {
    const { user } = await setupAndRender();
    go('#/dashboard');
    await user.click(await screen.findByRole('button', { name: '+ Create my dashboard' }));
    await user.click(within(screen.getByRole('dialog', { name: 'Create my dashboard' })).getByRole('button', { name: /Start from the solar template/ }));
    expect(await screen.findByRole('heading', { name: 'My dashboard' })).toBeInTheDocument();
    expect(screen.getByText('Still to collect')).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'My dashboard', selected: true })).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: '✎ Customize' }));
    await user.click(screen.getByRole('button', { name: '+ Add item' }));
    const ed = screen.getByRole('dialog', { name: 'Add dashboard item' });
    await user.click(within(ed).getByRole('radio', { name: /KPI tile/ }));
    await user.selectOptions(within(ed).getByLabelText('Data from'), 'Leads');
    await user.selectOptions(within(ed).getByLabelText('Measure'), 'Count of records');
    await user.clear(within(ed).getByLabelText('Title'));
    await user.type(within(ed).getByLabelText('Title'), 'All leads');
    expect(within(within(ed).getByLabelText('Preview')).getByText('All leads')).toBeInTheDocument();
    await user.click(within(ed).getByRole('button', { name: 'Add to dashboard' }));
    const handle = screen.getByRole('button', { name: /^Resize All leads: 3 of 12 columns wide, 1 rows tall/ });
    handle.focus();
    await user.keyboard('{ArrowRight}{ArrowRight}{ArrowDown}');
    expect(screen.getByRole('button', { name: /^Resize All leads: 5 of 12 columns wide, 2 rows tall/ })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Remove Pipeline by stage' }));
    await user.click(screen.getByRole('button', { name: 'Done' }));
    const saved = JSON.parse(localStorage.getItem(Object.keys(localStorage).find((k) => k.startsWith('ss1:dash:'))!)!);
    expect(saved.items.find((i: { title: string }) => i.title === 'All leads')).toMatchObject({ w: 5, h: 2, entity: 'leads' });
    expect(saved.items.some((i: { title: string }) => i.title === 'Pipeline by stage')).toBe(false);

    go('#/m/leads');
    await screen.findByRole('heading', { name: 'Leads' });
    go('#/dashboard');
    expect(await screen.findByRole('heading', { name: 'My dashboard' })).toBeInTheDocument(); // not the default one
    await user.click(screen.getByRole('tab', { name: 'Default dashboard' }));
    expect(await screen.findByRole('heading', { name: 'Dashboard' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '+ Create my dashboard' })).not.toBeInTheDocument(); // only one allowed
    await user.click(screen.getByRole('tab', { name: 'My dashboard' }));
    await user.click(screen.getByRole('button', { name: '✎ Customize' }));
    await user.click(screen.getByRole('button', { name: 'Delete dashboard' }));
    await user.click(within(screen.getByRole('dialog', { name: 'Delete my dashboard?' })).getByRole('button', { name: 'Delete' }));
    expect(await screen.findByRole('button', { name: '+ Create my dashboard' })).toBeInTheDocument();
  });

  it('recently used: 3 in the panel, up to 7 in History; tick several and add them to Favorites', async () => {
    const { user } = await setupAndRender();
    for (const f of ['open', 'seg:res', 'fu:overdue', 'src:online', 'seg:ci', 'seg:agri', 'src:ref', 'src:call']) {
      go(`#/m/leads?f=${encodeURIComponent(f)}`);
      await screen.findByRole('heading', { name: 'Leads' });
      go('#/m/customers');
      await screen.findByRole('heading', { name: 'Customers' });
    }
    go('#/m/leads');
    await screen.findByRole('heading', { name: 'Leads' });
    await user.click(screen.getByRole('button', { name: 'Filters, group by and favorites' }));
    const recent = within(screen.getByRole('group', { name: 'Recently used' }));
    const items = recent.getAllByRole('button', { name: /^(?!Add to|Remove from|History)/ });
    expect(items).toHaveLength(3);
    expect(items[0]).toHaveTextContent('Lead source: Phone call');
    // History: the last 7 of the 8 (the oldest, "Open leads", has dropped out).
    await user.click(recent.getByRole('button', { name: 'History (7)' }));
    const hist = within(screen.getByRole('dialog', { name: 'Search history' }));
    expect(hist.getAllByRole('checkbox')).toHaveLength(7);
    expect(hist.queryByText(/Pipeline: Open leads/)).not.toBeInTheDocument();
    await user.click(hist.getByRole('checkbox', { name: 'Choose: Customer type: Residential rooftop' }));
    await user.click(hist.getByRole('checkbox', { name: 'Choose: Follow-up: Follow-up overdue' }));
    await user.click(hist.getByRole('button', { name: '★ Add 2 to favorites' }));
    const favs = within(screen.getByRole('group', { name: 'Favorite searches' }));
    expect(favs.getByRole('button', { name: /^Customer type: Residential rooftop/ })).toBeInTheDocument();
    expect(favs.getByRole('button', { name: /^Follow-up: Follow-up overdue/ })).toBeInTheDocument();
    expect(hist.getByRole('checkbox', { name: 'Choose: Follow-up: Follow-up overdue' })).toBeDisabled(); // already a favorite
    await user.click(hist.getByRole('button', { name: /^Follow-up: Follow-up overdue/ }));
    expect(window.location.hash).toContain('f=fu%3Aoverdue');
  });

  it('views are icons beside the search, each with its name', async () => {
    await setupAndRender();
    go('#/m/invoices');
    await screen.findByRole('heading', { name: 'Invoices' });
    const views = within(document.querySelector('.toolbar') as HTMLElement).getByRole('group', { name: 'View' });
    for (const v of ['List', 'Board', 'Calendar', 'Pivot', 'Graph', 'Map']) {
      expect(within(views).getByRole('button', { name: v })).toHaveAttribute('data-tip', v);
    }
  });
});

