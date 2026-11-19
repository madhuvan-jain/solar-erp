import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './ui/App';
import { CloudSetupRequired } from './ui/pages/Landing';
import { createBackend } from './lib/store';
import { applyStoredTheme } from './ui/pages/Settings';
import './ui/styles.css';
import { isNativeApp } from './lib/nativeSave';

applyStoredTheme();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    {(() => {
      const backend = createBackend();
      return backend ? <App backend={backend} landingPage /> : <CloudSetupRequired />;
    })()}
  </StrictMode>,
);

// Offline support + "Install app" on Android, iPhone (Share → Add to Home Screen) and Windows (Edge/Chrome).
// (The Android app carries its files inside it, so it needs no offline cache.)
if ('serviceWorker' in navigator && import.meta.env.PROD && !isNativeApp()) {
  window.addEventListener('load', () => {
    // On the very first visit there is no older version to replace, so nothing to announce.
    const hadVersion = !!navigator.serviceWorker.controller;
    navigator.serviceWorker.register('./sw.js').then((reg) => {
      // A newer version installed while this page is open: Layout switches to it by itself at a safe moment.
      reg.addEventListener('updatefound', () => {
        const next = reg.installing;
        next?.addEventListener('statechange', () => {
          if (next.state === 'activated' && hadVersion) {
            (window as { __ss1UpdateReady?: boolean }).__ss1UpdateReady = true;
            window.dispatchEvent(new Event('ss1-update-ready'));
          }
        });
      });
      // Check for a new version every hour while the app stays open.
      setInterval(() => { void reg.update().catch(() => {}); }, 3600_000);
    }).catch(() => { /* app still works without offline cache */ });
  });
}

// A screen of the old version tried to load a file the new version replaced: load the new version.
window.addEventListener('vite:preloadError', (e) => {
  e.preventDefault();
  window.location.reload();
});
