import { lazy, Suspense, useEffect, useMemo, useState, type ReactNode } from 'react';
import { createHashRouter, Navigate, RouterProvider, useParams, useRouteError } from 'react-router-dom';
import { Store, StoreContext, useStore, type AppUser, type Backend } from '../lib/store';
import { getEntity } from '../modules/registry';
import { canRead } from '../lib/rbac';
import { FeedbackProvider, errorText, useFeedback } from './components/feedback';
import { Layout } from './Layout';
import { ErrorBoundary } from './components/ErrorBoundary';
import { AuthPage, MobilePage, PendingPage, RecoveryCodePage, SetNewPasswordPage } from './pages/Auth';
import { LandingPage } from './pages/Landing';
import { AlertsPage } from './pages/Alerts';
import { Home } from './pages/Home';

// The dashboard carries the India map data, so it loads on first visit instead of with the app.
const Dashboard = lazy(() => import('./pages/DashboardHome').then((m) => ({ default: m.DashboardHome })));
const loading = <div className="muted" role="status">Loading…</div>;
import { EntityList } from './pages/EntityList';
import { EntityForm } from './pages/EntityForm';
import { EntityDetail } from './pages/EntityDetail';
import { PrintDoc } from './pages/PrintDoc';
import { Reports } from './pages/Reports';
import { Settings } from './pages/Settings';
import { EnquiryPage } from './pages/Enquiry';
import { NoAccess, NotFound } from './pages/NotFound';
import { hasUnsavedChanges } from './unsaved';
import { BRAND } from '../config/brand';

/** Blocks a route when the user's role cannot read the module the URL points at. */
function Guard({ children }: { children: ReactNode }) {
  const { entity = '' } = useParams();
  const store = useStore();
  const e = getEntity(entity);
  if (!e) return <NotFound />;
  if (!store.user || !canRead(store.user, e.module)) return <NoAccess />;
  return <>{children}</>;
}

function RouteError() {
  const err = useRouteError();
  return (
    <div className="auth"><div className="card center">
      <h2>Something went wrong on this page</h2>
      <p className="muted">Your saved data is safe.</p>
      <p className="muted small">{errorText(err)}</p>
      <div className="btn-row" style={{ justifyContent: 'center' }}>
        <button className="btn primary" onClick={() => location.reload()}>Reload</button>
        <a className="btn" href="#/" onClick={() => setTimeout(() => location.reload(), 0)}>Go to dashboard</a>
      </div>
    </div></div>
  );
}

/** Shows store warnings (a save worked but a follow-up step did not) as messages. */
function WarningBridge({ store }: { store: Store }) {
  const { toast } = useFeedback();
  useEffect(() => {
    store.onWarning = (m) => toast(m, /could not|failed/i.test(m));
    return () => { store.onWarning = () => {}; };
  }, [store, toast]);
  return null;
}

type Phase =
  | { kind: 'loading' }
  | { kind: 'error'; message: string }
  | { kind: 'auth'; needsSetup: boolean }
  | { kind: 'recovery-code'; user: AppUser; code: string }
  | { kind: 'new-password' }
  | { kind: 'pending'; user: AppUser }
  | { kind: 'mobile'; user: AppUser; fresh: boolean }
  | { kind: 'ready' };

function insecure(): boolean {
  return typeof window !== 'undefined' && window.isSecureContext === false;
}

