import { connectPrefs } from '../lib/prefs';
import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { Link, NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { BRAND } from '../config/brand';
import { MODULES, getEntity } from '../modules/registry';
import { useStore } from '../lib/store';
import { canRead, isAdmin, ROLE_LABELS } from '../lib/rbac';
import { myAlerts } from '../lib/alerts';
import { Icon } from './components/Icon';
import { BrandLogo } from './components/BrandLogo';
import { useFileUrl } from './pages/PrintDoc';
import { DEMO_EVENT, demoState } from '../lib/demo';
import { formatMobile } from '../lib/validate';
import { Dropdown } from './components/Dropdown';
import { AlertList } from './pages/Alerts';
import { useFeedback } from './components/feedback';
import { hasUnsavedChanges } from './unsaved';
import { usePhone } from './useMedia';
import { isBusy } from './busy';
import { SubscriptionBanner } from './pages/Subscription';

/** Screens that are not a data module but still appear as apps on the home screen. */
export const EXTRA_APPS = [
  { key: 'dashboard', label: 'Dashboard', icon: 'dashboard', color: '#0f6b5c', desc: 'KPIs, charts, India sales map', to: '/dashboard' },
  { key: 'reports', label: 'Reports', icon: 'reports', color: '#334155', desc: 'Sales, GST, cash flow, leads', to: '/reports' },
  { key: 'alerts', label: 'Alerts', icon: 'alerts', color: '#b91c1c', desc: 'Overdue and due-soon items', to: '/alerts' },
  { key: 'settings', label: 'Settings', icon: 'settings', color: '#475569', desc: 'Company, print templates, users', to: '/settings' },
];

/** Which app the current address belongs to (null on the home screen). */
export function appOf(pathname: string): { key: string; label: string; icon: string; color: string } | null {
  const m = /^\/(?:m|print)\/([^/]+)/.exec(pathname);
  if (m) {
    const e = getEntity(m[1]);
    const mod = e && MODULES.find((x) => x.key === e.module);
    return mod || null;
  }
  const extra = EXTRA_APPS.find((a) => pathname === a.to || pathname.startsWith(a.to + '/'));
  return extra || null;
}

const onDemoChange = (cb: () => void) => {
  window.addEventListener(DEMO_EVENT, cb);
  window.addEventListener('storage', cb); // loaded or removed in another tab
  return () => { window.removeEventListener(DEMO_EVENT, cb); window.removeEventListener('storage', cb); };
};
const demoLoaded = () => !!demoState();

/** `confirmed`: the person already said yes to signing out (and to losing unsaved changes). */
export function Layout({ onSignOut }: { onSignOut: (confirmed?: boolean) => void }) {
  const store = useStore();
  const { confirm } = useFeedback();
  const user = store.user!;
  const nav = useNavigate();
  const phone = usePhone();
  const [online, setOnline] = useState(navigator.onLine);
  const loc = useLocation();
  useEffect(() => {
    const on = () => setOnline(true), off = () => setOnline(false);
    window.addEventListener('online', on); window.addEventListener('offline', off);
    return () => { window.removeEventListener('online', on); window.removeEventListener('offline', off); };
  }, []);
  // A new page starts at the top (assigning scrollTop also works where scrollTo is missing).
  useEffect(() => { document.documentElement.scrollTop = 0; document.body.scrollTop = 0; }, [loc.pathname]);

  const demo = useSyncExternalStore(onDemoChange, demoLoaded);
  // Re-count alerts as soon as someone changes which kinds they want (Settings → Alerts).
  const [, bump] = useState(0);
  useEffect(() => connectPrefs(store), [store, store.user?.id]);
  const health = store.backend.health?.();
  // A new version was downloaded in the background: offer it, never reload under someone's typing.
  // A new version downloaded in the background takes over by itself — no message — at a moment when nothing
  // can be lost: the next time the person opens another screen, or while the app is in the background
  // with no form or dialog open. (Saved data is never affected; see docs/UPGRADING.md.)
  const updateReady = useRef(!!(window as { __ss1UpdateReady?: boolean }).__ss1UpdateReady);
  const safeToReload = () => !/\/(new|edit)$/.test(window.location.hash.split('?')[0]) && !document.querySelector('.modal, [role="dialog"]')
    && !hasUnsavedChanges() && !isBusy();
  useEffect(() => {
    const ready = () => { updateReady.current = true; if (document.visibilityState === 'hidden' && safeToReload()) window.location.reload(); };
    const away = () => { if (updateReady.current && document.visibilityState === 'hidden' && safeToReload()) window.location.reload(); };
    window.addEventListener('ss1-update-ready', ready);
    document.addEventListener('visibilitychange', away);
    return () => { window.removeEventListener('ss1-update-ready', ready); document.removeEventListener('visibilitychange', away); };
  }, []);
  const firstPath = useRef(loc.pathname);
  useEffect(() => {
    if (loc.pathname === firstPath.current) return;
    firstPath.current = loc.pathname;
    // Leaving a screen (an unsaved form asks first), so switching to the new version now loses nothing —
    // unless a long job (import, backup, restore) is still running.
    if (updateReady.current && !isBusy() && !hasUnsavedChanges()) window.location.reload();
  }, [loc.pathname]);
  useEffect(() => { const h = () => bump((n) => n + 1); window.addEventListener('ss1-alertprefs', h); return () => window.removeEventListener('ss1-alertprefs', h); }, []);
  const alerts = myAlerts(store, (m) => canRead(store.user, m), (e) => getEntity(e)?.module || '');
  const alertCount = alerts.filter((a) => a.level === 'danger').length;
  const initial = user.name.trim().charAt(0).toUpperCase() || '?';
  // The business's own name and logo (Settings → Company profile / Print), the app's mark until a logo is uploaded.
  const company = store.settings();
  const companyName = company.companyName?.trim() || BRAND.name;
  const companyLogo = useFileUrl(store, company.logo);

  // Like a social app: a short "are you sure?" before signing out.
  const askSignOut = async () => {
    const unsaved = hasUnsavedChanges();
    const ok = await confirm({
      title: 'Sign out?',
      body: unsaved
        ? 'You have unsaved changes on this page. Signing out throws them away.'
        : <>You are signed in as <strong>{user.email}</strong>.</>,
      okLabel: 'Sign out',
      danger: unsaved,
    });
    if (ok) onSignOut(true);
  };
  const app = appOf(loc.pathname);
  const mod = app && MODULES.find((m) => m.key === app.key);
  const tabs = mod ? mod.entities.map((k) => getEntity(k)!) : [];

  const accountMenu = (close: () => void) => <>
    <div className="dd-me">
      <span className="avatar lg" aria-hidden>{initial}</span>
      <div className="account-text">
        <strong>{user.name}</strong>
        <span className="muted small">{user.email}</span>
        {user.phone && <span className="muted small">{formatMobile(user.phone)}</span>}
        <span className="badge info" style={{ justifySelf: 'start', marginTop: 4 }}>{ROLE_LABELS[user.role].split(' (')[0]}</span>
      </div>
    </div>
    <nav className="dd-menu" aria-label="Account">
      <Link to="/settings">{isAdmin(user) ? 'My profile & settings' : 'My profile'}</Link>
      <Link to="/alerts">Notifications{alerts.length ? ` (${alerts.length})` : ''}</Link>
      <button type="button" onClick={() => { close(); void askSignOut(); }}>Sign out</button>
    </nav>
  </>;
  // Phones get a bottom tab bar (thumb reach), except while filling a form or printing.
  const inForm = /\/(new|edit)$/.test(loc.pathname) || loc.pathname.startsWith('/print/');
  const bottomBar = phone && !inForm;
  const openSearch = () => {
    nav('/');
    setTimeout(() => document.querySelector<HTMLInputElement>('input[aria-label="Search everything"]')?.focus(), 60);
  };

  return (
    <div className={'shell' + (bottomBar ? ' has-bottom-nav' : '')}>
      <header className="appbar no-print">
        <div className="appbar-row">
          {/* Already on the home screen: no button back to it. */}
          {loc.pathname !== '/' && <Link to="/" className="home-btn" aria-label="All apps" title="All apps"><Icon name="home" /></Link>}
          {app ? (
            <Link to={mod ? `/m/${mod.entities[0]}` : loc.pathname} className="app-name">
              <span className="app-dot" style={{ background: app.color }}><Icon name={app.icon} size={16} /></span>{app.label}
            </Link>
          ) : (
            <Link to="/" className="app-name" title={companyName}>
              {companyLogo ? <img className="co-logo" src={companyLogo} alt="" /> : <BrandLogo size={30} />}
              <span className="co-name">{companyName}</span>
            </Link>
          )}
          <nav className="app-tabs hide-sm" aria-label={app ? `${app.label} menu` : undefined}>
            {tabs.map((e) => <NavLink key={e.key} to={`/m/${e.key}`}>{e.plural}</NavLink>)}
          </nav>
          <div className="spacer" />
          {!online && <span className="badge bad" role="status">Offline</span>}
          {store.mode === 'local' && demo && <Link to="/settings" className="badge warn" title="Demo data is loaded — for testing only. Remove it in Settings.">Demo data</Link>}
          {!phone && <Dropdown className="icon-btn" title="Notifications" panelLabel="Notifications" panelClass="dd-notes"
            label={`Notifications${alertCount ? ` (${alertCount} need action)` : ''}`}
            button={<><Icon name="alerts" />{alertCount > 0 && <span className="dot-count">{alertCount > 99 ? '99+' : alertCount}</span>}</>}>
            {() => <>
              <div className="dd-head">
                <strong>Notifications</strong>
                {alerts.length > 0 && <span className="muted small">{alertCount ? `${alertCount} need action · ` : ''}{alerts.length} in all</span>}
              </div>
              <div className="dd-body"><AlertList alerts={alerts} limit={6} /></div>
              {alerts.length > 0 && <Link className="dd-foot" to="/alerts">See all notifications</Link>}
            </>}
          </Dropdown>}
          {!phone && <Dropdown className="user-chip" title={`${user.name} · ${user.email}`} label={`Account menu for ${user.name}`} panelLabel="Account" panelClass="dd-profile"
            button={<><span className="avatar" aria-hidden>{initial}</span><span className="hide-sm">{user.name.split(' ')[0]}</span><span className="chev hide-sm" aria-hidden>▾</span></>}>
            {accountMenu}
          </Dropdown>}
        </div>
        {tabs.length > 1 && (
          <nav className="app-tabs show-sm" aria-label={`${app!.label} menu (mobile)`}>
            {tabs.map((e) => <NavLink key={e.key} to={`/m/${e.key}`}>{e.plural}</NavLink>)}
          </nav>
        )}
      </header>
      <main className="content">
        <SubscriptionBanner />
        {health && (health.blocked || health.damaged.length > 0) && (
          <div className="safety-banner" role="alert">
            <span>⚠ {health.blocked || `Some saved data (${health.damaged.join(', ')}) could not be read. It has been left untouched — nothing will overwrite it.`}</span>
            {!health.blocked && <Link className="btn sm" to="/settings?tab=data">Safety copies</Link>}
          </div>
        )}
        <Outlet />
      </main>
      {bottomBar && (
        <nav className="bottom-nav no-print" aria-label="Main">
          <NavLink to="/" end><Icon name="home" /><span>Home</span></NavLink>
          <NavLink to="/dashboard"><Icon name="dashboard" /><span>Dashboard</span></NavLink>
          <button type="button" onClick={openSearch}><Icon name="search" /><span>Search</span></button>
          <NavLink to="/alerts" aria-label={`Alerts${alertCount ? ` (${alertCount} need action)` : ''}`}>
            <span className="bn-icon"><Icon name="alerts" />{alertCount > 0 && <span className="dot-count">{alertCount > 99 ? '99+' : alertCount}</span>}</span><span>Alerts</span>
          </NavLink>
          <Dropdown className="bn-account" label={`Account menu for ${user.name}`} panelLabel="Account" panelClass="dd-profile dd-up"
            button={<><span className="avatar sm" aria-hidden>{initial}</span><span>Account</span></>}>
            {accountMenu}
          </Dropdown>
        </nav>
      )}
    </div>
  );
}
