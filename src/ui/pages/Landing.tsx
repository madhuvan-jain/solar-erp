import { useEffect, useState } from 'react';
import { BRAND } from '../../config/brand';
import { BrandLogo } from '../components/BrandLogo';

export function LandingPage({ onStart, onSignIn, notice }: { onStart: () => void; onSignIn: () => void; notice?: string }) {
  return (
    <main className="landing">
      <header className="landing-nav">
        <a className="landing-brand" href="#/" aria-label={`${BRAND.name} home`}>
          <BrandLogo size={36} />
          <span>{BRAND.name}</span>
        </a>
        <button className="btn" type="button" onClick={onSignIn}>Sign in</button>
      </header>

      <section className="landing-hero">
        <div className="landing-copy">
          <span className="landing-eyebrow">Solar business, end to end</span>
          <h1>Run your solar business from first lead to final payment.</h1>
          <p>Keep your team, projects, stock, customer documents and accounts connected in one simple workspace.</p>
          <div className="landing-actions">
            <button className="btn primary landing-cta" type="button" onClick={onStart}>Start your free trial now</button>
            <span className="muted small">15 days free · No card needed</span>
          </div>
          {notice && <div className="banner warn landing-notice" role="status">{notice}</div>}
        </div>
        <div className="landing-orbit" aria-hidden="true">
          <div className="landing-sun" />
          <div className="landing-panel panel-one" />
          <div className="landing-panel panel-two" />
          <div className="landing-panel panel-three" />
        </div>
      </section>

      <section className="landing-features" aria-label="What you can manage">
        <article><span>01</span><h2>Find and win work</h2><p>Track leads, surveys, quotations and customer follow-ups.</p></article>
        <article><span>02</span><h2>Deliver projects</h2><p>Coordinate installations, inventory, vendors and service visits.</p></article>
        <article><span>03</span><h2>Stay in control</h2><p>Manage invoices, payments, documents and business reports.</p></article>
      </section>

      <footer className="landing-footer">
        <span>{BRAND.name} · Built for solar teams</span>
        <span className="landing-links">
          <a href="./privacy.html" target="_blank" rel="noreferrer">Privacy</a>
          <a href="./terms.html" target="_blank" rel="noreferrer">Terms</a>
          <a href="./grievance.html" target="_blank" rel="noreferrer">Contact</a>
        </span>
      </footer>
    </main>
  );
}

export function CloudSetupRequired() {
  const [online, setOnline] = useState(() => navigator.onLine);
  const [notice, setNotice] = useState('');
  useEffect(() => {
    const wentOnline = () => setOnline(true);
    const wentOffline = () => setOnline(false);
    window.addEventListener('online', wentOnline);
    window.addEventListener('offline', wentOffline);
    return () => {
      window.removeEventListener('online', wentOnline);
      window.removeEventListener('offline', wentOffline);
    };
  }, []);

  if (!online) {
    return (
      <main className="auth"><section className="card center cloud-required">
        <h1>Internet connection required</h1>
        <p className="muted">Connect to the internet to use {BRAND.name}. Business data is only available from the shared cloud.</p>
      </section></main>
    );
  }

  return (
    <LandingPage
      onStart={() => setNotice('Online sign-up is not set up yet. The website administrator must connect the shared cloud database and enable account verification before anyone can sign up.')}
      onSignIn={() => setNotice('Online sign-in is not set up yet. The website administrator must connect the shared cloud database before accounts can be used.')}
      notice={notice}
    />
  );
}
