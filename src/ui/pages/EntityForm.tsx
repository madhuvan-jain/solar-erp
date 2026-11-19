import { categoryPatch } from '../../lib/productTax';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useBlocker, useLocation, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { getEntity } from '../../modules/registry';
import type { Entity, Rec } from '../../lib/schema';
import { ConflictError, DuplicateError, useStore, ValidationError } from '../../lib/store';
import { canWrite } from '../../lib/rbac';
import { localDateTimeOf, todayIso } from '../../lib/format';
import { FieldInput } from '../components/FieldInput';
import { errorText, useFeedback } from '../components/feedback';
import { markDirty } from '../unsaved';
import { NoAccess, NotFound } from './NotFound';

export function EntityForm() {
  const { entity: key = '', id } = useParams();
  const store = useStore();
  const entity = getEntity(key);
  if (!entity) return <NotFound />;
  if (!store.user || !canWrite(store.user, entity.module)) return <NoAccess />;
  const rec = id ? store.get(key, id) : undefined;
  if (id && !rec) return <NotFound text="This record does not exist or was deleted." />;
  return <FormInner key={key + (id || 'new')} entity={entity} rec={rec} />;
}

function initialValues(entity: Entity, rec: Rec | undefined, prefill: URLSearchParams): Record<string, unknown> {
  if (rec) return { ...rec };
  const v: Record<string, unknown> = {};
  for (const f of entity.fields) {
    if (f.default !== undefined) v[f.key] = f.default;
    if (f.type === 'date' && f.required) v[f.key] = todayIso();
    if (f.type === 'items') v[f.key] = [];
    const p = prefill.get(f.key);
    if (p !== null && !f.hidden && !['items', 'file', 'checklist'].includes(f.type)) v[f.key] = p;
  }
  return v;
}

