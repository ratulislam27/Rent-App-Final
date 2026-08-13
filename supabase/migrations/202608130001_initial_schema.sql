create extension if not exists pgcrypto;

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text not null,
  full_name text not null default '',
  phone text not null default '',
  address text not null default '',
  is_admin boolean not null default false,
  is_active boolean not null default true,
  force_password_change boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists profiles_email_lower_unique on public.profiles(lower(email));
create unique index if not exists only_one_platform_admin on public.profiles(is_admin) where is_admin = true;

create table if not exists public.account_sequences (
  user_id uuid not null references public.profiles(id) on delete cascade,
  entity_type text not null,
  last_value bigint not null default 0,
  primary key (user_id, entity_type)
);

create table if not exists public.user_settings (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  currency_code text not null default 'BDT',
  currency_symbol text not null default '৳',
  timezone text not null default 'Asia/Dhaka',
  date_format text not null default 'DD MMM YYYY',
  receipt_name text not null default '',
  receipt_phone text not null default '',
  receipt_address text not null default '',
  receipt_logo_path text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.property_types (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  name text not null,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  unique(user_id, name)
);

create table if not exists public.payment_methods (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  name text not null,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  unique(user_id, name)
);

create table if not exists public.expense_categories (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  name text not null,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  unique(user_id, name)
);

create table if not exists public.properties (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  display_id text not null,
  name text not null,
  property_type_id uuid references public.property_types(id) on delete restrict,
  location text not null default '',
  status text not null default 'vacant' check (status in ('vacant','occupied','maintenance')),
  notes text not null default '',
  archived_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(user_id, display_id)
);

create table if not exists public.tenants (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  display_id text not null,
  name text not null,
  phone text not null,
  email text,
  address text not null default '',
  nid text,
  profile_image_path text,
  notes text not null default '',
  archived_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(user_id, display_id)
);

create table if not exists public.agreements (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  display_id text not null,
  tenant_id uuid not null references public.tenants(id) on delete restrict,
  property_id uuid not null references public.properties(id) on delete restrict,
  start_date date not null,
  end_date date not null,
  security_deposit numeric(14,2) not null default 0 check (security_deposit >= 0),
  notice_period_months integer not null default 0 check (notice_period_months >= 0),
  monthly_base_rent numeric(14,2) not null check (monthly_base_rent >= 0),
  collection_offset smallint not null default 0 check (collection_offset in (0,1)),
  due_day smallint not null default 1 check (due_day between 1 and 28),
  notes text not null default '',
  terminated_on date,
  termination_note text,
  archived_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (end_date >= start_date),
  check (terminated_on is null or terminated_on between start_date and end_date),
  unique(user_id, display_id)
);

create table if not exists public.rent_increments (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  agreement_id uuid not null references public.agreements(id) on delete cascade,
  start_month date not null,
  end_month date,
  new_base_rent numeric(14,2) not null check (new_base_rent >= 0),
  note text not null default '',
  created_at timestamptz not null default now(),
  check (date_trunc('month', start_month)::date = start_month),
  check (end_month is null or end_month >= start_month)
);

create table if not exists public.rent_periods (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  agreement_id uuid not null references public.agreements(id) on delete restrict,
  rent_month date not null,
  base_rent numeric(14,2) not null check (base_rent >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (date_trunc('month', rent_month)::date = rent_month),
  unique(agreement_id, rent_month)
);

create table if not exists public.rent_charges (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  rent_period_id uuid not null references public.rent_periods(id) on delete cascade,
  reason text not null,
  amount numeric(14,2) not null check (amount > 0),
  created_at timestamptz not null default now()
);

create table if not exists public.rent_receipts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  display_id text not null,
  request_key uuid not null default gen_random_uuid(),
  rent_period_id uuid not null references public.rent_periods(id) on delete restrict,
  collection_date date not null,
  amount numeric(14,2) not null check (amount > 0),
  payment_method_id uuid references public.payment_methods(id) on delete restrict,
  collected_by text,
  notes text not null default '',
  status text not null default 'valid' check (status in ('valid','void')),
  void_reason text,
  voided_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(user_id, display_id),
  unique(user_id, request_key)
);

create table if not exists public.expenses (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  display_id text not null,
  request_key uuid not null default gen_random_uuid(),
  description text not null,
  expense_date date not null,
  amount numeric(14,2) not null check (amount > 0),
  category_id uuid references public.expense_categories(id) on delete restrict,
  notes text not null default '',
  status text not null default 'valid' check (status in ('valid','void')),
  archived_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(user_id, display_id),
  unique(user_id, request_key)
);

create table if not exists public.expense_allocations (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  expense_id uuid not null references public.expenses(id) on delete cascade,
  property_id uuid not null references public.properties(id) on delete restrict,
  allocated_amount numeric(14,2) not null check (allocated_amount > 0),
  unique(expense_id, property_id)
);

create table if not exists public.attachments (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  entity_type text not null check (entity_type in ('tenant','property','agreement','receipt','expense')),
  entity_id uuid not null,
  file_name text not null,
  storage_path text not null,
  content_type text,
  size_bytes bigint,
  created_at timestamptz not null default now(),
  unique(user_id, storage_path)
);

create table if not exists public.admin_audit_logs (
  id uuid primary key default gen_random_uuid(),
  admin_user_id uuid not null references public.profiles(id) on delete restrict,
  target_user_id uuid references public.profiles(id) on delete set null,
  action text not null,
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists idx_properties_user_active on public.properties(user_id, archived_at);
create index if not exists idx_tenants_user_active on public.tenants(user_id, archived_at);
create index if not exists idx_agreements_user_dates on public.agreements(user_id, start_date, end_date);
create index if not exists idx_agreements_property_dates on public.agreements(property_id, start_date, end_date);
create index if not exists idx_rent_periods_user_month on public.rent_periods(user_id, rent_month);
create index if not exists idx_receipts_user_date on public.rent_receipts(user_id, collection_date);
create index if not exists idx_expenses_user_date on public.expenses(user_id, expense_date);
create index if not exists idx_attachments_user_entity on public.attachments(user_id, entity_type, entity_id);
create index if not exists idx_audit_target_date on public.admin_audit_logs(target_user_id, created_at desc);

create or replace function public.touch_updated_at()
returns trigger language plpgsql security invoker set search_path = '' as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create or replace function public.current_user_is_active()
returns boolean language sql stable security definer set search_path = '' as $$
  select exists(select 1 from public.profiles p where p.id = auth.uid() and p.is_active);
$$;

create or replace function public.current_user_is_admin()
returns boolean language sql stable security definer set search_path = '' as $$
  select exists(select 1 from public.profiles p where p.id = auth.uid() and p.is_admin and p.is_active);
$$;

create or replace function public.next_account_display_id(p_entity_type text, p_prefix text, p_width integer)
returns text language plpgsql security definer set search_path = '' as $$
declare next_value bigint;
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  insert into public.account_sequences(user_id, entity_type, last_value)
  values (auth.uid(), p_entity_type, 1)
  on conflict (user_id, entity_type)
  do update set last_value = public.account_sequences.last_value + 1
  returning last_value into next_value;
  return p_prefix || lpad(next_value::text, p_width, '0');
end;
$$;

create or replace function public.assign_display_id()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.user_id is null then new.user_id := auth.uid(); end if;
  if new.user_id <> auth.uid() then raise exception 'Invalid owner'; end if;
  if current_setting('rentwise.restore_mode', true) = 'on' and coalesce(new.display_id, '') <> '' then
    return new;
  end if;
  case tg_table_name
    when 'properties' then new.display_id := public.next_account_display_id('property','PRP',4);
    when 'tenants' then new.display_id := public.next_account_display_id('tenant','TEN',4);
    when 'agreements' then new.display_id := public.next_account_display_id('agreement','AGR',4);
    when 'rent_receipts' then new.display_id := public.next_account_display_id('receipt','RCV',6);
    when 'expenses' then new.display_id := public.next_account_display_id('expense','EXP',6);
    else raise exception 'Unsupported display id target';
  end case;
  return new;
end;
$$;

create or replace function public.protect_record_identity()
returns trigger language plpgsql security invoker set search_path = '' as $$
begin
  if new.user_id <> old.user_id or new.display_id <> old.display_id or new.created_at <> old.created_at then
    raise exception 'Record ownership and generated IDs cannot be changed';
  end if;
  if tg_table_name = 'agreements' then
    if new.property_id <> old.property_id or new.tenant_id <> old.tenant_id then
      raise exception 'An agreement tenant and property cannot be rewritten';
    end if;
    return new;
  end if;
  if tg_table_name = 'rent_receipts' then
    if new.rent_period_id <> old.rent_period_id or new.collection_date <> old.collection_date or
       new.amount <> old.amount or new.payment_method_id is distinct from old.payment_method_id then
      raise exception 'A saved receipt is immutable; void it and create a correction instead';
    end if;
  end if;
  return new;
end;
$$;

create or replace function public.protect_profile_identity()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if auth.role() <> 'service_role' and not public.current_user_is_admin() then
    new.id := old.id;
    new.email := old.email;
    new.is_admin := old.is_admin;
    new.is_active := old.is_active;
  end if;
  return new;
end;
$$;

create or replace function public.enforce_account_relationships()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if tg_table_name = 'properties' and new.property_type_id is not null and not exists (
    select 1 from public.property_types x where x.id = new.property_type_id and x.user_id = new.user_id
  ) then raise exception 'Property type belongs to another account';
  elsif tg_table_name = 'agreements' and (not exists (
    select 1 from public.properties x where x.id = new.property_id and x.user_id = new.user_id
  ) or not exists (
    select 1 from public.tenants x where x.id = new.tenant_id and x.user_id = new.user_id
  )) then raise exception 'Agreement references another account';
  elsif tg_table_name = 'rent_increments' and not exists (
    select 1 from public.agreements x where x.id = new.agreement_id and x.user_id = new.user_id
  ) then raise exception 'Agreement belongs to another account';
  elsif tg_table_name = 'rent_periods' and not exists (
    select 1 from public.agreements x where x.id = new.agreement_id and x.user_id = new.user_id
  ) then raise exception 'Agreement belongs to another account';
  elsif tg_table_name = 'rent_charges' and not exists (
    select 1 from public.rent_periods x where x.id = new.rent_period_id and x.user_id = new.user_id
  ) then raise exception 'Rent period belongs to another account';
  elsif tg_table_name = 'rent_receipts' and (not exists (
    select 1 from public.rent_periods x where x.id = new.rent_period_id and x.user_id = new.user_id
  ) or (new.payment_method_id is not null and not exists (
    select 1 from public.payment_methods x where x.id = new.payment_method_id and x.user_id = new.user_id
  ))) then raise exception 'Receipt references another account';
  elsif tg_table_name = 'expenses' and new.category_id is not null and not exists (
    select 1 from public.expense_categories x where x.id = new.category_id and x.user_id = new.user_id
  ) then raise exception 'Expense category belongs to another account';
  elsif tg_table_name = 'expense_allocations' and (not exists (
    select 1 from public.expenses x where x.id = new.expense_id and x.user_id = new.user_id
  ) or not exists (
    select 1 from public.properties x where x.id = new.property_id and x.user_id = new.user_id
  )) then raise exception 'Expense allocation references another account';
  elsif tg_table_name = 'attachments' and not (
    (new.entity_type = 'tenant' and exists (select 1 from public.tenants x where x.id = new.entity_id and x.user_id = new.user_id)) or
    (new.entity_type = 'property' and exists (select 1 from public.properties x where x.id = new.entity_id and x.user_id = new.user_id)) or
    (new.entity_type = 'agreement' and exists (select 1 from public.agreements x where x.id = new.entity_id and x.user_id = new.user_id)) or
    (new.entity_type = 'receipt' and exists (select 1 from public.rent_receipts x where x.id = new.entity_id and x.user_id = new.user_id)) or
    (new.entity_type = 'expense' and exists (select 1 from public.expenses x where x.id = new.entity_id and x.user_id = new.user_id))
  ) then raise exception 'Attachment target belongs to another account';
  end if;
  return new;
end;
$$;

create or replace function public.prevent_used_record_delete()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if tg_table_name = 'properties' and (
    exists (select 1 from public.agreements x where x.property_id = old.id) or
    exists (select 1 from public.expense_allocations x where x.property_id = old.id) or
    exists (select 1 from public.attachments x where x.entity_type = 'property' and x.entity_id = old.id)
  ) then raise exception 'A property connected to another record cannot be deleted';
  elsif tg_table_name = 'tenants' and (
    exists (select 1 from public.agreements x where x.tenant_id = old.id) or
    exists (select 1 from public.attachments x where x.entity_type = 'tenant' and x.entity_id = old.id)
  ) then raise exception 'A tenant connected to another record cannot be deleted';
  end if;
  return old;
end;
$$;

create or replace function public.prevent_agreement_overlap()
returns trigger language plpgsql security invoker set search_path = '' as $$
begin
  if exists (
    select 1 from public.agreements a
    where (a.property_id = new.property_id or a.tenant_id = new.tenant_id)
      and a.id <> new.id
      and a.archived_at is null
      and daterange(a.start_date, coalesce(a.terminated_on, a.end_date + 1), '[)') &&
          daterange(new.start_date, coalesce(new.terminated_on, new.end_date + 1), '[)')
  ) then raise exception 'This property or tenant already has an overlapping agreement'; end if;
  return new;
end;
$$;

create or replace function public.prevent_rent_increment_overlap()
returns trigger language plpgsql security invoker set search_path = '' as $$
declare v_end date;
begin
  select coalesce(a.terminated_on, a.end_date) into strict v_end
  from public.agreements a where a.id = new.agreement_id and a.user_id = new.user_id;
  if new.start_month < date_trunc('month', (select start_date from public.agreements where id = new.agreement_id))::date
     or coalesce(new.end_month, v_end) > v_end then
    raise exception 'Rent increment must stay within the agreement dates';
  end if;
  if exists (
    select 1 from public.rent_increments x
    where x.agreement_id = new.agreement_id and x.id <> new.id
      and daterange(x.start_month, coalesce(x.end_month, v_end), '[]') &&
          daterange(new.start_month, coalesce(new.end_month, v_end), '[]')
  ) then raise exception 'Rent increment periods cannot overlap'; end if;
  return new;
end;
$$;

create or replace function public.enforce_property_status()
returns trigger language plpgsql security definer set search_path = '' as $$
declare has_active_agreement boolean;
begin
  if current_setting('rentwise.restore_mode', true) = 'on' then return new; end if;
  select exists (
    select 1 from public.agreements a
    where a.property_id = new.id and a.archived_at is null
      and current_date >= a.start_date
      and ((a.terminated_on is null and current_date <= a.end_date) or current_date < a.terminated_on)
  ) into has_active_agreement;
  if has_active_agreement and new.status <> 'occupied' then
    raise exception 'A property with an active agreement must remain occupied';
  elsif not has_active_agreement and new.status = 'occupied' then
    raise exception 'Occupied status is assigned by an active agreement';
  end if;
  return new;
end;
$$;

create or replace function public.sync_property_status()
returns trigger language plpgsql security definer set search_path = '' as $$
declare target_property uuid;
begin
  if tg_op = 'DELETE' then
    target_property := old.property_id;
  else
    target_property := new.property_id;
  end if;
  update public.properties p
  set status = case
    when p.status = 'maintenance' then 'maintenance'
    when exists(
      select 1 from public.agreements a
      where a.property_id = target_property and a.archived_at is null
        and current_date >= a.start_date
        and ((a.terminated_on is null and current_date <= a.end_date) or current_date < a.terminated_on)
    ) then 'occupied' else 'vacant' end,
    updated_at = now()
  where p.id = target_property;
  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;

create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  insert into public.profiles(id, email, full_name)
  values (new.id, lower(trim(new.email)), coalesce(new.raw_user_meta_data->>'full_name',''));
  insert into public.user_settings(user_id, receipt_name)
  values (new.id, coalesce(new.raw_user_meta_data->>'full_name',''));
  insert into public.property_types(user_id, name) values
    (new.id,'Flat'),(new.id,'Shop'),(new.id,'Office'),(new.id,'Plot');
  insert into public.payment_methods(user_id, name) values
    (new.id,'Cash'),(new.id,'Bank transfer'),(new.id,'Mobile banking'),(new.id,'Cheque');
  insert into public.expense_categories(user_id, name) values
    (new.id,'Maintenance'),(new.id,'Repairs'),(new.id,'Utilities'),
    (new.id,'Tax or fee'),(new.id,'Management'),(new.id,'Other');
  return new;
end;
$$;

create or replace function public.record_rent_collection(
  p_request_key uuid,
  p_agreement_id uuid,
  p_rent_month date,
  p_base_rent numeric,
  p_collection_date date,
  p_amount numeric,
  p_payment_method_id uuid,
  p_collected_by text,
  p_notes text,
  p_charges jsonb
) returns jsonb language plpgsql security invoker set search_path = '' as $$
declare
  v_user uuid := auth.uid();
  v_period public.rent_periods;
  v_receipt public.rent_receipts;
begin
  if v_user is null or not public.current_user_is_active() then raise exception 'Authentication required'; end if;
  if p_request_key is null then raise exception 'A request key is required'; end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_request_key::text, 0));
  select * into v_receipt from public.rent_receipts where user_id = v_user and request_key = p_request_key;
  if found then return to_jsonb(v_receipt); end if;
  if date_trunc('month', p_rent_month)::date <> p_rent_month then raise exception 'Rent month must be the first day of a month'; end if;
  if p_base_rent < 0 or p_amount <= 0 then raise exception 'The collection amount must be greater than zero'; end if;
  if not exists (select 1 from public.agreements x where x.id = p_agreement_id and x.user_id = v_user) then
    raise exception 'Agreement not found';
  end if;

  insert into public.rent_periods(user_id, agreement_id, rent_month, base_rent)
  values (v_user, p_agreement_id, p_rent_month, p_base_rent)
  on conflict (agreement_id, rent_month) do nothing;
  select * into strict v_period from public.rent_periods
  where agreement_id = p_agreement_id and rent_month = p_rent_month and user_id = v_user;

  insert into public.rent_charges(user_id, rent_period_id, reason, amount)
  select v_user, v_period.id, trim(charge->>'reason'), (charge->>'amount')::numeric
  from jsonb_array_elements(coalesce(p_charges, '[]'::jsonb)) charge
  where trim(charge->>'reason') <> '' and (charge->>'amount')::numeric >= 0;

  insert into public.rent_receipts(user_id, request_key, rent_period_id, collection_date, amount, payment_method_id, collected_by, notes)
  values (v_user, p_request_key, v_period.id, p_collection_date, p_amount, p_payment_method_id, nullif(trim(p_collected_by), ''), coalesce(p_notes, ''))
  returning * into v_receipt;
  return to_jsonb(v_receipt);
