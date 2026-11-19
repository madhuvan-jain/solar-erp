// Records a lesson of the tutorial series from the real app: a visible pointer moves to what is clicked, the clicked
// thing is ringed, typing is shown at reading speed, and 1080p frames are captured all the time. Each scene's start
// and end are noted, so build.py can put the narration on top and hold the last frame while it speaks.
import { chromium } from '../../node_modules/playwright/index.mjs';
import { mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const BASE = process.env.BASE || 'http://localhost:4173/';

const OVERLAY = `(() => {
  const add = () => {
    if (!document.documentElement || document.getElementById('v-cursor')) return;
    const c = document.createElement('div');
    c.id = 'v-cursor';
    c.innerHTML = '<svg width="30" height="30" viewBox="0 0 24 24"><path d="M3 2l7 19 2.6-7.4L20 11z" fill="#111" stroke="#fff" stroke-width="1.6" stroke-linejoin="round"/></svg>';
    c.style.cssText = 'position:fixed;left:0;top:0;z-index:2147483647;pointer-events:none;transform:translate(640px,360px);transition:transform .55s cubic-bezier(.3,.7,.3,1);filter:drop-shadow(0 2px 3px rgba(0,0,0,.35))';
    const r = document.createElement('div');
    r.id = 'v-ring';
    r.style.cssText = 'position:fixed;z-index:2147483646;pointer-events:none;border:3px solid #f5a623;border-radius:10px;box-shadow:0 0 0 4px rgba(245,166,35,.25);opacity:0;transition:opacity .25s,left .3s,top .3s,width .3s,height .3s';
    const p = document.createElement('div');
    p.id = 'v-pulse';
    p.style.cssText = 'position:fixed;z-index:2147483646;pointer-events:none;width:34px;height:34px;margin:-17px 0 0 -17px;border-radius:50%;background:rgba(245,166,35,.55);transform:scale(0);opacity:0';
    document.documentElement.append(r, p, c);
  };
  const start = () => { add(); if (document.documentElement) new MutationObserver(add).observe(document.documentElement, { childList: true }); };
  if (document.readyState === 'loading' || !document.documentElement) document.addEventListener('DOMContentLoaded', start); else start();
})();`;

export async function openLesson(lesson, outDir) {
  rmSync(outDir, { recursive: true, force: true });
  mkdirSync(join(outDir, 'frames'), { recursive: true });
  const phone = lesson.device === 'phone';
  const viewport = phone ? { width: 390, height: 844 } : { width: 1280, height: 720 };
  const scale = phone ? 1080 / 844 : 1.5; // frames 1920×1080 (desktop) or 499×1080 (phone, placed on a background later)
  // A fake camera (moving test picture) for the site-photo scenes.
  const cam = fileURLToPath(new URL('./assets/rooftop.mjpeg', import.meta.url));
  const browser = await chromium.launch({ args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream', `--use-file-for-fake-video-capture=${cam}`] });
  const ctx = await browser.newContext({
    viewport, deviceScaleFactor: phone ? 2 : 1.5, isMobile: phone, hasTouch: phone, acceptDownloads: true,
    permissions: ['geolocation', 'camera'], geolocation: { latitude: 25.6093, longitude: 85.1376, accuracy: 6 },
    locale: 'en-IN', timezoneId: 'Asia/Kolkata', colorScheme: 'light',
  });
  // WhatsApp is never really opened while recording.
  await ctx.route('https://wa.me/**', (r) => r.fulfill({ status: 200, contentType: 'text/html', body: '<title>WhatsApp</title>' }));
  await ctx.addInitScript(OVERLAY);
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
  page.on('console', (m) => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
  const cdp = await ctx.newCDPSession(page);
  let capturing = false, n = 0;
  const frames = [];
  const t0 = Date.now();
  const loop = async () => {
    while (capturing) {
      try {
        // What is on screen: the clip follows the page's scroll (on a phone the whole page scrolls).
        const pos = await cdp.send('Runtime.evaluate', { expression: '[window.scrollX, window.scrollY]', returnByValue: true }).catch(() => null);
        const [sx, sy] = pos?.result?.value || [0, 0];
        const r = await cdp.send('Page.captureScreenshot', { format: 'jpeg', quality: 86, clip: { x: sx, y: sy, width: viewport.width, height: viewport.height, scale } });
        const file = `f${String(n++).padStart(6, '0')}.jpg`;
        writeFileSync(join(outDir, 'frames', file), Buffer.from(r.data, 'base64'));
        frames.push([Date.now() - t0, file]);
      } catch { await new Promise((res) => setTimeout(res, 50)); }
    }
  };
  let looping = null;
  const scenes = [];
  const h = {
    page, ctx, phone, errors,
    async startCapture() { if (!capturing) { capturing = true; looping = loop(); } },
    async stopCapture() { capturing = false; await looping; },
    mark(kind) { if (kind === 'start') scenes.push({ start: Date.now() - t0 }); else scenes[scenes.length - 1].end = Date.now() - t0; },
    wait: (ms) => page.waitForTimeout(ms),
    async pointAt(target, { ring = true } = {}) {
      const loc = typeof target === 'string' ? page.locator(target).first() : target;
      await loc.scrollIntoViewIfNeeded().catch(() => {});
      const b = await loc.boundingBox();
      if (!b) return loc;
      const x = b.x + Math.min(b.width / 2, 60), y = b.y + Math.min(b.height / 2, 22);
      await page.evaluate(([x, y, b, ring]) => {
        const c = document.getElementById('v-cursor'); if (c) c.style.transform = `translate(${x}px,${y}px)`;
        const r = document.getElementById('v-ring');
        if (r) Object.assign(r.style, ring ? { left: b.x - 5 + 'px', top: b.y - 5 + 'px', width: b.width + 10 + 'px', height: b.height + 10 + 'px', opacity: '1' } : { opacity: '0' });
      }, [x, y, b, ring]);
      await page.waitForTimeout(650);
      return loc;
    },
    async unring() { await page.evaluate(() => { const r = document.getElementById('v-ring'); if (r) r.style.opacity = '0'; }); },
    async pulse() {
      await page.evaluate(() => {
        const c = document.getElementById('v-cursor'), p = document.getElementById('v-pulse');
        if (!c || !p) return;
        const m = /translate\(([-\d.]+)px,\s*([-\d.]+)px\)/.exec(c.style.transform);
        if (!m) return;
        p.style.left = m[1] + 'px'; p.style.top = m[2] + 'px';
        p.animate([{ transform: 'scale(.3)', opacity: 1 }, { transform: 'scale(1.6)', opacity: 0 }], { duration: 450 });
      });
    },
    async click(target, opts = {}) {
      const loc = await h.pointAt(target, opts);
      await h.pulse();
      await loc.click(opts.force ? { force: true } : {});
      await page.waitForTimeout(opts.after ?? 700);
      await h.unring();
    },
    async type(target, text, { clear = true, delay = 55 } = {}) {
      const loc = await h.pointAt(target);
      await loc.click();
      if (clear) await loc.fill('');
      await loc.pressSequentially(String(text), { delay });
      await page.waitForTimeout(350);
      await h.unring();
    },
    async select(target, value) {
      const loc = await h.pointAt(target);
      await h.pulse();
      await loc.selectOption(value);
      await page.waitForTimeout(600);
      await h.unring();
    },
    async selectText(target, text) {
      const loc = await h.pointAt(target);
      const v = await loc.locator('option').evaluateAll((os, t) => (os.find((o) => o.textContent.includes(t)) || {}).value, text);
      await h.pulse();
      await loc.selectOption(v);
      await page.waitForTimeout(600);
      await h.unring();
    },
    async fill(target, value) {
      const loc = await h.pointAt(target);
      await h.pulse();
      await loc.fill(String(value));
      await page.waitForTimeout(600);
      await h.unring();
    },
    async show(target, ms = 1400) { await h.pointAt(target); await page.waitForTimeout(ms); await h.unring(); },
    async go(hash, ready) {
      await page.evaluate((hsh) => { location.hash = hsh; }, hash.replace(/^#/, ''));
      await page.waitForFunction((hsh) => location.hash === hsh || location.hash.startsWith(hsh + '?'), '#' + hash.replace(/^#/, '').split('?')[0], { timeout: 15000 }).catch(() => {});
      if (ready) await page.locator(ready).first().waitFor({ timeout: 15000 });
      await page.waitForTimeout(700);
    },
    async scrollTo(target) { const loc = typeof target === 'string' ? page.locator(target).first() : target; await loc.evaluate((el) => el.scrollIntoView({ behavior: 'smooth', block: 'center' })); await page.waitForTimeout(900); },
    async top() { await page.evaluate(() => window.scrollTo({ top: 0, behavior: 'smooth' })); await page.waitForTimeout(700); },
  };
  return { browser, ctx, page, h, scenes, frames, errors, close: async () => { await h.stopCapture(); await browser.close(); } };
}

/** Off camera: a business with demo data, signed in as its owner (the state most lessons start from). */
export async function signUp(page, { demo = true, name = 'Asha Verma', email = 'asha@suryoday.example', mobile = '9835012345' } = {}) {
  await page.goto(BASE);
  await page.getByLabel('Your name').fill(name);
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Mobile number').fill(mobile);
  await page.getByLabel('Password', { exact: true }).fill('Surya@2026');
  await page.getByLabel('Confirm password').fill('Surya@2026');
  await page.getByRole('button', { name: 'Create account' }).click();
  await page.getByLabel('I have saved this code').check();
  await page.getByRole('button', { name: 'Continue' }).click();
  await page.getByRole('heading', { name: /Hello/ }).waitFor();
  if (demo) {
    await page.evaluate(() => { location.hash = '/settings?tab=data'; });
    await page.getByRole('button', { name: 'Load demo data' }).click();
    await page.getByRole('dialog', { name: 'Load demo data?' }).getByRole('button', { name: 'Load demo data' }).click();
    await page.getByText(/^Demo data loaded/).waitFor({ timeout: 30000 });
    // The demo business without "(Demo)" in its name, as a real one would look.
    await page.evaluate(() => { location.hash = '/settings'; });
    await page.locator('#s-companyName').fill('Suryoday Solar Solutions');
    await page.getByRole('button', { name: 'Save company profile' }).click();
    await page.getByText('Settings saved').first().waitFor();
    await page.evaluate(() => { location.hash = '/'; });
    await page.getByRole('heading', { name: /Hello/ }).waitFor();
  }
  await quiet(page);
}

/** Waits until no message (toast) is on screen, so a lesson never starts with one left from the setup. */
export async function quiet(page) {
  await page.waitForFunction(() => !document.querySelector('.toast'), null, { timeout: 15000 }).catch(() => {});
}
