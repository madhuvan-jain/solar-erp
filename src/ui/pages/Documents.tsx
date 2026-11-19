// The Documents app made for files: drop several files at once, see them as cards with a preview,
// open a large preview (images and PDFs) and move through them, download, and find a customer's or
// project's papers right on that customer or project.
import { useEffect, useMemo, useRef, useState, type DragEvent } from 'react';
import { Link } from 'react-router-dom';
import { useStore, type FileRef } from '../../lib/store';
import type { Store } from '../../lib/store';
import type { Rec } from '../../lib/schema';
import { canWrite } from '../../lib/rbac';
import { formatDate, localDateOf, localDateTimeOf, todayIso } from '../../lib/format';
import { getEntity } from '../../modules/registry';
import { errorText, useDialogFocus, useFeedback } from '../components/feedback';
import { isNativeApp, saveInApp } from '../../lib/nativeSave';
import { CameraButton, type GeoPhoto } from '../components/GeoCamera';

const SAFE_DATA_URL = /^data:[\w.+-]+\/[\w.+-]+;base64,[A-Za-z0-9+/=]+$/;
export const DOC_CATEGORIES = (): string[] => getEntity('documents')?.fields.find((f) => f.key === 'category')?.options || [];

const fileOf = (d: Rec): FileRef | null => (d.file && typeof d.file === 'object' ? (d.file as FileRef) : null);
const ext = (name: string) => (/\.([a-z0-9]{1,5})$/i.exec(name)?.[1] || '').toLowerCase();

export type Kind = 'image' | 'pdf' | 'sheet' | 'doc' | 'other';
export function fileKind(f: FileRef | null): Kind {
  if (!f) return 'other';
  const t = String(f.type || ''), e = ext(String(f.name || ''));
  // Pictures we can show (SVG is a drawing format that can carry script, so it is only ever downloaded).
  if ((t.startsWith('image/') && t !== 'image/svg+xml') || (!t && ['jpg', 'jpeg', 'png', 'webp', 'gif', 'heic'].includes(e))) return 'image';
  if (t === 'application/pdf' || e === 'pdf') return 'pdf';
  if (/sheet|excel|csv/.test(t) || ['xls', 'xlsx', 'csv', 'ods'].includes(e)) return 'sheet';
  if (/word|document|text/.test(t) || ['doc', 'docx', 'odt', 'txt', 'rtf'].includes(e)) return 'doc';
  return 'other';
}
const KIND_LABEL: Record<Kind, string> = { image: 'Photo', pdf: 'PDF', sheet: 'Sheet', doc: 'Document', other: 'File' };
const KIND_ICON: Record<Kind, string> = { image: '🖼', pdf: '📄', sheet: '📊', doc: '📝', other: '📎' };

