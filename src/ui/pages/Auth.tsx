import { useEffect, useState, type FormEvent, type ReactNode } from 'react';
import { BRAND } from '../../config/brand';
import { BrandLogo } from '../components/BrandLogo';
import { MIN_PASSWORD, type AppUser, type Backend } from '../../lib/store';
import { formatMobile, isValidEmail, toMobile } from '../../lib/validate';
import { forgetAccount, knownAccounts, rememberAccount, type KnownAccount } from '../../lib/accounts';
import { errorText } from '../components/feedback';
import { canPayHere, TRIAL_DAYS } from '../../lib/subscription';

type Mode = 'signin' | 'signup' | 'setup' | 'forgot' | 'otp' | 'recover';

/** The company code in an invite link (…#/?join=CODE or …?join=CODE), or ''. */
function inviteCode(): string {
  const h = window.location.hash;
  const q = new URLSearchParams(h.includes('?') ? h.slice(h.indexOf('?') + 1) : '');
  const c = (q.get('join') || new URLSearchParams(window.location.search).get('join') || '').replace(/\s+/g, '').toUpperCase();
  return /^[0-9A-F]{8,12}$/.test(c) ? c : '';
}

function Shell({ children }: { children: ReactNode }) {
  return (
    <div className="auth">
      <div className="card">
        <div className="brand" style={{ justifyContent: 'center' }}><BrandLogo size={34} />{BRAND.name}</div>
        <p className="center muted" style={{ marginTop: 0 }}>{BRAND.tagline}</p>
        {children}
      </div>
    </div>
  );
}

/** Shown once after device-mode setup or recovery: the only way back in if the admin forgets the password. */
export function RecoveryCodePage({ code, onDone }: { code: string; onDone: () => void }) {
  const [ack, setAck] = useState(false);
  return (
    <Shell>
      <h2 className="center">Save your recovery code</h2>
      <p className="muted small">If you forget the admin password, this code is the only way back in on this device. Write it down or save it somewhere safe. It is shown only once.</p>
      <p className="center" style={{ fontSize: '1.4rem', fontWeight: 700, letterSpacing: '.08em', fontFamily: 'ui-monospace, monospace' }} data-testid="recovery-code">{code}</p>
      <label className="check"><input type="checkbox" checked={ack} onChange={(e) => setAck(e.target.checked)} /> I have saved this code</label>
      <button className="btn primary" style={{ width: '100%', marginTop: 12 }} disabled={!ack} onClick={onDone}>Continue</button>
    </Shell>
  );
}

const RESEND_SECONDS = 30;

/** A 10-digit Indian mobile number field. */
function MobileField({ id, value, onChange, label = 'Mobile number', help }: { id: string; value: string; onChange: (v: string) => void; label?: string; help?: ReactNode }) {
  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      <div className="mobile-input">
        <span aria-hidden>+91</span>
        <input id={id} className="input" type="tel" inputMode="numeric" autoComplete="tel-national" placeholder="98765 43210" maxLength={16}
          value={value} onChange={(e) => onChange(e.target.value.replace(/[^\d +-]/g, ''))} aria-describedby={id + '-help'} />
      </div>
      <span className="help" id={id + '-help'}>{help || '10-digit Indian mobile number.'}</span>
    </div>
  );
}

function CodeField({ id, value, onChange }: { id: string; value: string; onChange: (v: string) => void }) {
  return (
    <div className="field">
      <label htmlFor={id}>Code from the SMS</label>
      <input id={id} className="input otp-input" inputMode="numeric" autoComplete="one-time-code" maxLength={8} placeholder="6-digit code"
        value={value} onChange={(e) => onChange(e.target.value.replace(/\D/g, ''))} />
    </div>
  );
}

/** Counts down to when another code may be asked for. */
function useCountdown() {
  const [until, setUntil] = useState(0);
  const [, tick] = useState(0);
  useEffect(() => {
    if (until <= Date.now()) return;
    const t = setInterval(() => { tick((n) => n + 1); if (until <= Date.now()) clearInterval(t); }, 1000);
    return () => clearInterval(t);
  }, [until]);
  return { left: Math.max(0, Math.ceil((until - Date.now()) / 1000)), start: () => setUntil(Date.now() + RESEND_SECONDS * 1000) };
}

