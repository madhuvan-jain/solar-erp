import { isNativeApp } from '../nativeSave';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import type { Rec } from '../schema';
import { uid } from '../format';
import { toMobile } from '../validate';
import { AppError, ConflictError, MIN_PASSWORD, type AppUser, type Backend, type DataMap, type FileRef, type MobileStatus, type Numbering, type RemoteChange, type Role, type ReplaceOptions, type SignUpOptions } from './types';
import type { BusinessInfo, PaymentRow, Plan } from '../subscription';

const MAX_FILE_BYTES = 20 * 1024 * 1024;
const PAGE = 1000;

interface Row { id: string; entity: string; data: Record<string, unknown>; created_at: string; updated_at: string; created_by: string | null; version: number }

function toRec(r: Row): Rec {
  return { ...r.data, id: r.id, createdAt: r.created_at, updatedAt: r.updated_at, createdBy: r.created_by ?? undefined, version: r.version } as Rec;
}

function toData(rec: Rec): Record<string, unknown> {
  const { id: _i, createdAt: _c, updatedAt: _u, createdBy: _b, version: _v, ...data } = rec;
  return data;
}

function friendly(e: { message?: string } | null, fallback: string): AppError {
  const m = e?.message || '';
  if (m.startsWith('ERP: ')) return new AppError(m.slice(5));
  if (/Invalid login credentials/i.test(m)) return new AppError('Wrong email or password.');
  if (/Email not confirmed/i.test(m)) return new AppError('Please confirm your email first — check your inbox (and spam folder).');
  if (/already registered/i.test(m)) return new AppError('This email already has an account. Please sign in.');
  // The sign-up trigger refuses a mobile number that another account already has; Supabase hides its message.
  if (/Database error saving new user/i.test(m)) return new AppError('Could not create the account. The mobile number may already be used by another account.');
  if (/phone.*(already|exists|registered)/i.test(m)) return new AppError('This mobile number is already used by another account.');
  if (/unsupported phone provider|phone (signups|logins|provider).*disabled|sms.*(not|disabled)/i.test(m)) return new AppError('SMS is not set up for this app yet. Ask the admin, or use “Reset by email”.');
  if (/token.*(expired|invalid)|otp.*(expired|invalid)|invalid.*otp/i.test(m)) return new AppError('That code is wrong or has expired. Request a new one.');
  if (/rate limit|too many/i.test(m)) return new AppError('Too many attempts. Please wait a few minutes and try again.');
  if (/Failed to fetch|NetworkError|Load failed/i.test(m)) return new AppError('No internet connection. Please try again.');
  if (/row-level security|not allowed|permission/i.test(m)) return new AppError('You do not have permission to do this.');
  if (/JWT|expired/i.test(m)) return new AppError('Your session has expired. Please sign in again.');
  return new AppError(m ? `${fallback}: ${m}` : fallback);
}

/** Per-app access the admin set for a profile, if any. */
function accessOf(row: { access?: unknown }): { access?: AppUser['access'] } {
  const a = row.access;
  return a && typeof a === 'object' && Object.keys(a).length ? { access: a as AppUser['access'] } : {};
}

/** Where email links (confirm sign-up, reset password) send people back to. */
function appUrl(extra = ''): string {
  // Inside the Android app the page lives on the phone, so links in emails must point to the live website.
  const site = import.meta.env.VITE_PUBLIC_URL?.trim().replace(/\/+$/, '');
  if (site && isNativeApp()) return `${site}/${extra}`;
  return `${location.origin}${location.pathname}${extra}`;
}

export class CloudBackend implements Backend {
  mode = 'cloud' as const;
  readonly phoneOtp: boolean;
  private sb: SupabaseClient;
  private recovery: boolean;

