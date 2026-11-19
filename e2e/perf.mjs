// Speed with a big business: demo data grown to ~32,000 records (10,000 leads, 6,000 customers, invoices and
// payments, 4,000 quotations), then the main screens are timed. Preview server must be running.
//   node e2e/perf.mjs
import { chromium } from 'playwright';
import { promises as fs } from 'node:fs';

const BASE = process.env.BASE || 'http://localhost:4173/';
const LIMIT = Number(process.env.LIMIT_MS || 8000); // any screen slower than this is reported as a problem
const b = await chromium.launch();
const page = await (await b.newContext({ viewport: { width: 1366, height: 900 } })).newPage();
const errs = []; page.on('pageerror', (e) => errs.push(e.message));
const slow = [];
try {
  await page.goto(BASE);
  await page.getByLabel('Your name').fill('Perf'); await page.getByLabel('Email').fill('perf@example.com');
  await page.getByLabel('Mobile number').fill('9835012345');
  await page.getByLabel('Password', { exact: true }).fill('password123'); await page.getByLabel('Confirm password').fill('password123');
  await page.getByRole('button', { name: 'Create account' }).click();
  await page.getByLabel('I have saved this code').check(); await page.getByRole('button', { name: 'Continue' }).click();
  await page.goto(BASE + '#/settings?tab=data');
  await page.getByRole('button', { name: 'Load demo data' }).click();
  await page.getByRole('dialog', { name: 'Load demo data?' }).getByRole('button', { name: 'Load demo data' }).click();
  await page.getByText(/^Demo data loaded/).waitFor({ timeout: 20000 });
  const N = { leads: 10000, customers: 6000, invoices: 6000, payments: 6000, quotations: 4000 };
  const sizes = await page.evaluate((N) => new Promise((resolve, reject) => {
    const req = indexedDB.open('ss1-records');
    req.onsuccess = () => {
      const t = req.result.transaction('lists', 'readwrite');
      const s = t.objectStore('lists');
      const out = {};
      for (const [key, n] of Object.entries(N)) {
        const g = s.get('ss1:data:' + key);
        g.onsuccess = () => {
          const list = g.result || [];
          const grown = [];
          for (let i = 0; grown.length < n; i++) {
            const r = list[i % list.length];
            grown.push({ ...r, id: crypto.randomUUID(), ...(r.number ? { number: r.number + '-' + i } : {}), ...(r.name ? { name: r.name + ' ' + i } : {}), ...(r.phone ? { phone: '9' + String(100000000 + i).slice(-9) } : {}) });
          }
          s.put(grown, 'ss1:data:' + key);
          out[key] = grown.length;
        };
      }
      t.oncomplete = () => resolve(out);
      t.onerror = () => reject(t.error);
    };
  }), N);
  console.log('records', sizes);
  const time = async (label, fn) => {
    const t = Date.now();
    try { await fn(); } catch (e) { slow.push(`${label}: failed — ${e.message.split('\n')[0]}`); console.log(label.padEnd(34), 'FAILED'); return; }
    const ms = Date.now() - t;
    if (ms > LIMIT) slow.push(`${label}: ${ms} ms`);
    console.log(label.padEnd(34), ms, 'ms');
  };
  const W = { timeout: 120000 };
  await page.goto(BASE + '#/');
  await time('start (reload → home)', async () => { await page.reload(); await page.getByRole('heading', { name: /Hello/ }).waitFor(W); });
  await time('leads list (10,000)', async () => { await page.goto(BASE + '#/m/leads'); await page.locator('tbody tr').first().waitFor(W); });
  await time('type in search', async () => { await page.getByLabel('Search', { exact: true }).fill('Kumar 42'); await page.waitForTimeout(50); await page.locator('tbody tr, .empty').first().waitFor(W); });
  await time('leads board', async () => { await page.goto(BASE + '#/m/leads?view=board'); await page.locator('.board .col').first().waitFor(W); });
  await time('invoices list (6,000)', async () => { await page.goto(BASE + '#/m/invoices'); await page.locator('tbody tr').first().waitFor(W); });
  await time('invoices pivot', async () => { await page.goto(BASE + '#/m/invoices?view=pivot'); await page.locator('table').first().waitFor(W); });
  await time('customers map (6,000)', async () => { await page.goto(BASE + '#/m/customers?view=map'); await page.locator('.india-map path.map-state').first().waitFor(W); });
  await time('dashboard', async () => { await page.goto(BASE + '#/dashboard'); await page.locator('.kpi').first().waitFor(W); await page.locator('.chart-card').first().waitFor(W); });
  await time('reports', async () => { await page.goto(BASE + '#/reports'); await page.locator('.kpi').first().waitFor(W); });
  await time('alerts', async () => { await page.goto(BASE + '#/alerts'); await page.locator('h1').first().waitFor(W); });
  await time('open a lead + save an edit', async () => {
    await page.goto(BASE + '#/m/leads'); await page.locator('tbody tr.clickable').first().click();
    await page.getByRole('link', { name: 'Edit', exact: true }).click(); await page.locator('#f-city').fill('Patna X');
    await page.getByRole('button', { name: /^Save/ }).first().click(); await page.waitForURL(/#\/m\/leads\/[0-9a-f-]{36}$/, W);
  });
  await time('create a new lead', async () => {
    await page.goto(BASE + '#/m/leads/new'); await page.locator('#f-name').fill('Speed Test'); await page.locator('#f-phone').fill('9123400001');
    await page.getByRole('button', { name: /^Save/ }).first().click(); await page.waitForURL(/#\/m\/leads\/[0-9a-f-]{36}$/, W);
  });
  await time('download backup', async () => {
    await page.goto(BASE + '#/settings?tab=data');
    const [dl] = await Promise.all([page.waitForEvent('download', W), page.getByRole('button', { name: 'Download backup' }).click()]);
    console.log('  backup size', Math.round((await fs.stat(await dl.path())).size / 1048576 * 10) / 10, 'MB');
  });
} finally {
  await b.close();
}
if (errs.length) slow.push(...errs.map((e) => 'page error: ' + e));
console.log(slow.length ? slow.map((x) => '✗ ' + x).join('\n') : 'ALL SCREENS FAST ENOUGH');
process.exitCode = slow.length ? 1 : 0;