export function AuthPage({ backend, needsSetup, initialMode = 'signin', onDone, onRecovery, onBackToLanding }: {
  backend: Backend; needsSetup: boolean; onDone: (u: AppUser, recoveryCode?: string) => void;
  initialMode?: 'signin' | 'signup';
  onBackToLanding?: () => void;
  /** a password-reset SMS code was right: the app now asks for the new password */
  onRecovery?: () => void;
}) {
  const cloud = backend.mode === 'cloud';
  // An invite link from an admin (…#/?join=CODE) opens "Join your company" with the code filled in.
  const invite = cloud ? inviteCode() : '';
  const [mode, setMode] = useState<Mode>(needsSetup ? 'setup' : invite ? 'signup' : initialMode);
  const [name, setName] = useState('');
  const [company, setCompany] = useState('');
  const ownBusiness = backend.mode === 'local' && !!backend.createBusiness;
  // Cloud sign-up: start a new business (free trial) or join one with its company code.
  const [joining, setJoining] = useState(!!invite);
  const [joinCode, setJoinCode] = useState(invite);
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [code, setCode] = useState('');
  const [codeSent, setCodeSent] = useState(false);
  const [error, setError] = useState('');
  const [info, setInfo] = useState('');
  const [busy, setBusy] = useState(false);
  const resend = useCountdown();
  const sms = backend.mode === 'cloud' && backend.phoneOtp;
  // Accounts used on this device: pick one and only type its password.
  const [accounts, setAccounts] = useState<KnownAccount[]>(knownAccounts);
  const [picked, setPicked] = useState<KnownAccount | null>(null);
  const [other, setOther] = useState(false);
  const [remember, setRemember] = useState(true);
  const choosing = mode === 'signin' && accounts.length > 0 && !picked && !other;
  const pick = (a: KnownAccount) => { setPicked(a); setEmail(a.email); setPassword(''); setError(''); setInfo(''); };
  const otherAccount = () => { setPicked(null); setOther(true); setEmail(''); setPassword(''); setError(''); };
  const forget = (a: KnownAccount) => { forgetAccount(a.email); setAccounts(knownAccounts()); };
  const signedIn = (u: AppUser, recoveryCode?: string) => {
    if (remember) rememberAccount(u.email, u.name); else forgetAccount(u.email);
    onDone(u, recoveryCode);
  };

  const go = (m: Mode) => { setMode(m); setError(''); setInfo(''); setPassword(''); setConfirm(''); setCode(''); setCodeSent(false); };
  const device = backend.mode === 'local';
  const forgot = (): Mode => (device ? 'forgot' : sms ? 'otp' : 'forgot');
  // Forgot password: by email, by mobile number, or (device mode only) with the admin's recovery code — three separate ways.
  const [by, setBy] = useState<'email' | 'mobile' | 'code'>('email');
  const chooseBy = (b: 'email' | 'mobile' | 'code') => {
    setBy(b); setError(''); setInfo(''); setEmail(''); setPhone('');
    if (b === 'code') go('recover');
    else go(!device && b === 'mobile' && sms ? 'otp' : 'forgot');
  };
  const resetTab = mode === 'otp' ? 'mobile' : by;
  // An element, not a component made inside render: it keeps keyboard focus as you move between the tabs.
  const resetBy = (
    <div className="seg reset-by" role="group" aria-label="Reset using">
      <button type="button" className={resetTab === 'email' ? 'on' : ''} aria-pressed={resetTab === 'email'} onClick={() => chooseBy('email')}>By email</button>
      {sms && <button type="button" className={resetTab === 'mobile' ? 'on' : ''} aria-pressed={resetTab === 'mobile'} onClick={() => chooseBy('mobile')}>By mobile number</button>}
    </div>
  );

  const sendCode = async () => {
    setError(''); setInfo('');
    if (!toMobile(phone)) return setError('Enter a valid 10-digit Indian mobile number.');
    setBusy(true);
    try {
      await backend.sendResetCode!(phone);
      setCodeSent(true);
      resend.start();
      setInfo(`If ${formatMobile(toMobile(phone))} belongs to an account, a code is on its way by SMS. It is valid for a few minutes.`);
    } catch (x) { setError(errorText(x)); } finally { setBusy(false); }
  };

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError(''); setInfo('');
    if (mode === 'otp') {
      if (!codeSent) return void sendCode();
      if (code.length < 4) return setError('Enter the code from the SMS.');
      setBusy(true);
      try { await backend.verifyResetCode!(phone, code); onRecovery?.(); }
      catch (x) { setError(errorText(x)); } finally { setBusy(false); }
      return;
    }
    const needsName = mode === 'setup' || mode === 'signup';
    const newPassword = mode !== 'signin' && mode !== 'forgot';
    if (needsName && !name.trim()) return setError('Enter your name.');
    if (mode === 'signup' && (ownBusiness || (cloud && !joining)) && !company.trim()) return setError('Enter the business name.');
    if (mode === 'signup' && cloud && joining && !/^[0-9A-F]{8,12}$/i.test(joinCode.replace(/\s+/g, ''))) return setError('Enter the company code from your admin (8 to 12 letters and numbers).');
    if (mode === 'recover') {
      if (!isValidEmail(email) && !toMobile(email)) return setError('Enter the admin’s email or 10-digit mobile number.');
    } else if (!isValidEmail(email)) return setError('Enter a valid email address.');
    if (needsName && !toMobile(phone)) return setError(phone.trim() ? 'Enter a valid 10-digit Indian mobile number.' : 'Enter your mobile number.');
    if (mode === 'recover' && !code.trim()) return setError('Enter your recovery code.');
    if (mode !== 'forgot' && !password) return setError('Enter your password.');
    if (newPassword) {
      if (password.length < MIN_PASSWORD) return setError(`Password must be at least ${MIN_PASSWORD} characters.`);
      if (password !== confirm) return setError('Passwords do not match.');
    }
    setBusy(true);
    try {
      if (mode === 'signin') signedIn(await backend.signIn(email, password));
      else if (mode === 'setup') {
        const r = await backend.setupAdmin(name.trim(), email, password, phone);
        signedIn(r.user, r.recoveryCode);
      } else if (mode === 'signup' && ownBusiness) {
        const r = await backend.createBusiness!(name.trim(), company.trim(), email, password, phone);
        signedIn(r.user, r.recoveryCode);
      } else if (mode === 'signup') {
        const u = await backend.signUp(name.trim(), email, password, phone, cloud ? (joining ? { joinCode } : { businessName: company.trim() }) : undefined);
        if (u) signedIn(u);
        else {
          go('signin');
          setInfo(joining
            ? 'Account created. Open the confirmation link we emailed you (check spam too), then sign in. Your admin then gives you access.'
            : `Your business is set up with a ${TRIAL_DAYS}-day free trial. Open the confirmation link we emailed you (check spam too), then sign in.`);
        }
      } else if (mode === 'forgot') {
        await backend.requestPasswordReset(email);
        go('signin');
        setInfo('If that email has an account, a reset link is on its way. Open it on this device.');
      } else if (mode === 'recover' && backend.recoverWithCode) {
        const r = await backend.recoverWithCode(email, code, password);
        signedIn(r.user, r.recoveryCode);
      }
    } catch (x) {
      setError(errorText(x));
    } finally {
      setBusy(false);
    }
  };

  const titles: Record<Mode, string> = {
    setup: 'Create the admin account', signup: ownBusiness ? 'Create a new business account' : cloud ? (joining ? 'Join your company' : 'Start your free trial') : 'Create account', signin: 'Sign in',
    forgot: 'Reset password by email', otp: 'Forgot password', recover: 'Forgot password',
  };
  const buttons: Record<Mode, string> = {
    setup: 'Create account', signup: 'Create account', signin: 'Sign in', forgot: 'Send reset link',
    otp: codeSent ? 'Verify code' : 'Send code by SMS', recover: 'Set new password',
  };

  if (choosing) return (
    <Shell>
      <h2 className="center">Choose an account</h2>
      {info && <div className="banner info" role="status">{info}</div>}
      <ul className="account-list" aria-label="Accounts on this device">
        {accounts.map((a) => (
          <li key={a.email}>
            <button type="button" className="account-pick" onClick={() => pick(a)} aria-label={`Continue as ${a.name} (${a.email})`}>
              <span className="avatar" aria-hidden>{a.name.trim().charAt(0).toUpperCase() || '?'}</span>
              <span className="account-text"><strong>{a.name}</strong><span className="muted small">{a.email}</span></span>
            </button>
            <button type="button" className="btn ghost sm" aria-label={`Remove ${a.email} from this device`} title="Remove from this device" onClick={() => forget(a)}>✕</button>
          </li>
        ))}
        <li>
          <button type="button" className="account-pick" onClick={otherAccount}>
            <span className="avatar other" aria-hidden>+</span>
            <span className="account-text"><strong>Use another account</strong></span>
          </button>
        </li>
      </ul>
      <p className="muted small center">Only names and emails are kept on this device — never passwords.</p>
      <div className="center small" style={{ display: 'grid', gap: 4 }}>
        <span>{ownBusiness || cloud ? 'New here?' : 'New staff member?'} <button className="btn ghost sm" onClick={() => { setOther(true); go('signup'); }}>Create account</button></span>
        {!cloud && <a href="#/enquiry">Customer enquiry form</a>}
      </div>
    </Shell>
  );

  return (
    <Shell>
      <h2 className="center">{device && mode === 'forgot' ? titles.recover : titles[mode]}</h2>
      {mode === 'signin' && picked && (
        <div className="account-chip">
          <span className="avatar" aria-hidden>{picked.name.trim().charAt(0).toUpperCase() || '?'}</span>
          <span className="account-text"><strong>{picked.name}</strong><span className="muted small">{picked.email}</span></span>
          <button type="button" className="btn ghost sm" onClick={() => { setPicked(null); setOther(false); setPassword(''); setError(''); }}>Switch account</button>
        </div>
      )}
      {mode === 'signup' && cloud && (
        <div className="seg" role="group" aria-label="What would you like to do?" style={{ marginBottom: 10 }}>
          <button type="button" className={!joining ? 'on' : ''} aria-pressed={!joining} onClick={() => { setJoining(false); setError(''); }}>Start my business</button>
          <button type="button" className={joining ? 'on' : ''} aria-pressed={joining} onClick={() => { setJoining(true); setError(''); }}>Join my company</button>
        </div>
      )}
      {mode === 'signup' && cloud && !joining && (
        <p className="small trial-note">
          <strong>Free for {TRIAL_DAYS} days</strong>, with every feature, for you and your whole team. No card needed.
          {canPayHere() && <> After that, plans start at ₹1,000 a month (GST included); the yearly plan works out to ₹625 a month.</>}
          {' '}Already have a company account? Choose “Join my company”.
        </p>
      )}
      {mode === 'signup' && cloud && !sms && (
        <div className="banner warn" role="status">
          Account creation is unavailable until the administrator configures an SMS provider and enables mobile verification. Email and mobile must both be verified before an account can be used.
        </div>
      )}
      {mode === 'signup' && cloud && joining && (
        <p className="muted small">Ask your admin for the <strong>company code</strong> (they find it in Settings → Users &amp; access). After you confirm your email, the admin approves you and gives you a role.</p>
      )}
      {mode === 'signup' && (
        <p className="muted small">
          {cloud ? null : ownBusiness
            ? <>This starts a <strong>separate, empty business</strong> on this device with you as its admin. It does not see any other business’s customers, invoices or users. To join an existing business instead, ask its admin to add you in Settings → Users & access.</>
            : 'After you confirm your email, the admin gives you a role in Settings → Users & access.'}
          {cloud ? '' : ' '}{backend.mode === 'cloud'
            ? <>We email you a link to <strong>confirm your email</strong>{sms ? <>, and text a code to <strong>confirm your mobile number</strong> when you first sign in</> : null}.</>
            : <span className="muted">On this device nothing can be emailed or texted, so the email and mobile number are not verified here; in the online (cloud) version both are confirmed.</span>}
        </p>
      )}
      {mode === 'setup' && <p className="muted small">First-time setup. This account will manage users and settings.{backend.mode === 'local' ? ' Data is stored on this device.' : ''}</p>}
      {(mode === 'otp' || mode === 'forgot') && !device && resetBy}
      {mode === 'forgot' && !device && !sms && <div className="banner warn" role="status">SMS password reset is not configured. You can still reset by email.</div>}
      {mode === 'otp' && <p className="muted small">Enter the mobile number on your account. We send a one-time code by SMS; with it you choose a new password.</p>}
      {mode === 'forgot' && !device && <p className="muted small">Enter the email on your account. We email you a link to choose a new password.</p>}
      {mode === 'forgot' && device && (
        <div className="reset-device">
          <p className="muted small">
            This app runs in device mode: everything stays on this device, so email and SMS password resets are unavailable.
          </p>
          <ul className="small">
            <li><strong>Staff:</strong> ask your admin to set a new password (Settings → Users &amp; access → Edit).</li>
            <li><strong>Admin:</strong> use the recovery code you saved when the account was made.</li>
          </ul>
          <button type="button" className="btn" onClick={() => chooseBy('code')}>Reset with my recovery code</button>
        </div>
      )}
      {mode === 'recover' && (
        <p className="muted small">For the <strong>admin</strong>: the recovery code was shown once when the account was made. It works once; you get a new one afterwards.</p>
      )}
      {error && <div className="banner bad" role="alert">{error}</div>}
      {info && <div className="banner info" role="status">{info}</div>}
      <form onSubmit={submit} noValidate>
        {(mode === 'setup' || mode === 'signup') && <div className="field"><label htmlFor="a-name">Your name</label><input id="a-name" className="input" autoComplete="name" maxLength={120} value={name} onChange={(e) => setName(e.target.value)} /></div>}
        {mode === 'signup' && (ownBusiness || (cloud && !joining)) && <div className="field"><label htmlFor="a-company">Business name</label><input id="a-company" className="input" autoComplete="organization" maxLength={120} placeholder="e.g. Sunrise Solar Solutions" value={company} onChange={(e) => setCompany(e.target.value)} /></div>}
        {mode === 'signup' && cloud && joining && <div className="field"><label htmlFor="a-join">Company code</label><input id="a-join" className="input mono" autoComplete="off" autoCapitalize="characters" spellCheck={false} maxLength={12} placeholder="e.g. 7E2A9D4B1C" value={joinCode} onChange={(e) => setJoinCode(e.target.value.toUpperCase())} /></div>}
        {mode === 'otp' ? <>
          <MobileField id="a-phone" value={phone} onChange={(v) => { setPhone(v); if (codeSent) { setCodeSent(false); setCode(''); } }} />
          {codeSent && <CodeField id="a-otp" value={code} onChange={setCode} />}
        </> : <>
          {mode === 'recover'
            ? <div className="field"><label htmlFor="a-email">Admin email or mobile number</label><input id="a-email" className="input" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="owner@example.com or 98765 43210" /></div>
            : mode === 'forgot' && device ? null
            : mode === 'signin' && picked
              // Hidden, so the browser's own password manager (if the person uses one) still knows which account this is.
              ? <input type="email" name="username" autoComplete="username" value={picked.email} readOnly hidden />
              : <div className="field"><label htmlFor="a-email">Email</label><input id="a-email" className="input" type="email" autoComplete={mode === 'signin' ? 'username' : 'email'} inputMode="email" value={email} onChange={(e) => setEmail(e.target.value)} /></div>}
          {(mode === 'setup' || mode === 'signup') && (
            <MobileField id="a-phone" value={phone} onChange={setPhone}
              help={sms ? 'Required. Used to reset your password by SMS code.' : 'Required. Used to identify your account and contact you.'} />
          )}
          {mode === 'recover' && <div className="field"><label htmlFor="a-code">Recovery code</label><input id="a-code" className="input" autoComplete="off" autoCapitalize="characters" value={code} onChange={(e) => setCode(e.target.value)} /></div>}
          {mode !== 'forgot' && <div className="field"><label htmlFor="a-pass">{mode === 'recover' ? 'New password' : 'Password'}</label><input id="a-pass" className="input" type="password" autoComplete={mode === 'signin' ? 'current-password' : 'new-password'} value={password} onChange={(e) => setPassword(e.target.value)} /></div>}
          {mode !== 'signin' && mode !== 'forgot' && <div className="field"><label htmlFor="a-conf">Confirm password</label><input id="a-conf" className="input" type="password" autoComplete="new-password" value={confirm} onChange={(e) => setConfirm(e.target.value)} /></div>}
          {(mode === 'signin' || mode === 'setup' || mode === 'signup') && (
            <label className="check small"><input type="checkbox" checked={remember} onChange={(e) => setRemember(e.target.checked)} /> Show this account on this device next time (the password is never saved)</label>
          )}
        </>}
        {!(mode === 'forgot' && device) && <button className="btn primary" type="submit" disabled={busy || (mode === 'signup' && cloud && !sms)}>{busy ? 'Please wait…' : buttons[mode]}</button>}
        {mode === 'otp' && codeSent && (
          <button type="button" className="btn ghost sm" style={{ marginTop: 8 }} disabled={busy || resend.left > 0} onClick={() => void sendCode()}>
            {resend.left > 0 ? `Send a new code in ${resend.left}s` : 'Send a new code'}
          </button>
        )}
      </form>
      <div className="center small" style={{ marginTop: 10, display: 'grid', gap: 4 }}>
        {mode === 'signin' && <button className="btn ghost sm" onClick={() => go(forgot())}>Forgot password?</button>}
        {onBackToLanding && mode !== 'setup' && <button className="btn ghost sm" onClick={onBackToLanding}>Back to home</button>}
        {mode === 'otp' && <button className="btn ghost sm" onClick={() => chooseBy('email')}>No access to this mobile? Reset by email</button>}
        {mode === 'forgot' && sms && <button className="btn ghost sm" onClick={() => chooseBy('mobile')}>Reset with an SMS code instead</button>}
        {mode === 'signin' && <span>{ownBusiness || cloud ? 'New here?' : 'New staff member?'} <button className="btn ghost sm" onClick={() => go('signup')}>Create account</button></span>}
        {mode === 'signin' && !picked && accounts.length > 0 && <button className="btn ghost sm" onClick={() => { setOther(false); setError(''); }}>Choose a saved account</button>}
        {(mode === 'signup' || mode === 'forgot' || mode === 'recover' || mode === 'otp') && <button className="btn ghost sm" onClick={() => go('signin')}>Back to sign in</button>}
        {!cloud && <a href="#/enquiry">Customer enquiry form</a>}
      </div>
      <nav className="legal-links" aria-label="Legal">
        <a href="./privacy.html" target="_blank" rel="noreferrer">Privacy</a>
        <a href="./terms.html" target="_blank" rel="noreferrer">Terms</a>
        {cloud && canPayHere() && <a href="./pricing.html" target="_blank" rel="noreferrer">Pricing</a>}
        <a href="./delete-account.html" target="_blank" rel="noreferrer">Delete account</a>
        <a href="./grievance.html" target="_blank" rel="noreferrer">Grievance</a>
      </nav>
    </Shell>
  );
}

