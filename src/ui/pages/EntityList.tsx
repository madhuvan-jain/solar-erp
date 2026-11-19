import { Fragment, lazy, Suspense, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { getEntity, MODULES } from '../../modules/registry';
import type { Entity, Field, Rec } from '../../lib/schema';
import { DuplicateError, useStore, ValidationError } from '../../lib/store';
import { canWrite } from '../../lib/rbac';
import { EXTRA, csvToObjects, readFileText } from '../../lib/csv';
import { exportTable } from '../../lib/exporters';
import { entityTable } from '../../modules/exportRows';
import { ExportMenu } from '../components/ExportMenu';
import { DocumentsBoard } from './Documents';
import { money } from '../../lib/money';
import { formatDate, localDateOf, todayIso } from '../../lib/format';
import { FieldValue, StatusBadge } from '../components/FieldValue';
import { errorText, useFeedback } from '../components/feedback';
import { NotFound } from './NotFound';
import { Icon } from '../components/Icon';
import { CalendarView, GraphView, PivotView, calendarField, groupValue, monthLabel, orderGroups, type GroupOpt } from '../components/Views';
import { SearchPanel, listGroupOptions } from '../components/SearchPanel';
import { filtersFor, type FilterCtx, type FilterDef } from '../../modules/filters';
import { decodeCustom, encodeCustom } from '../../modules/customFilter';
import { EMPTY_SEARCH, plainValue, searchRows, type SearchState } from '../../modules/search';
import { canDelete } from '../../lib/rbac';
import { defaultFavorite } from '../../lib/favorites';
import { rememberSearch } from '../../lib/recentSearches';
import { usePhone } from '../useMedia';
import { startBusy } from '../busy';
import { Dropdown } from '../components/Dropdown';
import { rememberOrder } from '../../lib/recordOrder';
import { isMappableEntity as isMappable } from '../../lib/geo/mappable';

// Map data is large; it loads the first time someone opens a map.
const EntityMap = lazy(() => import('../components/IndiaMap').then((m) => ({ default: m.EntityMap })));

type View = 'files' | 'table' | 'board' | 'calendar' | 'pivot' | 'graph' | 'map';

const PAGE = 25;

export { plainValue } from '../../modules/search';

export function EntityList() {
  const { entity: key = '' } = useParams();
  const entity = getEntity(key);
  if (!entity) return <NotFound />;
  return <ListInner key={key} entity={entity} />;
}

function ListInner({ entity }: { entity: Entity }) {
  const store = useStore();
  const nav = useNavigate();
  const { toast, confirm } = useFeedback();
  const [params, setParams] = useSearchParams();
  // The whole search lives in the address, so it survives Back and can be bookmarked or shared.
  const q = params.get('q') || '';
  const legacyStatus = params.get('status'); // older links (e.g. from the dashboard) used ?status=Won
  const fKeys = (params.get('f') || '').split(',').filter(Boolean);
  const gKeys = (params.get('g') || '').split(',').filter(Boolean);
  const sTerms = params.getAll('s').map((x) => { const i = x.indexOf(':'); return { field: x.slice(0, i), value: x.slice(i + 1) }; }).filter((x) => x.field && x.value);
  const cTerms = params.getAll('c').map(decodeCustom).filter((x): x is NonNullable<typeof x> => !!x);
  const search: SearchState = { q, f: fKeys, s: sTerms, c: cTerms, g: gKeys };
  const calField = calendarField(entity);
  const views: { key: View; label: string; icon: string }[] = [
    ...(entity.key === 'documents' ? [{ key: 'files' as View, label: 'Files', icon: 'documents' }] : []),
    { key: 'table', label: 'List', icon: 'list' },
    ...(entity.statusField ? [{ key: 'board' as View, label: 'Board', icon: 'board' }] : []),
    ...(calField ? [{ key: 'calendar' as View, label: 'Calendar', icon: 'calendar' }] : []),
    { key: 'pivot', label: 'Pivot', icon: 'pivot' },
    { key: 'graph', label: 'Graph', icon: 'graph' },
    ...(isMappable(entity) ? [{ key: 'map' as View, label: 'Map', icon: 'map' }] : []),
  ];
  const defaultView: View = views[0].key;
  const view: View = views.find((v) => v.key === params.get('view'))?.key || defaultView;
  const [sort, setSort] = useState<{ key: string; dir: 1 | -1 }>({ key: 'createdAt', dir: -1 });
  const [page, setPage] = useState(0);
  const fileRef = useRef<HTMLInputElement>(null);
  const [importing, setImporting] = useState<string | null>(null);
  const writable = !!store.user && canWrite(store.user, entity.module);
  const phone = usePhone();
  const moduleDef = MODULES.find((m) => m.key === entity.module);

  const listFields = entity.fields.filter((f) => f.list && !f.hidden);
  const statusField = entity.fields.find((f) => f.key === entity.statusField);

  const setParam = (k: string, v: string) => {
    const next = new URLSearchParams(params);
    if (v) next.set(k, v); else next.delete(k);
    setParams(next, { replace: true });
    setPage(0);
  };
  const setSearch = (st: SearchState) => {
    const next = new URLSearchParams(params);
    for (const k of ['q', 'f', 'g', 's', 'c', 'status']) next.delete(k);
    if (st.q) next.set('q', st.q);
    if (st.f.length) next.set('f', st.f.join(','));
    if (st.g.length) next.set('g', st.g.join(','));
    for (const t of st.s) next.append('s', `${t.field}:${t.value}`);
    for (const t of st.c || []) next.append('c', encodeCustom(t));
    setParams(next, { replace: true });
    setPage(0);
  };
  // Old ?status= links become the matching filter; with nothing asked for, the default favorite opens.
  useEffect(() => {
    if (legacyStatus && statusField) setSearch({ ...search, f: [...fKeys.filter((k) => !k.startsWith('st:')), `st:${legacyStatus}`] });
    else if (store.user && !q && !fKeys.length && !gKeys.length && !sTerms.length && !cTerms.length) {
      const fav = defaultFavorite(store.user.id, entity.key);
      if (fav) setSearch({ ...EMPTY_SEARCH, ...fav.state });
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  // A search that stays for a moment (or is still on when leaving) goes into "Recently used".
  const latest = useRef(search);
  latest.current = search;
  useEffect(() => {
    const t = setTimeout(() => rememberSearch(store.user?.id || '', entity.key, latest.current), 1200);
    return () => clearTimeout(t);
  }, [params.toString()]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => () => rememberSearch(store.user?.id || '', entity.key, latest.current), []); // eslint-disable-line react-hooks/exhaustive-deps
  const ctx: FilterCtx = useMemo(() => ({ store, me: store.user?.id || '', today: todayIso(), companyState: store.companyState() }),
    [store, store.getVersion()]); // eslint-disable-line react-hooks/exhaustive-deps
  const visible = store.all(entity.key);

  const searchKey = params.toString();
  // Live counts: for each filter, what the list would show with it added (its own section left out, like OR).
  const sectionBase = useMemo(() => new Map<string, Rec[]>(), [store, store.getVersion(), visible, ctx, searchKey]); // eslint-disable-line react-hooks/exhaustive-deps
  const countFor = (d: FilterDef) => {
    let base = sectionBase.get(d.section);
    if (!base) { base = searchRows(store, entity, visible, search, ctx, d.section); sectionBase.set(d.section, base); }
    return base.filter((r) => d.test(r, ctx)).length;
  };

  const rows = useMemo(() => {
    const list = searchRows(store, entity, visible, search, ctx);
    const f = entity.fields.find((x) => x.key === sort.key);
    const comp = entity.computed?.find((c) => c.key === sort.key);
    const val = (r: Rec): string | number => {
      if (comp) return comp.type === 'text' ? store.computedText(entity.key, r, comp.key) : store.computed(entity.key, r)[comp.key] ?? 0;
      if (!f) return String(r[sort.key] ?? '');
      if (['number', 'money', 'percent'].includes(f.type)) return Number(r[f.key]) || 0;
      return plainValue(store, f, r).toLowerCase();
    };
    return [...list].sort((a, b) => {
      const x = val(a), y = val(b);
      return (x < y ? -1 : x > y ? 1 : 0) * sort.dir;
    });
  }, [store, store.getVersion(), entity, visible, ctx, searchKey, sort]); // eslint-disable-line react-hooks/exhaustive-deps

  // Opening a record from here, its ‹ › arrows walk through exactly this list.
  useEffect(() => { rememberOrder(entity.key, rows.map((r) => r.id)); }, [rows, entity.key]);
  const pages = Math.max(1, Math.ceil(rows.length / PAGE));
  const cur = Math.min(page, pages - 1);
  const pageRows = rows.slice(cur * PAGE, cur * PAGE + PAGE);

  const toggleSort = (k: string) => setSort((s) => ({ key: k, dir: s.key === k && s.dir === 1 ? -1 : 1 }));
  const arrow = (k: string) => (sort.key === k ? (sort.dir === 1 ? ' ▲' : ' ▼') : '');

  // What is exported is exactly what the list shows now: same search, filters and order.
  const exportBuild = (list: Rec[] = rows, note = '') => () => entityTable(store, entity, list,
    `${list.length} record(s)${note}${list.length !== store.all(entity.key).length && !note ? ' (search and filters applied)' : ''} · ${formatDate(todayIso())}`);
  const exportName = (suffix = '') => `${entity.key}${suffix}-${todayIso()}`;

  // ---- selecting rows and acting on all of them at once ----
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [bulkBusy, setBulkBusy] = useState('');
  const pickedRows = rows.filter((r) => picked.has(r.id));
  const userField = entity.fields.find((f) => f.type === 'user' && !f.hidden);
  const deletable = !!store.user && canDelete(store.user, entity.module) && !entity.noDelete;
  const togglePick = (id: string) => setPicked((p0) => { const n = new Set(p0); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const pageAllPicked = pageRows.length > 0 && pageRows.every((r) => picked.has(r.id));
  const togglePage = () => setPicked((p0) => {
    const n = new Set(p0);
    for (const r of pageRows) { if (pageAllPicked) n.delete(r.id); else n.add(r.id); }
    return n;
  });
  const runBulk = async (label: string, work: (r: Rec) => Promise<unknown>) => {
    const list = pickedRows;
    setBulkBusy(label);
    const failed: string[] = [];
    let ok = 0;
    for (const r of list) {
      try { await work(r); ok++; } catch (e) { failed.push(`${r.number || store.titleOf(entity.key, r.id)}: ${e instanceof ValidationError ? Object.values(e.errors).join('; ') : errorText(e)}`); }
    }
    setBulkBusy('');
    setPicked(new Set(failed.length ? list.filter((r) => failed.some((f) => f.startsWith(`${r.number || store.titleOf(entity.key, r.id)}:`))).map((r) => r.id) : []));
    toast(`${label}: ${ok} of ${list.length} done${failed.length ? `, ${failed.length} not changed` : ''}.`, failed.length > 0);
    if (failed.length) await confirm({ title: 'Not changed', body: <pre style={{ whiteSpace: 'pre-wrap', fontSize: 12 }}>{failed.slice(0, 30).join('\n')}</pre>, okLabel: 'Close' });
  };
  const bulkSet = (field: string, value: string, label: string) =>
    runBulk(label, (r) => (r[field] === value ? Promise.resolve() : store.update(entity.key, r.id, { [field]: value }, { allowDuplicate: true })));
  const bulkDelete = async () => {
    const ok = await confirm({ title: `Delete ${pickedRows.length} ${pickedRows.length === 1 ? entity.label.toLowerCase() : entity.plural.toLowerCase()}?`,
      body: 'Records that other records still use are kept and listed afterwards. This cannot be undone.', okLabel: 'Delete', danger: true });
    if (ok) await runBulk('Delete', (r) => store.remove(entity.key, r.id));
  };

  const importCsv = async (file: File) => {
    if (importing) return;
    let text: string;
    try { text = await readFileText(file); } catch { return toast('Could not read the file.', true); }
    const objs = csvToObjects(text);
    if (!objs.length) return toast('The file has no data rows. The first row must be column headers.', true);
    const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '');
    const importable = entity.fields.filter((f) => !['items', 'file', 'checklist'].includes(f.type) && !f.hidden);
    const headerMap = new Map<string, Field>();
    for (const f of importable) { headerMap.set(norm(f.label), f); headerMap.set(norm(f.key), f); }
    // Common names people use in their own sheets.
    const ALIASES: Record<string, string> = { gstno: 'gstin', gstinno: 'gstin', gstnumber: 'gstin', mobile: 'phone', mobileno: 'phone', mobilenumber: 'phone', phoneno: 'phone', contactno: 'phone', emailid: 'email', pin: 'pincode', pinno: 'pincode', postalcode: 'pincode' };
    for (const [alias, key] of Object.entries(ALIASES)) { const f = importable.find((x) => x.key === key); if (f && !headerMap.has(alias)) headerMap.set(alias, f); }
    const firstHeaders = Object.keys(objs[0]).filter((h) => h !== EXTRA);
    const used = firstHeaders.filter((h) => headerMap.has(norm(h)));
    const ignored = firstHeaders.filter((h) => !headerMap.has(norm(h)));
    if (!used.length) {
      return toast(`No matching columns. Use headers like: ${importable.slice(0, 4).map((f) => f.label).join(', ')}`, true);
    }
    const ok = await confirm({
      title: `Import ${objs.length} row(s) into ${entity.plural}?`,
      body: <>
        <p>Columns used: <strong>{used.map((h) => `${h} → ${headerMap.get(norm(h))!.label}`).join(', ')}</strong></p>
        {ignored.length > 0 && <p className="banner warn">Not imported (no matching field): <strong>{ignored.join(', ')}</strong>. Rename these headers if they should be imported.</p>}
        <p className="muted small">Dates as DD/MM/YYYY or YYYY-MM-DD. Rows with errors or duplicates are skipped and listed afterwards.</p>
      </>,
      okLabel: 'Import',
    });
    if (!ok) return;

    let added = 0, dup = 0;
    const failed: string[] = [];
    setImporting(`0 / ${objs.length}`);
    const done = startBusy();
    try {
      for (let i = 0; i < objs.length; i++) {
        if (i % 10 === 0) setImporting(`${i} / ${objs.length}`);
        const data: Record<string, unknown> = {};
        const rowErrors: string[] = [];
        if (objs[i][EXTRA]) rowErrors.push(`${objs[i][EXTRA]} more cell(s) than there are headers — check the commas and quotes in this row`);
        for (const [h, v] of Object.entries(objs[i])) {
          if (h === EXTRA) continue;
          const f = headerMap.get(norm(h));
          if (!f || v === '') continue;
          if (f.type === 'ref') {
            const lower = v.toLowerCase();
            // A product can also be named by its SKU (unique), which is what stock sheets usually carry.
            const matches = store.all(f.ref!).filter((r) => store.titleOf(f.ref!, r.id).toLowerCase() === lower || r.number === v
              || (f.ref === 'products' && String(r.sku || '').trim().toLowerCase() === lower));
            if (matches.length > 1 && f.ref === 'products') {
              const bySku = matches.filter((r) => String(r.sku || '').trim().toLowerCase() === lower);
              if (bySku.length === 1) matches.splice(0, matches.length, bySku[0]);
            }
            if (matches.length === 1) data[f.key] = matches[0].id;
            else rowErrors.push(matches.length ? `${f.label} "${v}" matches more than one record — use its ${f.ref === 'products' ? 'SKU' : 'number'}` : `${f.label} "${v}" not found`);
          } else if (f.type === 'user') {
            const lower = v.toLowerCase();
            const u = store.users.find((x) => x.name.toLowerCase() === lower || x.email.toLowerCase() === lower);
            if (u) data[f.key] = u.id;
            else rowErrors.push(`${f.label} "${v}" is not a user`);
          } else if (f.type === 'select') {
            const opt = f.options!.find((o) => o.toLowerCase() === v.toLowerCase());
            data[f.key] = opt ?? v;
          } else if (f.type === 'date') {
            const m = v.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/); // DD/MM/YYYY
            data[f.key] = m ? `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}` : v;
          } else if (f.type === 'datetime') {
            const m = v.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})[ T]+(\d{1,2}):(\d{2})/); // DD/MM/YYYY HH:mm
            data[f.key] = m ? `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}T${m[4].padStart(2, '0')}:${m[5]}`
              : v.replace(' ', 'T').slice(0, 16); // "2026-11-10 10:00" as exported
          } else if (f.type === 'bool') {
            data[f.key] = /^(yes|y|true|1|active)$/i.test(v);
          } else if (f.type === 'money' || f.type === 'number' || f.type === 'percent') {
            const n = Number(v.replace(/[₹,%\s]/g, '').replace(/^rs\.?/i, ''));
            if (Number.isFinite(n)) data[f.key] = n; else rowErrors.push(`${f.label} "${v}" is not a number`);
          } else data[f.key] = v;
        }
        if (rowErrors.length) { failed.push(`Row ${i + 2}: ${rowErrors.join('; ')}`); continue; }
        // The same row imported twice (e.g. the same file again): skipped, also where there is no duplicate check.
        const keys = Object.keys(data);
        if (keys.length && store.all(entity.key).some((r) => keys.every((k) => JSON.stringify(r[k] ?? '') === JSON.stringify(data[k] ?? '')))) { dup++; continue; }
        try { await store.create(entity.key, data); added++; }
        catch (e) {
          if (e instanceof DuplicateError) dup++;
          else failed.push(`Row ${i + 2}: ${e instanceof ValidationError
            ? Object.entries(e.errors).map(([k, msg]) => { const lab = entity.fields.find((x) => x.key === k)?.label; return lab && !msg.startsWith(lab) ? `${lab}: ${msg}` : msg; }).join('; ')
            : errorText(e)}`);
        }
      }
    } finally {
      done();
      setImporting(null);
    }
    toast(`Imported ${added}. Skipped ${dup} duplicate(s), ${failed.length} with errors.`, failed.length > 0);
    if (failed.length) {
      await confirm({ title: 'Rows that were not imported', body: <pre style={{ whiteSpace: 'pre-wrap', fontSize: 12 }}>{failed.slice(0, 50).join('\n')}{failed.length > 50 ? `\n…and ${failed.length - 50} more` : ''}</pre>, okLabel: 'Close' });
    }
  };

  return (
    <>
      <div className="page-head" data-list={entity.key}>
        <div>
          <div className="muted small">{moduleDef?.label}</div>
          <h1>{entity.plural}</h1>
        </div>
        <div className="spacer" />
        {writable && <input ref={fileRef} type="file" accept=".csv,text/csv" hidden onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; if (f) void importCsv(f); }} />}
        {phone ? (
          // Phones: the less used actions in one menu; "New" is the round button at the bottom.
          <Dropdown className="btn sm" label="More actions" panelLabel="More actions" panelClass="dd-actions" button={<>⋯ More</>}>
            {(close) => (
              <nav className="dd-menu" aria-label="More actions">
                <button type="button" disabled={!rows.length} onClick={() => { close(); void exportTable(exportBuild()(), 'xlsx', exportName()); }}>Export to Excel</button>
                <button type="button" disabled={!rows.length} onClick={() => { close(); void exportTable(exportBuild()(), 'pdf', exportName()).catch((e) => toast(errorText(e), true)); }}>Export to PDF</button>
                <button type="button" disabled={!rows.length} onClick={() => { close(); void exportTable(exportBuild()(), 'csv', exportName()); }}>Export to CSV</button>
                <button type="button" disabled={!rows.length} onClick={() => { close(); window.print(); }}>Print list</button>
                {writable && <button type="button" disabled={!!importing} onClick={() => { close(); fileRef.current?.click(); }}>{importing ? `Importing ${importing}…` : 'Import CSV'}</button>}
              </nav>
            )}
          </Dropdown>
        ) : (
          <div className="btn-row">
            <ExportMenu build={exportBuild()} name={exportName()} disabled={!rows.length} />
            <button className="btn sm" onClick={() => window.print()} disabled={!rows.length}><Icon name="print" size={16} />Print</button>
            {writable && <>
              <button className="btn sm" disabled={!!importing} onClick={() => fileRef.current?.click()}>{importing ? `Importing ${importing}…` : 'Import CSV'}</button>
              <Link className="btn primary" to={`/m/${entity.key}/new`}>+ New {entity.label}</Link>
            </>}
          </div>
        )}
        {phone && writable && <Link className="fab" to={`/m/${entity.key}/new`} aria-label={`New ${entity.label}`}>＋</Link>}
      </div>

      <div className="toolbar">
        <SearchPanel entity={entity} state={search} onChange={setSearch} countFor={countFor} userId={store.user?.id || ''} />
        {/* Views as icons beside the search; the name shows on hover or focus. */}
        <div className="view-switch icons no-print" role="group" aria-label="View">
          {views.map((v) => (
            <button key={v.key} type="button" className={view === v.key ? 'on' : ''} aria-pressed={view === v.key} aria-label={v.label}
              data-tip={v.label} onClick={() => setParam('view', v.key === defaultView ? '' : v.key)}>
              <Icon name={v.icon} size={17} />
            </button>
          ))}
        </div>
        <span className="muted small">{rows.length} record(s)</span>
      </div>

      {view === 'files' ? (
        <DocumentsBoard rows={rows} />
      ) : view === 'board' && statusField ? (
        <Board entity={entity} statusKey={statusField.key} options={statusField.options!} rows={rows} writable={writable} />
      ) : view === 'calendar' && calField ? (
        <CalendarView entity={entity} rows={rows} field={calField} />
      ) : view === 'pivot' ? (
        <PivotView key={'p' + gKeys.join()} entity={entity} rows={rows} initialRows={gKeys[0]} initialCols={gKeys[1]} />
      ) : view === 'graph' ? (
        <GraphView key={'g' + gKeys.join()} entity={entity} rows={rows} initialGroup={gKeys[0]} initialSplit={gKeys[1]} />
      ) : view === 'map' ? (
        <Suspense fallback={<div className="card muted" role="status">Loading map…</div>}><EntityMap entity={entity} rows={rows} /></Suspense>
      ) : rows.length > 0 && gKeys.length > 0 ? (
        <GroupedTable entity={entity} rows={rows} groupKeys={gKeys} listFields={listFields} />
      ) : rows.length === 0 ? (
        <div className="card empty">
          {store.all(entity.key).length === 0
            ? <>No {entity.plural.toLowerCase()} yet.{writable && <> <Link to={`/m/${entity.key}/new`}>Add the first one</Link> or import a CSV.</>}</>
            : <>Nothing matches your search or filters. {filtersFor(entity).length > 0 && <button type="button" className="link-btn" onClick={() => setSearch(EMPTY_SEARCH)}>Clear search</button>}</>}
        </div>
      ) : (
        <>
          <div className="table-wrap">
            {picked.size > 0 && (
              <div className="bulk-bar" role="region" aria-label="Selected records">
                <strong>{picked.size} selected</strong>
                {picked.size < rows.length && <button type="button" className="link-btn" onClick={() => setPicked(new Set(rows.map((r) => r.id)))}>Select all {rows.length}</button>}
                <span className="spacer" />
                <ExportMenu build={exportBuild(pickedRows, ' selected')} name={exportName('-selected')} />
                {writable && statusField && (
                  <select className="input" aria-label={`Set ${statusField.label} of selected`} value="" disabled={!!bulkBusy}
                    onChange={(e) => { if (e.target.value) void bulkSet(statusField.key, e.target.value, `${statusField.label} → ${e.target.value}`); }}>
                    <option value="">Set {statusField.label.toLowerCase()}…</option>
                    {statusField.options!.map((o) => <option key={o} value={o}>{o}</option>)}
                  </select>
                )}
                {writable && userField && (
                  <select className="input" aria-label={`Set ${userField.label} of selected`} value="" disabled={!!bulkBusy}
                    onChange={(e) => { const u = store.users.find((x) => x.id === e.target.value); if (u) void bulkSet(userField.key, u.id, `${userField.label} → ${u.name}`); }}>
                    <option value="">{userField.label}…</option>
                    {store.users.filter((u) => u.active && u.role !== 'pending').map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
                  </select>
                )}
                {deletable && <button type="button" className="btn sm danger" disabled={!!bulkBusy} onClick={() => void bulkDelete()}>Delete</button>}
                <button type="button" className="btn sm ghost" onClick={() => setPicked(new Set())}>Clear</button>
                {bulkBusy && <span className="muted small" role="status">{bulkBusy}…</span>}
              </div>
            )}
            {phone ? (
              // Phones: one card per record, like a video list on a phone — the table would be too cramped.
              <ul className="rec-cards" aria-label={entity.plural}>
                <li className="rc-head">
                  <label className="check small"><input type="checkbox" aria-label="Select all on this page" checked={pageAllPicked} onChange={togglePage} /> Select page</label>
                  <select className="input" aria-label="Sort by" value={`${sort.key}:${sort.dir}`} onChange={(e) => { const [k, d] = e.target.value.split(':'); setSort({ key: k, dir: Number(d) as 1 | -1 }); }}>
                    <option value="createdAt:-1">Newest first</option>
                    <option value="createdAt:1">Oldest first</option>
                    {listFields.filter((f) => f.type !== 'items').map((f) => <option key={f.key} value={`${f.key}:1`}>{f.label}</option>)}
                    {(entity.computed || []).filter((x) => x.type !== 'text').map((x) => <option key={x.key} value={`${x.key}:-1`}>{x.label} (high to low)</option>)}
                  </select>
                </li>
                {pageRows.map((r) => <RecordCard key={r.id} entity={entity} rec={r} picked={picked.has(r.id)} onPick={() => togglePick(r.id)} />)}
              </ul>
            ) : (
            <table>
              <thead>
                <tr>
                  <th className="pick"><input type="checkbox" aria-label="Select all on this page" checked={pageAllPicked} onChange={togglePage} /></th>
                  {entity.numberPrefix && <th><button onClick={() => toggleSort('number')}>No.{arrow('number')}</button></th>}
                  {listFields.map((f) => (
                    <th key={f.key} className={['money', 'number'].includes(f.type) ? 'num' : ''}>
                      <button onClick={() => toggleSort(f.key)}>{f.label}{arrow(f.key)}</button>
                    </th>
                  ))}
                  {(entity.computed || []).map((c) => <th key={c.key} className={c.type === 'text' ? '' : 'num'}><button onClick={() => toggleSort(c.key)}>{c.label}{arrow(c.key)}</button></th>)}
                  <th className="hide-sm"><button onClick={() => toggleSort('createdAt')}>Created{arrow('createdAt')}</button></th>
                </tr>
              </thead>
              <tbody>
                {pageRows.map((r) => {
                  const c = store.computed(entity.key, r);
                  return (
                    <tr key={r.id} className={'clickable' + (picked.has(r.id) ? ' picked' : '')} tabIndex={0}
                      onClick={() => nav(`/m/${entity.key}/${r.id}`)}
                      onKeyDown={(e) => { if (e.key === 'Enter') nav(`/m/${entity.key}/${r.id}`); }}>
                      <td className="pick" onClick={(e) => e.stopPropagation()}>
                        <input type="checkbox" aria-label={`Select ${r.number || store.titleOf(entity.key, r.id)}`} checked={picked.has(r.id)}
                          onChange={() => togglePick(r.id)} onKeyDown={(e) => e.stopPropagation()} />
                      </td>
                      {entity.numberPrefix && <td>{r.number || '—'}</td>}
                      {listFields.map((f) => <td key={f.key} className={['money', 'number'].includes(f.type) ? 'num' : ''}><FieldValue field={f} rec={r} /></td>)}
                      {(entity.computed || []).map((x) => x.type === 'text'
                        ? <td key={x.key}><StatusBadge value={store.computedText(entity.key, r, x.key)} /></td>
                        : <td key={x.key} className="num">{x.type === 'money' ? money(c[x.key]) : c[x.key]}</td>)}
                      <td className="hide-sm muted">{formatDate(localDateOf(r.createdAt))}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            )}
          </div>
          {pages > 1 && (
            <div className="pager">
              <span className="muted small">Page {cur + 1} of {pages}</span>
              <div className="btn-row">
                <button className="btn sm" disabled={cur === 0} onClick={() => setPage(cur - 1)}>Previous</button>
                <button className="btn sm" disabled={cur >= pages - 1} onClick={() => setPage(cur + 1)}>Next</button>
              </div>
            </div>
          )}
        </>
      )}
    </>
  );
}

function Board({ entity, statusKey, options, rows, writable }: { entity: Entity; statusKey: string; options: string[]; rows: Rec[]; writable: boolean }) {
  const store = useStore();
  const { toast } = useFeedback();
  const [over, setOver] = useState<string | null>(null);
  const sub = entity.fields.filter((f) => f.list && f.key !== statusKey && f.key !== entity.title).slice(0, 2);

  const move = async (id: string, to: string) => {
    const r = store.get(entity.key, id);
    if (!r || r[statusKey] === to) return;
    try { await store.update(entity.key, id, { [statusKey]: to }, { allowDuplicate: true }); toast(`Moved to ${to}`); }
    catch (e) { toast(errorText(e), true); }
  };

  return (
    <div className="board">
      {options.map((o) => {
        const items = rows.filter((r) => r[statusKey] === o);
        return (
          <section key={o} className={'col' + (over === o ? ' drop' : '')} aria-label={o}
            onDragOver={(e) => { if (writable) { e.preventDefault(); setOver(o); } }}
            onDragLeave={() => setOver(null)}
            onDrop={(e) => { e.preventDefault(); setOver(null); void move(e.dataTransfer.getData('text/plain'), o); }}>
            <div className="col-head"><span>{o}</span><span className="muted">{items.length}</span></div>
            {items.slice(0, 100).map((r) => (
              <div key={r.id} className="tile" draggable={writable} onDragStart={(e) => e.dataTransfer.setData('text/plain', r.id)}>
                <Link to={`/m/${entity.key}/${r.id}`} className="t" style={{ color: 'inherit', textDecoration: 'none' }}>
                  {store.titleOf(entity.key, r.id)}
                </Link>
                {sub.map((f) => <div key={f.key} className="muted small"><FieldValue field={f} rec={r} /></div>)}
                {writable && (
                  // Drag-and-drop does not work on touch screens, so every card also has a picker.
                  <select className="input" aria-label={`Move ${store.titleOf(entity.key, r.id)}`} value={o} onChange={(e) => void move(r.id, e.target.value)}>
                    {options.map((x) => <option key={x} value={x}>{x}</option>)}
                  </select>
                )}
              </div>
            ))}
            {items.length > 100 && <div className="muted small">+{items.length - 100} more — use list view</div>}
          </section>
        );
      })}
    </div>
  );
}

/**
 * The list split into groups (one or two levels): each heading shows how many records
 * and, where there is one, the money total; click a heading to open it.
 */
function GroupedTable({ entity, rows, groupKeys, listFields }: { entity: Entity; rows: Rec[]; groupKeys: string[]; listFields: Field[] }) {
  const store = useStore();
  const nav = useNavigate();
  const [openKeys, setOpenKeys] = useState<Set<string>>(new Set());
  const opts = listGroupOptions(entity);
  const levels = groupKeys.map((k) => opts.find((o) => o.key === k)).filter((g): g is GroupOpt => !!g);
  const moneyKey = entity.computed?.find((c) => c.type === 'money')?.key;
  const moneyField = !moneyKey ? listFields.find((f) => f.type === 'money' && !f.noTotal) : undefined;
  const amount = (r: Rec) => (moneyKey ? store.computed(entity.key, r)[moneyKey] || 0 : moneyField ? Number(r[moneyField.key]) || 0 : 0);
  const showMoney = !!(moneyKey || moneyField);
  const cols = (entity.numberPrefix ? 1 : 0) + listFields.length + (entity.computed?.length || 0);

  const labelOf = (g: GroupOpt, v: string) => (g.kind === 'month' ? monthLabel(v) : v);
  const split = (list: Rec[], g: GroupOpt) => {
    const m = new Map<string, Rec[]>();
    for (const r of list) { const v = groupValue(store, entity, g, r); m.set(v, [...(m.get(v) || []), r]); }
    const size = new Map([...m.entries()].map(([k, v]) => [k, v.length]));
    return orderGroups(entity, g, [...m.keys()], size).map((k) => [k, m.get(k)!] as const);
  };
  const toggle = (k: string) => setOpenKeys((s) => { const n = new Set(s); if (n.has(k)) n.delete(k); else n.add(k); return n; });
  const allKeys = () => {
    const out: string[] = [];
    for (const [v1, l1] of split(rows, levels[0])) {
      out.push(v1);
      if (levels[1]) for (const [v2] of split(l1, levels[1])) out.push(`${v1}›${v2}`);
    }
    return out;
  };
  const LIMIT = 200;

  const renderRows = (list: Rec[]) => [...list.slice(0, LIMIT).map((r) => {
    const c = store.computed(entity.key, r);
    return (
      <tr key={r.id} className="clickable" tabIndex={0} onClick={() => nav(`/m/${entity.key}/${r.id}`)} onKeyDown={(e) => { if (e.key === 'Enter') nav(`/m/${entity.key}/${r.id}`); }}>
        {entity.numberPrefix && <td>{r.number || '—'}</td>}
        {listFields.map((f) => <td key={f.key} className={['money', 'number'].includes(f.type) ? 'num' : ''}><FieldValue field={f} rec={r} /></td>)}
        {(entity.computed || []).map((x) => x.type === 'text'
          ? <td key={x.key}><StatusBadge value={store.computedText(entity.key, r, x.key)} /></td>
          : <td key={x.key} className="num">{x.type === 'money' ? money(c[x.key]) : c[x.key]}</td>)}
      </tr>
    );
  }), ...(list.length > LIMIT ? [
    <tr key="more" className="group-more"><td colSpan={cols} className="muted small">…and {list.length - LIMIT} more in this group. Add a filter or another grouping level to see them.</td></tr>,
  ] : [])];

  const heading = (path: string, g: GroupOpt, v: string, list: Rec[], depth: number) => (
    <tr key={'h' + path} className={'group-row depth-' + depth}>
      <td colSpan={cols}>
        <button type="button" aria-expanded={openKeys.has(path)} onClick={() => toggle(path)}>
          <span className="caret" aria-hidden>{openKeys.has(path) ? '▾' : '▸'}</span>
          <span className="muted small">{g.label}:</span> <strong>{labelOf(g, v)}</strong>
          <span className="group-count">{list.length}</span>
          {showMoney && <span className="group-sum">{money(list.reduce((s, r) => s + amount(r), 0))}</span>}
        </button>
      </td>
    </tr>
  );

  return (
    <div className="table-wrap">
      <div className="btn-row group-tools">
        <button type="button" className="btn sm ghost" onClick={() => setOpenKeys(new Set(allKeys()))}>Expand all</button>
        <button type="button" className="btn sm ghost" onClick={() => setOpenKeys(new Set())}>Collapse all</button>
      </div>
      <table className="grouped">
        <thead>
          <tr>
            {entity.numberPrefix && <th>No.</th>}
            {listFields.map((f) => <th key={f.key} className={['money', 'number'].includes(f.type) ? 'num' : ''}>{f.label}</th>)}
            {(entity.computed || []).map((c) => <th key={c.key} className={c.type === 'text' ? '' : 'num'}>{c.label}</th>)}
          </tr>
        </thead>
        <tbody>
          {split(rows, levels[0]).map(([v1, l1]) => (
            <Fragment key={v1}>
              {heading(v1, levels[0], v1, l1, 0)}
              {openKeys.has(v1) && (levels[1]
                ? split(l1, levels[1]).map(([v2, l2]) => (
                  <Fragment key={v2}>
                    {heading(`${v1}›${v2}`, levels[1], v2, l2, 1)}
                    {openKeys.has(`${v1}›${v2}`) && renderRows(l2)}
                  </Fragment>
                ))
                : renderRows(l1))}
            </Fragment>
          ))}
        </tbody>
      </table>
      {showMoney && <p className="muted small group-total">Total {money(rows.reduce((s, r) => s + amount(r), 0))} · {rows.length} record(s)</p>}
    </div>
  );
}

/** One record as a card on a phone: title and status on top, the key details below, the amount on the right. */
function RecordCard({ entity, rec, picked, onPick }: { entity: Entity; rec: Rec; picked: boolean; onPick: () => void }) {
  const store = useStore();
  const title = store.titleOf(entity.key, rec.id);
  const status = entity.statusField ? String(rec[entity.statusField] || '') : '';
  const text = (entity.computed || []).find((c) => c.type === 'text');
  const amount = (entity.computed || []).find((c) => c.type === 'money');
  const moneyField = !amount ? entity.fields.find((f) => f.list && f.type === 'money') : undefined;
  const value = amount ? store.computed(entity.key, rec)[amount.key] : moneyField ? Number(rec[moneyField.key]) || 0 : null;
  const details = entity.fields.filter((f) => f.list && !f.hidden && f.key !== entity.title && f.key !== entity.statusField && f.type !== 'money').slice(0, 3);
  return (
    <li className={'rec-card' + (picked ? ' picked' : '')}>
      <input type="checkbox" aria-label={`Select ${rec.number || title}`} checked={picked} onChange={onPick} />
      <Link to={`/m/${entity.key}/${rec.id}`} className="rc-main">
        <span className="rc-top">
          <strong className="rc-title">{title}</strong>
          {status && <StatusBadge value={status} />}
          {text && <StatusBadge value={store.computedText(entity.key, rec, text.key)} />}
        </span>
        <span className="rc-meta">
          {rec.number && rec.number !== title && <span>{rec.number}</span>}
          {details.map((f) => { const v = plainValue(store, f, rec); return v ? <span key={f.key}>{f.type === 'date' || f.type === 'datetime' ? formatDate(v.length > 10 ? localDateOf(v) : v) : v}</span> : null; })}
        </span>
      </Link>
      {value !== null && <span className="rc-amount">{money(value)}</span>}
    </li>
  );
}

