import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { useLocation } from 'react-router-dom';

/**
 * A button that opens a small panel under it (notifications, profile menu). Closes on a click outside,
 * on Escape (focus goes back to the button) and when the page changes.
 */
export function Dropdown({ label, title, className, button, panelLabel, panelClass, children }: {
  /** accessible name of the button */
  label: string;
  title?: string;
  className?: string;
  button: ReactNode;
  panelLabel: string;
  panelClass?: string;
  children: (close: () => void) => ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const id = useId();
  const loc = useLocation();
  useEffect(() => { setOpen(false); }, [loc.pathname, loc.search]);
  useEffect(() => {
    if (!open) return;
    const outside = (e: Event) => { if (!box.current?.contains(e.target as Node)) setOpen(false); };
    const key = (e: KeyboardEvent) => { if (e.key === 'Escape') { setOpen(false); trigger.current?.focus(); } };
    document.addEventListener('mousedown', outside);
    document.addEventListener('touchstart', outside, { passive: true });
    document.addEventListener('keydown', key);
    // Move focus into the panel so keyboard users land on its first link or button.
    const focusFirst = () => box.current?.querySelector<HTMLElement>('.dd-panel a, .dd-panel button')?.focus();
    if (typeof requestAnimationFrame === 'function') requestAnimationFrame(focusFirst); else setTimeout(focusFirst, 0);
    return () => {
      document.removeEventListener('mousedown', outside);
      document.removeEventListener('touchstart', outside);
      document.removeEventListener('keydown', key);
    };
  }, [open]);
  const close = () => setOpen(false);
  return (
    <div className="dd" ref={box}>
      <button ref={trigger} type="button" className={className} aria-label={label} title={title} aria-haspopup="dialog"
        aria-expanded={open} aria-controls={open ? id : undefined} onClick={() => setOpen((o) => !o)}>
        {button}
      </button>
      {open && (
        <div id={id} className={'dd-panel' + (panelClass ? ' ' + panelClass : '')} role="dialog" aria-label={panelLabel}>
          {children(close)}
        </div>
      )}
    </div>
  );
}