function FormInner({ entity, rec }: { entity: Entity; rec?: Rec }) {
  const store = useStore();
  const nav = useNavigate();
  const location = useLocation();
  const [params] = useSearchParams();
  const { toast, confirm } = useFeedback();
  const [values, setValues] = useState<Record<string, unknown>>(() => initialValues(entity, rec, params));
  // What the user started from: only fields that differ from it are saved, and only onto that version.
  const initial = useRef(values);
  const baseVersion = useRef(rec?.version ?? 1);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [uploads, setUploads] = useState(0);
  const [conflict, setConflict] = useState(false);
  const busy = useRef(false);
  const leaving = useRef(false);

  const blocker = useBlocker(({ currentLocation, nextLocation }) =>
    dirty && !leaving.current && currentLocation.pathname !== nextLocation.pathname);
  useEffect(() => {
    if (blocker.state !== 'blocked') return;
    void confirm({ title: 'Discard unsaved changes?', body: 'Your edits on this form will be lost.', okLabel: 'Discard', danger: true })
      .then((ok) => (ok ? blocker.proceed() : blocker.reset()));
  }, [blocker, confirm]);
  useEffect(() => {
    if (!dirty) return;
    const release = markDirty(true);
    const h = (e: BeforeUnloadEvent) => { e.preventDefault(); e.returnValue = ''; };
    window.addEventListener('beforeunload', h);
    return () => { release(); window.removeEventListener('beforeunload', h); };
  }, [dirty]);

  const { customerId, placeOfSupply, vendorId } = values;
  // Editing a saved document shows the tax type it was saved with (the save keeps it) unless the party or place of
  // supply changes — exactly what saving will do.
  const interState = useMemo(() => {
    const same = !!rec && typeof rec.interState === 'boolean' && rec.customerId === customerId && rec.placeOfSupply === placeOfSupply && rec.vendorId === vendorId;
    if (same) return rec!.interState as boolean;
    return store.interStateFor(entity.key === 'purchaseOrders' ? { vendorId } : { customerId, placeOfSupply });
  }, [store, entity.key, customerId, placeOfSupply, vendorId, rec]);

  const set = (k: string, v: unknown) => {
    setValues((s) => {
      // A document picks up its name from the file when no name was typed yet.
      const named = entity.key === 'documents' && k === 'file' && v && typeof v === 'object' && !String(s.name || '').trim()
        ? { name: String((v as { name?: string }).name || '').replace(/\.[a-z0-9]{1,5}$/i, '').replace(/_+/g, ' ').trim().slice(0, 120) } : {};
      // A photo from the app's camera knows where it was taken: it fills an empty site location (and a document's own).
      const g = v && typeof v === 'object' ? (v as { geo?: { lat: number; lng: number; at: string; place?: string } }).geo : undefined;
      const located: Record<string, unknown> = {};
      if (g && geo && (s[geo[0]] === undefined || s[geo[0]] === null || s[geo[0]] === '')) { located[geo[0]] = g.lat; located[geo[1]] = g.lng; }
      if (g && entity.key === 'documents') Object.assign(located, { lat: g.lat, lng: g.lng, place: g.place || '', takenAt: localDateTimeOf(g.at) });
      // A product's GST and HSN follow its category, unless they were typed in.
      const taxed = entity.key === 'products' && k === 'category' ? categoryPatch(s.category, v, s) : {};
      return { ...s, [k]: v, ...named, ...located, ...taxed };
    });
    setDirty(true);
    setErrors((e) => { if (!e[k]) return e; const n = { ...e }; delete n[k]; return n; });
  };

  const backTo = rec ? `/m/${entity.key}/${rec.id}` : `/m/${entity.key}`;
  const cancel = () => {
    // Opened from a link or a fresh tab there may be no in-app history to go back to.
    if (location.key !== 'default' && window.history.length > 1) nav(-1);
    else nav(backTo);
  };

  const save = async (allowDuplicate = false): Promise<void> => {
    if (busy.current) return;
    if (uploads > 0) { toast('Please wait for the file upload to finish.', true); return; }
    busy.current = true;
    setSaving(true);
    try {
      let saved;
      if (rec) {
        const changed: Record<string, unknown> = {};
        for (const k of Object.keys(values)) {
          if (JSON.stringify(values[k]) !== JSON.stringify(initial.current[k])) changed[k] = values[k];
        }
        saved = await store.update(entity.key, rec.id, changed, { allowDuplicate, expectedVersion: baseVersion.current });
      } else saved = await store.create(entity.key, values, { allowDuplicate });
      leaving.current = true;
      setDirty(false);
      setConflict(false);
      toast(`${entity.label} saved${saved.number && !rec ? ` as ${saved.number}` : ''}`);
      nav(`/m/${entity.key}/${saved.id}`, { replace: true });
    } catch (e) {
      if (e instanceof ValidationError) {
        setErrors(e.errors);
        toast('Please fix the highlighted fields.', true);
        const first = Object.keys(e.errors)[0];
        setTimeout(() => document.getElementById('f-' + first)?.focus(), 0);
      } else if (e instanceof DuplicateError) {
        const names = e.matches.slice(0, 3).map((m) => store.titleOf(entity.key, m.id)).join(', ');
        const ok = await confirm({
          title: 'Possible duplicate',
          body: <>Another {entity.label.toLowerCase()} already has the same {e.field.toLowerCase()}: <strong>{names}</strong>. Save anyway?</>,
          okLabel: 'Save anyway',
        });
        busy.current = false;
        setSaving(false);
        if (ok) return save(true);
        return;
      } else if (e instanceof ConflictError) {
        // The user has now seen the warning; a second save deliberately applies their changes on top.
        const latest = rec && store.get(entity.key, rec.id);
        if (latest) baseVersion.current = latest.version ?? 1;
        setConflict(true);
        toast(e.message, true);
      } else toast(errorText(e), true);
    }
    busy.current = false;
    setSaving(false);
  };

  const visible = entity.fields.filter((f) => !f.hidden);
  const geo = entity.fields.some((f) => f.key === 'lat') ? ['lat', 'lng'] : entity.fields.some((f) => f.key === 'siteLat') ? ['siteLat', 'siteLng'] : null;
  const [locating, setLocating] = useState(false);
  const useMyLocation = () => {
    if (!geo) return;
    if (!('geolocation' in navigator)) { toast('This device cannot share its location.', true); return; }
    setLocating(true);
    navigator.geolocation.getCurrentPosition(
      (p) => {
        setLocating(false);
        set(geo[0], Math.round(p.coords.latitude * 1e6) / 1e6);
        set(geo[1], Math.round(p.coords.longitude * 1e6) / 1e6);
        toast(`Location added (accurate to about ${Math.round(p.coords.accuracy)} m)`);
      },
      (err) => {
        setLocating(false);
        toast(err.code === 1 ? 'Location permission was denied. Allow it in the browser settings, or type the latitude and longitude.' : 'Could not get the location. Try again outdoors, or type it in.', true);
      },
      // A position at most a few seconds old: a minute-old one (e.g. from a photo at the last site) could be another place.
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 5000 },
    );
  };
  const saveLabel = saving ? 'Saving…' : uploads > 0 ? 'Uploading…' : 'Save';

  return (
    <form data-form={entity.key} onSubmit={(e) => { e.preventDefault(); void save(); }} noValidate>
      <div className="page-head">
        <div>
          <div className="muted small"><Link to={`/m/${entity.key}`}>{entity.plural}</Link></div>
          <h1>{rec ? `Edit ${rec.number || store.titleOf(entity.key, rec.id)}` : `New ${entity.label}`}</h1>
        </div>
        <div className="spacer" />
        <div className="btn-row">
          <button type="button" className="btn" onClick={cancel}>Cancel</button>
          <button type="submit" className="btn primary" disabled={saving || uploads > 0}>{saveLabel}</button>
        </div>
      </div>
      {conflict && (
        <div className="banner warn" role="alert">
          Someone else saved this record while you were editing. Your changes are still below — saving again applies the fields you changed on top of their version.
          {' '}<Link to={`/m/${entity.key}/${rec?.id}`} target="_blank">Open their version in a new tab</Link>
        </div>
      )}
      {Object.keys(errors).length > 0 && (
        <div className="banner bad" role="alert">
          Please fix {Object.keys(errors).length} field(s) below.
          {Object.keys(errors).some((k) => !visible.some((f) => f.key === k)) && <> {Object.values(errors).join(' ')}</>}
        </div>
      )}
      <div className="card">
        {geo && (
          <div className="btn-row" style={{ marginBottom: 12 }}>
            <button type="button" className="btn sm" onClick={useMyLocation} disabled={locating}>{locating ? 'Getting location…' : '📍 Use my location'}</button>
            <span className="muted small">At the site? Fill the map location from this phone’s GPS.</span>
          </div>
        )}
        <div className="form-grid">
          {visible.map((f) => (
            <FieldInput key={f.key} field={f} value={values[f.key]} error={errors[f.key]}
              onChange={(v) => set(f.key, v)} interState={interState} discount={Number(values.discount) || 0} entityKey={entity.key} formValues={values}
              onUploading={(d) => setUploads((n) => Math.max(0, n + d))} />
          ))}
        </div>
      </div>
      <div className="btn-row form-actions" style={{ justifyContent: 'flex-end', marginTop: 14 }}>
        <button type="button" className="btn" onClick={cancel}>Cancel</button>
        <button type="submit" className="btn primary" disabled={saving || uploads > 0}>{saveLabel}</button>
      </div>
    </form>
  );
}