end;
$$;

create or replace function public.record_expense(
  p_request_key uuid,
  p_description text,
  p_expense_date date,
  p_amount numeric,
  p_category_id uuid,
  p_notes text,
  p_allocations jsonb
) returns jsonb language plpgsql security invoker set search_path = '' as $$
declare
  v_user uuid := auth.uid();
  v_expense public.expenses;
  v_allocated numeric;
begin
  if v_user is null or not public.current_user_is_active() then raise exception 'Authentication required'; end if;
  if p_request_key is null then raise exception 'A request key is required'; end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_request_key::text, 0));
  select * into v_expense from public.expenses where user_id = v_user and request_key = p_request_key;
  if found then return to_jsonb(v_expense); end if;
  if trim(p_description) = '' or p_amount <= 0 then raise exception 'A description and an amount greater than zero are required'; end if;
  select coalesce(sum((allocation->>'allocated_amount')::numeric), 0) into v_allocated
  from jsonb_array_elements(coalesce(p_allocations, '[]'::jsonb)) allocation;
  if abs(v_allocated - p_amount) > 0.01 then raise exception 'Property allocations must equal the expense total'; end if;
  if exists (
    select 1 from jsonb_array_elements(coalesce(p_allocations, '[]'::jsonb)) allocation
    where not exists (
      select 1 from public.properties x
      where x.id = (allocation->>'property_id')::uuid and x.user_id = v_user
    )
  ) then raise exception 'An allocated property does not belong to this account'; end if;

  insert into public.expenses(user_id, request_key, description, expense_date, amount, category_id, notes)
  values (v_user, p_request_key, trim(p_description), p_expense_date, p_amount, p_category_id, coalesce(p_notes, ''))
  returning * into v_expense;
  insert into public.expense_allocations(user_id, expense_id, property_id, allocated_amount)
  select v_user, v_expense.id, (allocation->>'property_id')::uuid, (allocation->>'allocated_amount')::numeric
  from jsonb_array_elements(coalesce(p_allocations, '[]'::jsonb)) allocation;
  return to_jsonb(v_expense);
