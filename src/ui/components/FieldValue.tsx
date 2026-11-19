import { useState } from 'react';
import type { Field, Rec } from '../../lib/schema';
import { useStore, type FileRef } from '../../lib/store';
import { money } from '../../lib/money';
import { formatDate } from '../../lib/format';
import { Link } from 'react-router-dom';
import { errorText, useFeedback } from './feedback';

const GOOD = ['Won', 'Sent', 'Completed', 'Paid', 'Approved', 'Disbursed', 'Closed', 'Resolved', 'Done', 'Accepted', 'Handover', 'Received', 'Active', 'Present', 'Renewed'];
const BAD = ['Lost', 'Cancelled', 'Rejected', 'Delayed', 'Expired', 'Absent', 'Urgent'];
const WARN = ['Unpaid', 'Partially Paid', 'On Hold', 'Negotiation', 'High', 'Late', 'Half Day', 'Under Review', 'Partially Received'];

export function StatusBadge({ value }: { value: unknown }) {
  const v = String(value ?? '');
  if (!v) return <span className="muted">—</span>;
  const cls = GOOD.includes(v) ? 'good' : BAD.includes(v) ? 'bad' : WARN.includes(v) ? 'warn' : 'info';
  return <span className={'badge ' + cls}>{v}</span>;
}

const SAFE_DATA_URL = /^data:[\w.+-]+\/[\w.+-]+;base64,[A-Za-z0-9+/=]+$/;

/** Opens an attachment in a new tab using DOM APIs only (never innerHTML), so file data cannot run script. */
export function FileLink({ file }: { file: FileRef }) {
  const store = useStore();
  const { toast } = useFeedback();
  const [busy, setBusy] = useState(false);
  if (!file || typeof file !== 'object') return <span className="muted">—</span>;
  const name = String(file.name || 'file');
  const open = async () => {
    setBusy(true);
    // Open the tab synchronously so pop-up blockers allow it, then point it at the file.
    const w = window.open('', '_blank');
    if (!w) { setBusy(false); toast('Your browser blocked the new tab. Allow pop-ups for this site and try again.', true); return; }
    w.opener = null;
    try {
      const url = await store.backend.fileUrl(file);
      if (!url) throw new Error('File is not available.');
      if (url.startsWith('data:')) {
        if (!SAFE_DATA_URL.test(url)) throw new Error('This attachment is damaged and cannot be opened.');
        const mime = url.slice(5, url.indexOf(';'));
        if (mime.startsWith('image/')) {
          // An <img> never runs script, even for SVG.
          const doc = w.document;
          doc.title = name;
          const img = doc.createElement('img');
          img.setAttribute('style', 'max-width:100%');
          img.setAttribute('alt', name);
          img.src = url;
          doc.body.replaceChildren(img);
        } else {
          const bytes = Uint8Array.from(atob(url.slice(url.indexOf(',') + 1)), (c) => c.charCodeAt(0));
          if (mime === 'application/pdf') {
            w.location.href = URL.createObjectURL(new Blob([bytes], { type: 'application/pdf' }));
          } else {
            // Anything else (HTML, Office files…) is downloaded, never rendered inside the app.
            w.close();
            const a = document.createElement('a');
            a.href = URL.createObjectURL(new Blob([bytes], { type: 'application/octet-stream' }));
            a.download = name;
            a.click();
            setTimeout(() => URL.revokeObjectURL(a.href), 2000);
          }
        }
      } else if (/^https:\/\//.test(url)) {
        w.location.href = url;
      } else throw new Error('File is not available.');
    } catch (e) {
      w.close();
      toast(errorText(e), true);
    } finally { setBusy(false); }
  };
  return (
    <button type="button" className="btn sm" onClick={open} disabled={busy}>
      📎 {name} <span className="muted small">({Math.max(1, Math.round((Number(file.size) || 0) / 1024))} KB)</span>
    </button>
  );
}

export function FieldValue({ field, rec }: { field: Field; rec: Rec }) {
  const store = useStore();
  const v = rec[field.key];
  if (v === undefined || v === null || v === '') {
    if (field.type === 'bool') return <>No</>;
    return <span className="muted">—</span>;
  }
  switch (field.type) {
    case 'money': return <>{money(v)}</>;
    case 'percent':
      return (
        <span style={{ display: 'inline-flex', gap: 8, alignItems: 'center' }}>
          <span className="progress" style={{ width: 80 }}><span style={{ width: `${Math.min(100, Math.max(0, Number(v)))}%` }} /></span>
          {Number(v)}%
        </span>
      );
    case 'date': case 'datetime': return <>{formatDate(v)}</>;
    case 'number': return <>{Number(v).toLocaleString('en-IN', { maximumFractionDigits: field.decimals ?? 3 })}</>;
    case 'bool': return <>{v ? 'Yes' : 'No'}</>;
    case 'select': return field.key === 'status' || field.key === 'stage' || field.key === 'priority' ? <StatusBadge value={v} /> : <>{String(v)}</>;
    case 'ref': {
      const exists = store.get(field.ref!, v);
      return exists ? <Link to={`/m/${field.ref}/${v}`} onClick={(e) => e.stopPropagation()}>{store.titleOf(field.ref!, v)}</Link> : <span className="muted">(deleted)</span>;
    }
    case 'user': return <>{store.userName(v)}</>;
    case 'phone': return <a href={`tel:${String(v).replace(/[^\d+]/g, '')}`} onClick={(e) => e.stopPropagation()}>{String(v)}</a>;
    case 'email': return <a href={`mailto:${String(v)}`} onClick={(e) => e.stopPropagation()}>{String(v)}</a>;
    case 'file': return <FileLink file={v as FileRef} />;
    case 'checklist': {
      const done = Array.isArray(v) ? (v as string[]) : [];
      const all = field.items || [];
      return <>{all.filter((i) => done.includes(i)).length} / {all.length} done</>;
    }
    case 'items': return <>{Array.isArray(v) ? v.length : 0} line(s)</>;
    default: return <>{String(v)}</>;
  }
}
