import type { CopyReason, SafetyCopyInfo } from './safety';
import type { Rec } from '../schema';
import type { BusinessInfo, PaymentRow, Plan } from '../subscription';

export type Role = 'admin' | 'manager' | 'sales' | 'technician' | 'accounts' | 'pending';

export interface AppUser {
  id: string;
  name: string;
  email: string;
  role: Role;
  active: boolean;
  /** mobile number, +91XXXXXXXXXX; required for every new account (older accounts are asked for it at sign-in) */
  phone?: string;
  /** per-app access the admin changed from the role's preset (see src/lib/rbac.ts) */
  access?: Partial<Record<string, 'none' | 'read' | 'own' | 'all' | 'manager'>>;
}

export type MobileStatus = 'missing' | 'unverified' | 'verified';

export interface FileRef {
  name: string;
  size: number;
  type: string;
  /** data: URL (device mode) */
  dataUrl?: string;
  /** storage path (cloud mode) */
  path?: string;
  /** id in this device's file store (device mode, newer versions) */
  local?: string;
  /** a photo taken with the app's camera: where and when */
  geo?: { lat: number; lng: number; accuracy?: number; at: string; place?: string };
}

export type DataMap = Record<string, Rec[]>;

/** Counter `key` (e.g. "invoices:26-27") and the text placed before the sequence number. */
export interface Numbering { key: string; prefix: string }

export type RemoteChange =
  | { kind: 'upsert'; entity: string; rec: Rec }
  | { kind: 'delete'; id: string }
  | { kind: 'reload' };

/** How a restore treats document numbering: counters from a backup, and whether today's counters are kept (they are,
 *  except when demo data goes in or out). Numbers never go back otherwise. */
export interface ReplaceOptions { counters?: Record<string, number>; keepCounters?: boolean }

export interface Backend {
  mode: 'local' | 'cloud';
  loadAll(): Promise<DataMap>;
  /** Inserts and, when `numbering` is given, assigns `number` atomically with the insert. */
  insert(entity: string, rec: Rec, numbering?: Numbering): Promise<Rec>;
  /** `rec.version` must be the version that was read; throws ConflictError if someone saved in between. */
  /** `numbering`: give the record its document number now, if it has none yet (an invoice being issued). */
  update(entity: string, rec: Rec, numbering?: Numbering): Promise<Rec>;
  remove(entity: string, id: string): Promise<void>;
  replaceAll(data: DataMap, opts?: ReplaceOptions): Promise<void>;
  /** Document counters (device mode), saved in backups so numbers are never issued twice after a restore. */
  counters?(): Record<string, number>;

  currentUser(): Promise<AppUser | null>;
  needsSetup(): Promise<boolean>;
  setupAdmin(name: string, email: string, password: string, phone: string): Promise<{ user: AppUser; recoveryCode?: string }>;
  signIn(email: string, password: string): Promise<AppUser>;
  /** Cloud: `join` (a company code) waits for that business's admin; otherwise a new business with a free trial. */
  signUp(name: string, email: string, password: string, phone: string, opts?: SignUpOptions): Promise<AppUser | null>;
  /** Device mode: "Create account" makes a separate, empty business with this person as its admin. */
  createBusiness?(name: string, company: string, email: string, password: string, phone: string): Promise<{ user: AppUser; recoveryCode?: string }>;
  signOut(): Promise<void>;
  listUsers(): Promise<AppUser[]>;
  saveUser(user: AppUser, password?: string): Promise<AppUser>;
  /** Removes the signed-in user's own login and profile (records they created are kept). */
  deleteMyAccount(): Promise<void>;
  /** Admin only: removes another user's login and profile. */
  deleteUser(id: string): Promise<void>;
  changePassword(oldPassword: string, newPassword: string): Promise<void>;
  requestPasswordReset(email: string): Promise<void>;
  /** True when the app was opened from a password-reset email link. */
  isPasswordRecovery(): Promise<boolean>;
  setNewPassword(password: string): Promise<void>;
  /** Device mode: the admin gets back in with the code shown at setup. `who` is their email or mobile number. */
  recoverWithCode?(who: string, code: string, newPassword: string): Promise<{ user: AppUser; recoveryCode: string }>;