end;
$$;

create or replace function public.restore_account_backup(p_backup jsonb, p_confirmation text)
returns void language plpgsql security invoker set search_path = '' as $$
declare v_user uuid := auth.uid();
begin
  if v_user is null or not public.current_user_is_active() then raise exception 'Authentication required'; end if;
  if p_confirmation <> 'RESTORE' then raise exception 'Type RESTORE to confirm'; end if;
  if coalesce(p_backup->'profile'->>'id', '') <> v_user::text then
    raise exception 'This backup belongs to a different landlord account';
  end if;
  if jsonb_typeof(p_backup->'properties') <> 'array' or jsonb_typeof(p_backup->'tenants') <> 'array'
     or jsonb_typeof(p_backup->'agreements') <> 'array' then
    raise exception 'Backup data is incomplete';
  end if;

  perform set_config('rentwise.restore_mode', 'on', true);

  delete from public.attachments where user_id = v_user;
  delete from public.rent_receipts where user_id = v_user;
  delete from public.rent_charges where user_id = v_user;
  delete from public.rent_periods where user_id = v_user;
  delete from public.rent_increments where user_id = v_user;
  delete from public.expense_allocations where user_id = v_user;
  delete from public.expenses where user_id = v_user;
  delete from public.agreements where user_id = v_user;
  delete from public.tenants where user_id = v_user;
  delete from public.properties where user_id = v_user;
  delete from public.property_types where user_id = v_user;
  delete from public.payment_methods where user_id = v_user;
  delete from public.expense_categories where user_id = v_user;
  delete from public.account_sequences where user_id = v_user;

  update public.profiles set
    full_name = coalesce(p_backup->'profile'->>'full_name', full_name),
    phone = coalesce(p_backup->'profile'->>'phone', phone),
    address = coalesce(p_backup->'profile'->>'address', address)
  where id = v_user;
  update public.user_settings set
    currency_code = coalesce(p_backup->'settings'->>'currency_code', currency_code),
    currency_symbol = coalesce(p_backup->'settings'->>'currency_symbol', currency_symbol),
    timezone = coalesce(p_backup->'settings'->>'timezone', timezone),
    date_format = coalesce(p_backup->'settings'->>'date_format', date_format),
    receipt_name = coalesce(p_backup->'settings'->>'receipt_name', receipt_name),
    receipt_phone = coalesce(p_backup->'settings'->>'receipt_phone', receipt_phone),
    receipt_address = coalesce(p_backup->'settings'->>'receipt_address', receipt_address),
    receipt_logo_path = nullif(p_backup->'settings'->>'receipt_logo_path', '')
  where user_id = v_user;

  insert into public.property_types(id, user_id, name, is_active, created_at)
  select x.id, v_user, x.name, x.is_active, coalesce(x.created_at, now())
  from jsonb_to_recordset(coalesce(p_backup->'propertyTypes', '[]'::jsonb))
    as x(id uuid, name text, is_active boolean, created_at timestamptz);
  insert into public.payment_methods(id, user_id, name, is_active, created_at)
  select x.id, v_user, x.name, x.is_active, coalesce(x.created_at, now())
  from jsonb_to_recordset(coalesce(p_backup->'paymentMethods', '[]'::jsonb))
    as x(id uuid, name text, is_active boolean, created_at timestamptz);
  insert into public.expense_categories(id, user_id, name, is_active, created_at)
  select x.id, v_user, x.name, x.is_active, coalesce(x.created_at, now())
  from jsonb_to_recordset(coalesce(p_backup->'expenseCategories', '[]'::jsonb))
    as x(id uuid, name text, is_active boolean, created_at timestamptz);

  insert into public.properties(id, user_id, display_id, name, property_type_id, location, status, notes, archived_at, created_at, updated_at)
  select x.id, v_user, x.display_id, x.name, x.property_type_id, coalesce(x.location,''), x.status, coalesce(x.notes,''), x.archived_at, x.created_at, x.updated_at
  from jsonb_to_recordset(p_backup->'properties') as x(
    id uuid, display_id text, name text, property_type_id uuid, location text, status text, notes text,
    archived_at timestamptz, created_at timestamptz, updated_at timestamptz
  );
  insert into public.tenants(id, user_id, display_id, name, phone, email, address, nid, profile_image_path, notes, archived_at, created_at, updated_at)
  select x.id, v_user, x.display_id, x.name, x.phone, x.email, coalesce(x.address,''), x.nid, x.profile_image_path, coalesce(x.notes,''), x.archived_at, x.created_at, x.updated_at
  from jsonb_to_recordset(p_backup->'tenants') as x(
    id uuid, display_id text, name text, phone text, email text, address text, nid text, profile_image_path text,
    notes text, archived_at timestamptz, created_at timestamptz, updated_at timestamptz
  );
  insert into public.agreements(id, user_id, display_id, tenant_id, property_id, start_date, end_date, security_deposit, notice_period_months, monthly_base_rent, collection_offset, due_day, notes, terminated_on, termination_note, archived_at, created_at, updated_at)
  select x.id, v_user, x.display_id, x.tenant_id, x.property_id, x.start_date, x.end_date, x.security_deposit, x.notice_period_months, x.monthly_base_rent, x.collection_offset, x.due_day, coalesce(x.notes,''), x.terminated_on, x.termination_note, x.archived_at, x.created_at, x.updated_at
  from jsonb_to_recordset(p_backup->'agreements') as x(
    id uuid, display_id text, tenant_id uuid, property_id uuid, start_date date, end_date date,
    security_deposit numeric, notice_period_months integer, monthly_base_rent numeric, collection_offset smallint,
    due_day smallint, notes text, terminated_on date, termination_note text, archived_at timestamptz,
    created_at timestamptz, updated_at timestamptz
  );
  insert into public.rent_increments(id, user_id, agreement_id, start_month, end_month, new_base_rent, note, created_at)
  select x.id, v_user, x.agreement_id, x.start_month, x.end_month, x.new_base_rent, coalesce(x.note,''), x.created_at
  from jsonb_to_recordset(coalesce(p_backup->'increments', '[]'::jsonb))
    as x(id uuid, agreement_id uuid, start_month date, end_month date, new_base_rent numeric, note text, created_at timestamptz);
  insert into public.rent_periods(id, user_id, agreement_id, rent_month, base_rent, created_at, updated_at)
  select x.id, v_user, x.agreement_id, x.rent_month, x.base_rent, x.created_at, x.updated_at
  from jsonb_to_recordset(coalesce(p_backup->'rentPeriods', '[]'::jsonb))
    as x(id uuid, agreement_id uuid, rent_month date, base_rent numeric, created_at timestamptz, updated_at timestamptz);
  insert into public.rent_charges(id, user_id, rent_period_id, reason, amount, created_at)
  select x.id, v_user, x.rent_period_id, x.reason, x.amount, x.created_at
  from jsonb_to_recordset(coalesce(p_backup->'rentCharges', '[]'::jsonb))
    as x(id uuid, rent_period_id uuid, reason text, amount numeric, created_at timestamptz);
  insert into public.rent_receipts(id, user_id, display_id, request_key, rent_period_id, collection_date, amount, payment_method_id, collected_by, notes, status, void_reason, voided_at, created_at, updated_at)
  select x.id, v_user, x.display_id, coalesce(x.request_key, gen_random_uuid()), x.rent_period_id, x.collection_date, x.amount, x.payment_method_id, x.collected_by, coalesce(x.notes,''), x.status, x.void_reason, x.voided_at, x.created_at, x.updated_at
  from jsonb_to_recordset(coalesce(p_backup->'receipts', '[]'::jsonb)) as x(
    id uuid, display_id text, request_key uuid, rent_period_id uuid, collection_date date, amount numeric, payment_method_id uuid,
    collected_by text, notes text, status text, void_reason text, voided_at timestamptz, created_at timestamptz, updated_at timestamptz
  );
  insert into public.expenses(id, user_id, display_id, request_key, description, expense_date, amount, category_id, notes, status, archived_at, created_at, updated_at)
  select x.id, v_user, x.display_id, coalesce(x.request_key, gen_random_uuid()), x.description, x.expense_date, x.amount, x.category_id, coalesce(x.notes,''), x.status, x.archived_at, x.created_at, x.updated_at
  from jsonb_to_recordset(coalesce(p_backup->'expenses', '[]'::jsonb)) as x(
    id uuid, display_id text, request_key uuid, description text, expense_date date, amount numeric, category_id uuid,
    notes text, status text, archived_at timestamptz, created_at timestamptz, updated_at timestamptz
  );
  insert into public.expense_allocations(id, user_id, expense_id, property_id, allocated_amount)
  select x.id, v_user, x.expense_id, x.property_id, x.allocated_amount
  from jsonb_to_recordset(coalesce(p_backup->'allocations', '[]'::jsonb))
    as x(id uuid, expense_id uuid, property_id uuid, allocated_amount numeric);
  insert into public.attachments(id, user_id, entity_type, entity_id, file_name, storage_path, content_type, size_bytes, created_at)
  select x.id, v_user, x.entity_type, x.entity_id, x.file_name, x.storage_path, x.content_type, x.size_bytes, x.created_at
  from jsonb_to_recordset(coalesce(p_backup->'attachments', '[]'::jsonb)) as x(
    id uuid, entity_type text, entity_id uuid, file_name text, storage_path text, content_type text,
    size_bytes bigint, created_at timestamptz
  );

  insert into public.account_sequences(user_id, entity_type, last_value) values
    (v_user, 'property', coalesce((select max(regexp_replace(display_id, '\D', '', 'g')::bigint) from public.properties where user_id = v_user), 0)),
    (v_user, 'tenant', coalesce((select max(regexp_replace(display_id, '\D', '', 'g')::bigint) from public.tenants where user_id = v_user), 0)),
    (v_user, 'agreement', coalesce((select max(regexp_replace(display_id, '\D', '', 'g')::bigint) from public.agreements where user_id = v_user), 0)),
    (v_user, 'receipt', coalesce((select max(regexp_replace(display_id, '\D', '', 'g')::bigint) from public.rent_receipts where user_id = v_user), 0)),
    (v_user, 'expense', coalesce((select max(regexp_replace(display_id, '\D', '', 'g')::bigint) from public.expenses where user_id = v_user), 0));
