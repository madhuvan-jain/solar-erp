-- ============================================================================
-- Database setup. Run once in Supabase: Dashboard → SQL Editor → New query →
-- paste this whole file → Run. Safe to re-run (it updates rules in place).
--
-- Many businesses, one database: every solar company that signs up is a business of its own, with a 15-day free
-- trial, then a paid subscription (plans below). Each business sees only its own people, records, numbers and
-- files; when its trial or paid period is over it can still read and export everything, but change nothing.
-- That is enforced HERE, in the database: no change to the website or the app can get around it.
--
-- Whoever signs up without a company code starts a business and is its admin; staff join with the company code.
-- ============================================================================
create table if not exists public.app_config (id int primary key default 1 check (id = 1), owner_email text not null default '');
alter table public.app_config alter column owner_email set default ''; -- (no longer used: was the single owner's email)
-- A random secret per database, so hashed enquiry addresses cannot be reversed by trying every IP.
alter table public.app_config add column if not exists enquiry_salt text not null default md5(random()::text || clock_timestamp()::text);
insert into public.app_config (id) values (1) on conflict (id) do nothing;
-- Once SMS codes work (Supabase → Authentication → Providers → Phone, and VITE_PHONE_OTP=1 for the app), switch on:
--   update public.app_config set trial_needs_sms = true;
-- A free trial then needs the owner's mobile number confirmed by an SMS code, so made-up numbers get no trial.
alter table public.app_config add column if not exists trial_needs_sms boolean not null default false;

create table if not exists public.profiles (
  id uuid primary key references auth.users on delete cascade,
  name text not null default '',
  email text not null default '',
  role text not null default 'pending'
    check (role in ('admin','manager','sales','technician','accounts','pending')),
  active boolean not null default true,
  created_at timestamptz not null default now()
);
-- Per-app access the admin changed from the role's preset, e.g. {"crm": "own", "finance": "none"} (see my_level).
alter table public.profiles add column if not exists access jsonb not null default '{}';

-- Mobile numbers, one per account and never shared by two. Kept apart from profiles so that only
-- the person and the admin can read them (colleagues see names and emails only).
create table if not exists public.user_phones (
  id uuid primary key references public.profiles on delete cascade,
  phone text not null unique check (phone ~ '^\+91[6-9][0-9]{9}$')
);

create table if not exists public.records (
  id uuid primary key,
  entity text not null check (char_length(entity) <= 40),
  data jsonb not null check (jsonb_typeof(data) = 'object'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references auth.users on delete set null,
  version integer not null default 1
);
alter table public.records add column if not exists version integer not null default 1;
create index if not exists records_entity_idx on public.records (entity);
create index if not exists records_data_idx on public.records using gin (data jsonb_path_ops);

create table if not exists public.enquiry_log (ip text not null, at timestamptz not null default now());
create index if not exists enquiry_log_idx on public.enquiry_log (ip, at);

create table if not exists public.counters (
  entity text primary key,
  value integer not null default 0
);

-- ---------------------------------------------------------- businesses ---
-- The first person to sign up without a company code owns a new business (admin) with a 15-day free trial.
-- Colleagues sign up with the company code and wait for the admin's approval.
create table if not exists public.businesses (
  id uuid primary key default gen_random_uuid(),
  name text not null default '' check (char_length(name) <= 120),
  owner_id uuid references auth.users on delete set null,
  join_code text not null unique default upper(substr(md5(gen_random_uuid()::text), 1, 8)),
  trial_ends timestamptz not null default now() + interval '15 days',
  paid_until timestamptz,
  plan text,
  created_at timestamptz not null default now()
);
alter table public.profiles add column if not exists business_id uuid references public.businesses on delete cascade;
alter table public.records add column if not exists business_id uuid references public.businesses on delete cascade;
create index if not exists records_business_idx on public.records (business_id, entity);
create index if not exists profiles_business_idx on public.profiles (business_id);
alter table public.businesses alter column join_code set default upper(substr(md5(gen_random_uuid()::text), 1, 10));
-- Set when the email or mobile number had a free trial before: this business starts without one.
alter table public.businesses add column if not exists trial_refused boolean not null default false;

-- One free trial per email and per mobile number. Kept as salted one-way hashes (never the address or number),
-- and kept when a business or a login is deleted, so deleting everything and signing up again starts no new
-- trial. Only the database itself reads it.
create table if not exists public.trial_claims (
  key text primary key,
  business_id uuid,               -- (no link to businesses: kept after the business is deleted)
  claimed_at timestamptz not null default now()
);

-- The business each login joined (it never changes), kept after the login is deleted, so the files a former
-- staff member uploaded still belong to that business, and only to it.
create table if not exists public.user_business (
  user_id uuid primary key,
  business_id uuid not null,
  added_at timestamptz not null default now()
);

-- Company-code checks from the sign-up screen, per connection (hashed, kept a day): stops guessing codes.
create table if not exists public.code_check_log (ip text not null, at timestamptz not null default now());

-- Subscription plans (prices in paise, GST included). The app and the payment server read them from this table.
-- These lines only add missing plans: to change a price later, use an UPDATE (GO-LIVE-STEPS.md, section 12).
create table if not exists public.plans (
  id text primary key,
  months integer not null check (months between 1 and 36),
  amount_paise integer not null check (amount_paise >= 100),
  label text not null,
  sort integer not null default 0,
  active boolean not null default true
);
insert into public.plans (id, months, amount_paise, label, sort) values
  ('1m', 1, 100000, '1 month', 1), ('3m', 3, 250000, '3 months', 2), ('6m', 6, 450000, '6 months', 3), ('12m', 12, 750000, '12 months', 4)
  on conflict (id) do nothing;

-- Payments for subscriptions (Razorpay). Written only by the payment server (service role), never by the app.
create table if not exists public.subscription_payments (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses on delete cascade,
  plan text not null references public.plans,
  amount_paise integer not null,
  order_id text not null unique,
  payment_id text unique,
  status text not null default 'created' check (status in ('created', 'paid', 'failed')),
  period_start timestamptz,
  period_end timestamptz,
  created_by uuid references auth.users on delete set null,
  created_at timestamptz not null default now(),
  paid_at timestamptz
);
-- Payments stay (your record of money received) when a business is deleted; they keep its name and the plan's length.
alter table public.subscription_payments add column if not exists business_name text not null default '';
alter table public.subscription_payments add column if not exists months integer;
alter table public.subscription_payments alter column business_id drop not null;
alter table public.subscription_payments drop constraint if exists subscription_payments_business_id_fkey;
alter table public.subscription_payments add constraint subscription_payments_business_id_fkey
  foreign key (business_id) references public.businesses on delete set null;
create index if not exists subscription_payments_business_idx on public.subscription_payments (business_id, created_at);

-- ---------------------------------------------------------------- helpers ---
create or replace function public.num(p text) returns numeric
language plpgsql immutable as $$
begin
  -- Only real numbers: "NaN" or "Infinity" would quietly switch off every check that compares with them.
  if p is null or btrim(p) !~ '^-?[0-9]+(\.[0-9]+)?([eE][-+]?[0-9]+)?$' then return null; end if;
  return btrim(p)::numeric;
exception when others then
  return null;
end $$;

-- Financial year (April–March) of a date, as in document numbers: '2026-11-12' → '26-27'.
create or replace function public.fy_of(p_date text) returns text
language plpgsql immutable as $$
declare y integer;
begin
  if p_date is null or p_date !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}' then return null; end if;
  y := substr(p_date, 1, 4)::integer;
  if substr(p_date, 6, 2)::integer < 4 then y := y - 1; end if;
  return lpad((y % 100)::text, 2, '0') || '-' || lpad(((y + 1) % 100)::text, 2, '0');
end $$;

-- Each numbered record type's letters, and the date field whose financial year starts a new series.
create or replace function public.num_letters(p_entity text) returns text
language sql immutable as $$
  select case p_entity when 'leads' then 'LD' when 'customers' then 'CU' when 'surveys' then 'SS' when 'quotations' then 'QT'
    when 'projects' then 'PR' when 'tasks' then 'TK' when 'installations' then 'IN' when 'stockMoves' then 'SM'
    when 'dispatches' then 'DC' when 'purchaseOrders' then 'PO' when 'supplierPayments' then 'SP' when 'invoices' then 'INV'
    when 'payments' then 'RC' when 'expenses' then 'EX' when 'subsidies' then 'SB' when 'loans' then 'LN'
    when 'tickets' then 'TKT' when 'amcs' then 'AMC' end
$$;
create or replace function public.num_fy_field(p_entity text) returns text
language sql immutable as $$
  select case when p_entity in ('quotations', 'dispatches', 'purchaseOrders', 'supplierPayments', 'invoices', 'payments') then 'date' end
$$;

-- The numbering a record asks for must be its own series: right letters, and the financial year of its own date.
create or replace function public.numbering_ok(p_entity text, p_key text, p_prefix text, p_data jsonb) returns boolean
language plpgsql stable as $$
declare
  letters text := public.num_letters(p_entity);
  f text := public.num_fy_field(p_entity);
  fy text;
begin
  if letters is null or p_key is null then return false; end if;
  if f is null then return p_key = p_entity and coalesce(p_prefix, '') = letters || '-'; end if;
  fy := public.fy_of(coalesce(p_data->>f, to_char(now() at time zone 'Asia/Kolkata', 'YYYY-MM-DD')));
  return fy is not null and p_key = p_entity || ':' || fy and coalesce(p_prefix, '') = letters || '/' || fy || '/';
end $$;

-- A document's lines as they matter (product, description, HSN, qty, rate, GST, discount), whatever their layout.
create or replace function public.lines_key(p jsonb) returns jsonb
language sql immutable set search_path = public as $$
  select coalesce(jsonb_agg(jsonb_build_array(coalesce(it->>'productId', ''), btrim(coalesce(it->>'description', '')), btrim(coalesce(it->>'hsn', '')),
           coalesce(public.num(it->>'qty'), 0), coalesce(public.num(it->>'rate'), 0), coalesce(public.num(it->>'gstRate'), 0),
           coalesce(public.num(it->>'discountPct'), 0)) order by ord), '[]'::jsonb)
  from jsonb_array_elements(case when jsonb_typeof(p) = 'array' then p else '[]'::jsonb end) with ordinality as x(it, ord)
  where jsonb_typeof(it) = 'object'
$$;

-- A document's grand total worked out from its lines, as the app does (line discounts, the document discount spread
-- over the lines, GST, rounded to the rupee). Totals are compared with ₹1 tolerance for rounding.
create or replace function public.doc_total(d jsonb) returns numeric
language sql immutable set search_path = public as $$
  with l as (
    select coalesce(public.num(it->>'qty'), 0) * coalesce(public.num(it->>'rate'), 0)
             * (1 - least(greatest(coalesce(public.num(it->>'discountPct'), 0), 0), 100) / 100) as v,
           coalesce(public.num(it->>'gstRate'), 0) as g
    from jsonb_array_elements(case when jsonb_typeof(d->'items') = 'array' then d->'items' else '[]'::jsonb end) it
    where jsonb_typeof(it) = 'object'
  ), s as (select coalesce(sum(v), 0) as sub, coalesce(sum(v * g / 100), 0) as tax from l),
  t as (select sub, tax, least(greatest(coalesce(public.num(d->>'discount'), 0), 0), round(sub, 2)) as disc from s)
  select round(sub - disc + case when sub > 0 then tax * (1 - disc / sub) else 0 end) from t
