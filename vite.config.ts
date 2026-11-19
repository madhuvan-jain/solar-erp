/// <reference types="vitest" />
import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import { readFileSync, writeFileSync, existsSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Stamps the service worker with a unique build id (so each release gets a fresh offline cache) and the list of
 * built files to save with it (so the app also opens offline with its look and scripts, not only its page).
 */
function stampServiceWorker(): Plugin {
  let outDir = 'dist';
  return {
    name: 'stamp-sw',
    apply: 'build',
    configResolved(c) { outDir = c.build.outDir; },
    closeBundle() {
      const file = resolve(outDir, 'sw.js');
      if (!existsSync(file)) return;
      const id = Date.now().toString(36);
      const dir = resolve(outDir, 'assets');
      const assets = existsSync(dir) ? readdirSync(dir).filter((f) => /\.(js|css|woff2?|png|svg|jpg|webp)$/.test(f)).map((f) => `'./assets/${f}'`) : [];
      writeFileSync(file, readFileSync(file, 'utf8').replace(/__BUILD_ID__/g, id).replace('/*__PRECACHE__*/', assets.join(', ')));
    },
  };
}

const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8')) as { version: string };

/**
 * The Android app (CAP_BUILD=1, set by scripts/build-apk.sh) has no web server to send security headers, so the
 * same policy as netlify.toml goes into the page itself. (frame-ancestors only works as a header and is left out.)
 */
export const APP_CSP = [
  "default-src 'self'", "script-src 'self'", "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob: https://*.supabase.co", "media-src 'self' blob:",
  "connect-src 'self' https://*.supabase.co wss://*.supabase.co", "frame-src 'self' blob: data: https://*.supabase.co",
  "object-src 'none'", "base-uri 'self'", "form-action 'self'", "manifest-src 'self'", "worker-src 'self' blob:",
].join('; ');

function appCsp(): Plugin {
  return {
    name: 'app-csp',
    apply: 'build',
    transformIndexHtml(html) {
      if (process.env.CAP_BUILD !== '1') return html;
      return html.replace('<head>', `<head>\n    <meta http-equiv="Content-Security-Policy" content="${APP_CSP}" />`);
    },
  };
}

export default defineConfig({
  plugins: [react(), stampServiceWorker(), appCsp()],
  define: { __APP_VERSION__: JSON.stringify(pkg.version) },
  base: './',
  test: {
    globals: true,
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.ts'],
    testTimeout: 20000,
    exclude: ['e2e/**', 'node_modules/**'],
    // The payment functions (Deno) import supabase-js from JSR; in the tests a stand-in backed by PGlite answers.
    alias: { 'jsr:@supabase/supabase-js@2': fileURLToPath(new URL('./src/test/fakeSupabaseJsr.ts', import.meta.url)) },
  },
});
