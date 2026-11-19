// A–Z crawl: every screen of the app with demo data, on a computer and on a phone.
// Reports page errors, console errors, missing headings, sideways overflow, dead "Loading…" screens and
// accessibility problems (axe-core, serious and critical only). Run with the preview server up:
//   node e2e/crawl.mjs            (BROWSER=firefox for Firefox)
import { chromium, firefox, devices } from 'playwright';
import AxeBuilder from '@axe-core/playwright';

const BASE = process.env.BASE || 'http://localhost:4173/';
const ENGINE = process.env.BROWSER || 'chromium';
const ENTITIES = ['leads', 'customers', 'activities', 'surveys', 'quotations', 'projects', 'tasks', 'installations', 'products', 'warehouses',
  'stockMoves', 'dispatches', 'vendors', 'purchaseOrders', 'supplierPayments', 'invoices', 'payments', 'expenses', 'subsidies', 'loans', 'tickets', 'amcs',
  'documents', 'employees', 'attendance'];
const PAGES = ['#/', '#/dashboard', '#/alerts', '#/reports', ...['general', 'sales', 'accounts', 'purchase', 'print', 'users', 'alerts', 'account', 'data'].map((t) => `#/settings?tab=${t}`)];

const issues = [];
const note = (where, what) => { issues.push({ where, what }); };

