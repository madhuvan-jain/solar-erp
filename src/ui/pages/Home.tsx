import { useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useStore } from '../../lib/store';
import { canRead, isAdmin } from '../../lib/rbac';
import { myAlerts } from '../../lib/alerts';
import { formatDate, todayIso } from '../../lib/format';
import { normalizePhone } from '../../lib/validate';
import { ENTITIES, MODULES, getEntity } from '../../modules/registry';
import { Icon } from '../components/Icon';
import { EXTRA_APPS } from '../Layout';

/** Home screen: one tile per app the user's role can open, plus search across everything. */
export function Home() {
  const store = useStore();
  const role = store.user!.role;
  const alerts = myAlerts(store, (m) => canRead(store.user, m), (e) => getEntity(e)?.module || '').filter((a) => a.level !== 'info');
  const byModule = new Map<string, number>();
  for (const a of alerts) {
    const m = getEntity(a.entity)?.module;
    if (m && canRead(store.user, m)) byModule.set(m, (byModule.get(m) || 0) + 1);
  }
  const apps = [
    EXTRA_APPS[0],
    ...MODULES.filter((m) => canRead(store.user, m.key)).map((m) => ({ ...m, to: `/m/${m.entities[0]}` })),
    ...EXTRA_APPS.slice(1),
  ];
  const hour = new Date().getHours();
  const greet = hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening';

  return (
    <div className="home">
      <div className="home-hero">
        <div>
          <div className="muted small">{greet} · {formatDate(todayIso())}</div>
          <h1>Hello, {store.user!.name.split(' ')[0]}</h1>
        </div>
        <GlobalSearch />
      </div>
      <div className="app-grid">
        {apps.map((a) => {
          const n = a.key === 'alerts' ? alerts.length : byModule.get(a.key) || 0;
          return (
            <Link key={a.key} to={a.to} className="app-tile">
              <span className="app-icon" style={{ background: a.color }}><Icon name={a.icon} size={26} /></span>
              <span className="app-label">{a.key === 'settings' && !isAdmin(role) ? 'My account' : a.label}</span>
              <span className="app-desc">{a.desc}</span>
              {n > 0 && <span className="app-badge" aria-label={`${n} need attention`}>{n}</span>}
            </Link>
          );
        })}
      </div>
    </div>
  );
}

interface Hit { entity: string; id: string; title: string; sub: string; plural: string }

function GlobalSearch() {
  const store = useStore();
  const nav = useNavigate();
  const role = store.user!.role;
  const [q, setQ] = useState('');
  const hits = useMemo<Hit[]>(() => {
    const needle = q.trim().toLowerCase();
    if (needle.length < 2) return [];
    const digits = normalizePhone(needle);
    const out: Hit[] = [];
    for (const e of ENTITIES) {
      if (!canRead(store.user, e.module)) continue;
      for (const r of store.all(e.key)) {
        const title = store.titleOf(e.key, r.id);
        const hay = [title, r.number, r.phone, r.email, r.city, r.gstin, r.sku, r.applicationNo].filter(Boolean).map((x) => String(x).toLowerCase());
        const phoneHit = digits.length >= 4 && r.phone && normalizePhone(String(r.phone)).includes(digits);
        if (phoneHit || hay.some((h) => h.includes(needle))) {
          const sub = [r.number !== title ? r.number : '', r.phone, r.city].filter(Boolean).join(' · ');
          out.push({ entity: e.key, id: r.id, title, sub: String(sub), plural: e.label });
          if (out.length >= 30) return out;
        }
      }
    }
    return out;
  }, [q, store, store.getVersion(), role]);

  return (
    <div className="global-search">
      <label className="search-box">
        <Icon name="search" size={18} />
        <input type="search" placeholder="Search customers, invoices, phone, GSTIN…" aria-label="Search everything" value={q}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter' && hits[0]) nav(`/m/${hits[0].entity}/${hits[0].id}`); }} />
      </label>
      {q.trim().length >= 2 && (
        <div className="search-results" role="listbox" aria-label="Search results">
          {hits.length ? hits.map((h) => (
            <Link key={h.entity + h.id} role="option" aria-selected={false} to={`/m/${h.entity}/${h.id}`}>
              <span className="badge">{h.plural}</span>
              <span className="t">{h.title}</span>
              <span className="muted small">{h.sub}</span>
            </Link>
          )) : <div className="muted small" style={{ padding: 10 }}>No matches for “{q.trim()}”.</div>}
        </div>
      )}
    </div>
  );
}
