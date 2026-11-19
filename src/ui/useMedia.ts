import { useSyncExternalStore } from 'react';

/** True while the screen matches a media query, e.g. "(max-width: 640px)". Updates when the window is resized or rotated. */
export function useMedia(query: string): boolean {
  const supported = typeof window !== 'undefined' && typeof window.matchMedia === 'function';
  return useSyncExternalStore(
    (cb) => {
      if (!supported) return () => {};
      const m = window.matchMedia(query);
      m.addEventListener?.('change', cb);
      return () => m.removeEventListener?.('change', cb);
    },
    () => supported && window.matchMedia(query).matches,
    () => false,
  );
}

/** Phone-sized screen: lists become cards. */
export const PHONE = '(max-width: 640px)';

/** A real phone: small screen and a finger, not a mouse (a narrow window on a computer stays a computer). */
export const TOUCH_PHONE = '(max-width: 640px) and (pointer: coarse)';

export type LayoutChoice = 'auto' | 'desktop' | 'phone';
const LAYOUT_KEY = 'ss1:layout';
export function layoutChoice(): LayoutChoice {
  try { const v = localStorage.getItem(LAYOUT_KEY); return v === 'desktop' || v === 'phone' ? v : 'auto'; } catch { return 'auto'; }
}
export function setLayoutChoice(v: LayoutChoice) {
  try { if (v === 'auto') localStorage.removeItem(LAYOUT_KEY); else localStorage.setItem(LAYOUT_KEY, v); } catch { /* blocked storage */ }
  window.dispatchEvent(new Event('ss1-layout'));
}

/** The phone layout (bottom bar, round + button, lists as cards): on phones, or when chosen in Settings → Appearance. */
export function usePhone(): boolean {
  const auto = useMedia(TOUCH_PHONE);
  const choice = useSyncExternalStore(
    (cb) => { window.addEventListener('ss1-layout', cb); return () => window.removeEventListener('ss1-layout', cb); },
    layoutChoice, () => 'auto' as LayoutChoice,
  );
  return choice === 'phone' ? true : choice === 'desktop' ? false : auto;
}