export const fileSize = (n: number) => (n >= 1048576 ? `${(n / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);

/** A safe address for showing the file inside the app: images as data/https URLs, PDFs as blob URLs. */
async function viewUrl(store: Store, f: FileRef): Promise<{ url: string; revoke?: () => void }> {
  const raw = await store.backend.fileUrl(f);
  if (!raw) throw new Error('This file is not available.');
  if (raw.startsWith('data:')) {
    if (!SAFE_DATA_URL.test(raw)) throw new Error('This file is damaged and cannot be shown.');
    const mime = raw.slice(5, raw.indexOf(';'));
    if (mime.startsWith('image/') && mime !== 'image/svg+xml') return { url: raw };
    const bytes = Uint8Array.from(atob(raw.slice(raw.indexOf(',') + 1)), (c) => c.charCodeAt(0));
    // PDFs are shown by the browser's viewer; anything else is only ever downloaded, never rendered.
    const url = URL.createObjectURL(new Blob([bytes], { type: mime === 'application/pdf' ? 'application/pdf' : 'application/octet-stream' }));
    return { url, revoke: () => URL.revokeObjectURL(url) };
  }
  if (/^https:\/\//.test(raw)) return { url: raw };
  throw new Error('This file is not available.');
}

export async function downloadDoc(store: Store, f: FileRef) {
  const raw = await store.backend.fileUrl(f);
  if (!raw) throw new Error('This file is not available.');
  if (raw.startsWith('data:')) {
    if (!SAFE_DATA_URL.test(raw)) throw new Error('This file is damaged.');
    const bytes = Uint8Array.from(atob(raw.slice(raw.indexOf(',') + 1)), (c) => c.charCodeAt(0));
    if (isNativeApp()) { await saveInApp(String(f.name || 'file'), new Blob([bytes], { type: f.type || 'application/octet-stream' })); return; }
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([bytes], { type: 'application/octet-stream' }));
    a.download = String(f.name || 'file');
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  } else if (/^https:\/\//.test(raw)) {
    const w = window.open(raw, '_blank', 'noopener');
    if (!w) throw new Error('Your browser blocked the new tab. Allow pop-ups for this site and try again.');
  } else throw new Error('This file is not available.');
}

// Small JPEG thumbnails, made once per file and kept (small) for this visit — never the full photo in memory.
const thumbCache = new Map<string, string>();
const thumbKey = (f: FileRef) => String(f.local || f.path || f.dataUrl?.slice(-64) || f.name);

async function makeThumb(store: Store, f: FileRef): Promise<string> {
  const k = thumbKey(f);
  const hit = thumbCache.get(k);
  if (hit) return hit;
  const v = await viewUrl(store, f);
  try {
    const img = new Image();
    img.decoding = 'async';
    img.crossOrigin = 'anonymous';
    await new Promise<void>((res, rej) => { img.onload = () => res(); img.onerror = () => rej(new Error('bad image')); img.src = v.url; });
    const scale = Math.min(1, 320 / Math.max(img.naturalWidth, img.naturalHeight));
    const c = document.createElement('canvas');
    c.width = Math.max(1, Math.round(img.naturalWidth * scale)); c.height = Math.max(1, Math.round(img.naturalHeight * scale));
    const g = c.getContext('2d');
    if (!g) throw new Error('no canvas');
    g.drawImage(img, 0, 0, c.width, c.height);
    const small = c.toDataURL('image/jpeg', 0.75);
    thumbCache.set(k, small);
    return small;
  } catch {
    return v.url.startsWith('blob:') ? '' : v.url; // a picture we cannot shrink (e.g. a signed web link) is shown as is
  } finally { v.revoke?.(); }
}

/** Small preview: a thumbnail for photos (made only when the card comes into view), a file-type tile otherwise. */
function Thumb({ file }: { file: FileRef | null }) {
  const store = useStore();
  const kind = fileKind(file);
  const [url, setUrl] = useState(() => (file && kind === 'image' ? thumbCache.get(thumbKey(file)) || '' : ''));
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!file || kind !== 'image' || url) return;
    let live = true;
    const load = () => { void makeThumb(store, file).then((u) => { if (live && u) setUrl(u); }).catch(() => {}); };
    const el = box.current;
    if (!el || typeof IntersectionObserver === 'undefined') { load(); return () => { live = false; }; }
    const io = new IntersectionObserver((es) => { if (es.some((e) => e.isIntersecting)) { io.disconnect(); load(); } }, { rootMargin: '200px' });
    io.observe(el);
    return () => { live = false; io.disconnect(); };
  }, [store, file, kind, url]);
  if (url) return <img className="files-thumb" src={url} alt="" />;
  return <div ref={box} className={`files-thumb kind-${kind}`} aria-hidden><span>{KIND_ICON[kind]}</span><b>{ext(String(file?.name || '')).toUpperCase() || KIND_LABEL[kind]}</b></div>;
}

const expiryBadge = (d: Rec) => {
  const v = String(d.expiresOn || '');
  if (!v) return null;
  const today = todayIso();
  if (v < today) return <span className="badge bad">Expired {formatDate(v)}</span>;
  const soon = new Date(Date.parse(today) + 30 * 86400000).toISOString().slice(0, 10);
  return <span className={'badge ' + (v <= soon ? 'warn' : 'info')}>Valid till {formatDate(v)}</span>;
};

/** Documents as cards. Tap the preview to look at it; ‹ › in the preview move through the list. */
const PAGE = 60;

export function DocCards({ docs, empty }: { docs: Rec[]; empty?: string }) {
  const store = useStore();
  const { toast } = useFeedback();
  // The open document is remembered by id, so the preview follows it if the list changes (or closes if it is gone).
  const [openId, setOpenId] = useState<string | null>(null);
  const [shown, setShown] = useState(PAGE);
  const openIndex = openId ? docs.findIndex((d) => d.id === openId) : -1;
  if (!docs.length) return <p className="muted">{empty || 'No documents yet.'}</p>;
  return (
    <>
      <ul className="files-cards">
        {docs.slice(0, shown).map((d) => {
          const f = fileOf(d);
          return (
            <li key={d.id} className="files-card">
              <button type="button" className="files-open" onClick={() => setOpenId(d.id)} aria-label={`Preview ${d.name}`}><Thumb file={f} /></button>
              <div className="files-meta">
                <Link to={`/m/documents/${d.id}`} className="files-name">{String(d.name || f?.name || 'Document')}</Link>
                <div className="muted small files-line">
                  {d.category ? <span className="badge info">{String(d.category)}</span> : null}
                  {d.customerId ? <Link to={`/m/customers/${d.customerId}`}>{store.titleOf('customers', d.customerId)}</Link> : null}
                </div>
                <div className="muted small files-line">
                  <span>{f ? `${KIND_LABEL[fileKind(f)]} · ${fileSize(Number(f.size) || 0)}` : 'No file'}</span>
                  <span>{formatDate(localDateOf(d.createdAt))}</span>
                  {expiryBadge(d)}
                </div>
              </div>
              {f && <button type="button" className="btn ghost sm files-dl" aria-label={`Download ${d.name}`} title="Download"
                onClick={() => void downloadDoc(store, f).catch((e) => toast(errorText(e), true))}>⬇</button>}
            </li>
          );
        })}
      </ul>
      {docs.length > shown && <div className="center" style={{ marginTop: 10 }}><button type="button" className="btn" onClick={() => setShown(shown + PAGE)}>Show more ({docs.length - shown} left)</button></div>}
      {openIndex >= 0 && <Preview docs={docs} index={openIndex} onIndex={(i) => setOpenId(docs[i]?.id ?? null)} onClose={() => setOpenId(null)} />}
    </>
  );
}

/** Large preview of one document, with ‹ › to the others and a download button. */
function Preview({ docs, index, onIndex, onClose }: { docs: Rec[]; index: number; onIndex: (i: number) => void; onClose: () => void }) {
  const store = useStore();
  const { toast } = useFeedback();
  const dlg = useDialogFocus(true, onClose);
  const d = docs[index];
  const f = fileOf(d);
  const kind = fileKind(f);
  const [view, setView] = useState<{ url: string; error?: string } | null>(null);
  useEffect(() => {
    let live = true, revoke: (() => void) | undefined;
    setView(null);
    if (!f || (kind !== 'image' && kind !== 'pdf')) { setView({ url: '' }); return; }
    viewUrl(store, f).then((v) => { revoke = v.revoke; if (live) setView({ url: v.url }); else v.revoke?.(); })
      .catch((e) => { if (live) setView({ url: '', error: errorText(e) }); });
    return () => { live = false; revoke?.(); };
  }, [store, f, kind]);
  useEffect(() => {
    const k = (e: KeyboardEvent) => {
      if (e.key === 'ArrowRight' && index < docs.length - 1) onIndex(index + 1);
      if (e.key === 'ArrowLeft' && index > 0) onIndex(index - 1);
    };
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  }, [index, docs.length, onIndex]);
  return (
    <div className="modal-back" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div ref={dlg} className="modal files-preview" role="dialog" aria-modal="true" aria-labelledby="dp-title">
        <div className="files-preview-head">
          <div>
            <h2 id="dp-title">{String(d.name || f?.name || 'Document')}</h2>
            <div className="muted small">{[d.category, d.customerId ? store.titleOf('customers', d.customerId) : '', f ? `${f.name} · ${fileSize(Number(f.size) || 0)}` : ''].filter(Boolean).join(' · ')}</div>
          </div>
          <div className="btn-row">
            <span className="muted small">{index + 1} / {docs.length}</span>
            <button type="button" className="btn sm" aria-label="Previous document" disabled={index === 0} onClick={() => onIndex(index - 1)}>‹</button>
            <button type="button" className="btn sm" aria-label="Next document" disabled={index === docs.length - 1} onClick={() => onIndex(index + 1)}>›</button>
            {f && <button type="button" className="btn sm primary" onClick={() => void downloadDoc(store, f).catch((e) => toast(errorText(e), true))}>⬇ Download</button>}
            <Link className="btn sm" to={`/m/documents/${d.id}`} onClick={onClose}>Open</Link>
            <button type="button" className="btn sm" onClick={onClose}>Close</button>
          </div>
        </div>
        <div className="files-preview-body">
          {!view ? <p className="muted" role="status">Loading…</p>
            : view.error ? <p className="error">{view.error}</p>
            : kind === 'image' && view.url ? <img src={view.url} alt={String(d.name || '')} />
            : kind === 'pdf' && view.url ? <div className="files-pdf"><iframe title={String(d.name || 'PDF')} src={view.url} />
                <a className="btn sm" href={view.url} target="_blank" rel="noreferrer">PDF not showing? Open it in a new tab</a></div>
            : <div className="files-noview"><Thumb file={f} /><p className="muted">No preview for this kind of file. Download it to open it.</p></div>}
        </div>
      </div>
    </div>
  );
}

/** "Drop files here": one document per file, with shared category, customer and project. */
export function AddFiles({ customerId, projectId, compact }: { customerId?: string; projectId?: string; compact?: boolean }) {
  const store = useStore();
  const input = useRef<HTMLInputElement>(null);
  const [files, setFiles] = useState<File[] | null>(null);
  const [geos, setGeos] = useState<GeoPhoto['geo'][]>([]);
  const [over, setOver] = useState(false);
  if (!canWrite(store.user, 'documents')) return null;
  const pick = (list: FileList | null) => { if (list && list.length) { setGeos([]); setFiles(Array.from(list)); } };
  const drop = (e: DragEvent) => { e.preventDefault(); setOver(false); pick(e.dataTransfer.files); };
  return (
    <>
      <div className={'files-drop' + (over ? ' over' : '') + (compact ? ' compact' : '')}
        onDragOver={(e) => { if (e.dataTransfer.types.includes('Files')) { e.preventDefault(); setOver(true); } }}
        onDragLeave={() => setOver(false)} onDrop={drop}>
        <span aria-hidden>⬆</span>
        <span><strong>Drop files here</strong> or <button type="button" className="link-btn" onClick={() => input.current?.click()}>choose files</button>
          <span className="muted small"> — photos, PDFs, Word or Excel; several at once{store.mode === 'local' ? ', up to 15 MB each' : ', up to 20 MB each'}</span></span>
        <input ref={input} type="file" multiple hidden accept="image/*,application/pdf,.doc,.docx,.xls,.xlsx,.csv,.txt,.odt,.ods"
          onChange={(e) => { pick(e.target.files); e.target.value = ''; }} aria-label="Choose files to add" />
        <CameraButton label="📷 Take photo" onPhoto={(p) => { setGeos([p.geo]); setFiles([p.file]); }} />
      </div>
      {files && <AddDialog files={files} geos={geos} customerId={customerId} projectId={projectId} onClose={() => setFiles(null)} />}
    </>
  );
}

const guessCategory = (name: string): string => {
  const n = name.toLowerCase();
  if (/aadhaar|aadhar|pan\b|pan[_ -]|kyc|voter|passport|electricity|bill/.test(n)) return 'KYC';
  if (/warrant/.test(n)) return 'Warranty';
  if (/agreement|contract|signed|net[- ]?meter/.test(n)) return 'Agreement';
  if (/invoice|receipt|bill/.test(n)) return 'Invoice';
  if (/subsid|surya|sanction|pm[- ]?sg/.test(n)) return 'Subsidy';
  if (/site|survey|photo|img|commission|report|drawing|layout/.test(n)) return 'Project';
  return 'Other';
};
const baseName = (n: string) => n.replace(/\.[a-z0-9]{1,5}$/i, '').replace(/[_]+/g, ' ').trim().slice(0, 120) || 'Document';

function AddDialog({ files: chosen, geos = [], customerId, projectId, onClose }: { files: File[]; geos?: GeoPhoto['geo'][]; customerId?: string; projectId?: string; onClose: () => void }) {
  const store = useStore();
  const { toast } = useFeedback();
  // Files still to add: after a part failure only the ones that did not go in stay, so "Add" again adds no copies.
  const [files, setFiles] = useState(chosen);
  const busyRef = useRef(false);
  const dlg = useDialogFocus(true, () => { if (!busyRef.current) onClose(); }); // Escape waits while uploading
  const cats = DOC_CATEGORIES();
  const [names, setNames] = useState(() => chosen.map((f) => baseName(f.name)));
  const [category, setCategory] = useState(() => { const g = files.map((f) => guessCategory(f.name)); return g.every((x) => x === g[0]) ? g[0] : 'Other'; });
  const [cust, setCust] = useState(customerId || (projectId ? String(store.get('projects', projectId)?.customerId || '') : ''));
  const [proj, setProj] = useState(projectId || '');
  const [expires, setExpires] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const customers = useMemo(() => store.all('customers').slice().sort((a, b) => String(a.name).localeCompare(String(b.name))), [store]);
  const projects = useMemo(() => store.all('projects').filter((p) => !cust || p.customerId === cust), [store, cust]);
  const save = async () => {
    if (busyRef.current) return;
    busyRef.current = true;
    let ok = 0;
    const failed: string[] = [];
    const left: number[] = [];
    for (let i = 0; i < files.length; i++) {
      setBusy(`Adding ${i + 1} of ${files.length}…`);
      try {
        const ref = await store.backend.uploadFile(files[i]);
        const g = geos[chosen.indexOf(files[i])];
        await store.create('documents', {
          name: names[i].trim() || baseName(files[i].name), category, customerId: cust || undefined, projectId: proj || undefined,
          file: g ? { ...ref, geo: g } : ref, ...(expires ? { expiresOn: expires } : {}), ...(g ? geoFields(g) : {}),
        });
        ok++;
      } catch (e) { failed.push(`${files[i].name}: ${errorText(e)}`); left.push(i); }
    }
    busyRef.current = false;
    setBusy(null);
    toast(failed.length ? `Added ${ok}; ${failed.length} not added — ${failed[0]}` : `Added ${ok} document${ok === 1 ? '' : 's'}`, failed.length > 0);
    if (!failed.length) { onClose(); return; }
    setFiles(left.map((i) => files[i]));
    setNames(left.map((i) => names[i]));
  };
  return (
    <div className="modal-back">
      <div ref={dlg} className="modal" role="dialog" aria-modal="true" aria-labelledby="af-title">
        <h2 id="af-title">Add {files.length} document{files.length === 1 ? '' : 's'}</h2>
        <ul className="add-files">
          {files.map((f, i) => (
            <li key={i}>
              <span aria-hidden>{KIND_ICON[fileKind({ name: f.name, type: f.type, size: f.size })]}</span>
              <input className="input" aria-label={`Name for ${f.name}`} value={names[i]} maxLength={120} onChange={(e) => setNames(names.map((n, j) => (j === i ? e.target.value : n)))} />
              <span className="muted small">{fileSize(f.size)}</span>
            </li>
          ))}
        </ul>
        <div className="form-grid">
          <label className="field"><span>Category</span>
            <select className="input" value={category} onChange={(e) => setCategory(e.target.value)}>{cats.map((c) => <option key={c}>{c}</option>)}</select></label>
          <label className="field"><span>Customer</span>
            <select className="input" value={cust} onChange={(e) => { setCust(e.target.value); setProj(''); }}>
              <option value="">— None —</option>{customers.map((c) => <option key={c.id} value={c.id}>{String(c.name)}</option>)}</select></label>
          <label className="field"><span>Project</span>
            <select className="input" value={proj} onChange={(e) => setProj(e.target.value)}>
              <option value="">— None —</option>{projects.map((p) => <option key={p.id} value={p.id}>{store.titleOf('projects', p.id)}</option>)}</select></label>
          <label className="field"><span>Valid until <span className="muted small">(warranties, agreements — optional)</span></span>
            <input className="input" type="date" value={expires} onChange={(e) => setExpires(e.target.value)} /></label>
        </div>
        <div className="btn-row" style={{ justifyContent: 'flex-end', marginTop: 12 }}>
          {busy && <span className="muted small" role="status">{busy}</span>}
          <button type="button" className="btn" onClick={onClose} disabled={!!busy}>Cancel</button>
          <button type="button" className="btn primary" onClick={() => void save()} disabled={!!busy}>Add {files.length === 1 ? 'document' : `${files.length} documents`}</button>
        </div>
      </div>
    </div>
  );
}

/** The Files view of the Documents list: quick add, category chips with counts, cards. */
export function DocumentsBoard({ rows }: { rows: Rec[] }) {
  const [cat, setCat] = useState('');
  const counts = useMemo(() => { const m = new Map<string, number>(); for (const r of rows) m.set(String(r.category || 'Other'), (m.get(String(r.category || 'Other')) || 0) + 1); return m; }, [rows]);
  const shown = cat ? rows.filter((r) => String(r.category || 'Other') === cat) : rows;
  return (
    <div className="card">
      <AddFiles />
      <div className="chips" role="group" aria-label="Category">
        <button type="button" className={'chip' + (!cat ? ' on' : '')} aria-pressed={!cat} onClick={() => setCat('')}>All <b>{rows.length}</b></button>
        {DOC_CATEGORIES().filter((c) => counts.get(c)).map((c) => (
          <button key={c} type="button" className={'chip' + (cat === c ? ' on' : '')} aria-pressed={cat === c} onClick={() => setCat(cat === c ? '' : c)}>{c} <b>{counts.get(c)}</b></button>
        ))}
      </div>
      <DocCards docs={shown} empty={rows.length ? 'No documents in this category.' : 'No documents yet — drop files above to add them.'} />
    </div>
  );
}

/** On a customer or project: its documents, and a drop zone that files new ones under it. */
/** Customer and project a record belongs to, for filing its photos and papers. */
export function linksOf(store: Store, entity: string, rec: Rec): { customerId?: string; projectId?: string } {
  if (entity === 'customers') return { customerId: rec.id };
  const projectId = entity === 'projects' ? rec.id : rec.projectId ? String(rec.projectId) : undefined;
  const pr = projectId ? store.get('projects', projectId) : undefined;
  const lead = entity === 'leads' ? rec : undefined;
  const customerId = String(rec.customerId || pr?.customerId || lead?.customerId || '') || undefined;
  return { customerId, projectId };
}

const geoFields = (g: NonNullable<GeoPhoto['geo']>) => ({ lat: g.lat, lng: g.lng, place: g.place || '', takenAt: localDateTimeOf(g.at) });

/**
 * A photo from the app's camera, taken from a record: filed as a document under that record (and its customer and
 * project), with where and when it was taken. A record that has no site location yet gets the photo's.
 */
export async function saveSitePhoto(store: Store, p: GeoPhoto, entity: string, rec: Rec): Promise<Rec> {
  const e = getEntity(entity);
  const ref = await store.backend.uploadFile(p.file);
  const when = formatDate(localDateOf(p.geo?.at || new Date().toISOString()));
  const where = p.geo?.place?.split(',').slice(1, 2).join('').trim();
  const doc = await store.create('documents', {
    name: `Site photo — ${store.titleOf(entity, rec.id)}${where ? ` — ${where}` : ''} — ${when}`.slice(0, 120),
    category: 'Project', ...linksOf(store, entity, rec), onEntity: entity, onRecord: rec.id,
    file: p.geo ? { ...ref, geo: p.geo } : ref, ...(p.geo ? geoFields(p.geo) : {}),
  });
  if (p.geo && e) {
    const keys = e.fields.some((f) => f.key === 'siteLat') ? ['siteLat', 'siteLng'] : e.fields.some((f) => f.key === 'lat') ? ['lat', 'lng'] : null;
    if (keys && (rec[keys[0]] === undefined || rec[keys[0]] === null || rec[keys[0]] === '') && canWrite(store.user, e.module)) {
      try { await store.update(entity, rec.id, { [keys[0]]: p.geo.lat, [keys[1]]: p.geo.lng }, { allowDuplicate: true }); } catch { /* the photo is saved; the location can be added by hand */ }
    }
  }
  return doc;
}

export function RelatedDocuments({ entity, rec }: { entity: string; rec: Rec }) {
  const store = useStore();
  const { toast } = useFeedback();
  const { customerId, projectId } = linksOf(store, entity, rec);
  const docs = store.all('documents').filter((d) => (d.onEntity === entity && d.onRecord === rec.id)
    || (entity === 'customers' && d.customerId === rec.id) || (entity === 'projects' && d.projectId === rec.id))
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  // e.g. "Installation IN-0014 · Ravi Kumar" — what the photo is for, printed on it.
  const who = customerId && entity !== 'customers' ? store.titleOf('customers', customerId) : '';
  const note = [`${getEntity(entity)?.label || ''} ${store.titleOf(entity, rec.id)}`.trim(), who].filter(Boolean).join(' · ');
  return (
    <div className="card">
      <div className="card-head">
        <h2>Photos &amp; documents ({docs.length})</h2>
        {canWrite(store.user, 'documents') && (
          <CameraButton label="📷 Site photo" className="btn sm primary" note={note}
            onPhoto={async (p) => { await saveSitePhoto(store, p, entity, rec); toast(p.geo ? `Photo saved with its location${p.geo.place ? `: ${p.geo.place}` : ''}` : 'Photo saved (no location: GPS was off)'); }} />
        )}
      </div>
      <AddFiles customerId={customerId} projectId={projectId} compact />
      <DocCards docs={docs} empty="No photos or documents yet." />
    </div>
  );
}

/** On a document's own page: the file large, with download. */
export function DocumentPreviewCard({ rec }: { rec: Rec }) {
  return (
    <div className="card">
      <h2>File</h2>
      <DocCards docs={[rec]} empty="No file attached." />
    </div>
  );
}
