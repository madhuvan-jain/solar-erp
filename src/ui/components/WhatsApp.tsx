// "WhatsApp" on a record or a printed document: shows whom it goes to and the message (from Settings → WhatsApp),
// which can be changed before opening WhatsApp. Opening it notes the message in the record's history.
// A real link is used (not window.open), so it works in browsers, on phones and inside the Android app.
import { useId, useMemo, useState } from 'react';
import type { Rec } from '../../lib/schema';
import { useStore } from '../../lib/store';
import { getEntity } from '../../modules/registry';
import { canRead } from '../../lib/rbac';
import { waDisplay, waLink, waMessage } from '../../lib/whatsapp';
import { useDialogFocus } from './feedback';

export function WhatsAppButton({ entity, rec, print = false, className = 'btn' }: { entity: string; rec: Rec; print?: boolean; className?: string }) {
  const store = useStore();
  const msg = useMemo(() => waMessage(store, entity, rec), [store, entity, rec, store.getVersion()]);
  const [open, setOpen] = useState(false);
  if (!msg) return null;
  return <>
    <button type="button" className={className} onClick={() => setOpen(true)}>{print ? 'Share on WhatsApp' : 'WhatsApp'}</button>
    {open && <WhatsAppDialog entity={entity} rec={rec} print={print} onClose={() => setOpen(false)} />}
  </>;
}

function WhatsAppDialog({ entity, rec, print, onClose }: { entity: string; rec: Rec; print: boolean; onClose: () => void }) {
  const store = useStore();
  const msg = waMessage(store, entity, rec)!;
  const [text, setText] = useState(msg.text);
  const dlg = useDialogFocus(true, onClose);
  const titleId = useId();
  const href = waLink(msg.number, text.trim()) || '#';
  const sent = () => {
    // The history keeps what was sent and to whom (anyone who can see the record may add to it).
    const e = getEntity(entity);
    if (e && store.user && canRead(store.user, e.module)) {
      void store.addNote(entity, rec.id, `WhatsApp to ${msg.name} (${waDisplay(msg.number)}): ${text.trim()}`).catch(() => {});
    }
    onClose();
  };
  return (
    <div className="modal-back" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div ref={dlg} className="modal" role="dialog" aria-modal="true" aria-labelledby={titleId}>
        <h2 id={titleId}>WhatsApp {msg.name}</h2>
        <p className="muted small">To <strong>{waDisplay(msg.number)}</strong>. WhatsApp opens with this message; you check it there and press send.</p>
        <div className="field">
          <label htmlFor={`${titleId}-msg`}>Message</label>
          <textarea id={`${titleId}-msg`} className="input" rows={6} value={text} onChange={(e) => setText(e.target.value)} data-autofocus />
          <span className="help">{text.trim().length} characters. Change the usual wording under Settings → WhatsApp.</span>
        </div>
        {print && (
          <ol className="small wa-steps">
            <li>Tap <strong>Print / Save as PDF</strong> and choose <strong>Save as PDF</strong>.</li>
            <li>Tap <strong>Open WhatsApp</strong>, then attach the saved PDF in the chat (📎 → Document).</li>
          </ol>
        )}
        <div className="btn-row">
          {print && <button type="button" className="btn" onClick={() => window.print()}>Print / Save as PDF</button>}
          <a className="btn primary" href={href} target="_blank" rel="noreferrer" aria-disabled={!text.trim()} onClick={(e) => { if (!text.trim()) { e.preventDefault(); return; } sent(); }}>Open WhatsApp</a>
          <button type="button" className="btn" onClick={onClose}>Cancel</button>
        </div>
      </div>
    </div>
  );
}
