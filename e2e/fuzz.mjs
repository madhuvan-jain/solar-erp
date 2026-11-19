// Odd input in every form: HTML/script, quotes, emoji, Hindi, very long text, negative and absurd numbers,
// impossible dates. Saving must either work or show a clear error — never crash, hang or run injected script —
// and what was saved must show as plain text on the record, in the list and in its print.
//   node e2e/fuzz.mjs        (BROWSER=firefox for Firefox; preview server must be running)
import { chromium, firefox } from 'playwright';

const BASE = process.env.BASE || 'http://localhost:4173/';
const ENGINE = process.env.BROWSER || 'chromium';
const ENTITIES = ['leads', 'customers', 'activities', 'surveys', 'quotations', 'projects', 'tasks', 'installations', 'products', 'warehouses',
  'stockMoves', 'dispatches', 'vendors', 'purchaseOrders', 'supplierPayments', 'invoices', 'payments', 'expenses', 'subsidies', 'loans', 'tickets', 'amcs',
  'documents', 'employees', 'attendance'];
const NASTY = `<img src=x onerror="window.__xss=1"><script>window.__xss=2</script> "Ravi" O'Brien & Sons ₹ हिन्दी नाम 😀`;
const LONG = 'L'.repeat(5000);

const problems = [];
const stats = { saved: 0, refused: 0 };
const bad = (where, what) => problems.push(`${where}: ${what}`);
const browser = await (ENGINE === 'firefox' ? firefox : chromium).launch();
try {
  const page = await (await browser.newContext({ viewport: { width: 1366, height: 900 } })).newPage();
  page.setDefaultTimeout(6000);
  let here = '';
  page.on('pageerror', (e) => bad(here, 'pageerror ' + e.message));
  page.on('console', (m) => { if (m.type() === 'error' && !/favicon/.test(m.text())) bad(here, 'console ' + m.text().slice(0, 200)); });
  page.on('dialog', (d) => { bad(here, `browser dialog opened: ${d.message()}`); void d.dismiss(); });

  await page.goto(BASE);
  await page.getByLabel('Your name').fill('Fuzz Admin');
  await page.getByLabel('Email').fill('fuzz@example.com');
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

  const xss = () => page.evaluate(() => (window).__xss);
  for (const e of ENTITIES) {
    for (const round of ['nasty', 'long', 'numbers']) {
      here = `${e} (${round})`;
      console.log('…', here);
      await page.goto(BASE + `#/m/${e}/new`);
      await page.locator('form').first().waitFor({ timeout: 8000 }).catch(() => bad(here, 'form did not open'));
      // Fill every field the way a careless or hostile person might.
      const fields = await page.locator('form [id^="f-"]').evaluateAll((els) => els.map((el) => ({ id: el.id, tag: el.tagName, type: el.getAttribute('type') || '', n: el.querySelectorAll?.('option')?.length || 0 })));
      for (const f of fields) {
        try {
          if (f.tag === 'SELECT') {
            if (f.n > 1) await page.locator(`#${f.id}`).selectOption({ index: 1 });
          } else if (f.type === 'checkbox') {
            await page.locator(`#${f.id}`).check().catch(() => {});
          } else if (f.type === 'file') {
            // skipped: files are covered elsewhere
          } else if (f.type === 'number') {
            await page.locator(`#${f.id}`).fill(round === 'numbers' ? '-99999999999999' : round === 'long' ? '1e308' : '12.345');
          } else if (f.type === 'date') {
            await page.locator(`#${f.id}`).fill(round === 'numbers' ? '1900-01-01' : '2099-12-31');
          } else if (f.type === 'datetime-local') {
            await page.locator(`#${f.id}`).fill('2026-02-28T23:59');
          } else if (f.type === 'time') {
            await page.locator(`#${f.id}`).fill('23:59');
          } else if (f.type === 'tel' || /phone/i.test(f.id)) {
            await page.locator(`#${f.id}`).fill(round === 'numbers' ? '0000000000' : '+91 98765 43210');
          } else if (f.type === 'email') {
            await page.locator(`#${f.id}`).fill(round === 'nasty' ? 'a"b@x.in' : 'ok@example.com');
          } else {
            await page.locator(`#${f.id}`).fill(round === 'long' ? LONG : round === 'numbers' ? '-1' : NASTY);
          }
        } catch { /* hidden or read-only */ }
      }
      // Line items, if any: one line with odd numbers.
      const add = page.getByRole('button', { name: '+ Add line' });
      if (await add.count()) {
        await add.click();
        await page.getByLabel('Quantity line 1').fill(round === 'numbers' ? '-5' : '3').catch(() => {});
        await page.getByLabel('Rate line 1').fill(round === 'numbers' ? '-100' : '999999.999').catch(() => {});
        await page.getByLabel(/Description line 1/).fill(round === 'long' ? LONG : NASTY).catch(() => {});
      }
      const t0 = Date.now();
      await page.getByRole('button', { name: /^Save/ }).first().click().catch(() => bad(here, 'no Save button'));
      await page.waitForTimeout(500);
      const dup = page.getByRole('dialog').getByRole('button', { name: /Save anyway/ });
      if (await dup.count()) { await dup.click(); await page.waitForTimeout(400); }
      if (Date.now() - t0 > 5000) bad(here, 'save took over 5 s');
      const saved = /#\/m\/[^/]+\/[0-9a-f-]{36}$/.test(page.url());
      stats[saved ? 'saved' : 'refused']++;
      if (!saved) {
        // Not saved: there must be a visible reason.
        const errs = await page.locator('.field .error, [role="alert"], .banner.bad, .toast').count();
        if (!errs) bad(here, 'not saved and no error shown');
        continue;
      }
      if (await xss()) bad(here, 'INJECTED SCRIPT RAN after save');
      await page.waitForTimeout(200);
      const detail = page.url();
      // The record, its list and its print show the text as text.
      await page.goto(BASE + `#/m/${e}`); await page.waitForTimeout(300);
      if (await xss()) bad(here, 'INJECTED SCRIPT RAN on the list');
      await page.goto(detail); await page.waitForTimeout(200);
      const print = page.getByRole('link', { name: /Print|Statement/ }).first();
      if (await print.count()) { await print.click(); await page.waitForTimeout(500); if (await xss()) bad(here, 'INJECTED SCRIPT RAN on the print'); }
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      if (overflow > 40 && round === 'long') bad(here, `long text pushes the page ${overflow}px sideways`);
    }
  }
  // Global search and the dashboard with the odd records in place.
  here = 'search';
  await page.goto(BASE + '#/'); await page.getByLabel('Search everything').fill('<img'); await page.waitForTimeout(400);
  here = 'dashboard'; await page.goto(BASE + '#/dashboard'); await page.waitForTimeout(800);
  here = 'reports'; await page.goto(BASE + '#/reports'); await page.waitForTimeout(800);
  if (await xss()) bad('end', 'INJECTED SCRIPT RAN somewhere');
} finally {
  await browser.close();
}
console.log(problems.length ? problems.map((p) => '✗ ' + p).join('\n') : 'no problems');
console.log(`${stats.saved} odd records saved, ${stats.refused} refused with a message`);
console.log(`${problems.length} problem(s) — ${ENGINE}`);
