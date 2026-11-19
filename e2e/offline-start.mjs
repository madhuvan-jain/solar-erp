// The installed website must open without a connection, with its full look and screens: open it online once, stop
// the server, reload. Then the same after a new version installed in the background. (Regression check: the offline
// copy used to keep only the page, not its stylesheet and scripts, so it opened blank or unstyled.)
// Runs its own server on port 4174 (the server really stops; the browser's "offline" switch does not reach service
// workers). Needs a build first:  npm run build && node e2e/offline-start.mjs
import { chromium } from 'playwright';
import { execSync, spawn } from 'node:child_process';

const PORT = 4174;
const URL_ = `http://localhost:${PORT}/`;
const start = () => new Promise((res, rej) => {
  const s = spawn('npx', ['vite', 'preview', '--port', String(PORT), '--strictPort'], { stdio: ['ignore', 'pipe', 'pipe'], detached: true });
  s.stdout.on('data', (d) => { if (/Local/.test(String(d))) res(s); });
  s.on('exit', (c) => rej(new Error(`server exited ${c}`)));
});
const stop = async (s) => { try { process.kill(-s.pid, 'SIGTERM'); } catch { /* gone */ } await new Promise((r) => setTimeout(r, 1500)); };
const look = (p) => p.evaluate(() => ({
  rules: [...document.styleSheets].reduce((n, s) => { try { return n + s.cssRules.length; } catch { return n; } }, 0),
  styled: getComputedStyle(document.body).fontFamily.includes('Inter'),
  screen: document.querySelector('h2')?.textContent || '',
}));
const okLook = (r) => r.styled && r.rules > 100 && /admin account|Sign in|Choose an account/.test(r.screen);

let failed = 0;
async function scenario(name, update) {
  let srv = await start();
  const b = await chromium.launch();
  try {
    const ctx = await b.newContext({ viewport: { width: 1280, height: 800 } });
    const p = await ctx.newPage();
    await p.goto(URL_);
    await p.evaluate(async () => { await navigator.serviceWorker.ready; });
    await p.waitForTimeout(1500);
    if (update) {
      execSync('npm run build', { stdio: 'ignore' }); // a new version (new service worker)
      await p.evaluate(async () => { await (await navigator.serviceWorker.getRegistration())?.update(); });
      await p.waitForTimeout(4000);
    }
    await stop(srv); srv = null;
    await p.reload().catch(() => {});
    await p.waitForTimeout(2500);
    const r = await look(p);
    const ok = okLook(r);
    if (!ok) failed++;
    console.log(`  ${ok ? '✓' : '✗'} ${name}: ${r.rules} style rules, ${r.styled ? 'styled' : 'NOT styled'}, screen "${r.screen}"`);
  } finally {
    await b.close();
    if (srv) await stop(srv);
  }
}

await scenario('opens offline after a first visit', false);
await scenario('opens offline after a new version installed in the background', true);
console.log(failed ? `\nOFFLINE START BROKEN (${failed})` : '\nOFFLINE START OK');
process.exit(failed ? 1 : 0);
