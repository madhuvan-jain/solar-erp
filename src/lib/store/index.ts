import { createContext, useContext, useSyncExternalStore } from 'react';
import { CloudBackend } from './cloud';
import { Store } from './store';
import type { Backend } from './types';

export function createBackend(): Backend | null {
  const url = import.meta.env.VITE_SUPABASE_URL?.trim();
  const key = import.meta.env.VITE_SUPABASE_ANON_KEY?.trim();
  return url && key ? new CloudBackend(url, key, { phoneOtp: import.meta.env.VITE_PHONE_OTP === '1' }) : null;
}

export const StoreContext = createContext<Store | null>(null);

export function useStore(): Store {
  const s = useContext(StoreContext);
  if (!s) throw new Error('StoreContext missing');
  // Re-render whenever any record changes.
  useSyncExternalStore((cb) => s.subscribe(cb), () => s.getVersion());
  return s;
}

export * from './store';
export * from './types';