const browser = await (ENGINE === 'firefox' ? firefox : chromium).launch();
try {
  const ctx = await browser.newContext({ viewport: { width: 1366, height: 860 } });
  let page = await ctx.newPage();
  let here = '';
  const hook = (p, tag) => {
    p.on('pageerror', (e) => note(`${tag} ${here}`, 'pageerror: ' + e.message));
    p.on('console', (m) => { if (m.type() === 'error' && !/favicon/.test(m.text())) note(`${tag} ${here}`, 'console: ' + m.text().slice(0, 300)); });
  };
  hook(page, 'desktop');

  await page.goto(BASE);
  await page.getByLabel('Your name').fill('Crawl Admin');
  await page.getByLabel('Email').fill('crawl@example.com');
  await page.getByLabel('Mobile number').fill('9835012345');
  await page.getByLabel('Password', { exact: true }).fill('password123');
  await page.getByLabel('Confirm password').fill('password123');
  await page.getByRole('button', { name: 'Create account' }).click();
  await page.getByLabel('I have saved this code').check();
  await page.getByRole('button', { name: 'Continue' }).click();
  await page.goto(BASE + '#/settings?tab=data');
  await page.getByRole('button', { name: 'Load demo data' }).click();
  await page.getByRole('dialog', { name: 'Load demo data?' }).getByRole('button', { name: 'Load demo data' }).click();
  await page.getByText(/^Demo data loaded/).waitFor({ timeout: 20000 });

  const settle = async () => {
    await page.waitForTimeout(250);
    try { await page.waitForFunction(() => !document.querySelector('[role="status"]')?.textContent?.startsWith('Loading'), null, { timeout: 5000 }); } catch { note(here, 'still "Loading…" after 5 s'); }
  };
  const checkPage = async (tag, { axe = false, expectMissing = false } = {}) => {
    const r = await page.evaluate(() => {
      const vw = document.documentElement.clientWidth;
      const scroll = document.documentElement.scrollWidth - vw;
      const out = [...document.querySelectorAll('.content *')].filter((el) => {
        const b = el.getBoundingClientRect();
        return b.width > 0 && b.right > vw + 1 && !el.closest('.table-wrap, .doc, .search-panel, .settings-tabs, .detail-actions, .dash-switch, .chart-scroll, .ditem-scroll, .seg, pre, .board');
      }).slice(0, 3).map((el) => `${el.tagName.toLowerCase()}.${String(el.className).split(' ')[0]} "${(el.textContent || '').trim().slice(0, 30)}"`);
      const h1 = !!document.querySelector('h1, h2');
      const notFound = /Page not found|no longer exists|not found/i.test(document.querySelector('.content')?.textContent || '');
      return { scroll, out, h1, notFound, text: (document.querySelector('.content')?.textContent || '').length };
    });
    if (r.scroll > 1) note(`${tag} ${here}`, `page scrolls sideways by ${r.scroll}px`);
    if (r.out.length) note(`${tag} ${here}`, 'sticks out: ' + r.out.join('; '));
    if (!r.h1) note(`${tag} ${here}`, 'no heading');
    if (r.notFound && !expectMissing) note(`${tag} ${here}`, 'shows a not-found message');
    if (!r.notFound && expectMissing) note(`${tag} ${here}`, 'a missing page should say it was not found');
    if (r.text < 20) note(`${tag} ${here}`, 'page looks empty');
    if (axe) {
      try {
        const res = await new AxeBuilder({ page }).include('#root').disableRules(['region']).analyze();
        for (const v of res.violations.filter((x) => x.impact === 'serious' || x.impact === 'critical')) {
          note(`${tag} ${here}`, `a11y ${v.impact} ${v.id}: ${v.help} — e.g. ${v.nodes[0]?.target?.join(' ')} (${v.nodes.length} el.)`);
        }
      } catch (e) { note(here, 'axe failed: ' + e.message); }
    }
  };
  const visit = async (tag, hash, opts = {}) => {
    here = hash;
    await page.goto(BASE + hash);
    await settle();
    await checkPage(tag, opts);
  };

  // ---------------- desktop
  for (const p of PAGES) await visit('desktop', p, { axe: true });
  for (const e of ENTITIES) {
    await visit('desktop', `#/m/${e}`, { axe: true });
    const views = await page.locator('.view-switch button').evaluateAll((bs) => bs.map((b) => b.getAttribute('aria-label')));
    for (const v of views) {
      if (v === 'List' || v === 'Files') continue;
      here = `#/m/${e} [${v}]`;
      await page.getByRole('button', { name: v, exact: true }).first().click();
      await settle();
      await checkPage('desktop');
    }
    await page.goto(BASE + `#/m/${e}?view=table`); await settle();
    const first = page.locator('tbody tr.clickable').first();
    if (!(await first.count())) { note(`desktop #/m/${e}`, 'no records in demo data (list empty)'); continue; }
    await first.click();
    await page.waitForURL(/#\/m\/[^/]+\/[^/?]+$/, { timeout: 5000 }).catch(() => note(`desktop #/m/${e}`, 'clicking a row did not open the record'));
    const detail = page.url().slice(page.url().indexOf('#'));
    here = detail; await settle(); await checkPage('desktop', { axe: e === 'invoices' || e === 'quotations' || e === 'customers' || e === 'products' });
    // pager
    const next = page.getByRole('button', { name: /next/i }).first();
    if (await next.count() && await next.isEnabled()) { await next.click(); await settle(); here = detail + ' (next)'; await checkPage('desktop'); }
    const print = page.getByRole('link', { name: /Print|Statement/ }).first();
    if (await print.count()) { await print.click(); here = detail + ' (print)'; await settle(); await checkPage('desktop'); }
    await visit('desktop', `${detail}/edit`, { axe: e === 'invoices' || e === 'leads' });
    await visit('desktop', `#/m/${e}/new`);
    // Saving the empty form must show errors, not crash.
    const save = page.getByRole('button', { name: /^Save/ }).first();
    if (await save.count()) { await save.click(); await page.waitForTimeout(300); }
  }
  await visit('desktop', '#/m/nope', { expectMissing: true });
  await visit('desktop', '#/m/leads/00000000-0000-0000-0000-000000000000', { expectMissing: true });

  // ---------------- phone
  const state = await ctx.storageState();
  const phoneCtx = await browser.newContext({ ...(ENGINE === 'firefox' ? { viewport: { width: 390, height: 844 } } : devices['Pixel 7']), storageState: state });
  page = await phoneCtx.newPage();
  hook(page, 'phone');
  await page.goto(BASE); await page.evaluate(() => localStorage.setItem('ss1:layout', 'phone'));
  for (const p of PAGES) await visit('phone', p);
  for (const e of ENTITIES) {
    await visit('phone', `#/m/${e}`);
    const card = page.locator('.rec-card, .files-card').first();
    if (await card.count()) {
      await card.click();
      await page.waitForTimeout(400);
      here = page.url().slice(page.url().indexOf('#')); await settle(); await checkPage('phone');
      if (/#\/m\/[^/]+\/[^/?]+$/.test(here)) await visit('phone', `${here}/edit`);
    }
    await visit('phone', `#/m/${e}/new`);
  }
  await phoneCtx.close();
} finally {
  await browser.close();
}

// Group identical problems.
const groups = new Map();
for (const i of issues) { const k = i.what.replace(/\d+px/, 'Npx'); groups.set(k, [...(groups.get(k) || []), i.where]); }
console.log(`\n${issues.length} problem(s), ${groups.size} kind(s) — ${ENGINE}\n`);
for (const [what, where] of [...groups].sort((a, b) => b[1].length - a[1].length)) {
  console.log(`• ${what}\n    ${where.length}×: ${[...new Set(where)].slice(0, 6).join(' | ')}${where.length > 6 ? ' …' : ''}`);
}