  /** Saves the signed-in user's own mobile number (with SMS OTP on, only after it was verified). */
  setMyPhone(phone: string, proof?: { password?: string }): Promise<void>;
  /**
   * How someone proves it is really them before changing a mobile number they already have:
   * a code sent to their email (cloud), or their current password (device mode, which cannot send email).
   */
  readonly identityCheck: 'email-code' | 'password';
  /** Cloud: emails a one-time code to the signed-in person; returns the address it went to (partly hidden). */
  /** Device mode: upgrade stored data for this app version and take the daily safety copy (run before anything else). */
  prepare?(): Promise<void>;
  /** Device mode: data from a newer app (read-only) or lists that could not be read. */
  health?(): { blocked: string | null; damaged: string[] };
  listSafetyCopies?(): Promise<SafetyCopyInfo[]>;
  makeSafetyCopy?(reason?: CopyReason): Promise<SafetyCopyInfo>;
  restoreSafetyCopy?(id: string, opts?: { keepCounters?: boolean }): Promise<void>;
  /** Small personal preferences kept with the account, so they follow the person to every device (cloud mode). */
  loadPrefs?(): Promise<Record<string, unknown>>;
  savePref?(key: string, value: unknown): Promise<void>;
  sendEmailCode?(): Promise<string>;
  verifyEmailCode?(code: string): Promise<void>;
  /** True when password reset and number checks go by SMS one-time code (cloud mode with an SMS provider set up). */
  readonly phoneOtp: boolean;
  /** Whether the signed-in user's number is saved and, with SMS OTP on, verified. */
  mobileStatus(user: AppUser): Promise<MobileStatus>;
  /** SMS OTP: sends a code to this number, which then becomes the user's number once confirmed. */
  sendMobileCode?(phone: string): Promise<'sent' | 'verified'>;
  confirmMobileCode?(phone: string, code: string): Promise<void>;
  /** SMS OTP: forgot password. Never says whether the number has an account. */
  sendResetCode?(phone: string): Promise<void>;
  /** SMS OTP: a right code signs the user in for choosing a new password (isPasswordRecovery() becomes true). */
  verifyResetCode?(phone: string, code: string): Promise<void>;

  uploadFile(file: File): Promise<FileRef>;
  fileUrl(ref: FileRef): Promise<string>;
  /** Deletes a stored file (cloud mode). Device-mode files live inside the record, so there is nothing extra to delete. */
  removeFile?(ref: FileRef): Promise<void>;
  /** Device mode: the attached files themselves, for backups (id → data: URL) and restoring them. */
  exportFiles?(refs: FileRef[]): Promise<Record<string, string>>;
  importFiles?(files: Record<string, string>): Promise<number>;
  onRemoteChange?(cb: (c: RemoteChange) => void): () => void;

  // Cloud mode: the business and its subscription (decided by the database; shown by the app).
  businessInfo?(): Promise<BusinessInfo | null>;
  plans?(): Promise<Plan[]>;
  payments?(): Promise<PaymentRow[]>;
  regenerateJoinCode?(): Promise<string>;
  /** The payment server makes a Razorpay order for the plan's price (from the database). */
  createOrder?(plan: string): Promise<{ orderId: string; amount: number; keyId: string; label: string }>;
  /** The payment server checks Razorpay's signature and the payment, then extends the subscription. */
  verifyPayment?(r: { orderId: string; paymentId: string; signature: string }): Promise<{ paidUntil: string }>;
}

export interface SignUpOptions { businessName?: string; joinCode?: string }

export class AppError extends Error {}

export class ConflictError extends AppError {
  constructor() {
    super('Someone else saved this record while you were editing. Their version has been loaded — check it, then save again to overwrite.');
  }
}

export const MIN_PASSWORD = 8;
