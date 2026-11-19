// Google Play graphics from the app itself (demo data): 8 phone screenshots 1080×1920, the 1024×500 feature graphic
// and the 512×512 icon, into go-live/play-store/. The app must be running: npx vite preview --port 4173
//   node scripts/store-assets.mjs
import { chromium } from '../node_modules/playwright/index.mjs';
import { mkdirSync, readFileSync, copyFileSync } from 'node:fs';
import { BASE, signUp, quiet } from './videos/engine.mjs';

const OUT = 'go-live/play-store';
mkdirSync(OUT, { recursive: true });
const b = await chromium.launch({ args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream', `--use-file-for-fake-video-capture=${new URL('./videos/assets/rooftop.mjpeg', import.meta.url).pathname.replace(/%20/g, ' ')}`] });
const ctx = await b.newContext({ viewport: { width: 360, height: 640 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true,
  permissions: ['geolocation', 'camera'], geolocation: { latitude: 25.6093, longitude: 85.1376, accuracy: 6 }, locale: 'en-IN', timezoneId: 'Asia/Kolkata' });
const page = await ctx.newPage();
await signUp(page);
// The "Demo data" badge is for testers, not for the store pictures.
const tidy = () => page.evaluate(() => { for (const a of document.querySelectorAll('a,button,span')) if (a.textContent?.trim() === 'Demo data') a.style.display = 'none'; });
const go = async (hash, ready) => { await page.evaluate((h) => { location.hash = h; }, hash); await page.locator(ready).first().waitFor({ timeout: 15000 }); await page.waitForTimeout(900); await quiet(page); await tidy(); };
const shots = [
  ['01-home', async () => go('/', 'h1')],
  ['02-dashboard', async () => go('/dashboard', '.kpi')],
  ['03-leads', async () => go('/m/leads', '[data-list="leads"]')],
  ['04-quotation', async () => { await go('/m/quotations', '[data-list="quotations"]'); await page.locator('tbody tr.clickable, .rec-card').first().click(); await page.locator('.detail-actions').waitFor(); await page.waitForTimeout(700); await tidy(); }],
  ['05-invoice', async () => { await go('/m/invoices', '[data-list="invoices"]'); await page.locator('tbody tr.clickable, .rec-card').first().click(); await page.locator('.detail-actions').waitFor(); await page.waitForTimeout(700); await tidy(); }],
  ['06-site-photo', async () => {
    await go('/m/leads', '[data-list="leads"]'); await page.locator('tbody tr.clickable, .rec-card').first().click();
    await page.getByRole('button', { name: '📷 Site photo' }).first().click();
    await page.getByRole('dialog', { name: 'SuryaSetu Camera' }).getByText(/Bihar, India/).first().waitFor({ timeout: 20000 }); await page.waitForTimeout(1500);
  }],
  ['07-projects', async () => { await page.keyboard.press('Escape'); await go('/m/projects?view=board', '[data-list="projects"]'); }],
  ['08-subsidy', async () => go('/m/subsidies', '[data-list="subsidies"]')],
];
for (const [name, act] of shots) { await act(); await page.screenshot({ path: `${OUT}/phone-${name}.png` }); console.log('✓', name); }

// Feature graphic 1024×500
const icon = 'data:image/png;base64,' + readFileSync('public/icon-512.png').toString('base64');
const shot = 'data:image/png;base64,' + readFileSync(`${OUT}/phone-01-home.png`).toString('base64');
const fg = await (await b.newContext({ viewport: { width: 1024, height: 500 } })).newPage();
await fg.setContent(`<html><body style="margin:0;width:1024px;height:500px;overflow:hidden;font-family:'Noto Sans',sans-serif;background:linear-gradient(160deg,#0b2545,#0e7468);color:#fff;position:relative">
  <div style="position:absolute;right:-120px;top:-150px;width:420px;height:420px;border-radius:50%;background:#f5a623"></div>
  <img src="${icon}" style="position:absolute;left:56px;top:60px;width:96px;height:96px;border-radius:22px">
  <div style="position:absolute;left:170px;top:66px;font-size:54px;font-weight:800">SuryaSetu</div>
  <div style="position:absolute;left:172px;top:132px;font-size:22px;opacity:.9">Solar business, end to end</div>
  <ul style="position:absolute;left:56px;top:200px;margin:0;padding-left:22px;font-size:23px;line-height:1.75">
    <li>Leads, site surveys and GST quotations</li><li>Installation, stock and delivery challans</li>
    <li>GST invoices, UPI QR and payments</li><li>PM Surya Ghar subsidy, service and AMC</li></ul>
  <img src="${shot}" style="position:absolute;right:70px;top:34px;height:432px;border-radius:26px;border:8px solid #111;box-shadow:0 10px 30px rgba(0,0,0,.35)">
</body></html>`);
await fg.screenshot({ path: `${OUT}/feature-graphic-1024x500.png` });
copyFileSync('public/icon-512.png', `${OUT}/icon-512.png`);
console.log('✓ feature graphic and icon');
await b.close();