end;
$$;

revoke all on function public.record_rent_collection(uuid,uuid,date,numeric,date,numeric,uuid,text,text,jsonb) from public, anon;
grant execute on function public.record_rent_collection(uuid,uuid,date,numeric,date,numeric,uuid,text,text,jsonb) to authenticated;
revoke all on function public.record_expense(uuid,text,date,numeric,uuid,text,jsonb) from public, anon;
grant execute on function public.record_expense(uuid,text,date,numeric,uuid,text,jsonb) to authenticated;
revoke all on function public.restore_account_backup(jsonb,text) from public, anon;
grant execute on function public.restore_account_backup(jsonb,text) to authenticated;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users for each row execute function public.handle_new_user();

do $$ begin
  create trigger properties_display_id before insert on public.properties for each row execute function public.assign_display_id();
exception when duplicate_object then null; end $$;
do $$ begin
  create trigger tenants_display_id before insert on public.tenants for each row execute function public.assign_display_id();
exception when duplicate_object then null; end $$;
do $$ begin
  create trigger agreements_display_id before insert on public.agreements for each row execute function public.assign_display_id();
exception when duplicate_object then null; end $$;
do $$ begin
  create trigger receipts_display_id before insert on public.rent_receipts for each row execute function public.assign_display_id();
exception when duplicate_object then null; end $$;
do $$ begin
  create trigger expenses_display_id before insert on public.expenses for each row execute function public.assign_display_id();
