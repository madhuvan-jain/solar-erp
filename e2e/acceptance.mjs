// Feature-by-feature acceptance test in a real browser (device mode).
// Usage: npm run build && node e2e/acceptance.mjs      (BROWSER=chromium|firefox|webkit)
// Each step is independent where possible: a failure is recorded with a screenshot and the run continues.
import { chromium, firefox, webkit, devices } from 'playwright';
import { spawn } from 'node:child_process';
import { mkdtempSync, writeFileSync, readFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const ENGINE = process.env.BROWSER || 'chromium';
const PORT = 4181;
const BASE = `http://localhost:${PORT}/`;
const OUT = mkdtempSync(join(tmpdir(), 'acceptance-'));
mkdirSync(join(OUT, 'fail'), { recursive: true });

let server;
async function startServer() {
  server = spawn(process.execPath, ['node_modules/vite/bin/vite.js', 'preview', '--port', String(PORT), '--strictPort'], { stdio: 'pipe' });
  await new Promise((resolve, reject) => {
    server.stdout.on('data', (d) => { if (String(d).includes(String(PORT))) resolve(); });
    server.on('exit', (c) => reject(new Error('preview exited ' + c)));
    setTimeout(() => reject(new Error('preview did not start')), 20000);
  });
}
async function stopServer() {
  const s = server;
  await new Promise((r) => { s.once('exit', r); s.kill(); });
}
await startServer();

const results = [];
let page;
const errors = [];
let quietErrors = false;

async function step(name, fn) {
  try {
    await fn();
    results.push({ name, ok: true });
    console.log('  ✓ ' + name);
  } catch (e) {
    const file = join(OUT, 'fail', name.replace(/[^\w]+/g, '_').slice(0, 60) + '.png');
    try { await page.screenshot({ path: file, fullPage: true }); } catch { /* ignore */ }
    results.push({ name, ok: false, err: String(e.message || e).split('\n')[0] });
    console.log(`  ✗ ${name}\n      ${String(e.message || e).split('\n')[0]}\n      screenshot: ${file}`);
  }
}
function must(cond, msg) { if (!cond) throw new Error(msg); }
const T = 6000;
const go = async (hash) => {
  await page.goto(BASE + hash);
  // Wait until the app has actually switched to the new page (a hash change can briefly show the old one).
  await page.waitForFunction((h) => location.hash === h, hash.startsWith('#') ? hash : '#' + hash, { timeout: T });
  await page.locator('main h1, main h2, .auth h2, .auth h1').first().waitFor({ timeout: T });
};
const save = async () => { await page.getByRole('button', { name: 'Save', exact: true }).first().click(); };
const toast = async (re) => { await page.locator('.toast', { hasText: re }).first().waitFor({ timeout: T }); };
const heading = async (re) => { await page.getByRole('heading', { level: 1, name: re }).waitFor({ timeout: T }); };
const detailUrl = (entity) => new RegExp(`#/m/${entity}/[0-9a-f-]{36}$`);
async function selectByText(selector, text) {
  const loc = page.locator(selector);
  let value;
  for (let i = 0; i < 30 && !value; i++) {
    value = await loc.locator('option').evaluateAll((opts, t) => (opts.find((o) => o.textContent.includes(t)) || {}).value, text).catch(() => undefined);
    if (!value) await page.waitForTimeout(100);
  }
  must(value, `no option containing "${text}" in ${selector}`);
  await loc.selectOption(value);
}
async function dialogClick(label) {
  const dlg = page.getByRole('dialog');
  await dlg.waitFor({ timeout: T });
  await dlg.getByRole('button', { name: label, exact: true }).click();
}
/** Past the "Choose an account" list to the plain email + password form. */
async function toEmailForm() {
  await page.getByRole('heading', { name: /Choose an account|Sign in/ }).waitFor({ timeout: T });
  const other = page.getByRole('button', { name: 'Use another account' });
  if (await other.count()) await other.click();
  await page.getByLabel('Email').waitFor();
}
async function signIn(email, password) {
  await toEmailForm();
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password', { exact: true }).fill(password);
  await page.getByRole('button', { name: 'Sign in' }).click();
}
async function signOut() {
  await page.getByRole('button', { name: /^Account menu for / }).click();
  await page.getByRole('dialog', { name: 'Account' }).getByRole('button', { name: 'Sign out' }).click();
  await page.getByRole('dialog', { name: 'Sign out?' }).getByRole('button', { name: 'Sign out' }).click();
  await page.getByRole('heading', { name: /Choose an account|Sign in/ }).waitFor({ timeout: T });
}
function emi(p, rate, n) { const r = rate / 1200; const f = (1 + r) ** n; return Math.round((p * r * f / (f - 1)) * 100) / 100; }
const inr = (n) => '₹' + n.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const todayIso = () => { const d = new Date(); return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10); };
const plusDays = (n) => { const d = new Date(todayIso() + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };

const png = join(OUT, 'site.png');
writeFileSync(png, Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64'));
const pdf = join(OUT, 'kyc.pdf');
writeFileSync(pdf, '%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n');

// Chromium gets a fake camera (a moving test pattern) so the app's own camera can be tested.
const browser = await ({ chromium, firefox, webkit })[ENGINE].launch(ENGINE === 'chromium' ? { args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream'] } : {}).catch((e) => { server.kill(); throw e; });
console.log(`Acceptance test — browser: ${ENGINE}\n`);
const ctx = await browser.newContext({ viewport: { width: 1366, height: 860 }, acceptDownloads: true });
page = await ctx.newPage();
page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
page.on('console', (m) => { if (m.type() === 'error' && !quietErrors) errors.push('console: ' + m.text()); });
page.on('dialog', (d) => d.accept()); // native confirm (sign out with unsaved changes)

let recoveryCode = '';
const ADMIN = { email: 'owner@test.in', pass: 'Owner@12345' };
const FY = (() => { const [y, m] = todayIso().split('-').map(Number); const s = m < 4 ? y - 1 : y; return `${String(s % 100).padStart(2, '0')}-${String((s + 1) % 100).padStart(2, '0')}`; })();

try {
  console.log('Sign-in & accounts');
  await step('first-run setup rejects empty and mismatched input', async () => {
    await page.goto(BASE);
    await page.getByText('Create the admin account').waitFor();
    await page.getByRole('button', { name: 'Create account' }).click();
    await page.getByRole('alert').filter({ hasText: 'Enter your name' }).waitFor();
    await page.getByLabel('Your name').fill('Owner Admin');
    await page.getByLabel('Email').fill(ADMIN.email);
    await page.getByRole('button', { name: 'Create account' }).click();
    await page.getByRole('alert').filter({ hasText: 'Enter your mobile number' }).waitFor();
    await page.getByLabel('Mobile number').fill('12345');
    await page.getByRole('button', { name: 'Create account' }).click();
    await page.getByRole('alert').filter({ hasText: 'valid 10-digit Indian mobile' }).waitFor();
    await page.getByLabel('Mobile number').fill('98350 12345');
    await page.getByLabel('Password', { exact: true }).fill('short');
    await page.getByLabel('Confirm password').fill('short');
    await page.getByRole('button', { name: 'Create account' }).click();
    await page.getByRole('alert').filter({ hasText: 'at least 8' }).waitFor();
  });
  await step('setup creates admin and shows a one-time recovery code', async () => {
    await page.getByLabel('Password', { exact: true }).fill(ADMIN.pass);
    await page.getByLabel('Confirm password').fill(ADMIN.pass);
    await page.getByRole('button', { name: 'Create account' }).click();
    recoveryCode = (await page.getByTestId('recovery-code').textContent()).trim();
    must(/^[A-Z2-9]{5}-[A-Z2-9]{5}$/.test(recoveryCode), 'bad recovery code ' + recoveryCode);
    must(await page.getByRole('button', { name: 'Continue' }).isDisabled(), 'Continue should need the checkbox');
    await page.getByLabel('I have saved this code').check();
    await page.getByRole('button', { name: 'Continue' }).click();
    await heading(/Hello, Owner/);
  });
  await step('wrong password is refused; right password signs in', async () => {
    await signOut();
    await signIn(ADMIN.email, 'wrong-pass-1');
    await page.getByRole('alert').filter({ hasText: 'Wrong email or password' }).waitFor();
    await page.getByLabel('Password', { exact: true }).fill(ADMIN.pass);
    await page.getByRole('button', { name: 'Sign in' }).click();
    await heading(/Hello, Owner/);
  });
  await step('forgotten admin password: recovery code works once and issues a new code', async () => {
    await signOut();
    await toEmailForm();
    await page.getByRole('button', { name: 'Forgot password?' }).click();
    await page.getByText(/no email can be sent from here/).waitFor();
    must(!(await page.getByLabel('Recovery code').count()), 'recovery code asked on the email tab');
    await page.getByRole('button', { name: 'By mobile number' }).click();
    await page.getByText(/no SMS code can be sent from here/).waitFor();
    await page.getByRole('button', { name: 'Recovery code', exact: true }).click();
    await page.getByLabel('Admin email or mobile number').fill('+91 98350-12345');
    await page.getByLabel('Recovery code').fill(recoveryCode.toLowerCase());
    await page.getByLabel('New password').fill('Owner@99999');
    await page.getByLabel('Confirm password').fill('Owner@99999');
    await page.getByRole('button', { name: 'Set new password' }).click();
    const fresh = (await page.getByTestId('recovery-code').textContent()).trim();
    must(fresh !== recoveryCode, 'recovery code not rotated');
    recoveryCode = fresh;
    ADMIN.pass = 'Owner@99999';
    await page.getByLabel('I have saved this code').check();
    await page.getByRole('button', { name: 'Continue' }).click();
    await heading(/Hello, Owner/);
  });

  await step('after sign-out: "Create account" starts a separate new business (own data, no approval)', async () => {
    await signOut();
    await page.getByRole('button', { name: 'Create account' }).click();
    await page.getByRole('heading', { name: 'Create a new business account' }).waitFor();
    await page.getByLabel('Your name').fill('Walk In');
    await page.getByLabel('Business name').fill('Walk In Solar');
    await page.getByLabel('Email').fill('walkin@test.in');
    await page.getByLabel('Mobile number').fill('9431000777');
    await page.getByLabel('Password', { exact: true }).fill('Staff@12345');
    await page.getByLabel('Confirm password').fill('Staff@12345');
    await page.locator('form').getByRole('button', { name: 'Create account' }).click();
    await page.getByText('Save your recovery code').waitFor();
    await page.getByLabel('I have saved this code').check();
    await page.getByRole('button', { name: 'Continue' }).click();
    await heading(/Hello, Walk/);
    await go('#/m/leads');
    await page.getByText(/No leads yet/).waitFor();
    await signOut();
    await signIn(ADMIN.email, ADMIN.pass);
    await heading(/Hello, Owner/);
  });

  console.log('\nSettings');
  await step('company profile: bad GSTIN rejected, good profile saved', async () => {
    await go('#/settings');
    await page.locator('#s-companyName').fill('Test Solar Pvt Ltd');
    await page.locator('#s-gstin').fill('10AAKCN0009K1Z');
    await page.getByRole('button', { name: 'Save company profile' }).click();
    await toast(/GSTIN looks wrong/);
    await page.locator('#s-gstin').fill('10aakcn0009k1zw');
    await page.locator('#s-state').selectOption('Bihar');
    await page.locator('#s-address').fill('Gandhi Maidan, Patna');
    await page.locator('#s-bankName').fill('State Bank of India');
    await page.locator('#s-accountNo').fill('12345678901');
    await page.locator('#s-ifsc').fill('sbin0000152');
    await page.getByRole('button', { name: 'Save company profile' }).click();
    await toast(/Settings saved/);
    await page.getByRole('button', { name: 'Save company profile' }).click(); // second save from same screen
    await toast(/Settings saved/);
    await page.reload();
    must((await page.locator('#s-gstin').inputValue()) === '10AAKCN0009K1ZW', 'GSTIN not saved upper-case');
  });
  await step('dark mode can be chosen and survives reload', async () => {
    await go('#/settings?tab=account');
    await page.getByRole('button', { name: 'Dark', exact: true }).click();
    await page.reload();
    must((await page.evaluate(() => document.documentElement.dataset.theme)) === 'dark', 'theme not kept');
    await page.getByRole('button', { name: 'Light', exact: true }).click();
  });
  let staffPhone = 9431000001;
  const addUser = async (name, email, role) => {
    await page.getByRole('button', { name: '+ Add user' }).click();
    await page.locator('#u-name').fill(name);
    await page.locator('#u-email').fill(email);
    await page.locator('#u-phone').fill(String(staffPhone++));
    await page.locator('#u-role').selectOption(role);
    await page.locator('#u-pass').fill('Staff@12345');
    await page.getByRole('dialog').getByRole('button', { name: 'Save' }).click();
    await toast(/User saved/);
  };
  await step('users: add sales, technician, accounts and a user to disable; duplicate email refused', async () => {
    await go('#/settings?tab=users');
    await addUser('Sunita Sales', 'sales@test.in', 'sales');
    await addUser('Tarun Tech', 'tech@test.in', 'technician');
    await addUser('Anil Accounts', 'acc@test.in', 'accounts');
    await addUser('Gone Person', 'gone@test.in', 'sales');
    await page.getByRole('button', { name: '+ Add user' }).click();
    await page.locator('#u-name').fill('Dup');
    await page.locator('#u-email').fill('SALES@test.in');
    await page.locator('#u-phone').fill('9431000099');
    await page.locator('#u-pass').fill('Staff@12345');
    await page.getByRole('dialog').getByRole('button', { name: 'Save' }).click();
    await toast(/already exists/);
    await page.keyboard.press('Escape');
    await page.getByRole('row', { name: /Gone Person/ }).getByRole('button', { name: 'Edit' }).click();
    await page.getByRole('dialog').getByLabel('Active (can sign in)').uncheck();
    await page.getByRole('dialog').getByRole('button', { name: 'Save' }).click();
    await toast(/User saved/);
    await page.getByRole('row', { name: /Gone Person/ }).getByText('Disabled').waitFor();
  });
  await step('change my password: wrong current refused, then changed', async () => {
    await go('#/settings?tab=account');
    await page.locator('#p-old').fill('nope-nope-1');
    await page.locator('#p-new').fill('Owner@77777');
    await page.locator('#p-conf').fill('Owner@77777');
    await page.getByRole('button', { name: 'Change password' }).click();
    await toast(/Current password is wrong/);
    await page.locator('#p-old').fill(ADMIN.pass);
    await page.getByRole('button', { name: 'Change password' }).click();
    await toast(/Password changed/);
    ADMIN.pass = 'Owner@77777';
  });

  console.log('\nCRM');
  await step('lead form shows field errors, then saves with number and auto-assignment', async () => {
    await go('#/m/leads/new');
    await save();
    await page.getByText('Name is required').waitFor();
    await page.getByText('Phone is required').waitFor();
    await page.locator('#f-name').fill('Ravi Kumar');
    await page.locator('#f-phone').fill('98765 43210');
    await page.locator('#f-email').fill('ravi@mail.com');
    await page.locator('#f-city').fill('Patna');
    await page.locator('#f-source').selectOption('Facebook');
    await page.locator('#f-capacityKw').fill('3');
    await page.locator('#f-nextFollowUp').fill(`${plusDays(-1)}T10:00`);
    await save();
    await page.waitForURL(detailUrl('leads'));
    await heading('Ravi Kumar');
    await page.getByText('LD-0001').first().waitFor();
    await page.locator('dd', { hasText: 'Sunita Sales' }).waitFor(); // auto-assigned to the sales user
  });
  await step('duplicate phone in another format warns; "Save anyway" saves', async () => {
    await go('#/m/leads/new');
    await page.locator('#f-name').fill('Ravi Duplicate');
    await page.locator('#f-phone').fill('+91-9876543210');
    await save();
    await page.getByRole('dialog').getByText('Possible duplicate').waitFor();
    await dialogClick('Save anyway');
    await page.waitForURL(detailUrl('leads'));
  });
  await step('more leads for search/sort/board', async () => {
    for (const [n, p, c] of [['Asha Devi', '9123456780', 'Gaya'], ['Bimal Roy', '9123456781', 'Patna'], ['Chhaya Singh', '9123456782', 'Muzaffarpur']]) {
      await go('#/m/leads/new');
      await page.locator('#f-name').fill(n);
      await page.locator('#f-phone').fill(p);
      await page.locator('#f-city').fill(c);
      await save();
      await page.waitForURL(detailUrl('leads'));
    }
  });
  await step('unsaved-changes guard: leaving asks, Cancel keeps the edits', async () => {
    await go('#/m/leads');
    await page.getByRole('row', { name: /Asha Devi/ }).click();
    await page.getByRole('link', { name: 'Edit', exact: true }).click();
    await page.locator('#f-notes').fill('typed but not saved');
    await page.getByRole('link', { name: 'All apps' }).click();
    await page.getByRole('dialog').getByText('Discard unsaved changes?').waitFor();
    await dialogClick('Cancel');
    must((await page.locator('#f-notes').inputValue()) === 'typed but not saved', 'edits lost');
    await save();
    await page.waitForURL(detailUrl('leads'));
    await page.getByText('typed but not saved', { exact: true }).first().waitFor();
  });
  await step('search, stage filter and column sort', async () => {
    await go('#/m/leads');
    await page.getByLabel('Search', { exact: true }).fill('gaya');
    await page.getByText('1 record(s)').waitFor();
    await page.getByLabel('Search', { exact: true }).fill('');
    await page.getByRole('button', { name: /^Name/ }).click();
    const first = await page.locator('tbody tr').first().innerText();
    must(first.includes('Asha Devi'), 'sort by name failed: ' + first);
    // Search panel: a ready-made filter, a field search and grouping.
    await page.getByRole('button', { name: 'Filters, group by and favorites' }).click();
    const panel = page.getByRole('dialog', { name: 'Filters, group by and favorites' });
    await panel.getByRole('button', { name: /^New\b/ }).click();
    await page.getByRole('button', { name: 'Remove Stage: New' }).waitFor();
    await page.locator('tbody tr').first().waitFor();
    await panel.getByRole('button', { name: 'Source', exact: true }).click();
    await page.keyboard.press('Escape');
    await page.locator('tr.group-row').first().waitFor();
    await page.locator('tr.group-row button').first().click();
    await page.locator('tbody tr.clickable').first().waitFor();
    await page.getByRole('button', { name: /^Remove Group by/ }).click();
    await page.getByRole('button', { name: 'Remove Stage: New' }).click();
    await page.getByLabel('Search', { exact: true }).fill('gaya');
    await page.getByRole('option', { name: /Search City for: gaya/ }).click();
    await page.getByRole('button', { name: 'Remove City: gaya' }).waitFor();
    await page.getByText('1 record(s)').waitFor();
    await page.getByRole('button', { name: 'Remove City: gaya' }).click();
  });
  await step('board view: move a lead to another stage', async () => {
    await go('#/m/leads?view=board');
    await page.getByLabel('Move Bimal Roy').selectOption('Contacted');
    await toast(/Moved to Contacted/);
    await page.locator('section[aria-label="Contacted"]').getByText('Bimal Roy').waitFor();
  });
  await step('WhatsApp: message shown and editable, opens the right chat, noted in history; call link', async () => {
    // WhatsApp itself is not opened in the test (no internet needed): its address is answered locally.
    await ctx.route('https://wa.me/**', (r) => r.fulfill({ status: 200, contentType: 'text/html', body: '<title>WhatsApp</title>ok' }));
    await go('#/m/leads');
    await page.getByRole('row', { name: /Ravi Kumar/ }).first().click();
    await page.getByRole('button', { name: 'WhatsApp', exact: true }).click();
    const dlg = page.getByRole('dialog', { name: /WhatsApp Ravi Kumar/ });
    await dlg.getByText('+91 98765 43210').waitFor();
    const box = dlg.getByLabel('Message');
    must((await box.inputValue()).startsWith('Hello Ravi Kumar, thank you for your interest in solar.'), 'lead message: ' + await box.inputValue());
    await box.fill('Namaste Ravi ji, survey kal 11 baje?');
    const href = await dlg.getByRole('link', { name: 'Open WhatsApp' }).getAttribute('href');
    must(href === 'https://wa.me/919876543210?text=' + encodeURIComponent('Namaste Ravi ji, survey kal 11 baje?'), 'bad WhatsApp link ' + href);
    const [popup] = await Promise.all([page.waitForEvent('popup'), dlg.getByRole('link', { name: 'Open WhatsApp' }).click()]);
    must(popup.url().startsWith('https://wa.me/919876543210'), 'opened ' + popup.url());
    await popup.close();
    await page.getByText(/WhatsApp to Ravi Kumar \(\+91 98765 43210\): Namaste Ravi ji, survey kal 11 baje\?/).waitFor({ timeout: T });
    const tel = await page.locator('a[href^="tel:"]').first().getAttribute('href');
    must(tel === 'tel:9876543210', 'bad tel link ' + tel);
    // Settings → WhatsApp: the business number and Hindi messages.
    await go('#/settings?tab=whatsapp');
    await page.locator('#w-number').fill('98765 00000');
    await page.getByRole('button', { name: 'Use Hindi messages' }).click();
    await page.getByRole('button', { name: 'Save WhatsApp settings' }).click();
    await toast(/Settings saved/);
    await go('#/m/leads');
    await page.getByRole('row', { name: /Ravi Kumar/ }).first().click();
    await page.getByRole('button', { name: 'WhatsApp', exact: true }).click();
    must((await page.getByRole('dialog').getByLabel('Message').inputValue()).startsWith('नमस्ते Ravi Kumar जी'), 'Hindi message not used');
    await page.getByRole('dialog').getByRole('button', { name: 'Cancel' }).click();
    await go('#/settings?tab=whatsapp');
    await page.getByRole('button', { name: 'Use English messages' }).click();
    await page.getByRole('button', { name: 'Save WhatsApp settings' }).click();
    await toast(/Settings saved/);
    await go('#/m/leads'); // back on the lead for the next step
    await page.getByRole('row', { name: /Ravi Kumar/ }).first().click();
    await page.getByRole('heading', { name: 'Ravi Kumar' }).waitFor();
  });
  await step('marking a lead Won creates the customer automatically', async () => {
    await page.getByRole('link', { name: 'Edit', exact: true }).click();
    await page.locator('#f-status').selectOption('Won');
    await save();
    await page.waitForURL(detailUrl('leads'));
    await page.getByRole('link', { name: 'Open customer' }).click();
    await heading('Ravi Kumar');
  });
  await step('"Convert to customer" button on another lead', async () => {
    await go('#/m/leads');
    await page.getByRole('row', { name: /Chhaya Singh/ }).click();
    await page.getByRole('button', { name: 'Convert to customer' }).click();
    await page.waitForURL(detailUrl('customers'));
    await heading('Chhaya Singh');
  });
  await step('activity linked to a lead appears on the lead', async () => {
    await go('#/m/activities/new');
    await page.locator('#f-subject').fill('First call');
    await selectByText('#f-leadId', 'Asha Devi');
    await save();
    await page.waitForURL(detailUrl('activities'));
    await page.getByRole('link', { name: 'Asha Devi' }).click();
    await page.getByRole('heading', { name: /Activities & Notes \(1\)/ }).waitFor();
  });
  await step('export: CSV (all leads, readable phone), Excel and PDF files', async () => {
    await go('#/m/leads');
    const pick = async (kind) => {
      await page.getByRole('button', { name: 'Export: choose a file type' }).first().click();
      const [dl] = await Promise.all([page.waitForEvent('download'), page.getByRole('navigation', { name: 'Export as' }).getByRole('button', { name: new RegExp('^' + kind) }).click()]);
      return { name: dl.suggestedFilename(), bytes: readFileSync(await dl.path()) };
    };
    const csv = await pick('CSV');
    const text = csv.bytes.toString('utf8');
    must(csv.name.endsWith('.csv') && text.includes('Ravi Kumar') && text.includes('Asha Devi') && text.split('\n').length >= 6, 'export missing rows');
    must(text.includes('98765 43210') && !text.includes("'+91"), 'phone should read 98765 43210, with no stray apostrophe');
    const xlsx = await pick('Excel');
    must(xlsx.name.endsWith('.xlsx') && xlsx.bytes.subarray(0, 2).toString() === 'PK' && xlsx.bytes.includes('Ravi Kumar'), 'Excel file wrong');
    const pdf = await pick('PDF');
    must(pdf.name.endsWith('.pdf') && pdf.bytes.subarray(0, 5).toString() === '%PDF-' && pdf.bytes.length > 5000, 'PDF file wrong');
  });
  await step('CSV import: adds good rows, skips duplicates, lists errors', async () => {
    const csv = join(OUT, 'leads.csv');
    writeFileSync(csv, 'Name,Phone,City,Source,Stage\nNew One,9000011111,Ara,instagram,new\nDup Ravi,09876543210,Patna,Call,New\n,9000022222,Gaya,Call,New\nNew Two,9000033333,Siwan,Referral,Contacted\n');
    await go('#/m/leads');
    await page.locator('input[type=file][accept*=csv]').setInputFiles(csv);
    await dialogClick('Import');
    await toast(/Imported 2\. Skipped 1 duplicate/);
    await page.getByRole('dialog').getByText(/Row 4: Name is required/).waitFor();
    await dialogClick('Close');
    await page.getByRole('row', { name: /New One/ }).getByText('Instagram').waitFor();
  });

  console.log('\nSurvey, quotation, invoice, payment');
  await step('site survey scheduled from a lead (lead pre-filled)', async () => {
    await go('#/m/leads');
    await page.getByRole('row', { name: /Asha Devi/ }).click();
    await page.getByRole('link', { name: 'Schedule survey' }).click();
    must((await page.locator('#f-leadId option:checked').textContent()).includes('Asha Devi'), 'lead not pre-filled');
    await page.locator('#f-roofType').selectOption('RCC');
    await page.locator('#f-recommendedKw').fill('3.24');
    await page.locator('#f-photo').setInputFiles(png);
    await page.getByRole('button', { name: /site\.png/ }).waitFor();
    await save();
    await page.waitForURL(detailUrl('surveys'));
  });
  await step('products: panel, inverter and service', async () => {
    for (const [n, sku, cat, price, gst, hsn, reorder] of [
      ['Panel 540Wp', 'PNL540', 'Solar Panel', '14500', '12', '8541', '5'],
      ['Inverter 3kW', 'INV3K', 'Inverter', '38000', '12', '8504', '1'],
      ['Installation service', 'SRV1', 'Service', '15000.45', '18', '9954', '0']]) {
      await go('#/m/products/new');
      await page.locator('#f-name').fill(n);
      await page.locator('#f-sku').fill(sku);
      await page.locator('#f-category').selectOption(cat);
      await page.locator('#f-price').fill(price);
      await page.locator('#f-gstRate').selectOption(gst);
      await page.locator('#f-hsn').fill(hsn);
      await page.locator('#f-reorderLevel').fill(reorder);
      await save();
      await page.waitForURL(detailUrl('products'));
    }
  });
  let quoteUrl = '';
  await step('quotation: product picker fills rate/GST, totals are correct', async () => {
    await go('#/m/customers');
    await page.getByRole('row', { name: /Ravi Kumar/ }).click();
    await page.getByRole('link', { name: 'New quotation' }).click();
    await page.getByRole('button', { name: '+ Add line' }).click();
    await selectByText('.items-table [aria-label="Product for line 1"]', 'Panel 540Wp');
    await page.getByLabel('Quantity line 1').fill('6');
    await page.getByRole('button', { name: '+ Add line' }).click();
    await selectByText('.items-table [aria-label="Product for line 2"]', 'Inverter 3kW');
    await page.getByRole('button', { name: '+ Add line' }).click();
    await selectByText('.items-table [aria-label="Product for line 3"]', 'Installation service');
    must((await page.getByLabel('Rate line 1').inputValue()) === '14500', 'rate not filled');
    // 87000 + 38000 + 15000.45 = 140000.45 ; tax 10440 + 4560 + 2700.08 = 17700.08 ; total 157700.53 → 157701
    await page.locator('.totals .grand', { hasText: '₹1,57,701.00' }).waitFor();
    await page.locator('.totals', { hasText: 'Round off' }).waitFor();
    await save();
    await page.waitForURL(detailUrl('quotations'));
    quoteUrl = page.url();
    await heading(`QT/${FY}/0001`);
  });
  await step('quotation prints with amount in words', async () => {
    await page.getByRole('link', { name: 'Print / PDF' }).click();
    await page.locator('.doc').getByText('Quotation', { exact: true }).waitFor();
    await page.locator('.doc').getByText(/One Lakh Fifty Seven Thousand Seven Hundred One Rupees Only/).waitFor();
  });
  let invUrl = '';
  await step('quotation → draft invoice (no number yet) → issued gets INV/…/0001; cannot be converted twice', async () => {
    await page.goto(quoteUrl);
    await page.getByRole('button', { name: 'Convert to invoice' }).click();
    await page.waitForURL(detailUrl('invoices'));
    invUrl = page.url();
    await page.getByRole('heading', { name: /^Draft invoice of / }).waitFor();
    await page.goto(quoteUrl);
    await page.getByRole('link', { name: 'Open draft invoice' }).click();
    await page.waitForURL(invUrl);
    await page.getByRole('button', { name: 'Issue invoice' }).click();
    await page.getByRole('dialog', { name: 'Issue this invoice?' }).getByRole('button', { name: 'Issue invoice' }).click();
    await page.getByText(`Invoice INV/${FY}/0001 issued`).waitFor();
    await heading(`INV/${FY}/0001`);
    await page.goto(quoteUrl);
    await page.getByRole('link', { name: new RegExp(`Open invoice INV/${FY}/0001`) }).waitFor();
    must(!(await page.getByRole('button', { name: 'Convert to invoice' }).count()), 'convert offered twice');
  });
  await step('invoice: place of supply, due date, CGST+SGST, HSN summary in print', async () => {
    await page.goto(invUrl);
    await page.locator('dd', { hasText: plusDays(15).split('-').reverse()[0] }).first().waitFor(); // due date = +15 days
    await page.getByRole('link', { name: 'Print / PDF' }).click();
    const doc = page.locator('.doc');
    await doc.getByRole('heading', { name: 'Tax Invoice', exact: true }).waitFor();
    await doc.getByText('Reverse charge').waitFor();
    await doc.locator('table.doc-hsn').getByText('HSN/SAC').waitFor();
    await doc.getByText('CGST', { exact: true }).first().waitFor();
    await doc.getByText('Bank details').waitFor();
    await doc.getByText('State Bank of India').first().waitFor();
    must(!(await doc.getByText('IGST').count()), 'IGST shown for same-state customer');
    await doc.getByText('WhatsApp +91 98765 00000').waitFor(); // the business number from Settings → WhatsApp
    // Share on WhatsApp: the invoice message, with the two steps to attach the PDF.
    await page.getByRole('button', { name: 'Share on WhatsApp' }).click();
    const share = page.getByRole('dialog', { name: /WhatsApp/ });
    await share.getByText('Save as PDF', { exact: false }).first().waitFor();
    must((await share.getByLabel('Message').inputValue()).includes(`invoice INV/${FY}/0001`), 'invoice message missing its number');
    must((await share.getByRole('link', { name: 'Open WhatsApp' }).getAttribute('href')).includes(encodeURIComponent(`INV/${FY}/0001`)), 'share link without the invoice');
    await share.getByRole('button', { name: 'Cancel' }).click();
  });
  await step('payments: partial, overpayment refused, full → Paid; receipt prints', async () => {
    await page.goto(invUrl);
    await page.getByRole('link', { name: 'Record payment' }).click();
    must((await page.locator('#f-amount').inputValue()) === '157701', 'balance not pre-filled');
    await page.locator('#f-amount').fill('200000');
    await save();
    await page.getByText(/more than the balance due/).waitFor();
    await page.locator('#f-amount').fill('57701');
    await page.locator('#f-mode').selectOption('UPI');
    await page.locator('#f-reference').fill('UTR123');
    await save();
    await page.waitForURL(detailUrl('payments'));
    await heading(`RC/${FY}/0001`);
    await page.getByRole('link', { name: 'Print / PDF' }).click();
    await page.locator('.doc').getByText('Payment Receipt').waitFor();
    await page.goto(invUrl);
    await page.locator('.badge', { hasText: 'Partially Paid' }).waitFor();
    must(!(await page.getByRole('button', { name: 'Cancel invoice' }).count()), 'cancel offered with payments');
    await page.getByRole('link', { name: 'Record payment' }).click();
    must((await page.locator('#f-amount').inputValue()) === '100000', 'remaining balance wrong');
    await save();
    await page.waitForURL(detailUrl('payments'));
    await page.goto(invUrl);
    await page.locator('.badge', { hasText: /^Paid$/ }).waitFor();
    must(!(await page.getByRole('link', { name: 'Record payment' }).count()), 'payment offered on paid invoice');
  });
  await step('other-state customer gets IGST; invoice can be cancelled but never deleted', async () => {
    await go('#/m/customers/new');
    await page.locator('#f-name').fill('Delhi Buyer');
    await page.locator('#f-phone').fill('9811100000');
    await page.locator('#f-gstin').fill('07AAKCN0009K1ZW');
    await save();
    await page.waitForURL(detailUrl('customers'));
    await page.locator('dd', { hasText: 'Delhi' }).first().waitFor(); // state filled from GSTIN
    await go('#/m/invoices/new');
    await selectByText('#f-customerId', 'Delhi Buyer');
    await page.getByRole('button', { name: '+ Add line' }).click();
    await page.getByLabel('Description line 1').fill('Panel');
    await page.getByLabel('Rate line 1').fill('1000');
    await page.getByLabel('GST line 1').fill('12');
    await page.locator('.totals', { hasText: 'IGST' }).waitFor();
    await save();
    await page.waitForURL(detailUrl('invoices'));
    await page.getByRole('link', { name: 'Print / PDF' }).click();
    await page.locator('.doc').getByText('IGST').first().waitFor();
    await page.getByRole('link', { name: '← Back' }).click();
    must(!(await page.getByRole('button', { name: 'Delete' }).count()), 'Delete offered on invoice');
    await page.getByRole('button', { name: 'Cancel invoice' }).click();
    await dialogClick('Cancel invoice');
    await toast(/cancelled/);
    await page.locator('.badge', { hasText: 'Cancelled' }).first().waitFor();
  });

  console.log('\nProjects & installation');
  let projectUrl = '';
  await step('project from customer page, with milestones and progress', async () => {
    await go('#/m/customers');
    await page.getByRole('row', { name: /Ravi Kumar/ }).click();
    await page.getByRole('link', { name: 'New project' }).click();
    await page.locator('#f-name').fill('Ravi 3.24 kW rooftop');
    await page.locator('#f-capacityKw').fill('3.24');
    await page.locator('#f-startDate').fill(plusDays(-10));
    await page.locator('#f-dueDate').fill(plusDays(20));
    await page.getByLabel('Site survey done').check();
    await page.getByLabel('Design approved').check();
    await page.locator('#f-progress').fill('30');
    await save();
    await page.waitForURL(detailUrl('projects'));
    projectUrl = page.url();
    await page.getByText('✅ Design approved').waitFor();
  });
  await step('target date before start date is refused', async () => {
    await page.getByRole('link', { name: 'Edit', exact: true }).click();
    await page.locator('#f-dueDate').fill(plusDays(-20));
    await save();
    await page.getByText('Target date cannot be before start date').waitFor();
    await page.locator('#f-dueDate').fill(plusDays(20));
    await save();
    await page.waitForURL(detailUrl('projects'));
  });
  await step('task from project, then moved to Done on the board', async () => {
    await page.getByRole('link', { name: 'Add task' }).click();
    await page.locator('#f-title').fill('Order structure');
    await page.locator('#f-priority').selectOption('High');
    await save();
    await page.waitForURL(detailUrl('tasks'));
    await go('#/m/tasks?view=board');
    await page.getByLabel('Move Order structure').selectOption('Done');
    await page.locator('section[aria-label="Done"]').getByText('Order structure').waitFor();
  });
  let instUrl = '';
  await step('installation: checklist, map link, completion certificate', async () => {
    await page.goto(projectUrl);
    await page.getByRole('link', { name: 'Schedule installation' }).click();
    await selectByText('#f-technician', 'Tarun Tech');
    await page.getByLabel('Panels fixed').check();
    await page.locator('#f-siteLat').fill('25.6093');
    await page.locator('#f-siteLng').fill('85.1376');
    await page.locator('#f-status').selectOption('Completed');
    await page.getByLabel('Customer confirmed completion').check();
    await save();
    await page.waitForURL(detailUrl('installations'));
    instUrl = page.url();
    const maps = await page.getByRole('link', { name: 'Open in Google Maps' }).getAttribute('href');
    must(maps.includes('25.6093,85.1376'), 'bad maps link');
    await page.getByRole('link', { name: 'Print / PDF' }).click();
    await page.locator('.doc').getByText('Installation & Commissioning Certificate').waitFor();
    await page.locator('.doc').getByText('Customer confirmed completion').waitFor();
    await page.locator('.doc').getByText(/installed and commissioned/).waitFor();
  });
  if (ENGINE === 'chromium') await step('site photo with the app camera: live place + GPS stamp, saved on the installation with its place', async () => {
    await ctx.grantPermissions(['geolocation', 'camera']);
    await ctx.setGeolocation({ latitude: 25.6093, longitude: 85.1376, accuracy: 8 });
    await page.goto(instUrl);
    await page.getByRole('heading', { name: /Photos & documents \(0\)/ }).waitFor({ timeout: T });
    await page.getByRole('button', { name: '📷 Site photo' }).click();
    const cam = page.getByRole('dialog', { name: 'SuryaSetu Camera' });
    await cam.getByText('Patna, Bihar, India').first().waitFor({ timeout: 15000 });
    await cam.getByText(/Lat 25\.609300° {2}Long 85\.137600°|25\.6093/).first().waitFor({ timeout: T });
    await page.waitForTimeout(800); // a frame from the fake camera
    await cam.getByRole('button', { name: 'Take photo', exact: true }).click();
    const shot = cam.getByRole('img').first();
    await shot.waitFor({ timeout: 15000 });
    const size = await shot.evaluate((i) => [i.naturalWidth, i.naturalHeight]);
    must(size[0] > 300 && size[1] > 200, `stamped photo too small: ${size}`);
    await cam.getByRole('button', { name: 'Use photo' }).click();
    await toast(/Photo saved with its location: .*Patna/);
    await page.getByRole('heading', { name: /Photos & documents \(1\)/ }).waitFor({ timeout: T });
    await page.getByRole('link', { name: /^Site photo — / }).first().click();
    await page.waitForURL(detailUrl('documents'));
    await page.locator('dd', { hasText: 'Patna' }).first().waitFor({ timeout: T });
    await page.locator('dd', { hasText: '25.6093' }).first().waitFor({ timeout: T }); // coordinates to 6 decimals, not 25.609
    // The photo's time is local time: within a few minutes of when the document was created.
    const dd = async (label) => (await page.locator('.dl > div', { has: page.locator('dt', { hasText: new RegExp(`^${label}$`) }) }).locator('dd').innerText()).trim();
    const parse = (t) => { const m = t.match(/(\d{1,2}) (\w{3}) (\d{4}),? (\d{1,2}):(\d{2})\s*(am|pm)/i); must(m, `cannot read time "${t}"`);
      const h = (Number(m[4]) % 12) + (/pm/i.test(m[6]) ? 12 : 0); return new Date(`${m[2]} ${m[1]} ${m[3]} ${h}:${m[5]}`).getTime(); };
    const taken = await dd('Photo taken on'), created = (await dd('Created')).split(' by ')[0];
    must(Math.abs(parse(taken) - parse(created)) <= 5 * 60000, `photo time ${taken} is not local time (created ${created})`);
  });

  console.log('\nInventory & purchase');
  await step('stock in, over-dispatch refused, dispatch, low-stock alert', async () => {
    await go('#/m/warehouses/new');
    await page.locator('#f-name').fill('Main Godown');
    await save();
    await page.waitForURL(detailUrl('warehouses'));
    const move = async (dir, qty, ok = true) => {
      await go('#/m/stockMoves/new');
      await selectByText('#f-productId', 'Panel 540Wp');
      await selectByText('#f-warehouseId', 'Main Godown');
      await page.locator('#f-direction').selectOption(dir);
      await page.locator('#f-qty').fill(String(qty));
      await save();
      if (ok) await page.waitForURL(detailUrl('stockMoves'));
    };
    await move('In', 10);
    await move('Out', 20, false);
    await page.getByText(/Only 10 in stock/).waitFor();
    await move('Out', 6);
    await go('#/m/products');
    await page.getByRole('row', { name: /Panel 540Wp/ }).getByRole('cell', { name: '4', exact: true }).waitFor();
    await go('#/alerts');
    await page.getByText('Low stock: Panel 540Wp (4 left)').waitFor();
  });
  let poUrl = '';
  await step('vendor state from GSTIN; purchase order Received adds stock once', async () => {
    await go('#/m/vendors/new');
    await page.locator('#f-name').fill('Sun Supplies');
    await page.locator('#f-gstin').fill('10ABCDE1234F1Z5');
    await save();
    await page.waitForURL(detailUrl('vendors'));
    await page.locator('dd', { hasText: 'Bihar' }).waitFor();
    await go('#/m/purchaseOrders/new');
    await selectByText('#f-vendorId', 'Sun Supplies');
    await page.getByRole('button', { name: '+ Add line' }).click();
    await selectByText('.items-table [aria-label="Product for line 1"]', 'Panel 540Wp');
    await page.getByLabel('Quantity line 1').fill('5');
    // The product has no purchase cost saved: the line asks for it (never our sale price).
    await page.locator('.items-table').getByText('Enter the purchase cost').first().waitFor({ timeout: T });
    must((await page.getByLabel('Rate line 1').inputValue()) === '0', 'PO line took a price that is not the purchase cost');
    await page.getByLabel('Rate line 1').fill('11000');
    await save();
    await page.waitForURL(detailUrl('purchaseOrders'));
    poUrl = page.url();
    await page.getByRole('link', { name: 'Edit', exact: true }).click();
    await page.locator('#f-status').selectOption('Received');
    await save();
    await toast(/Added 1 item\(s\)/);
    await page.goto(poUrl);
    await page.getByRole('link', { name: 'Edit', exact: true }).click();
    await page.locator('#f-status').selectOption('Ordered');
    await save();
    await page.getByText('This order was already received into stock. Its status can no longer be changed.').waitFor();
    await page.goto(poUrl);
    await dialogClick('Discard').catch(() => {});
    await page.waitForURL(detailUrl('purchaseOrders'));
    await go('#/m/products');
    await page.getByRole('row', { name: /Panel 540Wp/ }).getByRole('cell', { name: '9', exact: true }).waitFor();
    await page.goto(poUrl);
    await page.getByRole('link', { name: 'Print / PDF' }).click();
    await page.locator('.doc').getByText('Purchase Order', { exact: true }).waitFor();
  });
  await step('supplier payment: part paid, overpayment refused; order shows paid / still to pay; Reports count it', async () => {
    const dd = (label) => page.locator('.dl > div', { has: page.locator('dt', { hasText: new RegExp(`^${label}$`) }) }).locator('dd');
    await page.goto(poUrl);
    await page.getByRole('link', { name: 'Record supplier payment' }).click();
    await page.waitForURL(/#\/m\/supplierPayments\/new/);
    const due = Number(await page.locator('#f-amount').inputValue());
    must(due > 1000, `amount still to pay not filled in (${due})`);
    await page.locator('#f-amount').fill(String(due + 500));
    await save();
    await page.getByText(/More than is still to pay on /).first().waitFor({ timeout: T });
    await page.locator('#f-amount').fill('1000');
    await page.locator('#f-mode').selectOption('UPI');
    await save();
    await page.waitForURL(detailUrl('supplierPayments'));
    await page.goto(poUrl);
    must((await dd('Paid').innerText()).includes(inr(1000)), 'order does not show the payment');
    must((await dd('Still to pay').innerText()).includes(inr(Math.round((due - 1000) * 100) / 100)), 'still to pay is wrong');
    await go('#/reports');
    await page.locator('.kpi', { hasText: 'Paid to suppliers' }).getByText(inr(1000)).waitFor({ timeout: T });
  });

  console.log('\nVersion 2: challans, print templates, discounts, location, views, search');
  await step('delivery challan: send material takes stock out once; cancel puts it back; challan prints', async () => {
    await page.goto(projectUrl);
    await page.getByRole('link', { name: 'Send material' }).click();
    await heading('New Delivery Challan');
    await page.getByRole('button', { name: '+ Add line' }).click();
    await selectByText('.items-table [aria-label="Product for line 1"]', 'Panel 540Wp');
    await page.getByLabel('Quantity line 1').fill('2');
    await page.locator('.items-table').getByText(/In stock: 9/).waitFor();
    await page.locator('#f-vehicleNo').fill('BR01AB1234');
    await page.locator('#f-status').selectOption('Dispatched');
    await save();
    await page.waitForURL(detailUrl('dispatches'));
    await toast(/Took 1 item\(s\)/);
    const dcUrl = page.url();
    await go('#/m/products');
    await page.getByRole('row', { name: /Panel 540Wp/ }).getByRole('cell', { name: '7', exact: true }).waitFor();
    await page.goto(dcUrl);
    await page.getByRole('link', { name: 'Print / PDF' }).click();
    await page.locator('.doc').getByText('Delivery Challan', { exact: true }).waitFor();
    await page.locator('.doc').getByText('BR01AB1234').waitFor();
    await page.goto(dcUrl);
    await page.getByRole('link', { name: 'Edit', exact: true }).click();
    await page.locator('#f-status').selectOption('Cancelled');
    await save();
    await toast(/Put 1 item\(s\)/);
    await go('#/m/products');
    await page.getByRole('row', { name: /Panel 540Wp/ }).getByRole('cell', { name: '9', exact: true }).waitFor();
  });
  await step('quotation line discount: GST on the discounted value', async () => {
    await go('#/m/quotations/new');
    await selectByText('#f-customerId', 'Ravi Kumar');
    await page.getByRole('button', { name: '+ Add line' }).click();
    await page.getByLabel('Description line 1').fill('Panel cleaning kit');
    await page.getByLabel('Quantity line 1').fill('2');
    await page.getByLabel('Rate line 1').fill('1000');
    await page.getByLabel('Discount line 1').fill('10');
    await page.getByLabel('GST line 1').fill('18');
    const totals = page.locator('.totals').first();
    await totals.getByText('₹200.00').waitFor(); // line discount
    await totals.getByText('₹2,124.00').waitFor(); // 1800 + 9% + 9%
    await save();
    await page.waitForURL(detailUrl('quotations'));
    await page.getByRole('link', { name: 'Print / PDF' }).click();
    await page.locator('.doc').getByText('Disc %').waitFor();
    await page.locator('.doc').getByText('Two Thousand One Hundred Twenty Four Rupees Only').waitFor();
  });
  await step('customer: PIN code fills the state; “Use my location” fills GPS', async () => {
    await ctx.grantPermissions(['geolocation']);
    await ctx.setGeolocation({ latitude: 26.9124, longitude: 75.7873 });
    await go('#/m/customers/new');
    await page.locator('#f-name').fill('Jaipur Rooftops');
    await page.locator('#f-phone').fill('9123400001');
    await page.locator('#f-pincode').fill('302001');
    if (ENGINE === 'firefox') {
      // Playwright cannot fake GPS in headless Firefox, so type the position as a user without GPS would.
      await page.locator('#f-lat').fill('26.9124');
      await page.locator('#f-lng').fill('75.7873');
    } else {
      await page.getByRole('button', { name: /Use my location/ }).click();
      await toast(/Location added/);
    }
    must((await page.locator('#f-lat').inputValue()) === '26.9124', 'latitude not filled');
    await save();
    await page.waitForURL(detailUrl('customers'));
    await page.locator('dd', { hasText: 'Rajasthan' }).waitFor();
    must(!!(await page.getByRole('link', { name: 'Open in Google Maps' }).count()), 'maps link missing');
  });
  await step('print template: modern layout, UPI shown, no QR once fully paid', async () => {
    await go('#/settings?tab=print');
    await page.locator('#p-upi').fill('bad-upi');
    await page.getByRole('button', { name: 'Save print settings' }).click();
    await toast(/UPI ID looks wrong/);
    await page.locator('#p-upi').fill('testsolar@okaxis');
    await page.locator('#p-tpl').selectOption('modern');
    await page.getByRole('button', { name: 'Save print settings' }).click();
    await toast('Print settings saved');
    await page.goto(invUrl);
    await page.getByRole('link', { name: 'Print / PDF' }).click();
    await page.locator('.doc.tpl-modern').waitFor();
    await page.locator('.doc').getByText('UPI: testsolar@okaxis').waitFor();
    must(!(await page.locator('.doc .qr').count()), 'paid invoice should not show a pay-now QR');
  });
  await step('customer statement, global search, pivot and map views', async () => {
    await go('#/');
    await page.getByLabel('Search everything').fill('Ravi');
    await page.getByRole('option', { name: /^Customer\s*Ravi Kumar/ }).first().click();
    await heading('Ravi Kumar');
    await page.getByRole('link', { name: 'Statement (PDF)' }).click();
    await page.locator('.doc').getByText('Statement of Account').waitFor();
    await page.locator('.doc').getByText(/Closing balance/).waitFor();
    await go('#/m/invoices?view=pivot');
    await page.locator('table.pivot tfoot').waitFor();
    await go('#/m/customers?view=map');
    await page.locator('.india-map path.map-state').first().waitFor();
    must((await page.locator('.india-map path.map-state').count()) === 36, 'map should show 36 states/UTs');
    await page.getByRole('cell', { name: 'Rajasthan' }).waitFor();
  });

  await step('India map: states → state filter zooms to cities → city zooms to each customer', async () => {
    const level = (l) => page.waitForFunction((x) => document.querySelector('.india-map svg')?.dataset.level === x, l, { timeout: T });
    await go('#/m/customers?view=map');
    await page.locator('.india-map .map-dot').first().waitFor();
    await level('state');
    await page.getByRole('button', { name: /^Rajasthan: \d+ customers/ }).waitFor();
    await page.locator('#map-state').selectOption('Rajasthan');
    await level('city');
    await page.getByRole('heading', { name: 'Rajasthan · cities' }).waitFor();
    must((await page.locator('.map-labels text').allTextContents()).includes('Jaipur'), 'city name Jaipur not on the map');
    must((await page.locator('#map-state option:checked').textContent()).startsWith('Rajasthan ('), 'filter should show the count');
    await page.getByRole('button', { name: /^Jaipur.*: \d+ customers/ }).click();
    await level('record');
    await page.getByRole('heading', { name: /^Jaipur · \d+/ }).waitFor();
    await page.locator('.india-map').getByRole('button', { name: 'Jaipur Rooftops' }).click();
    await heading('Jaipur Rooftops');
    await page.goBack();
    await page.locator('.india-map .map-dot').first().waitFor();
    await page.getByRole('button', { name: 'Zoom in' }).click();
    await page.getByRole('button', { name: 'All India', exact: true }).first().click();
    await level('state');
  });
  await step('create vendor and product from inside a purchase order (popup, no page change)', async () => {
    await go('#/m/purchaseOrders/new');
    await heading('New Purchase Order');
    await page.locator('#f-vendorId').selectOption('__create_new__');
    const dlg = page.getByRole('dialog', { name: 'New vendor' });
    await dlg.waitFor();
    await page.locator('#qc-name').fill('Quick Solar Traders');
    await page.locator('#qc-state').selectOption('Rajasthan');
    await page.locator('#qc-name').press('Enter'); // saves the popup only
    await dlg.waitFor({ state: 'detached' });
    must((await page.locator('#f-vendorId option:checked').textContent()).includes('Quick Solar Traders'), 'new vendor not chosen');
    await heading('New Purchase Order');
    await page.getByRole('button', { name: '+ Add line' }).click();
    await page.getByLabel('Description line 1').first().fill('Quick Inverter 5 kW');
    await page.getByLabel('Rate line 1').first().fill('30000');
    await page.locator('.items-table').getByLabel('Product for line 1').selectOption('__create_new__');
    const pdlg = page.getByRole('dialog', { name: 'New product' });
    await pdlg.waitFor();
    must((await page.locator('#qc-name').inputValue()) === 'Quick Inverter 5 kW', 'product name not taken from the line');
    must((await page.locator('#qc-cost').inputValue()) === '30000', 'purchase cost not taken from the line');
    await page.locator('#qc-sku').fill('QINV-5');
    await page.locator('#qc-category').selectOption('Inverter');
    await pdlg.getByRole('button', { name: 'Create product' }).click();
    await pdlg.waitFor({ state: 'detached' });
    must((await page.locator('.items-table').getByLabel('Product for line 1').locator('option:checked').textContent()).includes('Quick Inverter 5 kW'), 'new product not on the line');
    await save();
    await page.waitForURL(detailUrl('purchaseOrders'));
    await page.getByText('Quick Solar Traders').first().waitFor();
    await go('#/m/products');
    await page.getByRole('cell', { name: 'QINV-5' }).waitFor();
  });

  console.log('\nFinance, subsidy, loans, service, documents, staff');
  await step('expense with receipt photo; photo opens', async () => {
    await go('#/m/expenses/new');
    await page.locator('#f-description').fill('Truck hire');
    await page.locator('#f-category').selectOption('Transport');
    await page.locator('#f-amount').fill('2500');
    await page.locator('#f-receipt').setInputFiles(png);
    await page.getByRole('button', { name: /site\.png/ }).waitFor();
    await save();
    await page.waitForURL(detailUrl('expenses'));
    const [popup] = await Promise.all([page.waitForEvent('popup'), page.getByRole('button', { name: /site\.png/ }).click()]);
    await popup.locator('img').waitFor({ timeout: T });
    await popup.close();
  });
  await step('document upload is required; PDF opens', async () => {
    await go('#/m/documents/new');
    await page.locator('#f-name').fill('Aadhaar - Ravi');
    await page.locator('#f-category').selectOption('KYC');
    await save();
    await page.getByText('File is required').waitFor();
    await page.locator('#f-file').setInputFiles(pdf);
    await page.getByRole('button', { name: /kyc\.pdf/ }).waitFor();
    await save();
    await page.waitForURL(detailUrl('documents'));
    // Browsers with a PDF viewer show it; test browsers have it switched off and download it. Either is correct.
    const outcome = new Promise((resolve) => {
      ctx.once('page', (p) => {
        p.on('download', () => resolve('downloaded'));
        p.waitForURL(/^blob:/, { timeout: 6000 }).then(() => resolve('shown'), () => {});
      });
      setTimeout(() => resolve('nothing'), 7000);
    });
    const popupP = page.waitForEvent('popup');
    await page.getByRole('button', { name: /kyc\.pdf/ }).click();
    const popup = await popupP;
    must((await outcome) !== 'nothing', 'PDF neither shown nor downloaded');
    await popup.close().catch(() => {});
  });
  await step('subsidy application through its stages', async () => {
    await go('#/m/subsidies/new');
    await selectByText('#f-customerId', 'Ravi Kumar');
    await page.locator('#f-amount').fill('78000');
    await page.getByLabel('Aadhaar').check();
    await save();
    await page.waitForURL(detailUrl('subsidies'));
    await go('#/m/subsidies?view=board');
    await page.getByLabel(/^Move SB-/).first().selectOption('Approved');
    await page.locator('section[aria-label="Approved"] .tile').first().waitFor();
  });
  await step('loan EMI is calculated correctly', async () => {
    await go('#/m/loans/new');
    await selectByText('#f-customerId', 'Ravi Kumar');
    await page.locator('#f-bank').fill('SBI');
    await page.locator('#f-amount').fill('200000');
    await page.locator('#f-ratePct').fill('10');
    await page.locator('#f-tenureMonths').fill('12.5');
    await save();
    await page.getByText('must be a whole number').waitFor();
    await page.locator('#f-tenureMonths').fill('24');
    await save();
    await page.waitForURL(detailUrl('loans'));
    await page.getByText(inr(emi(200000, 10, 24))).waitFor();
  });
  await step('urgent ticket and expiring AMC raise alerts', async () => {
    await go('#/m/tickets/new');
    await page.locator('#f-subject').fill('Inverter not starting');
    await selectByText('#f-customerId', 'Ravi Kumar');
    await page.locator('#f-priority').selectOption('Urgent');
    await save();
    await page.waitForURL(detailUrl('tickets'));
    await go('#/m/amcs/new');
    await selectByText('#f-customerId', 'Ravi Kumar');
    await page.locator('#f-startDate').fill(plusDays(-340));
    await page.locator('#f-endDate').fill(plusDays(-341));
    await save();
    await page.getByText('End date cannot be before start date').waitFor();
    await page.locator('#f-endDate').fill(plusDays(20));
    await save();
    await page.waitForURL(detailUrl('amcs'));
    await go('#/alerts');
    await page.getByText('Urgent ticket: Inverter not starting').waitFor();
    await page.getByText(/AMC renewal due/).waitFor();
    await page.getByText('Follow-up overdue: Ravi Kumar').count(); // Won leads are excluded — not required
  });
  await step('employee and attendance with times', async () => {
    await go('#/m/employees/new');
    await page.locator('#f-name').fill('Mohan Fitter');
    await page.locator('#f-phone').fill('9334455667');
    await page.locator('#f-department').selectOption('Installation');
    await save();
    await page.waitForURL(detailUrl('employees'));
    await go('#/m/attendance/new');
    await selectByText('#f-employeeId', 'Mohan Fitter');
    await page.locator('#f-checkIn').fill('09:30');
    await page.locator('#f-checkOut').fill('18:15');
    await save();
    await page.waitForURL(detailUrl('attendance'));
    await page.getByText('09:30').waitFor();
  });

  console.log('\nDelete rules, reports, dashboard, alerts, backup');
  await step('delete: unused record deleted; record in use is protected', async () => {
    await go('#/m/leads');
    await page.getByRole('row', { name: /New Two/ }).click();
    await page.getByRole('button', { name: 'Delete' }).click();
    await dialogClick('Delete');
    await page.waitForURL(/#\/m\/leads$/);
    must(!(await page.getByRole('row', { name: /New Two/ }).count()), 'lead not deleted');
    await go('#/m/customers');
    await page.getByRole('row', { name: /Ravi Kumar/ }).click();
    await page.getByRole('button', { name: 'Delete' }).click();
    await toast(/Cannot delete/);
  });
  await step('reports: totals, invalid range warning, GST CSV export', async () => {
    await go('#/reports');
    await page.locator('.kpi', { hasText: 'Collected' }).getByText('₹1,57,701.00').waitFor();
    await page.locator('.kpi', { hasText: 'Expenses' }).getByText('₹2,500.00').waitFor();
    const gstCard = page.locator('.card', { hasText: 'GST summary (sales)' });
    await gstCard.getByRole('button', { name: 'Export: choose a file type' }).click();
    const [dl] = await Promise.all([page.waitForEvent('download'), page.getByRole('navigation', { name: 'Export as' }).getByRole('button', { name: /^CSV/ }).click()]);
    const csv = readFileSync(await dl.path(), 'utf8');
    must(csv.includes(`INV/${FY}/0001`) && !csv.includes(`INV/${FY}/0002`), 'GST export should include issued, exclude cancelled');
    await page.locator('#r-from').fill(plusDays(5));
    await page.getByRole('alert').filter({ hasText: 'valid date range' }).waitFor();
  });
  await step('dashboard KPIs and alerts open their records', async () => {
    await go('#/dashboard');
    await page.locator('.kpi', { hasText: 'New leads' }).locator('.value').getByText(/^\d+$/).waitFor();
    await page.locator('.kpi', { hasText: 'Active projects' }).getByText('1', { exact: true }).waitFor();
    await page.locator('.kpi', { hasText: 'Collected' }).getByText('₹1,57,701', { exact: true }).waitFor();
    must((await page.locator('.india-map path.map-state').count()) === 36, 'India map should show 36 states/UTs');
    must((await page.locator('.india-map .map-dot').count()) >= 1, 'customers should appear on the map');
    // Every chart offers a table view of the same numbers.
    const cash = page.locator('.chart-card', { hasText: 'Cash flow' });
    await cash.getByRole('button', { name: 'Table' }).click();
    await cash.getByRole('cell', { name: '₹1,57,701.00' }).first().waitFor();
    await page.getByRole('button', { name: 'All time' }).click();
    await page.locator('.kpi', { hasText: 'Invoiced' }).getByText('₹1,57,701', { exact: true }).waitFor();
    await go('#/alerts');
    // Panel stock went back up to 9 after the purchase order, so the inverter (0 left) is the low one now.
    must(!(await page.getByText(/Low stock: Panel 540Wp/).count()), 'panel still shown as low after restocking');
    await page.getByText(/Low stock: Inverter 3kW \(0 left\)/).click();
    await heading('Inverter 3kW');
    await page.getByText('⚠ Action needed').count();
  });
  await step('backup downloads and restores', async () => {
    await go('#/settings?tab=data');
    const [dl] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Download backup' }).click()]);
    const file = await dl.path();
    const json = JSON.parse(readFileSync(file, 'utf8'));
    must(json.data.leads.length >= 5 && json.data.invoices.length === 2, 'backup incomplete');
    const bad = join(OUT, 'bad.json');
    writeFileSync(bad, JSON.stringify({ data: { evil: [] } }));
    await page.locator('input[type=file][accept*=json]').setInputFiles(bad);
    await toast(/not a valid backup file/);
    await page.locator('input[type=file][accept*=json]').setInputFiles(file);
    await dialogClick('Restore');
    await toast(/Backup restored/);
    await go('#/m/invoices');
    await page.getByText(`INV/${FY}/0001`).waitFor();
  });

  console.log('\nRoles');
  await step('disabled user cannot sign in', async () => {
    await signOut();
    await signIn('gone@test.in', 'Staff@12345');
    await page.getByRole('alert').filter({ hasText: 'disabled' }).waitFor();
  });
  await step('technician: installations yes, finance no, no delete', async () => {
    await page.getByLabel('Password', { exact: true }).fill('Staff@12345');
    await page.getByLabel('Email').fill('tech@test.in');
    await page.getByRole('button', { name: 'Sign in' }).click();
    await heading(/Hello, Tarun/);
    must(!(await page.getByRole('link', { name: 'Invoices' }).count()), 'technician sees invoices');
    await go('#/m/invoices');
    await page.getByText('Your role does not include this module').waitFor();
    await go('#/m/installations');
    await page.locator('tbody tr').first().click();
    await page.getByRole('link', { name: 'Edit', exact: true }).waitFor();
    must(!(await page.getByRole('button', { name: 'Delete' }).count()), 'technician can delete');
    await go('#/m/customers');
    await page.getByRole('row', { name: /Ravi Kumar/ }).click();
    must(!(await page.getByRole('heading', { name: /^Invoices/ }).count()), 'technician sees related invoices');
  });
  await step('sales: can add leads, cannot open invoices', async () => {
    await signOut();
    await signIn('sales@test.in', 'Staff@12345');
    await heading(/Hello, Sunita/);
    await go('#/m/leads/new');
    await page.locator('#f-name').fill('Sales Made');
    await page.locator('#f-phone').fill('9445566778');
    await save();
    await page.waitForURL(detailUrl('leads'));
    await go('#/m/invoices');
    await page.getByText('Your role does not include this module').waitFor();
  });
  await step('accounts: sees quotations and invoices, not staff settings', async () => {
    await signOut();
    await signIn('acc@test.in', 'Staff@12345');
    await heading(/Hello, Anil/);
    await go('#/m/quotations');
    await page.locator('tbody tr').first().waitFor();
    await go('#/m/invoices');
    await page.locator('tbody tr').first().waitFor();
    await go('#/settings');
    must(!(await page.getByText('Company profile').count()), 'accounts sees company profile');
    await signOut();
    await signIn(ADMIN.email, ADMIN.pass);
    await heading(/Hello, Owner/);
  });

  await step('access rights: admin sets "CRM: own documents only"; that user sees only their leads; account chooser', async () => {
    await go('#/m/leads/new');
    await page.locator('#f-name').fill('Owner Only Lead');
    await page.locator('#f-phone').fill('9431000555');
    await page.locator('#f-assignedTo').selectOption({ label: 'Owner Admin' });
    await save();
    await page.waitForURL(detailUrl('leads'));
    await go('#/settings?tab=users');
    await page.getByRole('row', { name: /Sunita Sales/ }).getByRole('button', { name: 'Edit' }).click();
    const dlg = page.getByRole('dialog', { name: 'Edit user' });
    must((await dlg.getByLabel('Access to CRM').inputValue()) === 'all', 'sales preset should be all documents');
    await dlg.getByLabel('Access to CRM').selectOption('own');
    await dlg.getByRole('button', { name: 'Save' }).click();
    await toast(/User saved/);
    await page.getByRole('row', { name: /Sunita Sales/ }).getByText('custom').waitFor();
    await signOut();
    // Accounts used here are listed; no password is kept.
    await page.getByRole('button', { name: /^Continue as Owner Admin/ }).waitFor();
    must(!(await page.evaluate(() => localStorage.getItem('ss1:accounts') || '')).match(/pass/i), 'password-like data kept');
    await signIn('sales@test.in', 'Staff@12345');
    await heading(/Hello, Sunita/);
    await go('#/m/leads');
    await page.getByRole('heading', { name: 'Leads' }).waitFor();
    await page.waitForTimeout(300);
    must(!(await page.getByText('Owner Only Lead').count()), 'own-documents user sees someone else\'s lead');
    await signOut();
    await page.getByRole('button', { name: /^Continue as Owner Admin/ }).click();
    await page.getByLabel('Password', { exact: true }).fill(ADMIN.pass);
    await page.getByRole('button', { name: 'Sign in' }).click();
    await heading(/Hello, Owner/);
    await go('#/m/leads');
    await page.getByText('Owner Only Lead').first().waitFor();
  });

  await step('custom filter and bulk actions on selected leads', async () => {
    await go('#/m/leads');
    await page.locator('tbody tr.clickable').first().waitFor();
    await page.getByRole('button', { name: 'Filters, group by and favorites' }).click();
    const panel = page.getByRole('dialog', { name: 'Filters, group by and favorites' });
    await panel.getByRole('button', { name: '＋ Add custom filter' }).click();
    const form = panel.getByRole('group', { name: 'Custom filter' });
    await form.getByLabel('Field').selectOption({ label: 'City' });
    await form.getByLabel('Condition').selectOption({ label: 'contains' });
    await form.getByLabel('Value').fill('patna');
    await form.getByRole('button', { name: 'Add filter' }).click();
    await page.getByRole('button', { name: 'Remove City: contains patna' }).waitFor();
    await page.keyboard.press('Escape');
    const n = await page.locator('tbody tr.clickable').count();
    must(n >= 1, 'custom filter found no Patna lead');
    await page.getByRole('checkbox', { name: 'Select all on this page' }).check();
    const bar = page.getByRole('region', { name: 'Selected records' });
    await bar.getByText(`${n} selected`).waitFor();
    await bar.getByLabel('Set Stage of selected').selectOption('Contacted');
    await toast(new RegExp(`Stage → Contacted: ${n} of ${n} done`));
    await page.getByRole('button', { name: 'Remove City: contains patna' }).click();
  });

  console.log('\nOther pages');
  await step('enquiry page explains it needs cloud mode', async () => {
    await page.goto(BASE + '#/enquiry');
    await page.getByLabel('Name *').fill('Visitor');
    await page.getByLabel('Mobile *').fill('9876500000');
    await page.getByRole('button', { name: 'Send enquiry' }).click();
    await page.getByRole('alert').filter({ hasText: 'not enabled yet' }).waitFor();
  });
  await step('unknown pages and deleted records show a friendly message', async () => {
    await go('#/no/such/page');
    await page.getByText('This page does not exist.').waitFor();
    await go('#/m/leads/00000000-0000-4000-8000-000000000000');
    await page.getByText(/does not exist or was deleted/).waitFor();
  });
  await step('installable app: manifest and offline start', async () => {
    const m = await (await page.request.get(BASE + 'manifest.webmanifest')).json();
    must(m.display === 'standalone' && m.icons.length >= 2, 'manifest incomplete');
    await page.goto(BASE + '#/');
    await page.evaluate(() => navigator.serviceWorker.ready.then(() => true));
    await page.reload(); // let the worker take control and cache the page
    await page.waitForFunction(() => !!navigator.serviceWorker.controller, null, { timeout: 10000 });
    // Real outage: the web server goes away entirely; the installed app must still open.
    quietErrors = true;
    await stopServer();
    try {
      await page.reload();
      await heading(/Hello, Owner/);
      await page.getByRole('link', { name: /^CRM/ }).click();
      await page.locator('tbody tr').first().waitFor({ timeout: T });
    } finally {
      await startServer();
      quietErrors = false;
    }
  });

  if (ENGINE !== 'firefox') {
    console.log('\nPhone (touch screen emulation)');
    const state = await ctx.storageState();
    const phoneCtx = await browser.newContext({ ...(ENGINE === 'webkit' ? devices['iPhone 13'] : devices['Pixel 7']), storageState: state });
    const desktop = page;
    page = await phoneCtx.newPage();
    page.on('pageerror', (e) => errors.push('phone pageerror: ' + e.message));
    page.on('console', (m) => { if (m.type() === 'error') errors.push('phone console: ' + m.text()); });
    await step('phone: home tiles and app menu navigate', async () => {
      await go('#/');
      await page.getByRole('link', { name: /^Sales/ }).tap();
      await heading('Quotations');
      await page.locator('nav.app-tabs.show-sm').getByRole('link', { name: 'Site Surveys' }).tap();
      await heading('Site Surveys');
      await page.getByRole('link', { name: 'All apps' }).tap();
      await heading(/Hello, Owner/);
    });
    await step('phone: dashboard map and charts fit the screen', async () => {
      await go('#/dashboard');
      await page.locator('.india-map path.map-state').first().waitFor();
      const over = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      must(over <= 1, `dashboard scrolls sideways by ${over}px`);
    });
    await step('phone: create a lead with the on-screen form', async () => {
      await go('#/m/leads/new');
      await page.locator('#f-name').tap();
      await page.locator('#f-name').fill('Phone Lead');
      await page.locator('#f-phone').fill('9556677889');
      await page.getByRole('button', { name: 'Save', exact: true }).first().tap();
      await page.waitForURL(detailUrl('leads'));
    });
    await step('phone: board card moved with the picker (no drag needed)', async () => {
      await go('#/m/leads?view=board');
      await page.getByLabel('Move Phone Lead').selectOption('Contacted');
      await toast(/Moved to Contacted/);
    });
    await step('phone: invoice line items use cards', async () => {
      await go('#/m/invoices/new');
      await page.getByRole('button', { name: '+ Add line' }).tap();
      await page.locator('.items-cards input[placeholder="Description"]').waitFor();
    });
    await step('phone: no sideways scrolling on any main page', async () => {
      const pages = ['#/', '#/alerts', '#/reports', '#/settings', '#/m/leads', '#/m/invoices', '#/m/invoices/new', '#/m/quotations?view=board', '#/m/products', '#/m/installations/new'];
      const bad = [];
      for (const p of pages) {
        await go(p);
        await page.waitForTimeout(100);
        const over = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
        if (over > 1) bad.push(`${p} (${over}px)`);
      }
      must(!bad.length, 'overflow: ' + bad.join(', '));
    });
    await step('phone: inputs are 16px so iPhone does not zoom', async () => {
      await go('#/m/leads/new');
      const size = await page.locator('#f-name').evaluate((el) => getComputedStyle(el).fontSize);
      must(size === '16px', 'input font ' + size);
    });
    await phoneCtx.close();
    page = desktop;
  }

  await step('no browser errors during the whole run', async () => {
    must(!errors.length, errors.slice(0, 5).join(' | '));
  });
} finally {
  await browser.close();
  server?.kill();
}

const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length} of ${results.length} feature checks passed (${ENGINE}).`);
if (failed.length) {
  console.log('FAILED:');
  for (const f of failed) console.log(` - ${f.name}: ${f.err}`);
}
console.log(`Screenshots of failures: ${join(OUT, 'fail')}`);
process.exit(failed.length ? 1 : 0);