  /** `phoneOtp`: an SMS provider is set up in Supabase (Authentication → Providers → Phone), so codes can be sent. */
  constructor(url: string, key: string, opts: { phoneOtp?: boolean } = {}) {
    this.phoneOtp = !!opts.phoneOtp;
    // PKCE puts the one-time code in ?code=… (not in #…), so it never collides with the app's #/routes.
    this.sb = createClient(url, key, { auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true, flowType: 'pkce' } });
    // Only a real reset link (exchanged by supabase-js) counts — not merely "?reset=1" in the address bar.
    this.recovery = false;
    this.sb.auth.onAuthStateChange((event) => { if (event === 'PASSWORD_RECOVERY') this.recovery = true; });
  }

  /** Removes ?code / ?reset / error params from the address bar once supabase-js has used them. */
  private async cleanUrl() {
    await this.sb.auth.getSession();
    const p = new URLSearchParams(location.search);
    if (['code', 'reset', 'error', 'error_code', 'error_description'].some((k) => p.has(k))) {
      history.replaceState(null, '', location.pathname + (location.hash || '#/'));
    }
  }

  async loadAll(): Promise<DataMap> {
    const out: DataMap = {};
    for (let from = 0; ; from += PAGE) {
      const { data, error } = await this.sb.from('records').select('*').order('created_at').order('id').range(from, from + PAGE - 1);
      if (error) throw friendly(error, 'Could not load data');
      for (const r of data as Row[]) (out[r.entity] ||= []).push(toRec(r));
      if (!data || data.length < PAGE) break;
    }
    return out;
  }

  async insert(entity: string, rec: Rec, numbering?: Numbering): Promise<Rec> {
    const data = toData(rec);
    delete data.number;
    if (numbering) Object.assign(data, { _numKey: numbering.key, _numPrefix: numbering.prefix });
    const { data: row, error } = await this.sb.from('records').insert({ id: rec.id, entity, data }).select().single();
    if (error) throw friendly(error, 'Could not save');
    return toRec(row as Row);
  }

  async update(entity: string, rec: Rec, numbering?: Numbering): Promise<Rec> {
    const data0 = toData(rec);
    // The database gives the number (from its counter) when a record without one asks for it.
    if (numbering && !rec.number) Object.assign(data0, { _numKey: numbering.key, _numPrefix: numbering.prefix });
    const { data, error } = await this.sb.from('records')
      .update({ data: data0 })
      .eq('id', rec.id).eq('entity', entity).eq('version', rec.version ?? 1)
      .select().maybeSingle();
    if (error) throw friendly(error, 'Could not save');
    if (!data) {
      const { data: still } = await this.sb.from('records').select('id').eq('id', rec.id).maybeSingle();
      if (still) throw new ConflictError();
      throw new AppError('This record no longer exists. It may have been deleted.');
    }
    return toRec(data as Row);
  }

  async remove(entity: string, id: string): Promise<void> {
    const { error, count } = await this.sb.from('records').delete({ count: 'exact' }).eq('id', id).eq('entity', entity);
    if (error) throw friendly(error, 'Could not delete');
    if (count === 0) {
      const { data: still } = await this.sb.from('records').select('id').eq('id', id).maybeSingle();
      if (still) throw new AppError('Only an admin or manager can delete records.');
    }
  }

  /** Cloud numbering lives in the database and never goes back, so the restore options are not needed here. */
  async replaceAll(data: DataMap, _opts?: ReplaceOptions): Promise<void> {
    // "Created by" goes along, so people with access to their own records only still see theirs after a restore.
    const rows = Object.entries(data).flatMap(([entity, list]) =>
      list.map((r) => ({ id: r.id, entity, data: toData(r), created_at: r.createdAt, updated_at: r.updatedAt, created_by: r.createdBy || null })));
    for (let i = 0; i < rows.length; i += 500) {
      const { error } = await this.sb.rpc('restore_records', { p_rows: rows.slice(i, i + 500) });
      if (error) throw friendly(error, `Restore stopped after ${i} records`);
    }
  }

  private async profile(id: string): Promise<AppUser | null> {
    const { data, error } = await this.sb.from('profiles').select('*').eq('id', id).maybeSingle();
    if (error || !data) return null;
    // Mobile numbers are in their own table that only the person and the admin can read.
    const { data: ph } = await this.sb.from('user_phones').select('phone').eq('id', id).maybeSingle();
    return { id: data.id, name: data.name, email: data.email, role: data.role as Role, active: data.active, ...accessOf(data), ...(ph?.phone ? { phone: ph.phone } : {}) };
  }

  async currentUser(): Promise<AppUser | null> {
    await this.cleanUrl();
    const { data } = await this.sb.auth.getSession();
    const user = data.session?.user;
    const id = user?.id;
    if (!id) return null;
    if (!user.email_confirmed_at) {
      await this.signOut();
      return null;
    }
    const p = await this.profile(id);
    if (!p || !p.active) {
      await this.sb.auth.signOut();
      return null;
    }
    return p;
  }

  async needsSetup(): Promise<boolean> {
    return false;
  }

  async setupAdmin(name: string, email: string, password: string, phone: string) {
    const u = await this.signUp(name, email, password, phone);
    if (!u) throw new AppError('Check your inbox to confirm your email, then sign in.');
    return { user: u };
  }

  async signIn(email: string, password: string): Promise<AppUser> {
    const { data, error } = await this.sb.auth.signInWithPassword({ email: email.trim(), password });
    if (error) throw friendly(error, 'Sign in failed');
    if (!data.user.email_confirmed_at) {
      await this.signOut();
      throw new AppError('Please confirm your email before signing in. Check your inbox and spam folder.');
    }
    const p = await this.profile(data.user.id);
    if (!p) {
      await this.sb.auth.signOut();
      throw new AppError('Your profile is missing. Ask the admin to re-run the database setup.');
    }
    if (!p.active) {
      await this.sb.auth.signOut();
      throw new AppError('This account has been disabled. Contact your administrator.');
    }
    return p;
  }

  async signUp(name: string, email: string, password: string, phone: string, opts: SignUpOptions = {}): Promise<AppUser | null> {
    if (password.length < MIN_PASSWORD) throw new AppError(`Password must be at least ${MIN_PASSWORD} characters.`);
    if (!this.phoneOtp) throw new AppError('Mobile verification is not configured. Ask the administrator to set up SMS verification before creating an account.');
    const mobile = toMobile(phone);
    if (!mobile) throw new AppError('Enter a valid 10-digit Indian mobile number.');
    const join = (opts.joinCode || '').replace(/\s+/g, '').toUpperCase();
    if (opts.joinCode !== undefined && !/^[0-9A-F]{8,12}$/.test(join)) throw new AppError('The company code has 8 to 12 letters and numbers. Ask your admin for it.');
    if (join) {
      // Supabase hides the database's reason when it refuses a sign-up, so the code is checked first.
      const { data: ok, error: ce } = await this.sb.rpc('join_code_ok', { p_code: join });
      if (ce) throw friendly(ce, 'Could not check the company code');
      if (!ok) throw new AppError('No business has this company code. Check the code with your admin.');
    }
    // The database copies the number into user_phones when the account is created, and starts the business or
    // puts the person into the business of the company code (see handle_new_user).
    const meta = { name, phone: mobile, ...(join ? { join_code: join } : { business_name: (opts.businessName || '').trim().slice(0, 120) }) };
    const { data, error } = await this.sb.auth.signUp({
      email: email.trim(), password, options: { data: meta, emailRedirectTo: appUrl() },
    });
    if (error) {
      if (join && /Database error saving new user/i.test(error.message || '')) {
        throw new AppError('Could not create the account. The mobile number may already be used by another account, or the company code was just changed — check both.');
      }
      throw friendly(error, 'Sign up failed');
    }
    // Supabase returns a user with no identities when the email is already registered (to avoid leaking it).
    if (data.user && Array.isArray(data.user.identities) && data.user.identities.length === 0) {
      throw new AppError('This email already has an account. Please sign in, or use “Forgot password”.');
    }
    if (!data.session || !data.user || !data.user.email_confirmed_at) {
      if (data.session) await this.signOut();
      return null;
    }
    return this.profile(data.user.id);
  }

  async signOut(): Promise<void> {
    const { error } = await this.sb.auth.signOut();
    if (error) throw friendly(error, 'Could not sign out');
  }

  async listUsers(): Promise<AppUser[]> {
    const { data, error } = await this.sb.from('profiles').select('*').order('created_at');
    if (error) throw friendly(error, 'Could not load users');
    // Only the admin gets everyone's number back; others only their own.
    const { data: phones } = await this.sb.from('user_phones').select('id, phone');
    const byId = new Map((phones || []).map((p) => [p.id as string, p.phone as string]));
    return (data || []).map((d) => ({ id: d.id, name: d.name, email: d.email, role: d.role as Role, active: d.active, ...accessOf(d), ...(byId.get(d.id) ? { phone: byId.get(d.id) } : {}) }));
  }

  async saveUser(user: AppUser, password?: string): Promise<AppUser> {
    if (password) throw new AppError('In cloud mode, staff create their own account using “Create account”. Then approve them here.');
    const { data, error } = await this.sb.from('profiles')
      .update({ name: user.name.trim(), role: user.role, active: user.active, access: user.role === 'admin' ? {} : user.access || {} })
      .eq('id', user.id).select().maybeSingle();
    if (error) throw friendly(error, 'Could not update user');
    if (!data) throw new AppError('Only an admin can change users.');
    if (user.phone) {
      const { error: pe } = await this.sb.rpc('set_user_phone', { p_id: user.id, p_phone: user.phone });
      if (pe) throw friendly(pe, 'Could not save the mobile number');
    }
    return { id: data.id, name: data.name, email: data.email, role: data.role as Role, active: data.active, ...accessOf(data), ...(user.phone ? { phone: toMobile(user.phone) || user.phone } : {}) };
  }

  async deleteMyAccount(): Promise<void> {
    const { error } = await this.sb.rpc('delete_my_account');
    if (error) throw friendly(error, 'Could not delete the account');
    await this.sb.auth.signOut().catch(() => {});
  }

  async deleteUser(id: string): Promise<void> {
    const { error } = await this.sb.rpc('admin_delete_user', { p_id: id });
    if (error) throw friendly(error, 'Could not delete the user');
  }

  async changePassword(oldPassword: string, newPassword: string): Promise<void> {
    if (newPassword.length < MIN_PASSWORD) throw new AppError(`Password must be at least ${MIN_PASSWORD} characters.`);
    const { data } = await this.sb.auth.getUser();
    const email = data.user?.email;
    if (!email) throw new AppError('Please sign in again.');
    const check = await this.sb.auth.signInWithPassword({ email, password: oldPassword });
    if (check.error) throw new AppError('Current password is wrong.');
    const { error } = await this.sb.auth.updateUser({ password: newPassword });
    if (error) throw friendly(error, 'Could not change password');
  }

  async requestPasswordReset(email: string): Promise<void> {
    const { error } = await this.sb.auth.resetPasswordForEmail(email.trim(), { redirectTo: appUrl('?reset=1') });
    if (error) throw friendly(error, 'Could not send the reset email');
  }

  async isPasswordRecovery(): Promise<boolean> {
    const { data } = await this.sb.auth.getSession(); // waits until supabase-js has processed the link
    return this.recovery && !!data.session;
  }

  async setNewPassword(password: string): Promise<void> {
    if (password.length < MIN_PASSWORD) throw new AppError(`Password must be at least ${MIN_PASSWORD} characters.`);
    const { error } = await this.sb.auth.updateUser({ password });
    if (error) throw friendly(error, 'Could not set the new password');
    this.recovery = false;
  }

  async mobileStatus(user: AppUser): Promise<MobileStatus> {
    if (!user.phone) return 'missing';
    const { data } = await this.sb.auth.getUser();
    const u = data.user;
    // Supabase keeps the login number without "+"; it counts only once confirmed by a code.
    return u?.phone && u.phone_confirmed_at && '+' + u.phone.replace(/^\+/, '') === user.phone ? 'verified' : 'unverified';
  }

  readonly identityCheck = 'email-code' as const;

  /** A one-time code to the signed-in person's email; the database then allows a number change for 15 minutes. */
  async loadPrefs(): Promise<Record<string, unknown>> {
    const { data } = await this.sb.auth.getUser();
    const p = data.user?.user_metadata?.prefs;
    return p && typeof p === 'object' ? p as Record<string, unknown> : {};
  }

  async savePref(key: string, value: unknown): Promise<void> {
    // Kept in the person's own account data (not used for access rights anywhere).
    const prefs = { ...(await this.loadPrefs()), [key]: value };
    const { error } = await this.sb.auth.updateUser({ data: { prefs } });
    if (error) throw friendly(error, 'Could not save your preference');
  }

  async sendEmailCode(): Promise<string> {
    const { data } = await this.sb.auth.getUser();
    const email = data.user?.email;
    if (!email) throw new AppError('Please sign in again.');
    const { error } = await this.sb.auth.signInWithOtp({ email, options: { shouldCreateUser: false } });
    if (error) throw friendly(error, 'Could not send the code');
    const [name, domain] = email.split('@');
    return `${name.slice(0, 2)}${'•'.repeat(Math.max(1, name.length - 2))}@${domain}`;
  }

  async verifyEmailCode(code: string): Promise<void> {
    const { data } = await this.sb.auth.getUser();
    const email = data.user?.email;
    if (!email) throw new AppError('Please sign in again.');
    const { error } = await this.sb.auth.verifyOtp({ email, token: code.replace(/\D/g, ''), type: 'email' });
    if (error) throw friendly(error, 'Could not check the code');
  }

  async setMyPhone(phone: string): Promise<void> {
    if (!this.phoneOtp) throw new AppError('Mobile verification is not configured. Ask the administrator to set up SMS verification before changing your number.');
    const { data } = await this.sb.auth.getUser();
    if (!data.user) throw new AppError('Please sign in again.');
    const { error } = await this.sb.rpc('set_user_phone', { p_id: data.user.id, p_phone: phone });
    if (error) throw friendly(error, 'Could not save the mobile number');
  }

  async sendMobileCode(phone: string): Promise<'sent' | 'verified'> {
    const mobile = toMobile(phone);
    if (!mobile) throw new AppError('Enter a valid 10-digit Indian mobile number.');
    const { data } = await this.sb.auth.getUser();
    const u = data.user;
    // Already this login's confirmed number (e.g. it was used to reset the password): nothing to send.
    if (u?.phone && u.phone_confirmed_at && '+' + u.phone.replace(/^\+/, '') === mobile) {
      await this.setMyPhone(mobile);
      return 'verified';
    }
    const { error } = await this.sb.auth.updateUser({ phone: mobile });
    if (error) throw friendly(error, 'Could not send the code');
    return 'sent';
  }

  async confirmMobileCode(phone: string, code: string): Promise<void> {
    const mobile = toMobile(phone);
    if (!mobile) throw new AppError('Enter a valid 10-digit Indian mobile number.');
    const { error } = await this.sb.auth.verifyOtp({ phone: mobile, token: code.replace(/\D/g, ''), type: 'phone_change' });
    if (error) throw friendly(error, 'Could not check the code');
    await this.setMyPhone(mobile);
  }

  async sendResetCode(phone: string): Promise<void> {
    const mobile = toMobile(phone);
    if (!mobile) throw new AppError('Enter a valid 10-digit Indian mobile number.');
    const { error } = await this.sb.auth.signInWithOtp({ phone: mobile, options: { shouldCreateUser: false } });
    // An unknown number must look the same as a known one, so nobody can test which numbers have accounts.
    if (error && !/signups not allowed|user not found|not registered/i.test(error.message || '')) throw friendly(error, 'Could not send the code');
  }

  async verifyResetCode(phone: string, code: string): Promise<void> {
    const mobile = toMobile(phone);
    if (!mobile) throw new AppError('Enter a valid 10-digit Indian mobile number.');
    const { data, error } = await this.sb.auth.verifyOtp({ phone: mobile, token: code.replace(/\D/g, ''), type: 'sms' });
    if (error || !data.session) throw error ? friendly(error, 'Could not check the code') : new AppError('That code is wrong or has expired. Request a new one.');
    this.recovery = true;
  }

  async uploadFile(file: File): Promise<FileRef> {
    if (file.size > MAX_FILE_BYTES) throw new AppError('Files must be under 20 MB.');
    const safe = file.name.replace(/[^\w.\-]+/g, '_').slice(-80) || 'file';
    // Into the uploader's own folder ("<user id>/…"): the storage rules allow nothing else.
    const { data: sess } = await this.sb.auth.getSession();
    const me = sess.session?.user.id;
    if (!me) throw new AppError('Please sign in again.');
    const path = `${me}/${new Date().toISOString().slice(0, 7)}/${uid()}-${safe}`;
    const { error } = await this.sb.storage.from('files').upload(path, file, { contentType: file.type || 'application/octet-stream' });
    if (error) throw friendly(error, 'Upload failed');
    return { name: file.name.slice(0, 200), size: file.size, type: file.type, path };
  }

  async fileUrl(ref: FileRef): Promise<string> {
    // Embedded data could be crafted by another user through the API, so cloud mode only serves stored files.
    if (!ref?.path || typeof ref.path !== 'string') return '';
    const { data, error } = await this.sb.storage.from('files').createSignedUrl(ref.path, 600);
    if (error) throw friendly(error, 'Could not open file');
    return data.signedUrl;
  }

  async removeFile(ref: FileRef): Promise<void> {
    if (!ref?.path || typeof ref.path !== 'string') return;
    const { error } = await this.sb.storage.from('files').remove([ref.path]);
    if (error) throw friendly(error, 'Could not delete the file');
  }

  async submitEnquiry(v: { name: string; phone: string; email: string; city: string; message: string; website?: string }, business: string) {
    const { error } = await this.sb.rpc('web_enquiry', {
      p_name: v.name, p_phone: v.phone, p_email: v.email, p_city: v.city, p_message: v.message, p_website: v.website || '', p_business: business || null,
    });
    if (error) throw friendly(error, 'Could not send enquiry');
  }

  /** The name of the business an enquiry link is for ('' if the link is wrong or the business is not active). */
  async enquiryBusinessName(business: string): Promise<string> {
    const { data } = await this.sb.rpc('enquiry_business_name', { p_business: business });
    return typeof data === 'string' ? data : '';
  }

  // ------------------------------------------------------------------------------ subscription ---
  async businessInfo(): Promise<BusinessInfo | null> {
    const { data, error } = await this.sb.rpc('my_business_info');
    if (error) throw friendly(error, 'Could not read the subscription');
    const info = (data as BusinessInfo) || null;
    this.businessId = info?.id || null;
    return info;
  }

  /** Known after businessInfo(): live updates then ask only for this business's changes. */
  private businessId: string | null = null;

  async plans(): Promise<Plan[]> {
    const { data, error } = await this.sb.from('plans').select('id, months, amount_paise, label').order('sort');
    if (error) throw friendly(error, 'Could not load the plans');
    return (data || []).map((p) => ({ id: p.id, months: p.months, amountPaise: p.amount_paise, label: p.label }));
  }

  async payments(): Promise<PaymentRow[]> {
    const { data, error } = await this.sb.from('subscription_payments').select('*').order('created_at', { ascending: false }).limit(50);
    if (error) throw friendly(error, 'Could not load the payments');
    return (data || []).map((r) => ({
      orderId: r.order_id, plan: r.plan, amountPaise: r.amount_paise, status: r.status, createdAt: r.created_at, paidAt: r.paid_at,
      periodStart: r.period_start, periodEnd: r.period_end, paymentId: r.payment_id,
    }));
  }

  async regenerateJoinCode(): Promise<string> {
    const { data, error } = await this.sb.rpc('regenerate_join_code');
    if (error) throw friendly(error, 'Could not change the company code');
    return String(data);
  }

  /** Calls one of the payment server's functions (supabase/functions) with the signed-in person's login. */
  private async payServer<T>(fn: string, body: Record<string, unknown>): Promise<T> {
    const { data, error } = await this.sb.functions.invoke(fn, { body });
    if (error) {
      // The function's own message (e.g. "Choose a plan.") is in the reply body.
      const ctx = (error as { context?: Response }).context;
      let msg = '';
      try { msg = ctx ? ((await ctx.json()) as { error?: string }).error || '' : ''; } catch { /* not JSON */ }
      if (!msg && /Failed to send|fetch/i.test(error.message)) msg = 'Online payment is not available right now. Please try again later, or contact us.';
      throw new AppError(msg || 'The payment could not be started. Please try again.');
    }
    return data as T;
  }

  createOrder(plan: string) {
    return this.payServer<{ orderId: string; amount: number; keyId: string; label: string }>('create-order', { plan });
  }

  verifyPayment(r: { orderId: string; paymentId: string; signature: string }) {
    return this.payServer<{ paidUntil: string }>('verify-payment', r);
  }

  onRemoteChange(cb: (c: RemoteChange) => void): () => void {
    const handle = (p: { eventType: string; new: unknown; old: unknown }) => {
      if (p.eventType === 'DELETE') {
        const id = (p.old as { id?: string }).id;
        if (id) cb({ kind: 'delete', id });
      } else {
        const row = p.new as Row;
        if (row?.id && row.entity) cb({ kind: 'upsert', entity: row.entity, rec: toRec(row) });
      }
    };
    // New and changed records: only this business's (the database's read rules apply on top). Deleted records
    // cannot be filtered by Supabase; their events carry only an id, and ids from elsewhere match nothing here.
    const mine = this.businessId ? { filter: `business_id=eq.${this.businessId}` } : {};
    const ch = this.sb.channel('records-changes')
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'records', ...mine }, handle)
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'records', ...mine }, handle)
      .on('postgres_changes', { event: 'DELETE', schema: 'public', table: 'records' }, handle)
      .subscribe((status) => {
        // After a dropped connection, changes may have been missed: fetch everything once.
        if (status === 'SUBSCRIBED') cb({ kind: 'reload' });
      });
    return () => { void this.sb.removeChannel(ch); };
  }
}