exception when duplicate_object then null; end $$;

do $$ declare table_name text; begin
  foreach table_name in array array['properties','tenants','agreements','rent_receipts','expenses'] loop
    execute format('drop trigger if exists %I_protect_identity on public.%I', table_name, table_name);
    execute format('create trigger %I_protect_identity before update on public.%I for each row execute function public.protect_record_identity()', table_name, table_name);
  end loop;
end $$;
drop trigger if exists profiles_protect_identity on public.profiles;
create trigger profiles_protect_identity before update on public.profiles for each row execute function public.protect_profile_identity();

do $$ declare table_name text; begin
  foreach table_name in array array['properties','agreements','rent_increments','rent_periods','rent_charges','rent_receipts','expenses','expense_allocations','attachments'] loop
    execute format('drop trigger if exists %I_enforce_account on public.%I', table_name, table_name);
    execute format('create trigger %I_enforce_account before insert or update on public.%I for each row execute function public.enforce_account_relationships()', table_name, table_name);
  end loop;
end $$;
drop trigger if exists properties_prevent_used_delete on public.properties;
create trigger properties_prevent_used_delete before delete on public.properties for each row execute function public.prevent_used_record_delete();
drop trigger if exists tenants_prevent_used_delete on public.tenants;
create trigger tenants_prevent_used_delete before delete on public.tenants for each row execute function public.prevent_used_record_delete();

