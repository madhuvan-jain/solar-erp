import { categoryPatch } from '../../lib/productTax';
import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { getEntity } from '../../modules/registry';
import type { Entity, LineItem, Rec } from '../../lib/schema';
import { DuplicateError, useStore, ValidationError, type Store } from '../../lib/store';
import { canWrite } from '../../lib/rbac';
import { todayIso } from '../../lib/format';
import { FieldInput } from './FieldInput';
import { errorText, useDialogFocus, useFeedback } from './feedback';

/** Value of the picker option that opens the popup instead of choosing a record. */
export const CREATE_NEW = '__create_new__';

/** Whether pickers of this entity may offer "Create new…" to the signed-in user. */
export function canQuickCreate(store: Store, entityKey: string | undefined): boolean {
  const e = entityKey ? getEntity(entityKey) : undefined;
  return !!(e?.quickCreate && store.user && canWrite(store.user, e.module));
}

export function defaultValues(entity: Entity): Record<string, unknown> {
  const v: Record<string, unknown> = {};
  for (const f of entity.fields) {
    if (f.default !== undefined) v[f.key] = f.default;
    if (f.type === 'date' && f.required) v[f.key] = todayIso();
    if (f.type === 'items') v[f.key] = [];
  }
  return v;
}

const LEAD_TO_CUSTOMER = ['name', 'phone', 'email', 'city', 'state', 'pincode', 'address', 'segment'];

/**
 * What the popup starts with, taken from the form it was opened from: the same links
 * (a project for this form's customer), and a customer from the lead the form is about.
 */
export function prefillFor(store: Store, entityKey: string, from: Record<string, unknown> = {}): Record<string, unknown> {
  const entity = getEntity(entityKey);
  if (!entity) return {};
  const v: Record<string, unknown> = {};
  for (const f of entity.fields) {
    if (f.type === 'ref' && from[f.key] && store.get(f.ref!, from[f.key])) v[f.key] = from[f.key];
  }
  if (entityKey === 'customers' && from.leadId) {
    const lead = store.get('leads', from.leadId);
    if (lead) for (const k of LEAD_TO_CUSTOMER) if (lead[k] !== undefined && lead[k] !== '') v[k] = lead[k];
  }
  if (entityKey === 'projects' && from.capacityKw) v.capacityKw = from.capacityKw;
  return v;
}

/** A product made from a "custom item" line keeps what was already typed on the line. */
export function productFromLine(it: LineItem, buying: boolean): Record<string, unknown> {
  const allowed = (key: string, val: string) => !!getEntity('products')!.fields.find((f) => f.key === key)?.options?.includes(val);
  const v: Record<string, unknown> = {};
  if (it.description?.trim()) v.name = it.description.trim();
  if (it.hsn?.trim()) v.hsn = it.hsn.trim();
  // Line units and GST are free to type; the product form only takes its listed values.
  if (it.unit && allowed('unit', it.unit)) v.unit = it.unit;
  if (Number.isFinite(it.gstRate) && allowed('gstRate', String(it.gstRate))) v.gstRate = String(it.gstRate);
  if (Number(it.rate) > 0) v[buying ? 'cost' : 'price'] = it.rate;
  return v;
}

interface Props {
  entityKey: string;
  initial?: Record<string, unknown>;
  onCreated: (rec: Rec) => void;
  onClose: () => void;
}