/**
 * Adds or changes the signed-in user's mobile number. With SMS codes on, the number is confirmed
 * with a code first; in device mode (or without an SMS provider) it is simply saved.
 */
export function MobileForm({ backend, user, onDone, submitLabel, proof }: { backend: Backend; user: AppUser; onDone: (phone: string) => void; submitLabel?: string; proof?: { password?: string } }) {
  const sms = backend.mode === 'cloud' && backend.phoneOtp;
  const [phone, setPhone] = useState(user.phone ? user.phone.slice(3) : '');
  const [code, setCode] = useState('');
  const [sent, setSent] = useState(false);
  const [error, setError] = useState('');
  const [info, setInfo] = useState('');
  const [busy, setBusy] = useState(false);
  const resend = useCountdown();

  if (backend.mode === 'cloud' && !sms) {
    return <div className="banner warn" role="status">Mobile verification is not configured. Ask the administrator to configure an SMS provider before adding or changing a mobile number.</div>;
  }

  const send = async () => {
    const mobile = toMobile(phone);
    if (!mobile) return setError('Enter a valid 10-digit Indian mobile number.');
    setError(''); setInfo(''); setBusy(true);
    try {
      if (!sms) { await backend.setMyPhone(mobile, proof); onDone(mobile); return; }
      const r = await backend.sendMobileCode!(mobile);
      if (r === 'verified') { onDone(mobile); return; }
      setSent(true); resend.start();
      setInfo(`We sent a code to ${formatMobile(mobile)}.`);
    } catch (x) { setError(errorText(x)); } finally { setBusy(false); }
  };
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (!sent) return void send();
    if (code.length < 4) return setError('Enter the code from the SMS.');
    setError(''); setBusy(true);
    try { await backend.confirmMobileCode!(phone, code); onDone(toMobile(phone)!); }
    catch (x) { setError(errorText(x)); } finally { setBusy(false); }
  };

  return (
    <form onSubmit={submit} noValidate>
      {error && <div className="banner bad" role="alert">{error}</div>}
      {info && <div className="banner info" role="status">{info}</div>}
      <MobileField id="m-phone" value={phone} onChange={(v) => { setPhone(v); setSent(false); setCode(''); }}
        help={sms ? 'We confirm it with a one-time SMS code. It is used to reset your password.' : '10-digit Indian mobile number.'} />
      {sent && <CodeField id="m-otp" value={code} onChange={setCode} />}
      <div className="btn-row">
        <button className="btn primary" type="submit" disabled={busy}>{busy ? 'Please wait…' : sent ? 'Confirm code' : sms ? 'Send code by SMS' : (submitLabel || 'Save mobile number')}</button>
        {sent && <button type="button" className="btn ghost sm" disabled={busy || resend.left > 0} onClick={() => void send()}>{resend.left > 0 ? `New code in ${resend.left}s` : 'Send a new code'}</button>}
      </div>
    </form>
  );
}