do $$ begin
  create trigger agreements_no_overlap before insert or update on public.agreements for each row execute function public.prevent_agreement_overlap();
exception when duplicate_object then null; end $$;
do $$ begin
  create trigger rent_increments_no_overlap before insert or update on public.rent_increments for each row execute function public.prevent_rent_increment_overlap();
exception when duplicate_object then null; end $$;
do $$ begin
  create trigger agreements_sync_property after insert or update or delete on public.agreements for each row execute function public.sync_property_status();
exception when duplicate_object then null; end $$;
do $$ begin
  create trigger properties_enforce_status before insert or update of status on public.properties for each row execute function public.enforce_property_status();
exception when duplicate_object then null; end $$;

do $$ declare table_name text; begin
  foreach table_name in array array['profiles','user_settings','properties','tenants','agreements','rent_periods','rent_receipts','expenses'] loop
    execute format('drop trigger if exists %I_touch_updated_at on public.%I', table_name, table_name);
    execute format('create trigger %I_touch_updated_at before update on public.%I for each row execute function public.touch_updated_at()', table_name, table_name);
  end loop;
end $$;

alter table public.profiles enable row level security;
alter table public.account_sequences enable row level security;
alter table public.user_settings enable row level security;
alter table public.property_types enable row level security;
alter table public.payment_methods enable row level security;
alter table public.expense_categories enable row level security;
alter table public.properties enable row level security;
alter table public.tenants enable row level security;
alter table public.agreements enable row level security;
alter table public.rent_increments enable row level security;
alter table public.rent_periods enable row level security;
alter table public.rent_charges enable row level security;
alter table public.rent_receipts enable row level security;
alter table public.expenses enable row level security;
alter table public.expense_allocations enable row level security;
alter table public.attachments enable row level security;
alter table public.admin_audit_logs enable row level security;

