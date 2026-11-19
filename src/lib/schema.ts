export type FieldType =
  | 'text'
  | 'textarea'
  | 'email'
  | 'phone'
  | 'number'
  | 'money'
  | 'percent'
  | 'date'
  | 'datetime'
  | 'time'
  | 'select'
  | 'ref'
  | 'user'
  | 'bool'
  | 'gstin'
  | 'pan'
  | 'items'
  | 'file'
  | 'checklist'
  | 'pincode';

export interface Field {
  key: string;
  label: string;
  type: FieldType;
  required?: boolean;
  options?: string[];
  /** entity key for `ref` fields */
  ref?: string;
  min?: number;
  max?: number;
  /** decimals shown for a number (default 3), e.g. 6 for map coordinates */
  decimals?: number;
  /** a per-unit rate (e.g. a product's price): never added up in totals */
  noTotal?: boolean;
  maxLength?: number;
  /** whole numbers only */
  integer?: boolean;
  /** shown in list table */
  list?: boolean;
  /** checklist item labels */
  items?: string[];
  default?: unknown;
  help?: string;
  /** stored but never shown in forms (set by the app itself) */
  hidden?: boolean;
}

export interface Entity {
  key: string;
  label: string;
  plural: string;
  module: string;
  /** field used as the display name of a record */
  title: string;
  fields: Field[];
  /** select field that drives the pipeline / kanban board */
  statusField?: string;
  /** fields used for duplicate detection */
  dedupe?: string[];
  /** document-number prefix, e.g. INV */
  numberPrefix?: string;
  /** number restarts every financial year, based on this date field (GST invoice series) */
  fyNumberField?: string;
  /** records that must never be deleted, only cancelled */
  noDelete?: boolean;
  printable?: boolean;
  /** date field used by the calendar view (defaults to the first listed date field) */
  calendarField?: string;
  /**
   * Fields of the small "create new" popup offered from other forms' pickers (customer from a
   * quotation, product from an invoice line…). Master data only; required fields are always shown.
   */
  quickCreate?: string[];
  /** extra computed values shown in list and detail */
  computed?: { key: string; label: string; type: 'money' | 'number' | 'text' }[];
}

export interface Rec {
  id: string;
  createdAt: string;
  updatedAt: string;
  createdBy?: string;
  number?: string;
  /** optimistic-concurrency version, bumped on every save */
  version?: number;
  [key: string]: unknown;
}

export interface LineItem {
  productId?: string;
  description: string;
  hsn?: string;
  qty: number;
  unit?: string;
  rate: number;
  /** per-line discount, 0–100 */
  discountPct?: number;
  gstRate: number;
}

export interface ModuleDef {
  key: string;
  label: string;
  icon: string;
  /** tile colour on the home screen */
  color: string;
  /** one-line description on the home screen */
  desc: string;
  entities: string[];
}