/** Small "create new" form in a popup, so a missing customer or product never means leaving the current form. */
export function QuickCreate({ entityKey, initial, onCreated, onClose }: Props) {
  const entity = getEntity(entityKey)!;
  const store = useStore();
  const { toast } = useFeedback();
  const [values, setValues] = useState<Record<string, unknown>>(() => ({ ...defaultValues(entity), ...initial }));
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [showAll, setShowAll] = useState(false);
  const [dup, setDup] = useState<DuplicateError | null>(null);
  const [saving, setSaving] = useState(false);
  const [uploads, setUploads] = useState(0);
  const busy = useRef(false);
  const dlg = useDialogFocus(true, onClose);
  // Back (or any address change) closes the popup first, so a "discard changes?" question is never hidden behind it.
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  useEffect(() => {
    const h = () => closeRef.current();
    window.addEventListener('hashchange', h);
    return () => window.removeEventListener('hashchange', h);
  }, []);
  const titleId = `qc-${entity.key}-title`;

  const quick = entity.quickCreate || [];
  const fields = entity.fields.filter((f) => !f.hidden && f.type !== 'items'
    && (showAll || quick.includes(f.key) || f.required || errors[f.key]));
  const hiddenCount = entity.fields.filter((f) => !f.hidden && f.type !== 'items').length - fields.length;

  const set = (k: string, v: unknown) => {
    setValues((s) => ({ ...s, [k]: v, ...(entity.key === 'products' && k === 'category' ? categoryPatch(s.category, v, s) : {}) }));
    setDup(null);
    setErrors((e) => { if (!e[k]) return e; const n = { ...e }; delete n[k]; return n; });
  };

  const done = (rec: Rec) => { onCreated(rec); onClose(); };

  const save = async (allowDuplicate = false) => {
    if (busy.current) return;
    if (uploads > 0) { toast('Please wait for the file upload to finish.', true); return; }
    busy.current = true;
    setSaving(true);
    try {
      const rec = await store.create(entity.key, values, { allowDuplicate });
      toast(`${entity.label} ${rec.number ? `${rec.number} ` : ''}created`);
      done(rec);
      return;
    } catch (e) {
      if (e instanceof ValidationError) {
        setErrors(e.errors);
        const first = Object.keys(e.errors)[0];
        setTimeout(() => document.getElementById('qc-' + first)?.focus(), 0);
      } else if (e instanceof DuplicateError) setDup(e);
      else toast(errorText(e), true);
    }
    busy.current = false;
    setSaving(false);
  };

  const existing = dup?.matches.map((m) => store.get(entity.key, m.id)).filter((r): r is Rec => !!r) || [];

  return createPortal(
    <div className="modal-back">
      <div ref={dlg} className="modal modal-form" role="dialog" aria-modal="true" aria-labelledby={titleId}>
        {/* A separate form: Enter here saves the new record, never the form underneath. */}
        <form noValidate onSubmit={(e) => { e.preventDefault(); e.stopPropagation(); void save(); }}>
          <h2 id={titleId}>New {entity.label.toLowerCase()}</h2>
          {Object.keys(errors).some((k) => !fields.some((f) => f.key === k)) && (
            <div className="banner bad" role="alert">{Object.values(errors).join(' ')}</div>
          )}
          {dup && (
            <div className="banner warn" role="alert">
              <div>Another {entity.label.toLowerCase()} already has the same {dup.field.toLowerCase()}:</div>
              <div className="btn-row" style={{ marginTop: 8 }}>
                {existing.slice(0, 3).map((r) => (
                  <button type="button" key={r.id} className="btn sm primary" onClick={() => done(r)}>Use {store.titleOf(entity.key, r.id)}</button>
                ))}
                <button type="button" className="btn sm" onClick={() => void save(true)}>Create anyway</button>
              </div>
            </div>
          )}
          <div className="form-grid">
            {fields.map((f) => (
              <FieldInput key={f.key} field={f} value={values[f.key]} error={errors[f.key]} idPrefix="qc-" noCreate
                onChange={(v) => set(f.key, v)} entityKey={entity.key}
                onUploading={(d) => setUploads((n) => Math.max(0, n + d))} />
            ))}
          </div>
          <div className="btn-row" style={{ marginTop: 16, alignItems: 'center', justifyContent: 'flex-end' }}>
            {!showAll && hiddenCount > 0 && (
              <button type="button" className="btn sm ghost" style={{ marginRight: 'auto' }} onClick={() => setShowAll(true)}>Show all fields ({hiddenCount} more)</button>
            )}
            <button type="button" className="btn" onClick={onClose}>Cancel</button>
            <button type="submit" className="btn primary" disabled={saving || uploads > 0}>{saving ? 'Saving…' : `Create ${entity.label.toLowerCase()}`}</button>
          </div>
        </form>
      </div>
    </div>,
    document.body,
  );
}