do $$ declare table_name text; begin
  foreach table_name in array array[
    'account_sequences','user_settings','property_types','payment_methods','expense_categories',
    'properties','tenants','agreements','rent_increments','rent_periods','rent_charges',
    'rent_receipts','expenses','expense_allocations','attachments'
  ] loop
    execute format('drop policy if exists owner_all on public.%I', table_name);
    execute format(
      'create policy owner_all on public.%I for all to authenticated using ((user_id = auth.uid() and public.current_user_is_active()) or public.current_user_is_admin()) with check ((user_id = auth.uid() and public.current_user_is_active()) or public.current_user_is_admin())',
      table_name
    );
  end loop;
end $$;

drop policy if exists profile_select on public.profiles;
create policy profile_select on public.profiles for select to authenticated
using ((id = auth.uid() and public.current_user_is_active()) or public.current_user_is_admin());
drop policy if exists profile_update_self on public.profiles;
create policy profile_update_self on public.profiles for update to authenticated
using (id = auth.uid() and public.current_user_is_active())
with check (id = auth.uid() and public.current_user_is_active() and is_admin = false);
drop policy if exists profile_admin_update on public.profiles;
create policy profile_admin_update on public.profiles for update to authenticated
using (public.current_user_is_admin()) with check (public.current_user_is_admin());

drop policy if exists admin_audit_read on public.admin_audit_logs;
create policy admin_audit_read on public.admin_audit_logs for select to authenticated using (public.current_user_is_admin());

-- New Supabase projects may revoke schema privileges by default. RLS policies
-- still decide which rows are visible, while these grants allow authenticated
-- application users to reach the tables and transactional RPC functions.
grant usage on schema public to authenticated, service_role;
revoke all on all tables in schema public from anon;
grant select, insert, update, delete on all tables in schema public to authenticated;
grant all privileges on all tables in schema public to service_role;
grant usage, select on all sequences in schema public to authenticated, service_role;
grant execute on all functions in schema public to authenticated, service_role;

alter default privileges in schema public revoke all on tables from anon;
alter default privileges in schema public grant select, insert, update, delete on tables to authenticated;
alter default privileges in schema public grant all privileges on tables to service_role;
alter default privileges in schema public grant usage, select on sequences to authenticated, service_role;
alter default privileges in schema public grant execute on functions to authenticated, service_role;

insert into storage.buckets(id, name, public, file_size_limit, allowed_mime_types)
values ('rentwise-private','rentwise-private',false,10485760,array['image/jpeg','image/png','image/webp','application/pdf'])
on conflict(id) do nothing;

drop policy if exists rentwise_storage_select on storage.objects;
create policy rentwise_storage_select on storage.objects for select to authenticated
using (bucket_id = 'rentwise-private' and ((storage.foldername(name))[1] = auth.uid()::text or public.current_user_is_admin()));
drop policy if exists rentwise_storage_insert on storage.objects;
create policy rentwise_storage_insert on storage.objects for insert to authenticated
with check (bucket_id = 'rentwise-private' and (storage.foldername(name))[1] = auth.uid()::text and public.current_user_is_active());
drop policy if exists rentwise_storage_update on storage.objects;
create policy rentwise_storage_update on storage.objects for update to authenticated
using (bucket_id = 'rentwise-private' and (storage.foldername(name))[1] = auth.uid()::text)
with check (bucket_id = 'rentwise-private' and (storage.foldername(name))[1] = auth.uid()::text);
drop policy if exists rentwise_storage_delete on storage.objects;
create policy rentwise_storage_delete on storage.objects for delete to authenticated
using (bucket_id = 'rentwise-private' and (storage.foldername(name))[1] = auth.uid()::text);

