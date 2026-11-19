import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import type { Entity } from '../../lib/schema';
import { useStore } from '../../lib/store';
import { filtersFor, type FilterDef } from '../../modules/filters';
import { NEEDS_VALUE, OPS, OP_LABELS, customFields, describeCustom, type CustomField, type CustomFilter, type Op } from '../../modules/customFilter';
import { EMPTY_SEARCH as EMPTY, type SearchState } from '../../modules/search';
import { groupOptions } from './Views';
import { deleteFavorite, favoritesFor, setDefaultFavorite, toggleFavorite, type Favorite } from '../../lib/favorites';
import { MAX_RECENT, clearRecent, recentSearches, sameSearch, type RecentSearch } from '../../lib/recentSearches';
import { Icon } from './Icon';

export type { SearchState } from '../../modules/search';

export function searchableFields(entity: Entity): { key: string; label: string }[] {
  const ok = ['text', 'phone', 'email', 'gstin', 'pincode', 'ref', 'user', 'select'];
  const fields = entity.fields.filter((f) => !f.hidden && ok.includes(f.type));
  fields.sort((a, b) => Number(b.key === entity.title) - Number(a.key === entity.title) || Number(!!b.list) - Number(!!a.list));
  return [...(entity.numberPrefix ? [{ key: 'number', label: 'Number' }] : []), ...fields.map((f) => ({ key: f.key, label: f.label }))].slice(0, 9);
}

/** Extra grouping choices beyond the pick lists and dates: free-text city. */
export function listGroupOptions(entity: Entity) {
  const base = groupOptions(entity);
  const city = entity.fields.find((f) => f.key === 'city' && !f.hidden);
  return city ? [...base, { key: 'city', label: 'City', kind: 'field' as const }] : base;
}

const MAX_GROUPS = 2;

