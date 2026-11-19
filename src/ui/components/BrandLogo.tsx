import { useId } from 'react';

/**
 * The app's mark: the sun (surya) rising over a solar-panel arch (setu, a bridge) on a warm tile.
 * Same drawing as public/icon.svg; the gradient id is unique so several logos can share a page.
 */
export function BrandLogo({ size = 28, title }: { size?: number; title?: string }) {
  const id = useId().replace(/:/g, '');
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" role={title ? 'img' : undefined} aria-label={title} aria-hidden={title ? undefined : true} className="brand-logo">
      <defs>
        <linearGradient id={`bl${id}`} x1="0" y1="0" x2="1" y2="1"><stop offset="0" stopColor="#ffb21e" /><stop offset="1" stopColor="#f0632a" /></linearGradient>
      </defs>
      <rect width="64" height="64" rx="15" fill={`url(#bl${id})`} />
      <circle cx="32" cy="27" r="9.5" fill="#fff" />
      <path d="M32 9.5v4.2M18.6 15l2.9 2.9M45.4 15l-2.9 2.9M13 27h4.3M46.7 27H51" stroke="#fff" strokeWidth="3.4" strokeLinecap="round" />
      <path d="M8.5 52.5c5.8-9.6 14.4-15 23.5-15s17.7 5.4 23.5 15z" fill="#0d5f52" />
      <path d="M14.6 52.5c4.4-6.1 10.5-9.6 17.4-9.6s13 3.5 17.4 9.6M22 41l-3.2 11.5M32 37.5v15M42 41l3.2 11.5" fill="none" stroke="#ffd27a" strokeWidth="1.8" />
    </svg>
  );
}