-- These triggers serve tables with different row shapes. Keep each table's
-- field references in a separate executed branch so PostgreSQL never resolves
-- a field that does not exist on the current trigger record.
create or replace function public.protect_record_identity()
returns trigger language plpgsql security invoker set search_path = '' as $$
begin
  if new.user_id <> old.user_id or new.display_id <> old.display_id or new.created_at <> old.created_at then
    raise exception 'Record ownership and generated IDs cannot be changed';
  end if;
  if tg_table_name = 'agreements' then
    if new.property_id <> old.property_id or new.tenant_id <> old.tenant_id then
      raise exception 'An agreement tenant and property cannot be rewritten';
    end if;
    return new;
  end if;
  if tg_table_name = 'rent_receipts' then
    if new.rent_period_id <> old.rent_period_id or new.collection_date <> old.collection_date or
       new.amount <> old.amount or new.payment_method_id is distinct from old.payment_method_id then
      raise exception 'A saved receipt is immutable; void it and create a correction instead';
    end if;
  end if;
  return new;
end;
$$;

create or replace function public.enforce_account_relationships()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if tg_table_name = 'properties' then
    if new.property_type_id is not null and not exists (
      select 1 from public.property_types x where x.id = new.property_type_id and x.user_id = new.user_id
    ) then raise exception 'Property type belongs to another account'; end if;
    return new;
  end if;
  if tg_table_name = 'agreements' then
    if not exists (select 1 from public.properties x where x.id = new.property_id and x.user_id = new.user_id)
       or not exists (select 1 from public.tenants x where x.id = new.tenant_id and x.user_id = new.user_id)
    then raise exception 'Agreement references another account'; end if;
    return new;
  end if;
  if tg_table_name = 'rent_increments' then
    if not exists (select 1 from public.agreements x where x.id = new.agreement_id and x.user_id = new.user_id)
    then raise exception 'Agreement belongs to another account'; end if;
    return new;
  end if;
  if tg_table_name = 'rent_periods' then
    if not exists (select 1 from public.agreements x where x.id = new.agreement_id and x.user_id = new.user_id)
    then raise exception 'Agreement belongs to another account'; end if;
    return new;
  end if;
  if tg_table_name = 'rent_charges' then
    if not exists (select 1 from public.rent_periods x where x.id = new.rent_period_id and x.user_id = new.user_id)
    then raise exception 'Rent period belongs to another account'; end if;
    return new;
  end if;
  if tg_table_name = 'rent_receipts' then
    if not exists (select 1 from public.rent_periods x where x.id = new.rent_period_id and x.user_id = new.user_id)
       or (new.payment_method_id is not null and not exists (
         select 1 from public.payment_methods x where x.id = new.payment_method_id and x.user_id = new.user_id
       ))
    then raise exception 'Receipt references another account'; end if;
    return new;
  end if;
  if tg_table_name = 'expenses' then
    if new.category_id is not null and not exists (
      select 1 from public.expense_categories x where x.id = new.category_id and x.user_id = new.user_id
    ) then raise exception 'Expense category belongs to another account'; end if;
    return new;
  end if;
  if tg_table_name = 'expense_allocations' then
    if not exists (select 1 from public.expenses x where x.id = new.expense_id and x.user_id = new.user_id)
       or not exists (select 1 from public.properties x where x.id = new.property_id and x.user_id = new.user_id)
    then raise exception 'Expense allocation references another account'; end if;
    return new;
  end if;
  if tg_table_name = 'attachments' then
    if not (
      (new.entity_type = 'tenant' and exists (select 1 from public.tenants x where x.id = new.entity_id and x.user_id = new.user_id)) or
      (new.entity_type = 'property' and exists (select 1 from public.properties x where x.id = new.entity_id and x.user_id = new.user_id)) or
      (new.entity_type = 'agreement' and exists (select 1 from public.agreements x where x.id = new.entity_id and x.user_id = new.user_id)) or
      (new.entity_type = 'receipt' and exists (select 1 from public.rent_receipts x where x.id = new.entity_id and x.user_id = new.user_id)) or
      (new.entity_type = 'expense' and exists (select 1 from public.expenses x where x.id = new.entity_id and x.user_id = new.user_id))
    ) then raise exception 'Attachment target belongs to another account'; end if;
  end if;
  return new;
end;
$$;

create or replace function public.prevent_used_record_delete()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if tg_table_name = 'properties' then
    if exists (select 1 from public.agreements x where x.property_id = old.id) or
       exists (select 1 from public.expense_allocations x where x.property_id = old.id) or
       exists (select 1 from public.attachments x where x.entity_type = 'property' and x.entity_id = old.id)
    then raise exception 'A property connected to another record cannot be deleted'; end if;
    return old;
  end if;
  if tg_table_name = 'tenants' then
    if exists (select 1 from public.agreements x where x.tenant_id = old.id) or
       exists (select 1 from public.attachments x where x.entity_type = 'tenant' and x.entity_id = old.id)
    then raise exception 'A tenant connected to another record cannot be deleted'; end if;
  end if;
  return old;
end;
$$;

select pg_catalog.set_config('search_path', '', false);