/** After sign-in: an account without a (confirmed) mobile number must add one before going on. */
export function MobilePage({ backend, user, onDone, onSignOut }: { backend: Backend; user: AppUser; onDone: () => void; onSignOut: () => void }) {
  const sms = backend.mode === 'cloud' && backend.phoneOtp;
  return (
    <Shell>
      <h2 className="center">{user.phone ? 'Confirm your mobile number' : 'Add your mobile number'}</h2>
      <p className="muted small">
        Hi {user.name}, a mobile number is now required for every account{sms ? ' — it lets you reset your password with an SMS code.' : '.'}
      </p>
      {sms || backend.mode === 'local'
        ? <MobileForm backend={backend} user={user} onDone={() => onDone()} submitLabel="Save and continue" />
        : <div className="banner warn" role="status">Your mobile number cannot be verified yet. Ask the administrator to configure an SMS provider; access will remain blocked until verification is complete.</div>}
      <div className="center small" style={{ marginTop: 10 }}><button className="btn ghost sm" onClick={onSignOut}>Sign out</button></div>
    </Shell>
  );
}

export function SetNewPasswordPage({ backend, onDone }: { backend: Backend; onDone: () => void }) {
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (password.length < MIN_PASSWORD) return setError(`Password must be at least ${MIN_PASSWORD} characters.`);
    if (password !== confirm) return setError('Passwords do not match.');
    setBusy(true);
    try { await backend.setNewPassword(password); onDone(); } catch (x) { setError(errorText(x)); } finally { setBusy(false); }
  };
  return (
    <Shell>
      <h2 className="center">Choose a new password</h2>
      {error && <div className="banner bad" role="alert">{error}</div>}
      <form onSubmit={submit} noValidate>
        <div className="field"><label htmlFor="n-pass">New password</label><input id="n-pass" className="input" type="password" autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} /></div>
        <div className="field"><label htmlFor="n-conf">Confirm new password</label><input id="n-conf" className="input" type="password" autoComplete="new-password" value={confirm} onChange={(e) => setConfirm(e.target.value)} /></div>
        <button className="btn primary" type="submit" disabled={busy}>{busy ? 'Saving…' : 'Save new password'}</button>
      </form>
    </Shell>
  );
}

export function PendingPage({ user, onSignOut }: { user: AppUser; onSignOut: () => void }) {
  return (
    <Shell>
      <h2 className="center">Waiting for approval</h2>
      <p className="muted center">Hi {user.name}, your account was created. An admin needs to give you a role before you can use {BRAND.name}.</p>
      <div className="btn-row" style={{ justifyContent: 'center' }}>
        <button className="btn" onClick={() => location.reload()}>Check again</button>
        <button className="btn" onClick={onSignOut}>Sign out</button>
      </div>
    </Shell>
  );
}