export function App({ backend, landingPage = false }: { backend: Backend; landingPage?: boolean }) {
  const store = useMemo(() => new Store(backend), [backend]);
  const [phase, setPhase] = useState<Phase>({ kind: 'loading' });
  const [session, setSession] = useState(0);
  const [authEntry, setAuthEntry] = useState<'landing' | 'signin' | 'signup'>(landingPage ? 'landing' : 'signin');
  const [online, setOnline] = useState(() => navigator.onLine);
  const isEnquiry = () => window.location.hash.startsWith('#/enquiry');
  const [enquiry, setEnquiry] = useState(isEnquiry);

  /** `fresh` = an actual sign-in (start on the dashboard); otherwise a reload keeps the current page. */
  const enter = async (user: AppUser, fresh = true) => {
    store.user = user;
    // Every account needs a mobile number (confirmed by SMS code when that is switched on).
    try {
      if ((await backend.mobileStatus(user)) !== 'verified') return setPhase({ kind: 'mobile', user, fresh });
    } catch (e) {
      setPhase({ kind: 'error', message: errorText(e) });
      return;
    }
    if (user.role === 'pending') return setPhase({ kind: 'pending', user });
    setPhase({ kind: 'loading' });
    try {
      await store.load();
      // Every sign-in starts on the dashboard with a fresh router (no previous user's pages).
      if (fresh && !isEnquiry()) window.history.replaceState(null, '', window.location.pathname + window.location.search + '#/');
      setSession((n) => n + 1);
      setPhase({ kind: 'ready' });
    } catch (e) {
      setPhase({ kind: 'error', message: errorText(e) });
    }
  };

  const boot = async () => {
    setPhase({ kind: 'loading' });
    try {
      // Before anything is read: upgrade data saved by an older version (after a safety copy).
      await backend.prepare?.();
      if (await backend.isPasswordRecovery()) return setPhase({ kind: 'new-password' });
      const u = await backend.currentUser();
      if (u) await enter(u, false);
      else setPhase({ kind: 'auth', needsSetup: await backend.needsSetup() });
    } catch (e) {
      setPhase({ kind: 'error', message: errorText(e) });
    }
  };

  useEffect(() => {
    const wentOnline = () => { setOnline(true); void boot(); };
    const wentOffline = () => setOnline(false);
    window.addEventListener('online', wentOnline);
    window.addEventListener('offline', wentOffline);
    if (navigator.onLine) void boot();
    return () => {
      window.removeEventListener('online', wentOnline);
      window.removeEventListener('offline', wentOffline);
    };
  }, []);
  useEffect(() => {
    const h = () => setEnquiry(isEnquiry());
    window.addEventListener('hashchange', h);
    return () => window.removeEventListener('hashchange', h);
  }, []);

  // Live updates from other users (cloud) or other tabs (device).
  useEffect(() => {
    if (phase.kind !== 'ready' || !backend.onRemoteChange) return;
    return backend.onRemoteChange((c) => store.applyRemote(c));
  }, [phase.kind, backend, store]);

  const signOut = async (confirmed = false) => {
    if (!confirmed && hasUnsavedChanges() && !window.confirm('You have unsaved changes. Sign out and discard them?')) return;
    try { await backend.signOut(); } finally {
      store.clear();
      window.history.replaceState(null, '', window.location.pathname + '#/');
      setAuthEntry('signin');
      setPhase({ kind: 'auth', needsSetup: false });
    }
  };

  const router = useMemo(() => createHashRouter([
    { path: '/enquiry', element: <EnquiryPage backend={backend} /> },
    {
      path: '/',
      element: <Layout onSignOut={signOut} />,
      errorElement: <RouteError />,
      children: [
        { index: true, element: <Home /> },
        { path: 'dashboard', element: <Suspense fallback={loading}><Dashboard /></Suspense> },
        { path: 'alerts', element: <AlertsPage /> },
        { path: 'reports', element: <Reports /> },
        { path: 'settings', element: <Settings /> },
        { path: 'm/:entity', element: <Guard><EntityList /></Guard> },
        { path: 'm/:entity/new', element: <Guard><EntityForm /></Guard> },
        { path: 'm/:entity/:id', element: <Guard><EntityDetail /></Guard> },
        { path: 'm/:entity/:id/edit', element: <Guard><EntityForm /></Guard> },
        { path: 'print/:entity/:id', element: <Guard><PrintDoc /></Guard> },
        { path: 'login', element: <Navigate to="/" replace /> },
        { path: '*', element: <NotFound /> },
      ],
    },
  ], {
    future: { v7_relativeSplatPath: true, v7_fetcherPersist: true, v7_normalizeFormMethod: true, v7_partialHydration: true, v7_skipActionErrorRevalidation: true },
  // A new router per sign-in, so history and page state never carry over between users.
  }), [session]);

  let body: ReactNode;
  if (insecure()) body = (
    <div className="auth"><div className="card center">
      <h2>Secure connection needed</h2>
      <p className="muted">Open this app using its <strong>https://</strong> address. Browsers turn off the security features it needs on plain http.</p>
    </div></div>
  );
  else if (!online) body = (
    <div className="auth"><div className="card center">
      <h2>Internet connection required</h2>
      <p className="muted">Connect this device to the internet to use {BRAND.name}. Business data is shared securely through the cloud and is not available offline.</p>
      <button className="btn primary" onClick={() => { if (navigator.onLine) { setOnline(true); void boot(); } }}>Try again</button>
    </div></div>
  );
  else if (enquiry) body = <EnquiryPage backend={backend} />;
  else if (phase.kind === 'loading') body = <div className="auth"><div className="muted" role="status">Loading…</div></div>;
  else if (phase.kind === 'error') body = (
    <div className="auth"><div className="card center">
      <h2>Could not start</h2><p className="muted">{phase.message}</p>
      <button className="btn primary" onClick={() => void boot()}>Try again</button>
    </div></div>
  );
  else if (phase.kind === 'auth' && landingPage && authEntry === 'landing') body = (
    <LandingPage onStart={() => setAuthEntry('signup')} onSignIn={() => setAuthEntry('signin')} />
  );
  else if (phase.kind === 'auth') body = (
    <AuthPage backend={backend} needsSetup={phase.needsSetup} initialMode={authEntry === 'signup' ? 'signup' : 'signin'}
      onBackToLanding={landingPage ? () => setAuthEntry('landing') : undefined}
      onDone={(u, code) => (code ? setPhase({ kind: 'recovery-code', user: u, code }) : void enter(u))}
      onRecovery={() => void boot()} />
  );
  else if (phase.kind === 'recovery-code') body = <RecoveryCodePage code={phase.code} onDone={() => void enter(phase.user)} />;
  else if (phase.kind === 'new-password') body = <SetNewPasswordPage backend={backend} onDone={() => void boot()} />;
  else if (phase.kind === 'mobile') body = (
    <MobilePage backend={backend} user={phase.user} onSignOut={() => void signOut()}
      onDone={() => void backend.currentUser().then((u) => (u ? enter(u, phase.fresh) : boot()))} />
  );
  else if (phase.kind === 'pending') body = <PendingPage user={phase.user} onSignOut={() => void signOut()} />;
  else body = <RouterProvider key={session} router={router} future={{ v7_startTransition: true }} />;

  return (
    <ErrorBoundary>
      <StoreContext.Provider value={store}>
        <FeedbackProvider>
          <WarningBridge store={store} />
          {body}
        </FeedbackProvider>
      </StoreContext.Provider>
    </ErrorBoundary>
  );
}
