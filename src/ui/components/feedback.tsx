import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';

interface Toast { id: number; text: string; bad?: boolean }
interface ConfirmReq { title: string; body?: ReactNode; okLabel?: string; danger?: boolean; resolve: (ok: boolean) => void }

interface Feedback {
  toast(text: string, bad?: boolean): void;
  confirm(opts: Omit<ConfirmReq, 'resolve'>): Promise<boolean>;
}

const Ctx = createContext<Feedback>({ toast: () => {}, confirm: async () => false });
export const useFeedback = () => useContext(Ctx);

export function errorText(e: unknown): string {
  if (e instanceof Error && e.message) return e.message;
  return 'Something went wrong. Please try again.';
}

/** Keeps keyboard focus inside a dialog and returns it to where it was when the dialog closes. */
/** Open dialogs, newest last: only the top one answers Escape (one press never closes two). */
const dialogStack: symbol[] = [];

export function useDialogFocus(open: boolean, onEscape: () => void) {
  const ref = useRef<HTMLDivElement>(null);
  const escape = useRef(onEscape);
  escape.current = onEscape;
  useEffect(() => {
    if (!open) return;
    const me = Symbol('dialog');
    dialogStack.push(me);
    const previous = document.activeElement as HTMLElement | null;
    const box = ref.current;
    const focusables = () => Array.from(box?.querySelectorAll<HTMLElement>('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])') || [])
      .filter((el) => !el.hasAttribute('disabled'));
    if (box && !box.contains(document.activeElement)) (box.querySelector<HTMLElement>('[data-autofocus]') || focusables()[0])?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (dialogStack[dialogStack.length - 1] !== me) return;
      if (e.key === 'Escape') { e.preventDefault(); e.stopImmediatePropagation(); escape.current(); }
      if (e.key === 'Tab') {
        const els = focusables();
        if (!els.length) return;
        const first = els[0], last = els[els.length - 1];
        if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
        else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
      }
    };
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('keydown', onKey);
      const i = dialogStack.lastIndexOf(me);
      if (i >= 0) dialogStack.splice(i, 1);
      previous?.focus?.();
    };
  }, [open]);
  return ref;
}

export function FeedbackProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [req, setReq] = useState<ConfirmReq | null>(null);
  const reqRef = useRef<ConfirmReq | null>(null);
  const openedAt = useRef(0);
  const seq = useRef(0);

  const toast = useCallback((text: string, bad?: boolean) => {
    const id = ++seq.current;
    setToasts((t) => [...t.slice(-3), { id, text, bad }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), bad ? 7000 : 4000);
  }, []);

  const close = useCallback((ok: boolean) => {
    reqRef.current?.resolve(ok);
    reqRef.current = null;
    setReq(null);
  }, []);

  const confirm = useCallback((opts: Omit<ConfirmReq, 'resolve'>) => new Promise<boolean>((resolve) => {
    reqRef.current?.resolve(false); // only one question at a time
    const r = { ...opts, resolve };
    reqRef.current = r;
    openedAt.current = Date.now();
    setReq(r);
  }), []);

  // A question about one page must never be answered on another (e.g. after pressing Back).
  useEffect(() => {
    // The router itself restores the address right after blocking a Back press; ignore that bounce.
    const h = () => { if (reqRef.current && Date.now() - openedAt.current > 600) close(false); };
    window.addEventListener('hashchange', h);
    return () => window.removeEventListener('hashchange', h);
  }, [close]);

  const dlg = useDialogFocus(!!req, () => close(false));

  return (
    <Ctx.Provider value={{ toast, confirm }}>
      {children}
      {req && (
        <div className="modal-back" onClick={() => close(false)}>
          <div ref={dlg} className="modal" role="dialog" aria-modal="true" aria-labelledby="dlg-title" onClick={(e) => e.stopPropagation()}>
            <h2 id="dlg-title">{req.title}</h2>
            {req.body && <div className="muted" style={{ marginBottom: 16 }}>{req.body}</div>}
            <div className="btn-row" style={{ justifyContent: 'flex-end' }}>
              <button className="btn" onClick={() => close(false)} {...(req.danger ? { 'data-autofocus': true } : {})}>Cancel</button>
              <button className={'btn ' + (req.danger ? 'danger' : 'primary')} onClick={() => close(true)} {...(req.danger ? {} : { 'data-autofocus': true })}>
                {req.okLabel || 'OK'}
              </button>
            </div>
          </div>
        </div>
      )}
      <div className="toasts" aria-live="polite">
        {toasts.map((t) => <div key={t.id} className={'toast' + (t.bad ? ' bad' : '')} role={t.bad ? 'alert' : 'status'}>{t.text}</div>)}
      </div>
    </Ctx.Provider>
  );
}