$$;

create or replace function public.my_role() returns text
language sql stable security definer set search_path = public as $$
  -- Cloud access is granted only after both identities are confirmed in Supabase Auth.
  select p.role from public.profiles p join auth.users u on u.id = p.id
  where p.id = auth.uid() and p.active and u.email_confirmed_at is not null and u.phone_confirmed_at is not null
$$;

-- The business of the signed-in person (also while waiting for approval).
create or replace function public.my_business() returns uuid
language sql stable security definer set search_path = public as $$
  select p.business_id from public.profiles p join auth.users u on u.id = p.id
  where p.id = auth.uid() and p.active and u.email_confirmed_at is not null and u.phone_confirmed_at is not null
$$;

-- In its free trial or a paid period. Afterwards the business can read everything but change nothing.
create or replace function public.business_active(p_business uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((
    select now() < coalesce(b.paid_until, '-infinity'::timestamptz)
        or (now() < b.trial_ends and (
              not coalesce((select trial_needs_sms from public.app_config where id = 1), false)
              or exists (select 1 from auth.users u where u.id = b.owner_id and u.phone_confirmed_at is not null)))
    from public.businesses b where b.id = p_business), false)
$$;

-- The key a free trial is remembered by: a salted one-way hash of the email or mobile number.
create or replace function public.trial_key(p_kind text, p_value text) returns text
language sql stable security definer set search_path = public as $$
  select case when coalesce(trim(p_value), '') = '' then null else p_kind || ':' || encode(sha256(convert_to(
    (select enquiry_salt from public.app_config where id = 1) || ':' || lower(trim(p_value)), 'UTF8')), 'hex') end
$$;

-- When the owner's email (and, with SMS codes, their mobile number) is confirmed: the business keeps its free trial
-- only if neither was used for a free trial before; otherwise it starts without one (it can still buy a plan).
create or replace function public.claim_trial(p_user uuid) returns void
language plpgsql security definer set search_path = public as $$
declare
  b uuid;
  u record;
  sms boolean := coalesce((select trial_needs_sms from public.app_config where id = 1), false);
  keys text[];
begin
  select id into b from public.businesses where owner_id = p_user order by created_at limit 1;
  if b is null then return; end if;
  select email, email_confirmed_at, phone, phone_confirmed_at into u from auth.users where id = p_user;
  if u.email_confirmed_at is null then return; end if; -- only an email that is really theirs counts
  keys := array_remove(array[
    public.trial_key('email', u.email),
    public.trial_key('phone', case
      when sms then case when u.phone_confirmed_at is not null and coalesce(u.phone, '') <> '' then '+' || ltrim(u.phone, '+') end
      else (select phone from public.user_phones where id = p_user) end)
  ], null);
  perform pg_advisory_xact_lock(hashtext('trial-claims'));
  if exists (select 1 from public.trial_claims where key = any(keys) and business_id is distinct from b) then
    update public.businesses set trial_ends = least(trial_ends, now()), trial_refused = true where id = b and not trial_refused;
  else
    insert into public.trial_claims (key, business_id) select k, b from unnest(keys) k on conflict (key) do nothing;
  end if;
end $$;

-- The connection's address as a one-way hash (for per-visitor limits). The left end of X-Forwarded-For is whatever
-- the visitor sends, so it is only a last resort: the right-most entry was added by the proxy itself.
create or replace function public.client_ip_hash() returns text
language plpgsql stable security definer set search_path = public as $$
declare h json := coalesce(nullif(current_setting('request.headers', true), ''), '{}')::json; xff text[];
begin
  xff := string_to_array(coalesce(h->>'x-forwarded-for', ''), ',');
  return md5((select enquiry_salt from public.app_config where id = 1) || ':' || coalesce(
    nullif(trim(h->>'cf-connecting-ip'), ''), nullif(trim(h->>'x-real-ip'), ''),
    nullif(trim(xff[array_length(xff, 1)]), ''), 'unknown'));
end $$;

-- What people see when they try to change something after the trial or paid period ended. (Neutral words: the
-- same message shows inside the Play Store / App Store apps, which may not point to payment outside the store.)
create or replace function public.ended_message() returns text
language sql immutable as $$
  select 'This business''s free trial or subscription has ended, so changes are paused. Your data is safe: you can still view and export it.'::text
$$;

-- Mirrors src/lib/rbac.ts and src/modules/registry.ts. Keep them in sync.
create or replace function public.module_of(p_entity text) returns text
language sql immutable as $$
  select case p_entity
    when 'leads' then 'crm' when 'customers' then 'crm' when 'activities' then 'crm'
    when 'surveys' then 'sales' when 'quotations' then 'sales'
    when 'projects' then 'projects' when 'tasks' then 'projects'
    when 'installations' then 'installation'
    when 'products' then 'inventory' when 'warehouses' then 'inventory' when 'stockMoves' then 'inventory'
    when 'dispatches' then 'inventory'
    when 'vendors' then 'purchase' when 'purchaseOrders' then 'purchase' when 'supplierPayments' then 'purchase'
    when 'invoices' then 'finance' when 'payments' then 'finance' when 'expenses' then 'finance'
    when 'subsidies' then 'subsidy' when 'loans' then 'loans'
    when 'tickets' then 'service' when 'amcs' then 'service'
    when 'documents' then 'documents'
    when 'employees' then 'staff' when 'attendance' then 'staff'
    when '_settings' then '_settings'
  end
$$;

-- Access level in one app: none | read | own (records you created or are assigned to) | all | manager (all + delete).
-- Mirrors src/lib/rbac.ts: the role gives a preset, profiles.access can change single apps; the admin has everything.
create or replace function public.my_level(p_module text) returns text
language plpgsql stable security definer set search_path = public as $$
declare
  r text;
  acc jsonb;
  v text;
begin
  select role, access into r, acc from public.profiles where id = auth.uid() and active;
  if r is null or r = 'pending' or p_module is null then return 'none'; end if;
  if r = 'admin' then return 'manager'; end if;
  v := acc->>p_module;
  if v in ('none', 'read', 'all', 'manager')
     or (v = 'own' and p_module in ('crm', 'sales', 'projects', 'installation', 'service', 'subsidy', 'loans', 'documents')) then
    return v;
  end if;
  if r = 'manager' then return 'manager'; end if;
  return coalesce(case r
    when 'sales' then case p_module when 'crm' then 'all' when 'sales' then 'all' when 'projects' then 'read'
      when 'documents' then 'all' when 'subsidy' then 'all' when 'loans' then 'all' when 'inventory' then 'read' end
    when 'technician' then case p_module when 'projects' then 'all' when 'installation' then 'all' when 'service' then 'all'
      when 'inventory' then 'read' when 'documents' then 'all' when 'crm' then 'read' when 'sales' then 'all' end
    when 'accounts' then case p_module when 'finance' then 'all' when 'purchase' then 'all' when 'inventory' then 'all'
      when 'subsidy' then 'all' when 'loans' then 'all' when 'crm' then 'read' when 'projects' then 'read'
      when 'documents' then 'all' when 'staff' then 'all' when 'sales' then 'all' end
  end, 'none');
end $$;

-- May the signed-in user read (or change) this type of record at all?
create or replace function public.can_access(p_entity text, p_write boolean) returns boolean
language plpgsql stable security definer set search_path = public as $$
declare
  r text := public.my_role();
  m text := public.module_of(p_entity);
  l text;
begin
  if r is null or r = 'pending' or m is null then return false; end if;
  if m = '_settings' then return (not p_write) or r = 'admin'; end if;
  l := public.my_level(m);
  return case when p_write then l in ('own', 'all', 'manager') else l <> 'none' end;
end $$;

-- This particular record: at "own" level only the ones you created or that name you (assigned to, manager…).
create or replace function public.can_row(p_entity text, p_write boolean, p_created_by uuid, p_data jsonb) returns boolean
language plpgsql stable security definer set search_path = public as $$
declare me uuid := auth.uid();
begin
  -- Activity log entries follow the record they belong to: whoever may see that record may read its history
  -- and add a note (written as themselves). Nobody edits history; see the update policy.
  if p_entity = 'activity' then
    if coalesce(public.my_role(), 'pending') = 'pending' then return false; end if;
    if p_write and p_created_by is distinct from me then return false; end if;
    return exists (select 1 from public.records t where t.business_id = public.my_business() and t.id::text = p_data->>'recordId' and t.entity = p_data->>'on'
                   and public.can_row(t.entity, false, t.created_by, t.data));
  end if;
  if not public.can_access(p_entity, p_write) then return false; end if;
  if public.module_of(p_entity) = '_settings' or public.my_level(public.module_of(p_entity)) <> 'own' then return true; end if;
  return p_created_by = me or exists (select 1 from jsonb_each(p_data) e where e.value = to_jsonb(me::text));
end $$;

-- ------------------------------------------------------------ new users ---
-- An Indian mobile number as +91XXXXXXXXXX, or null. Accepts spaces, dashes, +91, 91 or 0 in front.
create or replace function public.to_mobile(p text) returns text
language sql immutable set search_path = public as $$
  select case when d ~ '^[6-9][0-9]{9}$' and d !~ '^([0-9])\1{9}$' then '+91' || d end
  from (select case when x ~ '^91[0-9]{10}$' then substr(x, 3) when x ~ '^0[0-9]{10}$' then substr(x, 2) else x end as d
        from (select regexp_replace(coalesce(p, ''), '[^0-9]', '', 'g') as x) a) b
$$;

create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_phone text := public.to_mobile(new.raw_user_meta_data->>'phone');
  v_code text := upper(trim(coalesce(new.raw_user_meta_data->>'join_code', '')));
  v_name text := left(coalesce(nullif(trim(new.raw_user_meta_data->>'name'), ''), split_part(new.email, '@', 1)), 120);
  v_business uuid;
begin
  if v_code <> '' then
    -- Joining a colleague's business: waits for its admin's approval.
    select id into v_business from public.businesses where join_code = v_code;
    if v_business is null then raise exception 'ERP: No business has this company code. Check the code with your admin.'; end if;
    insert into public.profiles (id, name, email, role, business_id) values (new.id, v_name, new.email, 'pending', v_business);
  else
    -- A new business of its own, with the free trial; the person signing up is its admin.
    -- It needs a mobile number, and each number gets one free trial (checked below).
    if v_phone is null then raise exception 'ERP: Enter your mobile number to start the free trial.'; end if;
    insert into public.businesses (owner_id, name)
      values (new.id, left(coalesce(nullif(trim(new.raw_user_meta_data->>'business_name'), ''), v_name), 120))
      returning id into v_business;
    insert into public.profiles (id, name, email, role, business_id) values (new.id, v_name, new.email, 'admin', v_business);
  end if;
  -- The app sends the mobile number with the sign-up; a number another account has is refused (the sign-up fails),
  -- so one mobile number gets one free trial.
  if v_phone is not null then
    -- A sign-up that was never confirmed (after a day) cannot hold a number: it is released for the real person.
    delete from public.user_phones up using auth.users u
      where up.phone = v_phone and u.id = up.id and u.email_confirmed_at is null and u.id <> new.id
        and coalesce(u.created_at, now()) < now() - interval '1 day';
    if exists (select 1 from public.user_phones where phone = v_phone) then
      raise exception 'ERP: This mobile number is already used by another account.';
    end if;
    insert into public.user_phones (id, phone) values (new.id, v_phone);
  end if;
  insert into public.user_business (user_id, business_id) values (new.id, v_business) on conflict (user_id) do nothing;
  -- (Projects that confirm emails automatically: the trial is claimed now; otherwise when the email is confirmed.)
  if new.email_confirmed_at is not null then perform public.claim_trial(new.id); end if;
  return new;
end $$;

-- True when the signed-in person confirmed a one-time code sent to their email in the last 15 minutes
-- (Supabase records it in the login token's "amr" list).
create or replace function public.recent_email_code() returns boolean
language sql stable set search_path = public as $$
  select exists (
    select 1 from jsonb_array_elements(coalesce(nullif(current_setting('request.jwt.claims', true), '')::jsonb -> 'amr', '[]'::jsonb)) a
    where a->>'method' in ('otp', 'magiclink') and (a->>'timestamp')::bigint > extract(epoch from now()) - 900)
$$;

-- Sets a mobile number: your own, or anyone's if you are the admin. With SMS codes switched on, your own
-- number must be the one you confirmed with a code (Supabase keeps it on the login), so nobody can point
-- password resets at a number they do not hold.
create or replace function public.set_user_phone(p_id uuid, p_phone text) returns void
language plpgsql security definer set search_path = public as $$
declare v text := public.to_mobile(p_phone); me uuid := auth.uid();
begin
  if me is null then raise exception 'ERP: Please sign in again.'; end if;
  if p_id is distinct from me and public.my_role() is distinct from 'admin' then
    raise exception 'ERP: Only an admin can change another user''s mobile number.';
  end if;
  if v is null then raise exception 'ERP: Enter a valid 10-digit Indian mobile number.'; end if;
  if not exists (select 1 from public.profiles where id = p_id and business_id = public.my_business()) then raise exception 'ERP: This user no longer exists.'; end if;
  if exists (select 1 from public.user_phones where phone = v and id <> p_id) then
    raise exception 'ERP: This mobile number is already used by another account.';
  end if;
  -- Changing your own existing number needs a fresh email code, so a stolen session cannot redirect password resets.
  if p_id = me and exists (select 1 from public.user_phones where id = me and phone <> v) and not public.recent_email_code() then
    raise exception 'ERP: Confirm with the code we emailed you first.';
  end if;
  if p_id = me and exists (select 1 from auth.users u where u.id = me and u.phone_confirmed_at is not null
                           and u.phone is not null and '+' || ltrim(u.phone, '+') <> v) then
    raise exception 'ERP: Confirm this mobile number with the SMS code first.';
  end if;
  insert into public.user_phones (id, phone) values (p_id, v) on conflict (id) do update set phone = excluded.phone;
end $$;

revoke all on function public.set_user_phone(uuid, text) from public, anon;
grant execute on function public.set_user_phone(uuid, text) to authenticated;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.handle_new_user();

drop trigger if exists on_auth_user_confirmed on auth.users;
drop function if exists public.handle_user_confirmed();

create or replace function public.on_user_verified() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  perform public.claim_trial(new.id);
  return new;
end $$;
drop trigger if exists on_auth_user_verified on auth.users;
create trigger on_auth_user_verified after update of email_confirmed_at, phone_confirmed_at on auth.users
  for each row when (old.email_confirmed_at is distinct from new.email_confirmed_at or old.phone_confirmed_at is distinct from new.phone_confirmed_at)
  execute function public.on_user_verified();

-- Admins may change name/role/active only; there must always be one active admin.
create or replace function public.profiles_guard() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  new.id := old.id;
  new.email := old.email;
  new.created_at := old.created_at;
  if old.business_id is not null then new.business_id := old.business_id; end if;
  new.name := left(trim(new.name), 120);
  if new.access is null or jsonb_typeof(new.access) <> 'object' then new.access := '{}'; end if;
  if new.role = 'admin' then new.access := '{}'; end if;
  if (old.role = 'admin' and old.active) and (new.role <> 'admin' or not new.active) then
    perform pg_advisory_xact_lock(hashtext('profiles-admin:' || coalesce(old.business_id::text, '')));
    if not exists (select 1 from public.profiles where role = 'admin' and active and id <> old.id and business_id is not distinct from old.business_id) then
      raise exception 'ERP: At least one active admin is required.';
    end if;
  end if;
  return new;
end $$;

drop trigger if exists profiles_guard on public.profiles;
create trigger profiles_guard before update on public.profiles
  for each row execute function public.profiles_guard();

-- --------------------------------------------------------- business rules ---
create or replace function public.stock_of(p_product text, p_exclude uuid) returns numeric
language sql stable security definer set search_path = public as $$
  select coalesce(sum(case when data->>'direction' = 'Out' then -1 else 1 end * coalesce(public.num(data->>'qty'), 0)), 0)
  from public.records
  where business_id = public.my_business() and entity = 'stockMoves' and data @> jsonb_build_object('productId', p_product)
    and (p_exclude is null or id <> p_exclude)
$$;

create or replace function public.stock_in(p_product text, p_wh text, p_exclude uuid) returns numeric
language sql stable security definer set search_path = public as $$
  select coalesce(sum(case when data->>'direction' = 'Out' then -1 else 1 end * coalesce(public.num(data->>'qty'), 0)), 0)
  from public.records
  where business_id = public.my_business() and entity = 'stockMoves' and data @> jsonb_build_object('productId', p_product)
    and coalesce(data->>'warehouseId', '') = coalesce(p_wh, '')
    and (p_exclude is null or id <> p_exclude)
$$;

create or replace function public.paid_on(p_invoice text, p_exclude uuid) returns numeric
language sql stable security definer set search_path = public as $$
  select coalesce(sum(coalesce(public.num(data->>'amount'), 0)), 0)
  from public.records
  where business_id = public.my_business() and entity = 'payments' and data @> jsonb_build_object('invoiceId', p_invoice)
    and (p_exclude is null or id <> p_exclude)
$$;

create or replace function public.records_before_write() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  n integer;
  k text;
  inv public.records;
  delta numeric;
  avail numeric;
  paid numeric;
  total numeric;
  src public.records;
  restoring boolean := coalesce(current_setting('erp.restoring', true), '') = 'on';
  -- Set only by web_enquiry(): the business named in the enquiry link.
  enq uuid := nullif(current_setting('erp.enquiry_business', true), '')::uuid;
begin
  -- A deleted login: only "created by" is cleared and nothing else changes. Always allowed (account deletion).
  if tg_op = 'UPDATE' and new.data = old.data and new.entity = old.entity and new.created_by is null
     and old.created_by is not null and not exists (select 1 from auth.users where id = old.created_by) then
    return new;
  end if;
  -- 'activity' is the change history and notes of records (who changed what); it belongs to no single app.
  if public.module_of(new.entity) is null and new.entity <> 'activity' then
    raise exception 'ERP: Unknown record type %', new.entity;
  end if;

  -- The business is the signed-in person's (an enquiry from the website names it itself); it never changes.
  -- Nobody else can put a record into another business, and an insert from nobody stops here, before any check
  -- that could tell them something about another business.
  if tg_op = 'INSERT' then
    new.business_id := coalesce(enq, public.my_business(), case when restoring then new.business_id end);
    if new.business_id is null then raise exception 'ERP: Please sign in again.'; end if;
  elsif old.business_id is not null then
    new.business_id := old.business_id;
  end if;
  -- After the free trial or the paid period: everything stays readable (and exportable), nothing changes.
  if not restoring and not public.business_active(new.business_id) then
    raise exception 'ERP: %', public.ended_message();
  end if;

  if tg_op = 'INSERT' then
    if not restoring then
      new.created_by := case when enq is null then auth.uid() end; -- a website enquiry is nobody's
      new.created_at := now();
      new.updated_at := now();
      new.version := 1;
      new.data := new.data - 'number' - '_seq';
      k := new.data->>'_numKey';
      if k is not null then
        -- A record may only advance its own type's counter, with a sane prefix like "INV/26-27/" or "LD-".
        if not public.numbering_ok(new.entity, k, new.data->>'_numPrefix', new.data) then
          raise exception 'ERP: Invalid numbering';
        end if;
        insert into public.counters (entity, value) values (new.business_id::text || '|' || k, 1)
          on conflict (entity) do update set value = public.counters.value + 1
          returning value into n;
        new.data := (new.data - '_numPrefix')
          || jsonb_build_object('number', coalesce(new.data->>'_numPrefix', '') || lpad(n::text, 4, '0'), '_seq', n);
      end if;
    end if;
  else
    if new.entity <> old.entity or new.id <> old.id then
      raise exception 'ERP: A record cannot change type';
    end if;
    if not restoring then
      -- "Created by" never changes, except that it is cleared when that person's login is deleted.
      if not (new.created_by is null and old.created_by is not null
              and not exists (select 1 from auth.users where id = old.created_by)) then
        new.created_by := old.created_by;
      end if;
      new.created_at := old.created_at;
      new.updated_at := now();
      new.version := old.version + 1;
      -- Document numbers are permanent. A record that has none yet (an invoice saved as a draft) gets the next
      -- number of its series when it asks for one — i.e. when it is issued — so drafts never leave gaps.
      k := new.data->>'_numKey';
      if old.data->>'number' is null and k is not null then
        if not public.numbering_ok(new.entity, k, new.data->>'_numPrefix', new.data) then
          raise exception 'ERP: Invalid numbering';
        end if;
        insert into public.counters (entity, value) values (new.business_id::text || '|' || k, 1)
          on conflict (entity) do update set value = public.counters.value + 1
          returning value into n;
        new.data := (new.data - 'number' - '_seq' - '_numPrefix')
          || jsonb_build_object('number', coalesce(new.data->>'_numPrefix', '') || lpad(n::text, 4, '0'), '_seq', n);
      else
        new.data := (new.data - 'number' - '_numKey' - '_seq' - '_numPrefix')
          || jsonb_strip_nulls(jsonb_build_object('number', old.data->'number', '_numKey', old.data->'_numKey', '_seq', old.data->'_seq'));
        -- A numbered document stays in its financial year (its number says which).
        if old.data->>'number' is not null and public.num_fy_field(new.entity) is not null and position(':' in coalesce(old.data->>'_numKey', '')) > 0
           and coalesce(new.data->>public.num_fy_field(new.entity), old.data->>public.num_fy_field(new.entity)) is not null
           and public.fy_of(coalesce(new.data->>public.num_fy_field(new.entity), old.data->>public.num_fy_field(new.entity))) is distinct from split_part(old.data->>'_numKey', ':', 2) then
          raise exception 'ERP: % belongs to another financial year. Create a new document instead.', old.data->>'number';
        end if;
      end if;
    end if;
  end if;

  -- A restore loads records in any order, so cross-record checks are skipped while restoring.
  if restoring then
    return new;
  end if;

  if new.entity = 'activity' then
    if exists (select 1 from jsonb_object_keys(new.data) x where x not in ('on', 'recordId', 'kind', 'text', 'changes')) then
      raise exception 'ERP: Invalid history entry';
    end if;
    if coalesce(new.data->>'kind', '') <> 'note' and not exists (
      select 1 from public.records t where t.business_id = new.business_id and t.id::text = new.data->>'recordId' and t.entity = new.data->>'on'
        and public.can_row(t.entity, true, t.created_by, t.data)) then
      raise exception 'ERP: Only someone who can change a record can add to its history';
    end if;
  end if;

  -- Money documents: the stored total must be the one their lines give (it is what payments are checked against).
  if new.entity in ('invoices', 'purchaseOrders') then
    total := public.num(new.data->>'grandTotal');
    if total is null or abs(total - public.doc_total(new.data)) > 1 then
      raise exception 'ERP: The total does not match the lines of this document.';
    end if;
  end if;

  if new.entity = 'stockMoves' then
    if coalesce(public.num(new.data->>'qty'), 0) <= 0 then raise exception 'ERP: Quantity must be more than 0'; end if;
    -- Entries made by a purchase order, challan or transfer are part of that document: never edited on their own.
    if tg_op = 'UPDATE' and coalesce(old.data->>'sourceId', '') <> '' then
      raise exception 'ERP: This stock entry was made by a purchase order, challan or transfer. Change it there.';
    end if;
    -- Stock entered by hand (opening stock, counts, damage) needs an inventory manager — to add it or to change it.
    if coalesce(new.data->>'sourceId', '') = '' and public.my_level('inventory') <> 'manager' then
      raise exception 'ERP: Only an inventory manager can add or change stock entries by hand.';
    end if;
    if tg_op = 'UPDATE' and coalesce(new.data->>'sourceId', '') <> coalesce(old.data->>'sourceId', '') then
      raise exception 'ERP: A stock entry cannot be moved to another document.';
    end if;
    -- An entry that says it belongs to a document must really belong to one, within what that document allows.
    if tg_op = 'INSERT' and coalesce(new.data->>'sourceId', '') <> '' then
      if new.data->>'sourceType' = 'purchaseOrders' then
        select * into src from public.records where business_id = new.business_id and entity = 'purchaseOrders' and id::text = new.data->>'sourceId';
        if new.data->>'direction' = 'Out' or not found or coalesce(src.data->>'status', '') in ('Cancelled', 'Draft') then
          raise exception 'ERP: Goods can only be received against a live purchase order.';
        end if;
        perform pg_advisory_xact_lock(hashtext('po:' || src.id::text));
        if (select coalesce(sum(coalesce(public.num(data->>'qty'), 0)), 0) from public.records
            where business_id = new.business_id and entity = 'stockMoves' and data->>'sourceId' = src.id::text and data->>'productId' = new.data->>'productId' and data->>'direction' = 'In')
           + coalesce(public.num(new.data->>'qty'), 0)
           > (select coalesce(sum(coalesce(public.num(it->>'qty'), 0)), 0)
              from jsonb_array_elements(case when jsonb_typeof(src.data->'items') = 'array' then src.data->'items' else '[]'::jsonb end) it
              where it->>'productId' = new.data->>'productId') + 0.0001 then
          raise exception 'ERP: More than was ordered on this purchase order.';
        end if;
      elsif new.data->>'sourceType' = 'dispatches' then
        select * into src from public.records where business_id = new.business_id and entity = 'dispatches' and id::text = new.data->>'sourceId';
        if not found then
          raise exception 'ERP: This stock entry must belong to an existing delivery challan.';
        end if;
        perform pg_advisory_xact_lock(hashtext('dc:' || src.id::text));
        -- Out: at most what is on the challan. In (back from site): at most what went out on it and has not come back.
        delta := (select coalesce(sum(case when data->>'direction' = 'Out' then 1 else -1 end * coalesce(public.num(data->>'qty'), 0)), 0)
                  from public.records where business_id = new.business_id and entity = 'stockMoves' and data->>'sourceId' = src.id::text and data->>'productId' = new.data->>'productId');
        if new.data->>'direction' = 'In' and coalesce(public.num(new.data->>'qty'), 0) > delta + 0.0001 then
          raise exception 'ERP: More is coming back than went out on this challan.';
        end if;
        if new.data->>'direction' = 'Out' and (select coalesce(sum(case when data->>'direction' = 'Out' then 1 else 0 end * coalesce(public.num(data->>'qty'), 0)), 0)
              from public.records where business_id = new.business_id and entity = 'stockMoves' and data->>'sourceId' = src.id::text and data->>'productId' = new.data->>'productId')
              + coalesce(public.num(new.data->>'qty'), 0)
            > (select coalesce(sum(coalesce(public.num(it->>'qty'), 0)), 0)
               from jsonb_array_elements(case when jsonb_typeof(src.data->'items') = 'array' then src.data->'items' else '[]'::jsonb end) it
               where it->>'productId' = new.data->>'productId') + 0.0001 then
          raise exception 'ERP: More is going out than is on this challan.';
        end if;
      elsif new.data->>'sourceType' = 'transfer' then
        -- A transfer is an Out from one place and then exactly one matching In to another.
        if new.data->>'direction' = 'In' and (
             not exists (select 1 from public.records where business_id = new.business_id and entity = 'stockMoves' and data->>'sourceId' = new.data->>'sourceId'
                         and data->>'direction' = 'Out' and data->>'productId' = new.data->>'productId'
                         and public.num(data->>'qty') = public.num(new.data->>'qty'))
             or exists (select 1 from public.records where business_id = new.business_id and entity = 'stockMoves' and data->>'sourceId' = new.data->>'sourceId' and data->>'direction' = 'In')) then
          raise exception 'ERP: A transfer must take out what it puts in.';
        end if;
      else
        raise exception 'ERP: Unknown source for a stock entry.';
      end if;
    end if;
    perform pg_advisory_xact_lock(hashtext('stock:' || coalesce(new.data->>'productId', '')));
    delta := case when new.data->>'direction' = 'Out' then -1 else 1 end * public.num(new.data->>'qty');
    avail := public.stock_of(new.data->>'productId', new.id);
    if avail + delta < -0.0001 then
      raise exception 'ERP: Only % in stock for this product — this change would make stock negative.', trim_scale(round(avail, 3));
    end if;
    -- …and no single warehouse (or the stock in none) goes below zero either.
    if new.data->>'direction' = 'Out' and public.stock_in(new.data->>'productId', new.data->>'warehouseId', new.id) + delta < -0.0001 then
      raise exception 'ERP: Only % in that warehouse for this product.', trim_scale(round(public.stock_in(new.data->>'productId', new.data->>'warehouseId', new.id), 3));
    end if;
    if tg_op = 'UPDATE' and old.data->>'direction' is distinct from 'Out'
       and public.stock_in(old.data->>'productId', old.data->>'warehouseId', old.id)
           + (case when new.data->>'productId' = old.data->>'productId' and coalesce(new.data->>'warehouseId', '') = coalesce(old.data->>'warehouseId', '') then delta else 0 end) < -0.0001 then
      raise exception 'ERP: This change would leave a warehouse with negative stock (that stock was already used).';
    end if;
    if tg_op = 'UPDATE' and old.data->>'productId' is distinct from new.data->>'productId' then
      perform pg_advisory_xact_lock(hashtext('stock:' || coalesce(old.data->>'productId', '')));
      if public.stock_of(old.data->>'productId', old.id) < -0.0001 then
        raise exception 'ERP: Moving this entry would make the previous product''s stock negative.';
      end if;
    end if;
  end if;

  if new.entity = 'supplierPayments' then
    if coalesce(public.num(new.data->>'amount'), 0) <= 0 then raise exception 'ERP: Amount must be more than 0'; end if;
    if coalesce(new.data->>'purchaseOrderId', '') <> '' then
      perform pg_advisory_xact_lock(hashtext('po:' || (new.data->>'purchaseOrderId')));
      select * into src from public.records where business_id = new.business_id and entity = 'purchaseOrders' and id::text = new.data->>'purchaseOrderId';
      -- (A payment already on an order cancelled since may still be corrected.)
      if not found or (src.data->>'status' = 'Cancelled' and (tg_op = 'INSERT' or old.data->>'purchaseOrderId' is distinct from new.data->>'purchaseOrderId')) then
        raise exception 'ERP: The purchase order for this payment does not exist or is cancelled.';
      end if;
      if coalesce(new.data->>'vendorId', '') <> '' and coalesce(src.data->>'vendorId', '') <> '' and new.data->>'vendorId' <> src.data->>'vendorId' then
        raise exception 'ERP: This order is from another vendor.';
      end if;
      paid := (select coalesce(sum(coalesce(public.num(data->>'amount'), 0)), 0) from public.records
               where business_id = new.business_id and entity = 'supplierPayments' and data @> jsonb_build_object('purchaseOrderId', src.id::text) and id <> new.id)
              + coalesce(public.num(src.data->>'paidAmount'), 0);
      if paid + public.num(new.data->>'amount') > coalesce(public.num(src.data->>'grandTotal'), public.doc_total(src.data)) + 0.005 then
        raise exception 'ERP: More than is still to pay on this order (%).', trim_scale(round(coalesce(public.num(src.data->>'grandTotal'), public.doc_total(src.data)) - paid, 2));
      end if;
    end if;
  end if;

  if new.entity = 'purchaseOrders' and tg_op = 'UPDATE' then
    perform pg_advisory_xact_lock(hashtext('po:' || new.id::text));
    paid := (select coalesce(sum(coalesce(public.num(data->>'amount'), 0)), 0) from public.records
             where business_id = new.business_id and entity = 'supplierPayments' and data @> jsonb_build_object('purchaseOrderId', new.id::text));
    if paid > 0 and new.data->>'status' = 'Cancelled' and old.data->>'status' is distinct from 'Cancelled' then
      raise exception 'ERP: Payments to the vendor are recorded on this order. Delete them before cancelling it.';
    end if;
    if paid + coalesce(public.num(new.data->>'paidAmount'), 0) > public.num(new.data->>'grandTotal') + 0.005 then
      raise exception 'ERP: Order total cannot be less than what was already paid to the vendor.';
    end if;
    -- Goods received: the lines, price and vendor are what was received; the status never goes back.
    if exists (select 1 from public.records where business_id = new.business_id and entity = 'stockMoves' and data @> jsonb_build_object('sourceId', new.id::text)) then
      if public.lines_key(new.data->'items') <> public.lines_key(old.data->'items')
         or coalesce(public.num(new.data->>'discount'), 0) <> coalesce(public.num(old.data->>'discount'), 0)
         or new.data->>'vendorId' is distinct from old.data->>'vendorId' then
        raise exception 'ERP: Goods on this order were already received, so its lines, price and vendor can no longer be changed.';
      end if;
      if coalesce(new.data->>'status', '') in ('Draft', 'Ordered', 'Cancelled') then
        raise exception 'ERP: Goods on this order were already received, so it cannot go back to % .', new.data->>'status';
      end if;
    end if;
  end if;

  if new.entity = 'dispatches' and tg_op = 'UPDATE' and old.data->>'status' = 'Cancelled' and coalesce(new.data->>'status', '') <> 'Cancelled' then
    raise exception 'ERP: A cancelled challan cannot be reopened. Make a new one.';
  end if;

  -- An invoiced quotation is a done deal: its lines, price and customer are locked.
  if new.entity = 'quotations' and tg_op = 'UPDATE' and coalesce(old.data->>'invoiceId', '') <> ''
     and exists (select 1 from public.records where business_id = new.business_id and entity = 'invoices' and id::text = old.data->>'invoiceId' and coalesce(data->>'status', '') <> 'Cancelled')
     and (public.lines_key(new.data->'items') <> public.lines_key(old.data->'items')
          or coalesce(public.num(new.data->>'discount'), 0) <> coalesce(public.num(old.data->>'discount'), 0)
          or new.data->>'customerId' is distinct from old.data->>'customerId') then
    raise exception 'ERP: This quotation is already invoiced, so its lines, price and customer can no longer be changed.';
  end if;

  if new.entity = 'payments' then
    if coalesce(public.num(new.data->>'amount'), 0) <= 0 then raise exception 'ERP: Amount must be more than 0'; end if;
    perform pg_advisory_xact_lock(hashtext('inv:' || coalesce(new.data->>'invoiceId', '')));
    select * into inv from public.records where business_id = new.business_id and entity = 'invoices' and id::text = new.data->>'invoiceId';
    if not found then raise exception 'ERP: The invoice for this payment does not exist.'; end if;
    if inv.data->>'status' = 'Cancelled' then raise exception 'ERP: This invoice is cancelled.'; end if;
    paid := public.paid_on(new.data->>'invoiceId', new.id);
    -- Invoices saved by older versions have no stored total: their lines give it.
    total := coalesce(public.num(inv.data->>'grandTotal'), public.doc_total(inv.data));
    if paid + public.num(new.data->>'amount') > total + 0.005 then
      raise exception 'ERP: Amount is more than the balance due (%).', trim_scale(round(total - paid, 2));
    end if;
  end if;

  if new.entity = 'invoices' and tg_op = 'UPDATE' then
    perform pg_advisory_xact_lock(hashtext('inv:' || new.id::text));
    paid := public.paid_on(new.id::text, null);
    if public.num(new.data->>'grandTotal') is not null and paid > public.num(new.data->>'grandTotal') + 0.005 then
      raise exception 'ERP: Invoice total cannot be less than the amount already received (%).', trim_scale(paid);
    end if;
    if paid > 0 and new.data->>'status' = 'Cancelled' then
      raise exception 'ERP: Delete the payments on this invoice before cancelling it.';
    end if;
    -- Issued (numbered): never back to Draft, a cancelled one stays cancelled, and what it charged stays as issued.
    if old.data->>'number' is not null then
      if old.data->>'status' = 'Cancelled' and coalesce(new.data->>'status', '') <> 'Cancelled' then
        raise exception 'ERP: A cancelled invoice cannot be used again. Make a new invoice.';
      end if;
      if new.data->>'status' = 'Draft' then
        raise exception 'ERP: An issued invoice cannot go back to Draft. Cancel it if it should not count.';
      end if;
      if public.lines_key(new.data->'items') <> public.lines_key(old.data->'items')
         or coalesce(public.num(new.data->>'discount'), 0) <> coalesce(public.num(old.data->>'discount'), 0)
         or new.data->>'customerId' is distinct from old.data->>'customerId'
         or coalesce(new.data->>'placeOfSupply', '') <> coalesce(old.data->>'placeOfSupply', '')
         or new.data->>'date' is distinct from old.data->>'date' then
        raise exception 'ERP: An issued invoice cannot be changed (lines, price, customer, place of supply or date). Cancel it and make a new one.';
      end if;
    end if;
  end if;

  return new;
end $$;

drop trigger if exists records_before_write on public.records;
create trigger records_before_write before insert or update on public.records
  for each row execute function public.records_before_write();

create or replace function public.records_before_delete() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  idt text := old.id::text;
begin
  -- The whole business is being removed (by you, the provider): its records go with it.
  if not exists (select 1 from public.businesses where id = old.business_id) then return old; end if;
  if not public.business_active(old.business_id) then raise exception 'ERP: %', public.ended_message(); end if;
  if old.entity = 'invoices' then
    raise exception 'ERP: Invoices cannot be deleted. Cancel the invoice instead.';
  end if;
  if exists (
    select 1 from public.records r
    where r.business_id = old.business_id and r.id <> old.id and (
      r.data @> jsonb_build_object('customerId', idt) or r.data @> jsonb_build_object('leadId', idt)
      or r.data @> jsonb_build_object('projectId', idt) or r.data @> jsonb_build_object('productId', idt)
      or r.data @> jsonb_build_object('warehouseId', idt) or r.data @> jsonb_build_object('vendorId', idt)
      or r.data @> jsonb_build_object('invoiceId', idt) or r.data @> jsonb_build_object('employeeId', idt)
      or r.data @> jsonb_build_object('purchaseOrderId', idt)
      or (old.entity = 'products' and r.entity in ('quotations', 'invoices', 'purchaseOrders', 'dispatches')
          and r.data->'items' @> jsonb_build_array(jsonb_build_object('productId', idt))))
  ) then
    raise exception 'ERP: Cannot delete: other records still use this one. Delete or reassign those first.';
  end if;
  if old.entity = 'stockMoves' and coalesce(old.data->>'sourceId', '') <> '' and coalesce(public.my_role(), '') <> 'admin' then
    raise exception 'ERP: This stock entry belongs to a purchase order, challan or transfer and cannot be deleted on its own.';
  end if;
  if old.entity in ('purchaseOrders', 'dispatches') and (
       coalesce(old.data->>'stockReceived', 'false') = 'true' or coalesce(old.data->>'stockIssued', 'false') = 'true'
       or exists (select 1 from public.records r where r.business_id = old.business_id and r.entity = 'stockMoves' and r.data @> jsonb_build_object('sourceId', idt))) then
    raise exception 'ERP: Stock moved with this document, so it is kept for the record. Cancel it instead.';
  end if;
  if old.entity = 'stockMoves' and old.data->>'direction' is distinct from 'Out' then
    perform pg_advisory_xact_lock(hashtext('stock:' || coalesce(old.data->>'productId', '')));
    if public.stock_of(old.data->>'productId', old.id) < -0.0001 then
      raise exception 'ERP: Deleting this entry would make stock negative.';
    end if;
    if public.stock_in(old.data->>'productId', old.data->>'warehouseId', old.id) < -0.0001 then
      raise exception 'ERP: Deleting this entry would make that warehouse''s stock negative.';
    end if;
  end if;
  return old;
end $$;

drop trigger if exists records_before_delete on public.records;
create trigger records_before_delete before delete on public.records
  for each row execute function public.records_before_delete();

-- --------------------------------------------------------- backup restore ---
-- Admin-only. Keeps original numbers and dates, then moves counters past them.
create or replace function public.restore_records(p_rows jsonb) returns integer
language plpgsql security definer set search_path = public as $$
declare
  r jsonb;
  cnt integer := 0;
  b uuid := public.my_business();
begin
  if public.my_role() is distinct from 'admin' then raise exception 'ERP: Only an admin can restore a backup.'; end if;
  if not public.business_active(b) then raise exception 'ERP: Your subscription has ended. Renew it to restore a backup.'; end if;
  if jsonb_typeof(p_rows) <> 'array' then raise exception 'ERP: Invalid backup'; end if;
  perform set_config('erp.restoring', 'on', true);
  for r in select * from jsonb_array_elements(p_rows) loop
    if (public.module_of(r->>'entity') is null and r->>'entity' <> 'activity') or jsonb_typeof(r->'data') <> 'object' then
      raise exception 'ERP: Invalid record in backup';
    end if;
    -- A record id that belongs to another business is refused (backups never cross businesses).
    if exists (select 1 from public.records x where x.id = (r->>'id')::uuid and x.business_id is distinct from b) then
      raise exception 'ERP: This backup belongs to another business.';
    end if;
    insert into public.records (id, entity, data, created_at, updated_at, created_by, version, business_id)
    values ((r->>'id')::uuid, r->>'entity', r->'data',
            coalesce((r->>'created_at')::timestamptz, now()), coalesce((r->>'updated_at')::timestamptz, now()),
            -- Who created it stays (people with "own records only" access keep seeing theirs), if they are still here.
            case when coalesce(r->>'created_by', '') ~ '^[0-9a-fA-F-]{36}$'
                      and exists (select 1 from public.profiles u where u.id = (r->>'created_by')::uuid and u.business_id = b)
                 then (r->>'created_by')::uuid else auth.uid() end, 1, b)
    on conflict (id) do update set entity = excluded.entity, data = excluded.data,
      updated_at = excluded.updated_at, version = public.records.version + 1;
    cnt := cnt + 1;
  end loop;
  perform set_config('erp.restoring', 'off', true);
  insert into public.counters (entity, value)
    select b::text || '|' || coalesce(data->>'_numKey', entity), max(public.num(data->>'_seq'))::int
    from public.records where business_id = b and data ? '_seq' group by 1
  on conflict (entity) do update set value = greatest(public.counters.value, excluded.value);
  return cnt;
end $$;

-- ---------------------------------------------------------- web enquiries ---
-- Public form. Validates input, ignores repeats, caps volume, only ever creates a new lead.
drop function if exists public.web_enquiry(text, text, text, text, text);
drop function if exists public.web_enquiry(text, text, text, text, text, text);
-- Checked by the sign-up screen before the account is made: Supabase Auth hides the database's own message when a
-- sign-up is refused, so a wrong company code would otherwise look like any other failure. (Says only yes or no.)
-- At most 20 checks per connection per hour, so codes cannot be found by trying them all.
drop function if exists public.join_code_ok(text);
create or replace function public.join_code_ok(p_code text) returns boolean
language plpgsql volatile security definer set search_path = public as $$
declare v_ip text := public.client_ip_hash();
begin
  perform pg_advisory_xact_lock(hashtext('code-check'));
  delete from public.code_check_log where at < now() - interval '1 day';
  if (select count(*) from public.code_check_log where ip = v_ip and at > now() - interval '1 hour') >= 20 then
    raise exception 'ERP: Too many tries. Please wait an hour, or ask your admin for the invite link.';
  end if;
  insert into public.code_check_log (ip) values (v_ip);
  return exists (select 1 from public.businesses where join_code = upper(trim(coalesce(p_code, ''))));
end $$;
grant execute on function public.join_code_ok(text) to anon, authenticated;

-- The business name for the top of its website enquiry form (only while it takes enquiries).
create or replace function public.enquiry_business_name(p_business uuid) returns text
language sql stable security definer set search_path = public as $$
  select coalesce((select name from public.businesses where id = p_business and public.business_active(id)), '')
$$;
grant execute on function public.enquiry_business_name(uuid) to anon, authenticated;

create or replace function public.web_enquiry(p_name text, p_phone text, p_email text, p_city text, p_message text, p_website text default '', p_business uuid default null)
returns void language plpgsql security definer set search_path = public as $$
declare
  digits text := regexp_replace(coalesce(p_phone, ''), '\D', '', 'g');
  v_ip text := public.client_ip_hash();
begin
  -- A hidden form field only bots fill in: accept quietly, store nothing.
  if coalesce(p_website, '') <> '' then return; end if;
  if p_business is null or not exists (select 1 from public.businesses where id = p_business) then
    raise exception 'ERP: This enquiry form link is not complete. Please call us instead.';
  end if;
  if not public.business_active(p_business) then raise exception 'ERP: This business is not taking online enquiries right now. Please call us instead.'; end if;
  if coalesce(trim(p_name), '') = '' or char_length(p_name) > 120 then raise exception 'ERP: Please enter your name.'; end if;
  if p_phone is null or p_phone !~ '^[0-9+ \-]{8,16}$' or char_length(digits) < 10 then
    raise exception 'ERP: Please enter a valid mobile number.';
  end if;
  if coalesce(p_email, '') <> '' and p_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]{2,}$' then raise exception 'ERP: Please enter a valid email or leave it blank.'; end if;
  if char_length(coalesce(p_email, '')) > 120 or char_length(coalesce(p_city, '')) > 80
     or char_length(coalesce(p_message, '')) > 1000 then raise exception 'ERP: Some fields are too long.'; end if;
  perform pg_advisory_xact_lock(hashtext('web-enquiry'));
  -- Per-visitor limit (client IP as seen by Supabase's API gateway).
  -- Only a one-way hash is kept (never the address itself), and only for a day.
  delete from public.enquiry_log where at < now() - interval '1 day';
  if (select count(*) from public.enquiry_log where ip = v_ip and at > now() - interval '1 hour') >= 5 then
    raise exception 'ERP: Too many enquiries from this connection. Please call us instead.';
  end if;
  insert into public.enquiry_log (ip) values (v_ip);
  if (select count(*) from public.records where business_id = p_business and entity = 'leads' and created_by is null
      and created_at > now() - interval '1 hour') >= 100 then
    raise exception 'ERP: Too many enquiries right now. Please call us instead.';
  end if;
  if exists (select 1 from public.records where business_id = p_business and entity = 'leads' and created_at > now() - interval '1 day'
             and right(regexp_replace(coalesce(data->>'phone', ''), '\D', '', 'g'), 10) = right(digits, 10)) then
    return; -- same person already enquired today
  end if;
  -- The lead goes to the business in the link, even when someone signed in sends the form.
  perform set_config('erp.enquiry_business', p_business::text, true);
  insert into public.records (id, entity, business_id, data) values (
    gen_random_uuid(), 'leads', p_business,
    jsonb_build_object('name', trim(p_name), 'phone', trim(p_phone), 'email', trim(coalesce(p_email, '')),
      'city', trim(coalesce(p_city, '')), 'notes', coalesce(p_message, ''), 'source', 'Website', 'status', 'New',
      'segment', 'Residential', '_numKey', 'leads', '_numPrefix', 'LD-')
  );
  perform set_config('erp.enquiry_business', '', true);
end $$;

-- ------------------------------------------------------------- privileges ---
revoke all on function public.web_enquiry(text,text,text,text,text,text,uuid) from public;
grant execute on function public.web_enquiry(text,text,text,text,text,text,uuid) to anon, authenticated;
revoke all on function public.restore_records(jsonb) from public, anon;
grant execute on function public.restore_records(jsonb) to authenticated;
revoke all on function public.stock_of(text, uuid) from public, anon, authenticated;
revoke all on function public.paid_on(text, uuid) from public, anon, authenticated;
revoke all on function public.stock_in(text, text, uuid) from public, anon, authenticated;
drop function if exists public.next_number(text);

alter table public.app_config enable row level security;
alter table public.profiles enable row level security;
alter table public.user_phones enable row level security;
alter table public.records enable row level security;
alter table public.counters enable row level security;
alter table public.enquiry_log enable row level security;
alter table public.businesses enable row level security;
alter table public.plans enable row level security;
alter table public.subscription_payments enable row level security;
alter table public.trial_claims enable row level security;      -- (no policies: the database only)
alter table public.user_business enable row level security;     -- (no policies: the database only)
alter table public.code_check_log enable row level security;    -- (no policies: the database only)

-- Businesses: not readable directly (the app uses my_business_info(), which shows the company code to the admin
-- only); trial and paid dates change only through payments. Plans for everyone; payments for the business's admin.
drop policy if exists businesses_read on public.businesses;
drop policy if exists plans_read on public.plans;
create policy plans_read on public.plans for select to anon, authenticated using (active);
drop policy if exists subscription_payments_read on public.subscription_payments;
create policy subscription_payments_read on public.subscription_payments for select to authenticated
  using (business_id = public.my_business() and public.my_role() = 'admin');

drop policy if exists profiles_read on public.profiles;
create policy profiles_read on public.profiles for select to authenticated
  using (id = auth.uid() or (business_id = public.my_business() and coalesce(public.my_role(), 'pending') <> 'pending'));

drop policy if exists profiles_admin_update on public.profiles;
create policy profiles_admin_update on public.profiles for update to authenticated
  using (public.my_role() = 'admin' and business_id = public.my_business()) with check (public.my_role() = 'admin' and business_id = public.my_business());

-- Read your own number; the admin reads everyone's. Changes go through set_user_phone() only.
drop policy if exists user_phones_read on public.user_phones;
create policy user_phones_read on public.user_phones for select to authenticated
  using (id = auth.uid() or (public.my_role() = 'admin'
         and exists (select 1 from public.profiles p where p.id = user_phones.id and p.business_id = public.my_business())));

drop policy if exists records_read on public.records;
-- Reading: always (also after the subscription ended, so the business can export its data). Changing: only while active.
create policy records_read on public.records for select to authenticated
  using (business_id = public.my_business() and public.can_row(entity, false, created_by, data));

drop policy if exists records_insert on public.records;
create policy records_insert on public.records for insert to authenticated
  with check (business_id = public.my_business() and public.business_active(business_id) and public.can_row(entity, true, created_by, data));

drop policy if exists records_update on public.records;
create policy records_update on public.records for update to authenticated
  using (business_id = public.my_business() and entity <> 'activity' and public.can_row(entity, true, created_by, data))
  with check (business_id = public.my_business() and public.business_active(business_id) and entity <> 'activity' and public.can_row(entity, true, created_by, data));

drop policy if exists records_delete on public.records;
create policy records_delete on public.records for delete to authenticated
  using (business_id = public.my_business()
         and case when public.module_of(entity) = '_settings' then public.my_role() = 'admin'
              else public.my_level(public.module_of(entity)) = 'manager' end);

-- File storage for documents, photos and receipts (private bucket, 20 MB per file).
insert into storage.buckets (id, name, public, file_size_limit) values ('files', 'files', false, 20971520)
  on conflict (id) do update set public = false, file_size_limit = 20971520;
-- Only the kinds of file the app offers (photos, PDF, Office, text).
update storage.buckets set allowed_mime_types = array[
  'image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/heic', 'image/heif', 'application/pdf', 'text/plain', 'text/csv',
  'application/msword', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-excel', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.oasis.opendocument.text', 'application/vnd.oasis.opendocument.spreadsheet', 'application/octet-stream']
  where id = 'files';

-- Who may open a stored file: the person who uploaded it, the admin, and anyone who can see a record that uses it
-- (records' own access rules decide that, so a KYC copy is as private as the document record holding it).
-- The business of whoever uploaded a file ("<user id>/…"), also after that person's login was deleted.
create or replace function public.uploader_business(p_name text) returns uuid
language sql stable security definer set search_path = public as $$
  select business_id from public.user_business where user_id::text = split_part(p_name, '/', 1)
$$;

-- (Runs as the signed-in person, so the records' own read rules decide — never with more rights than they have.)
-- Only files uploaded within the person's own business: a path copied into a record of another business opens nothing.
create or replace function public.file_visible(p_name text) returns boolean
language sql stable set search_path = public as $$
  select split_part(p_name, '/', 1) = coalesce(auth.uid()::text, '-')
      or (public.uploader_business(p_name) = public.my_business() and (
            -- the admin: every file of the business
            coalesce(public.my_role(), '') = 'admin'
            -- others: files on a record they may see
            or exists (select 1 from public.records r
                       where r.business_id = public.my_business() and r.entity <> 'activity' and position(p_name in r.data::text) > 0
                         and jsonb_path_exists(r.data, '$.** ? (@.path == $p)', jsonb_build_object('p', p_name)))))
$$;

drop policy if exists files_rw on storage.objects;
drop policy if exists files_read on storage.objects;
drop policy if exists files_insert on storage.objects;
drop policy if exists files_delete on storage.objects;
create policy files_read on storage.objects for select to authenticated
  using (bucket_id = 'files' and coalesce(public.my_role(), 'pending') <> 'pending' and public.file_visible(name));
-- New files go into the uploader's own folder: "<user id>/…".
create policy files_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'files' and coalesce(public.my_role(), 'pending') <> 'pending' and split_part(name, '/', 1) = auth.uid()::text
              and public.business_active(public.my_business()));
-- Deleted only by the uploader (when their record goes) or the admin — never through a path planted in a record,
-- and, like every change, only while the business is active.
create policy files_delete on storage.objects for delete to authenticated
  using (bucket_id = 'files' and public.business_active(public.my_business()) and (
    (public.my_role() = 'admin' and public.uploader_business(objects.name) = public.my_business())
    or (public.my_role() = 'manager' and split_part(objects.name, '/', 1) = auth.uid()::text)));

-- ------------------------------------------------------------ account deletion ---
-- App stores require that people can delete their own account from inside the app.
-- The profile goes with the login; business records they created stay (GST record keeping) with "created by" cleared.
create or replace function public.delete_my_account() returns void
language plpgsql security definer set search_path = public as $$
declare me uuid := auth.uid(); b uuid := public.my_business();
begin
  if me is null then raise exception 'ERP: Please sign in again.'; end if;
  if b is null then select business_id into b from public.profiles where id = me; end if;
  if exists (select 1 from public.profiles where id = me and role = 'admin' and active)
     and not exists (select 1 from public.profiles where id <> me and role = 'admin' and active and business_id = public.my_business())
     and exists (select 1 from public.profiles where id <> me and business_id = public.my_business()) then
    raise exception 'ERP: You are the only admin. Make another user an admin before deleting your account.';
  end if;
  delete from auth.users where id = me;
  -- The last person of a business: the business and all its data go too (the app asks for a backup first).
  if b is not null and not exists (select 1 from public.profiles where business_id = b) then
    delete from public.businesses where id = b;
    delete from public.counters where entity like b::text || '|%';
  end if;
end $$;

-- An admin removes another user's login completely (not just disables it).
create or replace function public.admin_delete_user(p_id uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  if public.my_role() is distinct from 'admin' then raise exception 'ERP: Only an admin can delete users.'; end if;
  if p_id = auth.uid() then raise exception 'ERP: Use “Delete my account” to delete your own account.'; end if;
  if not exists (select 1 from public.profiles where id = p_id and business_id = public.my_business()) then
    raise exception 'ERP: This user is not in your business.';
  end if;
  if exists (select 1 from public.profiles where id = p_id and role = 'admin' and active)
     and not exists (select 1 from public.profiles where id <> p_id and role = 'admin' and active and business_id = public.my_business()) then
    raise exception 'ERP: At least one active admin is required.';
  end if;
  delete from auth.users where id = p_id;
end $$;

revoke all on function public.delete_my_account() from public, anon;
revoke all on function public.admin_delete_user(uuid) from public, anon;
grant execute on function public.delete_my_account() to authenticated;
grant execute on function public.admin_delete_user(uuid) to authenticated;

-- Live updates between users (respects the read rules above).
do $$ begin
  alter publication supabase_realtime add table public.records;
exception when duplicate_object then null; when undefined_object then null;
end $$;

-- ------------------------------------------------------------ subscription ---
-- What the app shows: the business, its trial and paid dates, and whether it is active. The company code only
-- for its admin.
create or replace function public.my_business_info() returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'id', b.id, 'name', b.name, 'joinCode', case when p.role = 'admin' then b.join_code end,
    'trialEnds', b.trial_ends, 'paidUntil', b.paid_until, 'plan', b.plan,
    'active', public.business_active(b.id), 'trialRefused', b.trial_refused,
    'isOwner', b.owner_id = p.id, 'now', now())
  from public.profiles p join public.businesses b on b.id = p.business_id
  where p.id = auth.uid() and p.active
$$;

-- A new company code for the admin (when the old one was shared too widely). Joining still needs approval.
create or replace function public.regenerate_join_code() returns text
language plpgsql security definer set search_path = public as $$
declare c text;
begin
  if public.my_role() is distinct from 'admin' then raise exception 'ERP: Only the admin can change the company code.'; end if;
  c := upper(substr(md5(gen_random_uuid()::text), 1, 10));
  update public.businesses set join_code = c where id = public.my_business();
  return c;
end $$;

-- For the payment server only (service role): who pays, for which business, and how much — from this table,
-- never from the app.
create or replace function public.billing_quote(p_user uuid, p_plan text) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare pr public.profiles; pl public.plans;
begin
  select * into pr from public.profiles where id = p_user and active;
  if pr.id is null or pr.role <> 'admin' then raise exception 'ERP: Only the business admin can pay for the subscription.'; end if;
  select * into pl from public.plans where id = p_plan and active;
  if pl.id is null then raise exception 'ERP: Unknown plan.'; end if;
  return jsonb_build_object('business', pr.business_id, 'plan', pl.id, 'months', pl.months, 'amount', pl.amount_paise, 'label', pl.label);
end $$;

create or replace function public.billing_record_order(p_user uuid, p_plan text, p_order text, p_amount integer) returns void
language plpgsql security definer set search_path = public as $$
declare q jsonb := public.billing_quote(p_user, p_plan);
begin
  if (q->>'amount')::int is distinct from p_amount then raise exception 'ERP: Amount does not match the plan.'; end if;
  insert into public.subscription_payments (business_id, business_name, plan, months, amount_paise, order_id, created_by)
    values ((q->>'business')::uuid, (select name from public.businesses where id = (q->>'business')::uuid), p_plan,
            (q->>'months')::int, p_amount, p_order, p_user);
end $$;

-- A verified payment extends the business. Safe to call twice for the same order (the second does nothing),
-- and the amount must be the order's. Paying during the trial starts after the trial; paying early adds on.
create or replace function public.apply_subscription_payment(p_order text, p_payment text, p_amount integer) returns jsonb
language plpgsql security definer set search_path = public as $$
declare o public.subscription_payments; m integer; b public.businesses; s timestamptz; e timestamptz;
begin
  select * into o from public.subscription_payments where order_id = p_order for update;
  if o.id is null then raise exception 'ERP: Unknown order.'; end if;
  if o.status = 'paid' then return jsonb_build_object('already', true, 'paidUntil', o.period_end); end if;
  if p_amount is distinct from o.amount_paise then raise exception 'ERP: Paid amount does not match the order.'; end if;
  if o.business_id is null then raise exception 'ERP: The business of this order no longer exists.'; end if;
  if exists (select 1 from public.subscription_payments where payment_id = p_payment and id <> o.id) then
    raise exception 'ERP: This payment was already used.';
  end if;
  m := coalesce(o.months, (select months from public.plans where id = o.plan)); -- the length bought, as ordered
  select * into b from public.businesses where id = o.business_id for update;
  s := greatest(now(), b.trial_ends, coalesce(b.paid_until, now()));
  e := s + make_interval(months => m);
  update public.businesses set paid_until = e, plan = o.plan where id = b.id;
  update public.subscription_payments set status = 'paid', payment_id = p_payment, period_start = s, period_end = e, paid_at = now()
    where id = o.id;
  return jsonb_build_object('already', false, 'paidUntil', e);
end $$;

-- For you, the provider, in the SQL editor: give a business extra days (a goodwill extension, an offline payment).
--   select public.vendor_extend('<business id>', 30);
create or replace function public.vendor_extend(p_business uuid, p_days integer) returns timestamptz
language plpgsql security definer set search_path = public as $$
declare e timestamptz;
begin
  update public.businesses set paid_until = greatest(now(), trial_ends, coalesce(paid_until, now())) + make_interval(days => p_days)
    where id = p_business returning paid_until into e;
  return e;
end $$;

revoke all on function public.my_business_info() from public, anon;
grant execute on function public.my_business_info() to authenticated;
revoke all on function public.regenerate_join_code() from public, anon;
grant execute on function public.regenerate_join_code() to authenticated;
revoke all on function public.my_business() from public, anon;
grant execute on function public.my_business() to authenticated;
revoke all on function public.billing_quote(uuid, text) from public, anon, authenticated;
revoke all on function public.billing_record_order(uuid, text, text, integer) from public, anon, authenticated;
revoke all on function public.apply_subscription_payment(text, text, integer) from public, anon, authenticated;
revoke all on function public.vendor_extend(uuid, integer) from public, anon, authenticated;
revoke all on function public.trial_key(text, text) from public, anon, authenticated;
revoke all on function public.claim_trial(uuid) from public, anon, authenticated;
revoke all on function public.client_ip_hash() from public, anon, authenticated;
revoke all on function public.uploader_business(text) from public, anon;
grant execute on function public.uploader_business(text) to authenticated; -- (used by the file rules)
do $$ begin
  grant execute on function public.billing_quote(uuid, text) to service_role;
  grant execute on function public.billing_record_order(uuid, text, text, integer) to service_role;
  grant execute on function public.apply_subscription_payment(text, text, integer) to service_role;
  grant execute on function public.vendor_extend(uuid, integer) to service_role;
exception when undefined_object then null; -- (no service_role outside Supabase, e.g. in tests)
end $$;

-- ------------------------------------------- one-time move to businesses ---
-- A database made before businesses existed: its people and records become one business (the first admin owns it,
-- with a fresh 15-day trial), and its document counters carry on inside that business.
do $$
declare b uuid; o uuid;
begin
  if exists (select 1 from public.profiles where business_id is null) or exists (select 1 from public.records where business_id is null) then
    select id into o from public.profiles where role = 'admin' and active order by created_at limit 1;
    select id into b from public.businesses where owner_id is not distinct from o order by created_at limit 1;
    if b is null then
      insert into public.businesses (owner_id, name)
        values (o, left(coalesce((select data->>'companyName' from public.records where entity = '_settings' limit 1), ''), 120))
        returning id into b;
    end if;
    perform set_config('erp.restoring', 'on', true);
    update public.profiles set business_id = b where business_id is null;
    update public.records set business_id = b where business_id is null;
    perform set_config('erp.restoring', 'off', true);
    update public.counters set entity = b::text || '|' || entity where position('|' in entity) = 0;
  end if;
end $$;

-- ------------------------------------------- kept up to date on every run ---
-- Logins and the business they joined (for files of former staff); free trials already used by existing owners.
insert into public.user_business (user_id, business_id)
  select id, business_id from public.profiles where business_id is not null on conflict (user_id) do nothing;
insert into public.trial_claims (key, business_id)
  select k, b.id from public.businesses b join auth.users u on u.id = b.owner_id
  cross join lateral unnest(array_remove(array[public.trial_key('email', u.email),
    public.trial_key('phone', (select phone from public.user_phones where id = u.id))], null)) k
  where u.email_confirmed_at is not null
  on conflict (key) do nothing;
