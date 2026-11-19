// Real-browser smoke test. Usage: npm run build && npm run e2e   (BROWSER=webkit|firefox|chromium, default chromium)
// Starts `vite preview`, then drives every module in headless Chromium at desktop and phone sizes.
import { chromium, firefox, webkit } from 'playwright';
import { spawn } from 'node:child_process';
import { writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const ENGINE = process.env.BROWSER || 'chromium';
const PORT = 4179;
const BASE = `http://localhost:${PORT}/`;

// Order matters: records that others reference come first.
const ORDER = ['customers', 'leads', 'activities', 'surveys', 'products', 'warehouses', 'stockMoves', 'quotations',
  'projects', 'tasks', 'installations', 'dispatches', 'vendors', 'purchaseOrders', 'invoices', 'payments', 'expenses',
  'subsidies', 'loans', 'tickets', 'amcs', 'documents', 'employees', 'attendance'];
const PRINTABLE = ['quotations', 'invoices', 'purchaseOrders', 'payments', 'installations', 'surveys', 'tickets', 'amcs',
  'dispatches', 'customers', 'expenses', 'projects', 'loans'];
const VIEWS = ['Calendar', 'Pivot', 'Graph', 'Map'];

const server = spawn(process.execPath, ['node_modules/vite/bin/vite.js', 'preview', '--port', String(PORT), '--strictPort'], { stdio: 'pipe' });
await new Promise((resolve, reject) => {
  server.stdout.on('data', (d) => { if (String(d).includes(String(PORT))) resolve(); });
  server.on('exit', (c) => reject(new Error('preview exited ' + c)));
  setTimeout(() => reject(new Error('preview did not start')), 20000);
});

const failures = [];
const fail = (m) => { failures.push(m); console.log('  ✗ ' + m); };
const ok = (m) => console.log('  ✓ ' + m);

let browser;
// How many records of a type device mode has saved (read from its record store, IndexedDB "ss1-records").
const countStored = (page, entity) => page.evaluate((key) => new Promise((resolve) => {
  const req = indexedDB.open('ss1-records');
  req.onsuccess = () => {
    const db = req.result;
    if (!db.objectStoreNames.contains('lists')) { resolve(0); return; }
    const g = db.transaction('lists', 'readonly').objectStore('lists').get(key);
    g.onsuccess = () => resolve(Array.isArray(g.result) ? g.result.length : 0);
    g.onerror = () => resolve(-1);
  };
  req.onerror = () => resolve(-1);
}), 'ss1:data:' + entity);

try {
  browser = await ({ chromium, firefox, webkit })[ENGINE].launch();
} catch (e) {
  server.kill();
  throw e;
}
console.log(`Browser: ${ENGINE}`);
try {
  const ctx = await browser.newContext({ viewport: { width: 1366, height: 860 } });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
  page.on('console', (m) => { if (m.type() === 'error') errors.push('console: ' + m.text()); });

  await page.goto(BASE);
  await page.getByLabel('Your name').fill('E2E Admin');
  await page.getByLabel('Email').fill('admin@example.com');
  await page.getByLabel('Mobile number').fill('9835012345');
  await page.getByLabel('Password', { exact: true }).fill('password123');
  await page.getByLabel('Confirm password').fill('password123');
  await page.getByRole('button', { name: 'Create account' }).click();
  await page.getByText('Save your recovery code').waitFor();
  await page.getByLabel('I have saved this code').check();
  await page.getByRole('button', { name: 'Continue' }).click();
  await page.getByRole('heading', { name: /Hello, E2E/ }).waitFor();
  ok('admin setup + dashboard');

  await page.goto(BASE + '#/settings');
  await page.locator('#s-companyName').fill('Test Solar Pvt Ltd');
  await page.locator('#s-state').selectOption('Bihar');
  await page.getByRole('button', { name: 'Save company profile' }).click();
  await page.getByText('Settings saved').waitFor();
  ok('company settings saved');

  const tmp = mkdtempSync(join(tmpdir(), 'e2e-'));
  const upload = join(tmp, 'kyc.pdf');
  writeFileSync(upload, '%PDF-1.4\n% test file\n');

  let phone = 9000000100;
  for (const key of ORDER) {
    await page.goto(BASE + `#/m/${key}/new`);
    await page.locator(`form[data-form="${key}"]`).waitFor(); // this entity's form (a slow device may still show the last one)
    const fields = await page.locator('.form-grid > .field').evaluateAll((els) => els.map((el) => ({
      id: el.querySelector('[id^="f-"]:not(label)')?.id || el.querySelector('label')?.getAttribute('for'),
      required: !!el.querySelector('.req'),
      tag: el.querySelector('[id^="f-"]:not(label)')?.tagName,
      type: el.querySelector('[id^="f-"]:not(label)')?.getAttribute('type'),
    })));
    for (const f of fields) {
      if (!f.required || !f.id) continue;
      const loc = page.locator('#' + f.id);
      if (f.id === 'f-items') continue;
      if (f.tag === 'SELECT') {
        const cur = await loc.inputValue();
        if (!cur) {
          const opts = await loc.locator('option').evaluateAll((o) => o.map((x) => x.value).filter((v) => v && v !== '__create_new__'));
          if (opts.length) await loc.selectOption(opts[0]);
        }
      } else if (f.type === 'file') {
        await loc.setInputFiles(upload);
        await page.getByRole('button', { name: /kyc\.pdf/ }).waitFor();
      } else if (f.type === 'tel') await loc.fill(String(phone++));
      else if (f.type === 'number') { if (!(await loc.inputValue())) await loc.fill(key === 'payments' ? '1' : '5'); }
      else if (f.type === 'date') { if (!(await loc.inputValue())) await loc.fill('2026-11-03'); }
      else if (f.type !== 'checkbox') { if (!(await loc.inputValue())) await loc.fill(`Test ${key}`); }
    }
    if (await page.getByRole('button', { name: '+ Add line' }).count()) {
      await page.getByRole('button', { name: '+ Add line' }).click();
      await page.getByLabel('Description line 1').fill('Solar module 540Wp');
      await page.getByLabel('Rate line 1').fill('12000');
    }
    if (key === 'amcs') await page.locator('#f-endDate').fill('2027-11-02');
    // A GST invoice needs its place of supply before it can be issued (the payment below issues it).
    if (key === 'invoices') await page.locator('#f-placeOfSupply').selectOption('Bihar');
    await page.getByRole('button', { name: 'Save' }).first().click();
    try {
      await page.waitForURL(new RegExp(`#/m/${key}/[0-9a-f-]{20,}$`), { timeout: 5000 });
      ok(`create ${key}`);
    } catch {
      const msg = await page.locator('.field .error, .toast').allTextContents();
      fail(`create ${key}: ${msg.join(' | ') || 'did not reach detail page'}`);
    }
  }

  for (const key of ORDER) {
    await page.goto(BASE + `#/m/${key}`);
    await page.locator(`[data-list="${key}"]`).waitFor();
    await page.locator('tbody tr.clickable, .files-card').first().waitFor({ timeout: 10000 }).then(() => ok(`list ${key}`), () => fail(`list ${key} empty`));
    if (await page.getByRole('button', { name: 'Board' }).count()) {
      await page.getByRole('button', { name: 'Board' }).click();
      await page.locator('.board .tile').first().waitFor({ timeout: 4000 }).then(() => ok(`board ${key}`), () => fail(`board ${key}`));
    }
    for (const v of VIEWS) {
      const btn = page.locator('.view-switch').getByRole('button', { name: v });
      if (!(await btn.count())) continue;
      await btn.click();
      const sel = { Calendar: '.cal', Pivot: 'table.pivot', Graph: '.card .chart, .card .bars, .card .donut-wrap', Map: '.india-map path.map-state' }[v];
      await page.locator(sel).first().waitFor({ timeout: 8000 }).then(() => ok(`${v.toLowerCase()} ${key}`), () => fail(`${v.toLowerCase()} view ${key}`));
    }
  }

  for (const key of PRINTABLE) {
    await page.goto(BASE + `#/m/${key}`);
    await page.locator(`[data-list="${key}"]`).waitFor();
    await page.locator('tbody tr.clickable').first().click();
    await page.getByRole('link', { name: /Print \/ PDF|Statement \(PDF\)/ }).click();
    await page.locator('.doc .doc-title').waitFor({ timeout: 4000 }).then(() => ok(`print ${key}`), () => fail(`print ${key}`));
  }

  // "+ Create new …" in every picker of every form: popup opens, saves, and the new record is chosen.
  const CREATE = '__create_new__';
  let qc = 0;
  const leaveForm = async () => {
    await page.evaluate(() => { location.hash = '#/'; });
    const discard = page.getByRole('dialog', { name: 'Discard unsaved changes?' });
    if (await discard.waitFor({ timeout: 1500 }).then(() => true, () => false)) await discard.getByRole('button', { name: 'Discard' }).click();
    await page.getByRole('heading', { name: /Hello, E2E/ }).waitFor();
  };
  const fillPopup = async (dlg) => {
    const fields = await dlg.locator('.field').evaluateAll((els) => els.map((el) => {
      const c = el.querySelector('[id^="qc-"]:not(label)');
      return { id: c?.id, required: !!el.querySelector('.req'), tag: c?.tagName, type: c?.getAttribute('type') };
    }));
    for (const f of fields) {
      if (!f.required || !f.id) continue;
      const loc = page.locator('#' + f.id);
      if (await loc.inputValue()) continue;
      if (f.tag === 'SELECT') {
        const opts = await loc.locator('option').evaluateAll((o) => o.map((x) => x.value).filter((v) => v && v !== '__create_new__'));
        if (opts.length) await loc.selectOption(opts[0]);
      } else if (f.type === 'tel') await loc.fill(String(phone++));
      else if (f.type === 'number') await loc.fill('1');
      else if (f.type === 'date') await loc.fill('2026-12-01');
      else await loc.fill(`QC ${++qc}`);
    }
  };
  let pairs = 0;
  for (const key of ORDER) {
    await page.goto(BASE + `#/m/${key}/new`);
    await page.locator(`form[data-form="${key}"]`).waitFor(); // this entity's form (a slow device may still show the last one)
    const pickers = await page.locator('.form-grid select').evaluateAll((els, c) => els
      .filter((el) => [...el.options].some((o) => o.value === c))
      .map((el) => ({ id: el.id, label: [...el.options].find((o) => o.value === c).textContent })), CREATE);
    for (const pk of pickers) {
      const what = pk.label.replace(/^\+ Create new /, '').replace(/…$/, '');
      const name = `${key} → ${pk.id.slice(2)} (${what})`;
      try {
        const sel = page.locator('#' + pk.id);
        const before = await sel.inputValue();
        await sel.selectOption(CREATE);
        const dlg = page.getByRole('dialog', { name: `New ${what}` });
        await dlg.waitFor({ timeout: 4000 });
        if (await dlg.locator(`option[value="${CREATE}"]`).count()) throw new Error('popup offers a nested "Create new"');
        if (pairs === 0) {
          await dlg.getByRole('button', { name: 'Cancel' }).click();
          await dlg.waitFor({ state: 'detached' });
          if ((await sel.inputValue()) !== before) throw new Error('Cancel changed the picker');
          await sel.selectOption(CREATE);
          await dlg.waitFor();
        }
        await fillPopup(dlg);
        await dlg.getByRole('button', { name: `Create ${what}` }).click();
        const dup = dlg.getByRole('button', { name: 'Create anyway' });
        if (await dup.waitFor({ timeout: 800 }).then(() => true, () => false)) await dup.click();
        await dlg.waitFor({ state: 'detached', timeout: 5000 }).catch(async () => {
          throw new Error('popup did not close: ' + (await dlg.locator('.error, .banner').allTextContents()).join(' | '));
        });
        const chosen = await sel.inputValue();
        if (!chosen || chosen === CREATE || chosen === before) throw new Error('new record not chosen');
        if (!(await page.getByRole('heading', { name: /^New / }).count())) throw new Error('left the form');
        pairs++;
        ok(`create from picker: ${name}`);
      } catch (e) {
        fail(`create from picker: ${name}: ${e.message.split('\n')[0]}`);
        await page.keyboard.press('Escape').catch(() => {});
      }
    }
    await leaveForm();
  }
  if (pairs < 20) fail(`only ${pairs} pickers offered "Create new"`);

  // Back while the popup is open on an edited form: popup closes and the "discard?" question is in front.
  // Reach the form through the app's own links: the router can only hold Back for pages it opened itself.
  await page.getByRole('link', { name: /^Sales/ }).first().click();
  await page.getByRole('heading', { name: 'Quotations' }).waitFor();
  await page.getByRole('link', { name: /New/ }).first().click();
  await page.getByRole('heading', { name: 'New Quotation' }).waitFor();
  await page.locator('#f-systemKw').fill('3');
  await page.locator('#f-customerId').selectOption(CREATE);
  await page.getByRole('dialog', { name: 'New customer' }).waitFor();
  await page.goBack();
  const ask = page.getByRole('dialog', { name: 'Discard unsaved changes?' });
  await ask.waitFor({ timeout: 4000 }).then(async () => {
    if (await page.getByRole('dialog', { name: 'New customer' }).count()) fail('popup still open behind the discard question');
    await ask.getByRole('button', { name: 'Cancel' }).click();
    await page.getByRole('heading', { name: 'New Quotation' }).waitFor();
    if ((await page.locator('#f-systemKw').inputValue()) !== '3') fail('form lost its value after Back');
    else ok('Back with popup open: popup closes, discard question in front, form kept');
  }, () => fail('Back with popup open: no discard question'));
  await leaveForm();

  for (const path of ['#/', '#/dashboard', '#/alerts', '#/reports', '#/settings']) {
    await page.goto(BASE + path);
    await page.locator('h1').first().waitFor();
    ok('page ' + path);
  }
  await page.goto(BASE + '#/dashboard');
  await page.locator('.india-map path.map-state').first().waitFor({ timeout: 10000 }).catch(() => {});
  const states = await page.locator('.india-map path.map-state').count();
  if (states === 36) ok('dashboard India map: 36 states/UTs'); else fail(`dashboard map shows ${states} states`);
  const charts = await page.locator('.chart-card').count();
  if (charts >= 4) ok(`dashboard charts: ${charts}`); else fail(`dashboard charts: ${charts}`);

  // Phone size: no horizontal page scroll, menu drawer works.
  await page.setViewportSize({ width: 375, height: 812 });
  for (const path of ['#/', '#/dashboard', '#/m/leads', '#/m/invoices/new', '#/m/quotations', '#/m/quotations?view=pivot', '#/m/customers?view=map', '#/reports', '#/settings']) {
    await page.goto(BASE + path);
    await page.locator('h1').first().waitFor();
    await page.waitForTimeout(150);
    const over = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    if (over > 1) fail(`mobile overflow ${path}: ${over}px`); else ok('mobile layout ' + path);
  }
  // A narrow window on a computer (mouse, no touch) keeps the computer layout…
  await page.goto(BASE + '#/m/leads');
  await page.locator('h1').first().waitFor();
  if (await page.getByRole('navigation', { name: 'Main' }).count()) fail('narrow computer window shows the phone bottom bar'); else ok('narrow computer window keeps the computer layout');
  // …the phone layout is for phones (here chosen in Settings → Appearance, as this browser has a mouse).
  await page.evaluate(() => { localStorage.setItem('ss1:layout', 'phone'); window.dispatchEvent(new Event('ss1-layout')); });
  // Phone: app-style bottom bar, a round + button on lists, and the dashboard order can be changed and is kept.
  await page.getByRole('navigation', { name: 'Main' }).waitFor({ timeout: 5000 }).then(() => ok('phone bottom bar shown'), () => fail('phone bottom bar missing'));
  await page.getByRole('link', { name: 'New Lead' }).waitFor({ timeout: 5000 }).then(() => ok('phone + button on lists'), () => fail('phone + button missing'));
  await page.goto(BASE + '#/dashboard');
  await page.getByRole('button', { name: '✎ Customize' }).click();
  const blockOrder = () => page.locator('.dash-blocks > .arrangeable').evaluateAll((els) => els.map((e) => e.getAttribute('aria-label')));
  const before = await blockOrder();
  await page.getByRole('button', { name: `Move ${before[0]} later` }).click();
  await page.getByRole('button', { name: 'Done' }).click();
  await page.reload();
  await page.getByRole('button', { name: '✎ Customize' }).click();
  const after = await blockOrder();
  if (after[0] === before[1] && after[1] === before[0]) ok('dashboard order changed on a phone and kept after reload');
  else fail(`dashboard order not kept: ${before.slice(0, 2)} → ${after.slice(0, 2)}`);
  await page.getByRole('button', { name: 'Reset order' }).click();
  await page.getByRole('button', { name: 'Done' }).click();

  // Smallest phones (320 px): nothing sticks out, lists turn into cards, line items into cards.
  await page.setViewportSize({ width: 320, height: 700 });
  for (const path of ['#/', '#/dashboard', '#/m/leads', '#/m/invoices', '#/m/invoices?view=pivot', '#/m/invoices?view=graph', '#/m/invoices/new', '#/settings', '#/reports']) {
    await page.goto(BASE + path);
    await page.locator('h1').first().waitFor();
    await page.waitForTimeout(150);
    const over = await page.evaluate(() => {
      const vw = document.documentElement.clientWidth;
      const out = [...document.querySelectorAll('.content *')].filter((el) => { const r = el.getBoundingClientRect(); return r.width > 0 && r.right > vw + 1 && !el.closest('.table-wrap, .doc, .search-panel, .settings-tabs, .detail-actions, .dash-switch, .chart-scroll, .ditem-scroll'); });
      return document.documentElement.scrollWidth - vw + out.length;
    });
    if (over > 1) fail(`320px: something sticks out on ${path}`); else ok('320px layout ' + path);
  }
  await page.goto(BASE + '#/m/invoices');
  await page.locator('.rec-card').first().waitFor({ timeout: 4000 }).then(() => ok('phone: list shown as cards'), () => fail('phone: list cards missing'));
  const cardOver = await page.evaluate(() => [...document.querySelectorAll('.rec-card')].some((c) => c.getBoundingClientRect().right > document.documentElement.clientWidth + 1));
  if (cardOver) fail('phone: a record card is wider than the screen'); else ok('phone: cards fit the screen');
  await page.evaluate(() => { localStorage.removeItem('ss1:layout'); window.dispatchEvent(new Event('ss1-layout')); });
  await page.setViewportSize({ width: 375, height: 812 });

  // Big monitors: the page grows with the screen.
  await page.setViewportSize({ width: 2560, height: 1000 });
  await page.goto(BASE + '#/');
  await page.locator('.app-tile').first().waitFor();
  const wide = await page.evaluate(() => document.querySelector('.content').getBoundingClientRect().width);
  if (wide >= 2000) ok(`2560px: content uses ${Math.round(wide)} px`); else fail(`2560px: content only ${Math.round(wide)} px wide`);
  await page.setViewportSize({ width: 375, height: 812 });

  await page.goto(BASE + '#/');
  await page.getByRole('link', { name: /^Projects/ }).click();
  await page.getByRole('heading', { name: 'Projects' }).waitFor();
  await page.locator('nav.app-tabs.show-sm').getByRole('link', { name: 'Tasks' }).click();
  await page.getByRole('heading', { name: 'Tasks' }).waitFor();
  await page.getByRole('link', { name: 'All apps' }).click();
  await page.getByRole('heading', { name: /Hello, E2E/ }).waitFor();
  await page.getByRole('link', { name: /^Projects/ }).click();
  await page.getByRole('heading', { name: 'Projects' }).waitFor();
  ok('mobile home tiles and app menu navigation');

  // Reload keeps data and session (installed-app restart).
  await page.reload();
  await page.getByRole('heading', { name: 'Projects' }).waitFor();
  ok('reload keeps session and data');

  // Demo data (testing only): loads, every list and print works with it, and removing it puts the earlier data back.
  await page.setViewportSize({ width: 1366, height: 860 });
  const ownCustomers = await countStored(page, 'customers');
  await page.goto(BASE + '#/settings?tab=data');
  await page.getByRole('button', { name: 'Load demo data' }).click();
  await page.getByRole('dialog', { name: 'Load demo data?' }).getByRole('button', { name: 'Load demo data' }).click();
  await page.getByText(/^Demo data loaded: \d+ records/).waitFor({ timeout: 15000 });
  await page.getByRole('link', { name: 'Demo data' }).waitFor();
  ok('demo data loaded; top bar shows "Demo data"');
  for (const key of ORDER) {
    await page.goto(BASE + `#/m/${key}`);
    await page.locator(`[data-list="${key}"]`).waitFor();
    const n = await page.locator('tbody tr.clickable').count().catch(() => 0);
    await page.locator('tbody tr.clickable, .files-card').first().waitFor({ timeout: 4000 }).then(() => ok(`demo list ${key}`), () => fail(`demo list ${key} is empty (${n})`));
  }
  for (const key of PRINTABLE) {
    await page.goto(BASE + `#/m/${key}`);
    await page.locator(`[data-list="${key}"]`).waitFor();
    await page.locator('tbody tr.clickable').first().click();
    await page.getByRole('link', { name: /Print \/ PDF|Statement \(PDF\)/ }).click();
    await page.locator('.doc .doc-title').waitFor({ timeout: 4000 }).then(() => ok(`demo print ${key}`), () => fail(`demo print ${key}`));
  }
  await page.goto(BASE + '#/dashboard');
  await page.locator('.india-map .map-dot').first().waitFor({ timeout: 10000 }).then(() => ok('demo dashboard map has customers'), () => fail('demo dashboard map empty'));
  await page.goto(BASE + '#/reports');
  await page.locator('h1').first().waitFor();
  await page.goto(BASE + '#/settings?tab=users');
  await page.getByText('Priya Kumari').first().waitFor({ timeout: 8000 })
    .then(() => ok('demo team members listed under Users'), () => fail('demo users missing'));
  await page.goto(BASE + '#/settings?tab=data');
  await page.getByRole('button', { name: 'Remove demo data' }).click();
  await page.getByRole('dialog', { name: 'Remove demo data?' }).getByRole('button', { name: 'Remove demo data' }).click();
  await page.getByText(/Demo data removed/).waitFor({ timeout: 15000 });
  const back = await countStored(page, 'customers');
  if (back === ownCustomers && !(await page.getByText('Priya Kumari').count()) && !(await page.getByRole('link', { name: 'Demo data' }).count())) ok('demo removed; earlier data and users are back');
  else fail(`after removing demo: ${back} customers (expected ${ownCustomers})`);

  const noisy = errors.filter((e) => !/favicon/.test(e));
  if (noisy.length) fail('browser errors:\n    ' + noisy.join('\n    ')); else ok('no console or page errors');
} finally {
  await browser.close();
  server.kill();
}

console.log(failures.length ? `\n${failures.length} FAILURE(S)` : '\nALL E2E CHECKS PASSED');
process.exit(failures.length ? 1 : 0);
