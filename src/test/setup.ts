import '@testing-library/jest-dom/vitest';
import 'fake-indexeddb/auto';
import { IDBFactory } from 'fake-indexeddb';
import { resetRecordStore } from '../lib/store/recordStore';
import { afterEach } from 'vitest';
import { cleanup } from '@testing-library/react';
import { webcrypto } from 'node:crypto';

// Node 18 + jsdom do not expose crypto.subtle / randomUUID on window.
if (!globalThis.crypto?.subtle) {
  Object.defineProperty(globalThis, 'crypto', { value: webcrypto, configurable: true });
}

afterEach(() => {
  globalThis.indexedDB = new IDBFactory(); // records, files and safety copies never leak from one test into the next
  resetRecordStore();
  if (typeof document === 'undefined') return; // node-environment tests (database)
  cleanup();
  localStorage.clear();
});
