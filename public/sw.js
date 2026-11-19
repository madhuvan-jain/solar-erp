// Network-first for pages, cache-first for built (content-hashed) assets. Never caches API calls.
// __BUILD_ID__ is replaced at build time, so every release starts a fresh cache and old files are dropped.
const CACHE = 'solar-erp-__BUILD_ID__';
// Every built file (stylesheet, scripts), listed at build time (vite.config.ts). They are saved when this version
// installs, together with the page: a page saved without its files would open blank or unstyled when offline.
const PRECACHE = [/*__PRECACHE__*/];

self.addEventListener('install', (e) => {
  // If any file cannot be saved, this version does not install and the previous one keeps working.
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(['./', './manifest.webmanifest', './icon.svg', ...PRECACHE])).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  const url = new URL(req.url);
  if (req.method !== 'GET' || url.origin !== self.location.origin) return;
  // Only the app itself is saved for offline start; other pages (privacy policy etc.) always come from the network.
  const isApp = url.pathname.endsWith('/') || url.pathname.endsWith('/index.html');
  if (req.mode === 'navigate' && !isApp) return;
  if (req.mode === 'navigate') {
    e.respondWith(fetch(req).then((res) => {
      if (res.ok) {
        const copy = res.clone();
        caches.open(CACHE).then((c) => c.put('./', copy));
      }
      return res;
    }).catch(() => caches.match('./').then((hit) => hit || Response.error())));
    return;
  }
  if (!url.pathname.includes('/assets/')) return; // manifest, icons, sw.js: always from the network
  // Built files never change (their names carry their content), so match on the address alone: a server that marks
  // them "Vary: Origin" would otherwise never match the saved copy (the page's own requests carry an Origin header).
  e.respondWith(caches.match(req, { ignoreVary: true }).then((hit) => hit || fetch(req).then((res) => {
    if (res.ok) {
      const copy = res.clone();
      caches.open(CACHE).then((c) => c.put(req, copy));
    }
    return res;
  })));
});