export function SearchPanel({ entity, state, onChange, countFor, userId }: {
  entity: Entity;
  state: SearchState;
  onChange: (next: SearchState) => void;
  /** how many records the list would show with this filter added (other sections stay applied) */
  countFor: (def: FilterDef) => number;
  userId: string;
}) {
  const store = useStore();
  const [open, setOpen] = useState(false);
  const [focus, setFocus] = useState(false);
  const [active, setActive] = useState(0);
  const [favs, setFavs] = useState<Favorite[]>(() => favoritesFor(userId, entity.key));
  const [history, setHistory] = useState(false);
  const [recent, setRecent] = useState<RecentSearch[]>([]);
  const [custom, setCustom] = useState<CustomFilter | null>(null);
  const box = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLInputElement>(null);

  const filters = filtersFor(entity);
  const sections = useMemo(() => {
    const m = new Map<string, FilterDef[]>();
    for (const f of filters) m.set(f.section, [...(m.get(f.section) || []), f]);
    return [...m.entries()];
  }, [filters]);
  const groups = listGroupOptions(entity);
  const fields = searchableFields(entity);
  const cFields = useMemo(() => (open || state.c.length ? customFields(store, entity) : []), [open, state.c.length, store, entity]);

  useEffect(() => {
    if (!open) return;
    const outside = (e: Event) => { if (!box.current?.contains(e.target as Node)) setOpen(false); };
    const key = (e: globalThis.KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', outside);
    document.addEventListener('keydown', key);
    return () => { document.removeEventListener('mousedown', outside); document.removeEventListener('keydown', key); };
  }, [open]);

  const set = (patch: Partial<SearchState>) => onChange({ ...state, ...patch });
  const toggleFilter = (k: string) => set({ f: state.f.includes(k) ? state.f.filter((x) => x !== k) : [...state.f, k] });
  const toggleGroup = (k: string) => set({
    g: state.g.includes(k) ? state.g.filter((x) => x !== k) : [...state.g, k].slice(-MAX_GROUPS),
  });
  const addFieldSearch = (field: string) => {
    const value = state.q.trim();
    if (!value) return;
    set({ q: '', s: [...state.s.filter((x) => !(x.field === field && x.value === value)), { field, value }] });
    setActive(0);
  };

  // Facets shown inside the search box: one per section, per field search, per custom filter, and the grouping.
  const fieldLabel = (k: string) => fields.find((f) => f.key === k)?.label || entity.fields.find((f) => f.key === k)?.label || k;
  const facetsOf = (st: SearchState) => {
    const out: { key: string; label: string; value: string; remove: () => void }[] = [];
    for (const [name, defs] of sections) {
      const on = defs.filter((d) => st.f.includes(d.key));
      if (on.length) out.push({ key: 'sec:' + name, label: name, value: on.map((d) => d.label).join(' or '), remove: () => set({ f: st.f.filter((k) => !on.some((d) => d.key === k)) }) });
    }
    for (const s of st.s) out.push({ key: `s:${s.field}:${s.value}`, label: fieldLabel(s.field), value: s.value, remove: () => set({ s: st.s.filter((x) => x !== s) }) });
    (st.c || []).forEach((c, i) => {
      const d = describeCustom(cFields, c);
      out.push({ key: `c:${i}`, label: d.label, value: d.value, remove: () => set({ c: st.c.filter((x) => x !== c) }) });
    });
    if (st.g.length) out.push({ key: 'g', label: 'Group by', value: st.g.map((k) => groups.find((g) => g.key === k)?.label || k).join(' › '), remove: () => set({ g: [] }) });
    return out;
  };
  const facets = facetsOf(state);
  // Read again each time the panel opens, so a search made a moment ago is there.
  useEffect(() => { if (open) { setRecent(recentSearches(userId, entity.key)); setFavs(favoritesFor(userId, entity.key)); } else setHistory(false); }, [open, userId, entity.key]);
  const summary = (st: SearchState) => facetsOf(st).map((f) => `${f.label}: ${f.value}`).join(' · ');
  const starred = (st: SearchState) => favs.some((f) => sameSearch(f.state, st));
  const star = (st: SearchState) => { toggleFavorite(userId, entity.key, summary(st).slice(0, 120), st); setFavs(favoritesFor(userId, entity.key)); };
  const apply = (st: SearchState) => { onChange({ ...EMPTY, ...st, q: state.q }); setOpen(false); };

  const suggest = focus && state.q.trim().length > 0;
  const onKey = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Backspace' && !state.q && facets.length) { facets[facets.length - 1].remove(); return; }
    if (!suggest) return;
    if (e.key === 'ArrowDown') { e.preventDefault(); setActive((a) => Math.min(a + 1, fields.length)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setActive((a) => Math.max(a - 1, 0)); }
    else if (e.key === 'Enter') {
      e.preventDefault();
      if (active > 0) addFieldSearch(fields[active - 1].key);
      else input.current?.blur(); // the first line is "search everything", which is already applied while typing
    }
  };

  const active1 = state.f.length + state.s.length + state.c.length;

  return (
    <div className="searchbar" ref={box}>
      <div className="search-box" onClick={() => input.current?.focus()}>
        <Icon name="search" size={16} />
        {facets.map((f) => (
          <span key={f.key} className="facet">
            <span className="facet-label">{f.label}</span>
            <span className="facet-value" title={f.value}>{f.value}</span>
            <button type="button" aria-label={`Remove ${f.label}: ${f.value}`} onClick={(e) => { e.stopPropagation(); f.remove(); }}>×</button>
          </span>
        ))}
        <input ref={input} type="search" aria-label="Search" placeholder={facets.length ? '' : `Search ${entity.plural.toLowerCase()}…`}
          value={state.q} onChange={(e) => { set({ q: e.target.value }); setActive(0); }}
          onFocus={() => setFocus(true)} onBlur={() => setTimeout(() => setFocus(false), 150)} onKeyDown={onKey}
          role="combobox" aria-expanded={suggest} aria-controls="search-suggest" aria-autocomplete="list" />
        <button type="button" className={'search-toggle' + (open ? ' on' : '')} aria-expanded={open} aria-label="Filters, group by and favorites"
          title="Filters, group by and favorites" onClick={(e) => { e.stopPropagation(); setOpen((o) => !o); }}>
          <Icon name="filter" size={16} /><span className="vs-label">Filters</span>{active1 > 0 && <span className="facet-count" aria-hidden>{active1}</span>}
        </button>
      </div>
      {suggest && (
        <ul id="search-suggest" className="search-suggest" role="listbox" aria-label="Search in">
          <li role="option" aria-selected={active === 0} className={active === 0 ? 'on' : ''}
            onMouseDown={(e) => { e.preventDefault(); input.current?.blur(); }}>Search everything for: <strong>{state.q}</strong></li>
          {fields.map((f, i) => (
            <li key={f.key} role="option" aria-selected={active === i + 1} className={active === i + 1 ? 'on' : ''}
              onMouseDown={(e) => { e.preventDefault(); addFieldSearch(f.key); }}>Search <strong>{f.label}</strong> for: {state.q}</li>
          ))}
        </ul>
      )}
      {open && (
        <div className="search-panel" role="dialog" aria-label="Filters, group by and favorites">
          <section aria-label="Filters">
            {recent.length > 0 && (
              <div className="sp-recent" role="group" aria-label="Recently used">
                <div className="sp-head">
                  <span className="sp-title">↺ Recently used</span>
                  <button type="button" className="link-btn small" onClick={() => setHistory(true)}>History ({recent.length})</button>
                </div>
                {recent.slice(0, 3).map((r, i) => (
                  <RecentRow key={i} text={summary(r)} inUse={sameSearch(r, state)} starred={starred(r)} onApply={() => apply(r)} onStar={() => star(r)} />
                ))}
                <hr />
              </div>
            )}
            <h3><Icon name="filter" size={15} /> Filters</h3>
            {sections.map(([name, defs], i) => (
              <div key={name} className="sp-section" role="group" aria-label={name}>
                {i > 0 && <hr />}
                <div className="sp-title" aria-hidden>{name}</div>
                {defs.map((d) => {
                  const on = state.f.includes(d.key);
                  const n = countFor(d);
                  return (
                    <button key={d.key} type="button" aria-pressed={on} className={'sp-item' + (on ? ' on' : '') + (n === 0 && !on ? ' none' : '')} onClick={() => toggleFilter(d.key)}>
                      <span className="tick" aria-hidden>{on ? '✓' : ''}</span>
                      <span className="sp-label">{d.label}</span>
                      <span className="muted small" aria-label={`${n} records`}>{n}</span>
                    </button>
                  );
                })}
              </div>
            ))}
            <hr />
            {custom
              ? <CustomFilterForm fields={cFields} value={custom} onChange={setCustom} onCancel={() => setCustom(null)}
                  onAdd={(c) => { set({ c: [...state.c, c] }); setCustom(null); }} />
              : <button type="button" className="sp-add" onClick={() => setCustom({ field: cFields[0]?.key || '', op: OPS[cFields[0]?.kind || 'text'][0] })}>＋ Add custom filter</button>}
            {active1 > 0 && <button type="button" className="link-btn sp-clear" onClick={() => set({ f: [], s: [], c: [] })}>Clear all filters</button>}
          </section>
          <section aria-label="Group by">
            <h3><Icon name="pivot" size={15} /> Group by</h3>
            <p className="muted small">Up to {MAX_GROUPS} levels. Also used by the Pivot and Graph views.</p>
            <div role="group" aria-label="Group by">
              {groups.map((g) => {
                const on = state.g.includes(g.key);
                return (
                  <button key={g.key} type="button" aria-pressed={on} className={'sp-item' + (on ? ' on' : '')} onClick={() => toggleGroup(g.key)}>
                    <span className="tick" aria-hidden>{on ? String(state.g.indexOf(g.key) + 1) : ''}</span>
                    <span className="sp-label">{g.label}</span>
                  </button>
                );
              })}
            </div>
          </section>
          <section aria-label="Favorites">
            <h3>★ Favorites</h3>
            {favs.length === 0 && <p className="muted small">Tap ☆ next to a recent search (or in History) to keep it here.</p>}
            <div role="group" aria-label="Favorite searches">
              {favs.map((fv) => (
                <div key={fv.name} className="fav-row">
                  <button type="button" className="sp-item fav-apply" title={fv.name} onClick={() => apply(fv.state)}>
                    <span className="star on" aria-hidden>★</span>
                    <span className="sp-label">{fv.name}</span>
                  </button>
                  <button type="button" className={'btn ghost sm fav-default' + (fv.isDefault ? ' on' : '')} aria-pressed={!!fv.isDefault}
                    aria-label={`Open with ${fv.name} every time`} title={fv.isDefault ? 'Opens by itself — tap to stop' : 'Open the list with this every time'}
                    onClick={() => { setDefaultFavorite(userId, entity.key, fv.isDefault ? null : fv.name); setFavs(favoritesFor(userId, entity.key)); }}>
                    {fv.isDefault ? 'Default ✓' : 'Default'}
                  </button>
                  <button type="button" className="btn ghost sm" aria-label={`Delete favorite ${fv.name}`} onClick={() => { deleteFavorite(userId, entity.key, fv.name); setFavs(favoritesFor(userId, entity.key)); }}>✕</button>
                </div>
              ))}
            </div>
          </section>
          {history && (
            <HistoryPanel items={recent} summary={summary} starred={starred} current={state}
              onApply={apply} onClose={() => setHistory(false)}
              onAddFavorites={(list) => { for (const st of list) if (!starred(st)) toggleFavorite(userId, entity.key, summary(st).slice(0, 120), st); setFavs(favoritesFor(userId, entity.key)); }}
              onStar={star} onClear={() => { clearRecent(userId, entity.key); setRecent([]); setHistory(false); }} />
          )}
        </div>
      )}
    </div>
  );
}

/** Field → condition → value: a custom filter. */
function CustomFilterForm({ fields, value, onChange, onAdd, onCancel }: {
  fields: CustomField[]; value: CustomFilter; onChange: (c: CustomFilter) => void; onAdd: (c: CustomFilter) => void; onCancel: () => void;
}) {
  const def = fields.find((f) => f.key === value.field) || fields[0];
  if (!def) return null;
  const ops = OPS[def.kind];
  const op: Op = ops.includes(value.op) ? value.op : ops[0];
  const needs = NEEDS_VALUE(op);
  const ready = !needs || (!!value.value && (op !== 'between' || !!value.value2));
  const inputType = def.kind === 'date' ? 'date' : def.kind === 'number' || def.kind === 'money' ? 'number' : 'text';
  const valueInput = (which: 'value' | 'value2', label: string) => def.options
    ? (
      <select className="input" aria-label={label} value={value[which] || ''} onChange={(e) => onChange({ ...value, op, [which]: e.target.value })}>
        <option value="">— choose —</option>
        {def.options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
    )
    : <input className="input" aria-label={label} type={inputType} step="any" value={value[which] || ''} onChange={(e) => onChange({ ...value, op, [which]: e.target.value })} />;
  return (
    <div className="custom-filter" role="group" aria-label="Custom filter">
      <div className="sp-title">Custom filter</div>
      <select className="input" aria-label="Field" value={def.key} onChange={(e) => {
        const nd = fields.find((f) => f.key === e.target.value)!;
        onChange({ field: nd.key, op: OPS[nd.kind][0] });
      }}>
        {fields.map((f) => <option key={f.key} value={f.key}>{f.label}</option>)}
      </select>
      <select className="input" aria-label="Condition" value={op} onChange={(e) => onChange({ ...value, op: e.target.value as Op })}>
        {ops.map((o) => <option key={o} value={o}>{OP_LABELS[o]}</option>)}
      </select>
      {needs && valueInput('value', op === 'between' ? 'From' : 'Value')}
      {op === 'between' && valueInput('value2', 'To')}
      <div className="btn-row">
        <button type="button" className="btn sm primary" disabled={!ready} onClick={() => onAdd({ ...value, op })}>Add filter</button>
        <button type="button" className="btn sm" onClick={onCancel}>Cancel</button>
      </div>
    </div>
  );
}

/** One recent search: tap to bring it back, ☆ to keep it in Favorites. */
function RecentRow({ text, inUse, starred, onApply, onStar }: { text: string; inUse: boolean; starred: boolean; onApply: () => void; onStar: () => void }) {
  return (
    <div className="recent-row">
      <button type="button" className="sp-item recent" title={text} onClick={onApply}>
        <span className="sp-label">{text}</span>
        {inUse && <span className="badge info">in use</span>}
      </button>
      <button type="button" className={'star-btn' + (starred ? ' on' : '')} aria-pressed={starred}
        aria-label={starred ? `Remove from favorites: ${text}` : `Add to favorites: ${text}`} title={starred ? 'In favorites' : 'Add to favorites'} onClick={onStar}>
        {starred ? '★' : '☆'}
      </button>
    </div>
  );
}

/** The last searches (up to 7) over the panel: tick several and add them to Favorites at once. */
function HistoryPanel({ items, summary, starred, current, onApply, onStar, onAddFavorites, onClose, onClear }: {
  items: RecentSearch[]; summary: (s: SearchState) => string; starred: (s: SearchState) => boolean; current: SearchState;
  onApply: (s: SearchState) => void; onStar: (s: SearchState) => void; onAddFavorites: (list: SearchState[]) => void; onClose: () => void; onClear: () => void;
}) {
  const [ticked, setTicked] = useState<Set<number>>(new Set());
  const when = (at?: string) => {
    if (!at) return '';
    const mins = Math.round((Date.now() - Date.parse(at)) / 60000);
    if (mins < 1) return 'just now';
    if (mins < 60) return `${mins} min ago`;
    if (mins < 1440) return `${Math.round(mins / 60)} h ago`;
    return new Date(at).toLocaleDateString('en-IN', { day: '2-digit', month: 'short' });
  };
  const choosable = items.map((x, i) => ({ x, i })).filter(({ x }) => !starred(x));
  return (
    <div className="history-panel" role="dialog" aria-label="Search history" onKeyDown={(e) => { if (e.key === 'Escape') { e.stopPropagation(); onClose(); } }}>
      <div className="sp-head">
        <h3>↺ Search history <span className="muted small">last {MAX_RECENT}</span></h3>
        <button type="button" className="btn ghost sm" aria-label="Close history" onClick={onClose}>✕</button>
      </div>
      <ul className="history-list">
        {items.map((r, i) => {
          const text = summary(r);
          const fav = starred(r);
          return (
            <li key={i}>
              <input type="checkbox" aria-label={`Choose: ${text}`} disabled={fav} checked={fav || ticked.has(i)}
                onChange={() => setTicked((t) => { const n = new Set(t); if (n.has(i)) n.delete(i); else n.add(i); return n; })} />
              <button type="button" className="sp-item" title={text} onClick={() => onApply(r)}>
                <span className="sp-label">{text}</span>
                {sameSearch(r, current) && <span className="badge info">in use</span>}
                <span className="muted small">{when(r.at)}</span>
              </button>
              <button type="button" className={'star-btn' + (fav ? ' on' : '')} aria-pressed={fav} aria-label={fav ? `Remove from favorites: ${text}` : `Add to favorites: ${text}`} onClick={() => onStar(r)}>{fav ? '★' : '☆'}</button>
            </li>
          );
        })}
      </ul>
      <div className="btn-row" style={{ alignItems: 'center' }}>
        <button type="button" className="btn sm primary" disabled={!ticked.size || !choosable.some(({ i }) => ticked.has(i))}
          onClick={() => { onAddFavorites(choosable.filter(({ i }) => ticked.has(i)).map(({ x }) => x)); setTicked(new Set()); }}>
          ★ Add {ticked.size || ''} to favorites
        </button>
        <span className="spacer" />
        <button type="button" className="link-btn small" onClick={onClear}>Clear history</button>
      </div>
    </div>
  );
}

