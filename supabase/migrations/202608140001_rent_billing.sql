-- Upgrade collection-first rent periods into permanent monthly rent bills.
-- Existing periods and receipts are preserved and backfilled into allocations.

alter table public.rent_periods add column if not exists display_id text;
alter table public.rent_periods add column if not exists issue_date date;
alter table public.rent_periods add column if not exists due_date date;
alter table public.rent_periods add column if not exists void_reason text;
alter table public.rent_periods add column if not exists voided_at timestamptz;

alter table public.rent_receipts add column if not exists agreement_id uuid references public.agreements(id) on delete restrict;
alter table public.rent_receipts add column if not exists unallocated_amount numeric(14,2) not null default 0 check (unallocated_amount >= 0);
alter table public.rent_receipts alter column rent_period_id drop not null;

with ranked as (
  select id, 'BIL' || lpad(row_number() over (partition by user_id order by rent_month, created_at, id)::text, 6, '0') as generated_id
  from public.rent_periods
)
update public.rent_periods p set display_id = ranked.generated_id
from ranked where ranked.id = p.id and p.display_id is null;

update public.rent_periods p set
  issue_date = coalesce(p.issue_date, p.rent_month),
  due_date = coalesce(
    p.due_date,
    (date_trunc('month', p.rent_month + make_interval(months => a.collection_offset))::date + (a.due_day - 1))
  )
from public.agreements a where a.id = p.agreement_id;

update public.rent_receipts r set agreement_id = p.agreement_id
from public.rent_periods p where p.id = r.rent_period_id and r.agreement_id is null;

alter table public.rent_periods alter column display_id set not null;
alter table public.rent_periods alter column issue_date set not null;
alter table public.rent_periods alter column due_date set not null;
alter table public.rent_receipts alter column agreement_id set not null;

create unique index if not exists rent_periods_user_display_id_unique on public.rent_periods(user_id, display_id);
create index if not exists idx_rent_periods_user_due on public.rent_periods(user_id, due_date);

insert into public.account_sequences(user_id, entity_type, last_value)
select user_id, 'rent_bill', count(*) from public.rent_periods group by user_id
on conflict (user_id, entity_type) do update
set last_value = greatest(public.account_sequences.last_value, excluded.last_value);

create table if not exists public.rent_payment_allocations (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  receipt_id uuid not null references public.rent_receipts(id) on delete cascade,
  rent_period_id uuid not null references public.rent_periods(id) on delete restrict,
  allocated_amount numeric(14,2) not null check (allocated_amount > 0),
  created_at timestamptz not null default now(),
  unique(receipt_id, rent_period_id)
);

create index if not exists idx_payment_allocations_bill on public.rent_payment_allocations(rent_period_id);
create index if not exists idx_payment_allocations_receipt on public.rent_payment_allocations(receipt_id);

insert into public.rent_payment_allocations(user_id, receipt_id, rent_period_id, allocated_amount, created_at)
select r.user_id, r.id, r.rent_period_id, r.amount, r.created_at
from public.rent_receipts r
where r.rent_period_id is not null
on conflict (receipt_id, rent_period_id) do nothing;

create or replace function public.next_owner_display_id(p_user uuid, p_entity_type text, p_prefix text, p_width integer)
returns text language plpgsql security definer set search_path = '' as $$
declare next_value bigint;
begin
  insert into public.account_sequences(user_id, entity_type, last_value)
  values (p_user, p_entity_type, 1)
  on conflict (user_id, entity_type)
  do update set last_value = public.account_sequences.last_value + 1
  returning last_value into next_value;
  return p_prefix || lpad(next_value::text, p_width, '0');
end;
$$;

create or replace function public.generate_rent_bills_for_user(p_user uuid, p_through_month date)
returns integer language plpgsql security definer set search_path = '' as $$
declare
  v_agreement public.agreements;
  v_month date;
  v_last_month date;
  v_rent numeric;
  v_created integer := 0;
begin
  if p_user is null then raise exception 'A landlord account is required'; end if;
  p_through_month := date_trunc('month', p_through_month)::date;
  perform set_config('rentwise.billing_mode', 'on', true);
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('rent-bills:' || p_user::text, 0));

  for v_agreement in
    select * from public.agreements a
    where a.user_id = p_user and a.archived_at is null
      and date_trunc('month', a.start_date)::date <= p_through_month
  loop
    v_last_month := least(
      date_trunc('month', coalesce(v_agreement.terminated_on, v_agreement.end_date))::date,
      p_through_month
    );
    v_month := date_trunc('month', v_agreement.start_date)::date;
    while v_month <= v_last_month loop
      if not exists (
        select 1 from public.rent_periods p
        where p.agreement_id = v_agreement.id and p.rent_month = v_month
      ) then
        select coalesce((
          select i.new_base_rent from public.rent_increments i
          where i.agreement_id = v_agreement.id and i.start_month <= v_month
            and (i.end_month is null or i.end_month >= v_month)
          order by i.start_month desc limit 1
        ), v_agreement.monthly_base_rent) into v_rent;

        insert into public.rent_periods(
          user_id, display_id, agreement_id, rent_month, issue_date, due_date, base_rent
        ) values (
          p_user,
          public.next_owner_display_id(p_user, 'rent_bill', 'BIL', 6),
          v_agreement.id,
          v_month,
          v_month,
          date_trunc('month', v_month + make_interval(months => v_agreement.collection_offset))::date + (v_agreement.due_day - 1),
          v_rent
        );
        v_created := v_created + 1;
      end if;
      v_month := (v_month + interval '1 month')::date;
    end loop;
  end loop;
  return v_created;
end;
$$;

create or replace function public.apply_available_rent_credit(p_user uuid, p_agreement_id uuid)
returns numeric language plpgsql security definer set search_path = '' as $$
declare
  v_receipt public.rent_receipts;
  v_bill public.rent_periods;
  v_bill_remaining numeric;
  v_apply numeric;
  v_applied numeric := 0;
begin
  perform set_config('rentwise.payment_mode', 'on', true);
  for v_receipt in
    select * from public.rent_receipts r
    where r.user_id = p_user and r.agreement_id = p_agreement_id
      and r.status = 'valid' and r.unallocated_amount > 0
    order by r.collection_date, r.created_at, r.id
  loop
    for v_bill in
      select * from public.rent_periods p
      where p.user_id = p_user and p.agreement_id = p_agreement_id and p.voided_at is null
      order by p.rent_month, p.created_at, p.id
    loop
      select greatest(0, v_bill.base_rent
        + coalesce((select sum(c.amount) from public.rent_charges c where c.rent_period_id = v_bill.id), 0)
        - coalesce((select sum(a.allocated_amount)
            from public.rent_payment_allocations a
            join public.rent_receipts rr on rr.id = a.receipt_id and rr.status = 'valid'
            where a.rent_period_id = v_bill.id), 0))
      into v_bill_remaining;
      v_apply := least(v_receipt.unallocated_amount, v_bill_remaining);
      if v_apply > 0 then
        insert into public.rent_payment_allocations(user_id, receipt_id, rent_period_id, allocated_amount)
        values (p_user, v_receipt.id, v_bill.id, v_apply)
        on conflict (receipt_id, rent_period_id) do update
        set allocated_amount = public.rent_payment_allocations.allocated_amount + excluded.allocated_amount;
        update public.rent_receipts set
          unallocated_amount = unallocated_amount - v_apply,
          rent_period_id = coalesce(rent_period_id, v_bill.id)
        where id = v_receipt.id;
        v_receipt.unallocated_amount := v_receipt.unallocated_amount - v_apply;
        v_applied := v_applied + v_apply;
      end if;
      exit when v_receipt.unallocated_amount <= 0.009;
    end loop;
  end loop;
  return v_applied;
end;
$$;

create or replace function public.ensure_rent_bills(p_through_month date default current_date)
returns integer language plpgsql security definer set search_path = '' as $$
declare
  v_user uuid := auth.uid();
  v_created integer;
  v_agreement uuid;
begin
  if v_user is null or not public.current_user_is_active() then raise exception 'Authentication required'; end if;
  p_through_month := least(date_trunc('month', p_through_month)::date, date_trunc('month', current_date)::date);
  v_created := public.generate_rent_bills_for_user(v_user, p_through_month);
  for v_agreement in select id from public.agreements where user_id = v_user loop
    perform public.apply_available_rent_credit(v_user, v_agreement);
  end loop;
  return v_created;
end;
$$;

create or replace function public.generate_all_due_rent_bills()
returns integer language plpgsql security definer set search_path = '' as $$
declare
  v_user uuid;
  v_agreement uuid;
  v_created integer := 0;
begin
  for v_user in select id from public.profiles where is_active loop
    v_created := v_created + public.generate_rent_bills_for_user(v_user, current_date);
    for v_agreement in select id from public.agreements where user_id = v_user loop
      perform public.apply_available_rent_credit(v_user, v_agreement);
    end loop;
  end loop;
  return v_created;
end;
$$;

create or replace function public.add_rent_bill_charge(p_rent_period_id uuid, p_reason text, p_amount numeric)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_user uuid := auth.uid();
  v_id uuid;
begin
  if v_user is null or not public.current_user_is_active() then raise exception 'Authentication required'; end if;
  if trim(coalesce(p_reason, '')) = '' or p_amount <= 0 then raise exception 'A charge reason and amount greater than zero are required'; end if;
  if not exists (select 1 from public.rent_periods p where p.id = p_rent_period_id and p.user_id = v_user and p.voided_at is null)
  then raise exception 'Rent bill not found'; end if;
  perform set_config('rentwise.charge_mode', 'on', true);
  insert into public.rent_charges(user_id, rent_period_id, reason, amount)
  values (v_user, p_rent_period_id, trim(p_reason), p_amount) returning id into v_id;
  return v_id;
end;
$$;

create or replace function public.record_rent_payment(
  p_request_key uuid,
  p_agreement_id uuid,
  p_collection_date date,
  p_amount numeric,
  p_payment_method_id uuid,
  p_collected_by text,
  p_notes text,
  p_allocations jsonb
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_user uuid := auth.uid();
  v_receipt public.rent_receipts;
  v_allocation jsonb;
  v_allocation_total numeric := 0;
  v_outstanding numeric;
  v_period_id uuid;
  v_allocation_amount numeric;
  v_primary_period uuid;
begin
  if v_user is null or not public.current_user_is_active() then raise exception 'Authentication required'; end if;
  if p_request_key is null or p_amount <= 0 then raise exception 'A request key and payment amount greater than zero are required'; end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_request_key::text, 0));
  select * into v_receipt from public.rent_receipts where user_id = v_user and request_key = p_request_key;
  if found then return to_jsonb(v_receipt); end if;
  if not exists (select 1 from public.agreements a where a.id = p_agreement_id and a.user_id = v_user)
  then raise exception 'Agreement not found'; end if;
  if p_payment_method_id is not null and not exists (
    select 1 from public.payment_methods m where m.id = p_payment_method_id and m.user_id = v_user
  ) then raise exception 'Payment method not found'; end if;
  if exists (
    select 1 from jsonb_array_elements(coalesce(p_allocations, '[]'::jsonb)) x
    group by x->>'rent_period_id' having count(*) > 1
  ) then raise exception 'A rent bill can appear only once in a payment'; end if;

  for v_allocation in select * from jsonb_array_elements(coalesce(p_allocations, '[]'::jsonb)) loop
    v_period_id := (v_allocation->>'rent_period_id')::uuid;
    v_allocation_amount := (v_allocation->>'amount')::numeric;
    if v_allocation_amount <= 0 then raise exception 'Allocation amounts must be greater than zero'; end if;
    if not exists (
      select 1 from public.rent_periods p
      where p.id = v_period_id and p.user_id = v_user and p.agreement_id = p_agreement_id and p.voided_at is null
    ) then raise exception 'A payment allocation references an invalid rent bill'; end if;
    select greatest(0, p.base_rent
      + coalesce((select sum(c.amount) from public.rent_charges c where c.rent_period_id = p.id), 0)
      - coalesce((select sum(a.allocated_amount)
          from public.rent_payment_allocations a
          join public.rent_receipts r on r.id = a.receipt_id and r.status = 'valid'
          where a.rent_period_id = p.id), 0))
    into v_outstanding from public.rent_periods p where p.id = v_period_id;
    if v_allocation_amount > v_outstanding + 0.01 then raise exception 'A payment allocation exceeds the bill balance'; end if;
    v_allocation_total := v_allocation_total + v_allocation_amount;
    v_primary_period := coalesce(v_primary_period, v_period_id);
  end loop;
  if v_allocation_total > p_amount + 0.01 then raise exception 'Payment allocations exceed the amount received'; end if;

  perform set_config('rentwise.payment_mode', 'on', true);
  insert into public.rent_receipts(
    user_id, request_key, agreement_id, rent_period_id, collection_date, amount, unallocated_amount,
    payment_method_id, collected_by, notes
  ) values (
    v_user, p_request_key, p_agreement_id, v_primary_period, p_collection_date, p_amount,
    greatest(0, p_amount - v_allocation_total), p_payment_method_id, nullif(trim(p_collected_by), ''), coalesce(p_notes, '')
  ) returning * into v_receipt;

  insert into public.rent_payment_allocations(user_id, receipt_id, rent_period_id, allocated_amount)
  select v_user, v_receipt.id, (x->>'rent_period_id')::uuid, (x->>'amount')::numeric
  from jsonb_array_elements(coalesce(p_allocations, '[]'::jsonb)) x
  where (x->>'amount')::numeric > 0;
  return to_jsonb(v_receipt);
end;
$$;

create or replace function public.void_rent_receipt(p_receipt_id uuid, p_reason text)
returns void language plpgsql security definer set search_path = '' as $$
declare v_user uuid := auth.uid();
begin
  if v_user is null or not public.current_user_is_active() then raise exception 'Authentication required'; end if;
  if trim(coalesce(p_reason, '')) = '' then raise exception 'A void reason is required'; end if;
  update public.rent_receipts set status = 'void', void_reason = trim(p_reason), voided_at = now()
  where id = p_receipt_id and user_id = v_user and status = 'valid';
  if not found then raise exception 'Valid receipt not found'; end if;
end;
$$;

create or replace function public.restore_account_backup(p_backup jsonb, p_confirmation text)
returns void language plpgsql security definer set search_path = '' as $$
declare v_user uuid := auth.uid();
begin
  if v_user is null or not public.current_user_is_active() then raise exception 'Authentication required'; end if;
  if p_confirmation <> 'RESTORE' then raise exception 'Type RESTORE to confirm'; end if;
  if coalesce(p_backup->'profile'->>'id', '') <> v_user::text then raise exception 'This backup belongs to a different landlord account'; end if;
  if jsonb_typeof(p_backup->'properties') <> 'array' or jsonb_typeof(p_backup->'tenants') <> 'array' or jsonb_typeof(p_backup->'agreements') <> 'array'
  then raise exception 'Backup data is incomplete'; end if;

  perform set_config('rentwise.restore_mode', 'on', true);
  perform set_config('rentwise.billing_mode', 'on', true);
  perform set_config('rentwise.charge_mode', 'on', true);
  perform set_config('rentwise.payment_mode', 'on', true);

  delete from public.attachments where user_id = v_user;
  delete from public.rent_payment_allocations where user_id = v_user;
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
  from jsonb_to_recordset(coalesce(p_backup->'propertyTypes', '[]'::jsonb)) as x(id uuid, name text, is_active boolean, created_at timestamptz);
  insert into public.payment_methods(id, user_id, name, is_active, created_at)
  select x.id, v_user, x.name, x.is_active, coalesce(x.created_at, now())
  from jsonb_to_recordset(coalesce(p_backup->'paymentMethods', '[]'::jsonb)) as x(id uuid, name text, is_active boolean, created_at timestamptz);
  insert into public.expense_categories(id, user_id, name, is_active, created_at)
  select x.id, v_user, x.name, x.is_active, coalesce(x.created_at, now())
  from jsonb_to_recordset(coalesce(p_backup->'expenseCategories', '[]'::jsonb)) as x(id uuid, name text, is_active boolean, created_at timestamptz);

  insert into public.properties(id, user_id, display_id, name, property_type_id, location, status, notes, archived_at, created_at, updated_at)
  select x.id, v_user, x.display_id, x.name, x.property_type_id, coalesce(x.location,''), x.status, coalesce(x.notes,''), x.archived_at, x.created_at, x.updated_at
  from jsonb_to_recordset(p_backup->'properties') as x(id uuid, display_id text, name text, property_type_id uuid, location text, status text, notes text, archived_at timestamptz, created_at timestamptz, updated_at timestamptz);
  insert into public.tenants(id, user_id, display_id, name, phone, email, address, nid, profile_image_path, notes, archived_at, created_at, updated_at)
  select x.id, v_user, x.display_id, x.name, x.phone, x.email, coalesce(x.address,''), x.nid, x.profile_image_path, coalesce(x.notes,''), x.archived_at, x.created_at, x.updated_at
  from jsonb_to_recordset(p_backup->'tenants') as x(id uuid, display_id text, name text, phone text, email text, address text, nid text, profile_image_path text, notes text, archived_at timestamptz, created_at timestamptz, updated_at timestamptz);
  insert into public.agreements(id, user_id, display_id, tenant_id, property_id, start_date, end_date, security_deposit, notice_period_months, monthly_base_rent, collection_offset, due_day, notes, terminated_on, termination_note, archived_at, created_at, updated_at)
  select x.id, v_user, x.display_id, x.tenant_id, x.property_id, x.start_date, x.end_date, x.security_deposit, x.notice_period_months, x.monthly_base_rent, x.collection_offset, x.due_day, coalesce(x.notes,''), x.terminated_on, x.termination_note, x.archived_at, x.created_at, x.updated_at
  from jsonb_to_recordset(p_backup->'agreements') as x(id uuid, display_id text, tenant_id uuid, property_id uuid, start_date date, end_date date, security_deposit numeric, notice_period_months integer, monthly_base_rent numeric, collection_offset smallint, due_day smallint, notes text, terminated_on date, termination_note text, archived_at timestamptz, created_at timestamptz, updated_at timestamptz);
  insert into public.rent_increments(id, user_id, agreement_id, start_month, end_month, new_base_rent, note, created_at)
  select x.id, v_user, x.agreement_id, x.start_month, x.end_month, x.new_base_rent, coalesce(x.note,''), x.created_at
  from jsonb_to_recordset(coalesce(p_backup->'increments', '[]'::jsonb)) as x(id uuid, agreement_id uuid, start_month date, end_month date, new_base_rent numeric, note text, created_at timestamptz);

  insert into public.rent_periods(id, user_id, display_id, agreement_id, rent_month, issue_date, due_date, base_rent, void_reason, voided_at, created_at, updated_at)
  select x.id, v_user, coalesce(x.display_id, public.next_owner_display_id(v_user, 'rent_bill', 'BIL', 6)), x.agreement_id, x.rent_month,
    coalesce(x.issue_date, x.rent_month),
    coalesce(x.due_date, date_trunc('month', x.rent_month + make_interval(months => a.collection_offset))::date + (a.due_day - 1)),
    x.base_rent, x.void_reason, x.voided_at, x.created_at, x.updated_at
  from jsonb_to_recordset(coalesce(p_backup->'rentPeriods', '[]'::jsonb)) as x(id uuid, display_id text, agreement_id uuid, rent_month date, issue_date date, due_date date, base_rent numeric, void_reason text, voided_at timestamptz, created_at timestamptz, updated_at timestamptz)
  join public.agreements a on a.id = x.agreement_id and a.user_id = v_user;
  insert into public.rent_charges(id, user_id, rent_period_id, reason, amount, created_at)
  select x.id, v_user, x.rent_period_id, x.reason, x.amount, x.created_at
  from jsonb_to_recordset(coalesce(p_backup->'rentCharges', '[]'::jsonb)) as x(id uuid, rent_period_id uuid, reason text, amount numeric, created_at timestamptz);
  insert into public.rent_receipts(id, user_id, display_id, request_key, agreement_id, rent_period_id, collection_date, amount, unallocated_amount, payment_method_id, collected_by, notes, status, void_reason, voided_at, created_at, updated_at)
  select x.id, v_user, x.display_id, coalesce(x.request_key, gen_random_uuid()), coalesce(x.agreement_id, p.agreement_id), x.rent_period_id, x.collection_date, x.amount,
    coalesce(x.unallocated_amount, 0), x.payment_method_id, x.collected_by, coalesce(x.notes,''), x.status, x.void_reason, x.voided_at, x.created_at, x.updated_at
  from jsonb_to_recordset(coalesce(p_backup->'receipts', '[]'::jsonb)) as x(id uuid, display_id text, request_key uuid, agreement_id uuid, rent_period_id uuid, collection_date date, amount numeric, unallocated_amount numeric, payment_method_id uuid, collected_by text, notes text, status text, void_reason text, voided_at timestamptz, created_at timestamptz, updated_at timestamptz)
  left join public.rent_periods p on p.id = x.rent_period_id;
  insert into public.rent_payment_allocations(id, user_id, receipt_id, rent_period_id, allocated_amount, created_at)
  select x.id, v_user, x.receipt_id, x.rent_period_id, x.allocated_amount, coalesce(x.created_at, now())
  from jsonb_to_recordset(coalesce(p_backup->'paymentAllocations', '[]'::jsonb)) as x(id uuid, receipt_id uuid, rent_period_id uuid, allocated_amount numeric, created_at timestamptz);
  if jsonb_array_length(coalesce(p_backup->'paymentAllocations', '[]'::jsonb)) = 0 then
    insert into public.rent_payment_allocations(user_id, receipt_id, rent_period_id, allocated_amount, created_at)
    select r.user_id, r.id, r.rent_period_id, r.amount, r.created_at from public.rent_receipts r
    where r.user_id = v_user and r.rent_period_id is not null;
  end if;

  insert into public.expenses(id, user_id, display_id, request_key, description, expense_date, amount, category_id, notes, status, archived_at, created_at, updated_at)
  select x.id, v_user, x.display_id, coalesce(x.request_key, gen_random_uuid()), x.description, x.expense_date, x.amount, x.category_id, coalesce(x.notes,''), x.status, x.archived_at, x.created_at, x.updated_at
  from jsonb_to_recordset(coalesce(p_backup->'expenses', '[]'::jsonb)) as x(id uuid, display_id text, request_key uuid, description text, expense_date date, amount numeric, category_id uuid, notes text, status text, archived_at timestamptz, created_at timestamptz, updated_at timestamptz);
  insert into public.expense_allocations(id, user_id, expense_id, property_id, allocated_amount)
  select x.id, v_user, x.expense_id, x.property_id, x.allocated_amount
  from jsonb_to_recordset(coalesce(p_backup->'allocations', '[]'::jsonb)) as x(id uuid, expense_id uuid, property_id uuid, allocated_amount numeric);
  insert into public.attachments(id, user_id, entity_type, entity_id, file_name, storage_path, content_type, size_bytes, created_at)
  select x.id, v_user, x.entity_type, x.entity_id, x.file_name, x.storage_path, x.content_type, x.size_bytes, x.created_at
  from jsonb_to_recordset(coalesce(p_backup->'attachments', '[]'::jsonb)) as x(id uuid, entity_type text, entity_id uuid, file_name text, storage_path text, content_type text, size_bytes bigint, created_at timestamptz);

  insert into public.account_sequences(user_id, entity_type, last_value) values
    (v_user, 'property', coalesce((select max(regexp_replace(display_id, '\D', '', 'g')::bigint) from public.properties where user_id = v_user), 0)),
    (v_user, 'tenant', coalesce((select max(regexp_replace(display_id, '\D', '', 'g')::bigint) from public.tenants where user_id = v_user), 0)),
    (v_user, 'agreement', coalesce((select max(regexp_replace(display_id, '\D', '', 'g')::bigint) from public.agreements where user_id = v_user), 0)),
    (v_user, 'rent_bill', coalesce((select max(regexp_replace(display_id, '\D', '', 'g')::bigint) from public.rent_periods where user_id = v_user), 0)),
    (v_user, 'receipt', coalesce((select max(regexp_replace(display_id, '\D', '', 'g')::bigint) from public.rent_receipts where user_id = v_user), 0)),
    (v_user, 'expense', coalesce((select max(regexp_replace(display_id, '\D', '', 'g')::bigint) from public.expenses where user_id = v_user), 0))
  on conflict (user_id, entity_type) do update set last_value = excluded.last_value;
end;
$$;

-- Preserve financial identities. Allocations may only be changed by controlled payment functions or backup restore.
create or replace function public.protect_rent_payment_allocation()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if current_setting('rentwise.payment_mode', true) = 'on' or current_setting('rentwise.restore_mode', true) = 'on' then
    if tg_op = 'DELETE' then return old; end if;
    return new;
  end if;
  raise exception 'Payment allocations can only be changed through a rent payment operation';
end;
$$;

create or replace function public.protect_generated_financial_insert()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if current_setting('rentwise.restore_mode', true) = 'on' then return new; end if;
  if tg_table_name = 'rent_periods' and current_setting('rentwise.billing_mode', true) = 'on' then return new; end if;
  if tg_table_name = 'rent_charges' and current_setting('rentwise.charge_mode', true) = 'on' then return new; end if;
  if tg_table_name = 'rent_receipts' and current_setting('rentwise.payment_mode', true) = 'on' then return new; end if;
  raise exception 'Financial records must be created through the corresponding Rentwise operation';
end;
$$;

create or replace function public.enforce_rent_receipt_account()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if not exists (
    select 1 from public.agreements a where a.id = new.agreement_id and a.user_id = new.user_id
  ) then raise exception 'Receipt agreement belongs to another account'; end if;
  if new.rent_period_id is not null and not exists (
    select 1 from public.rent_periods p
    where p.id = new.rent_period_id and p.user_id = new.user_id and p.agreement_id = new.agreement_id
  ) then raise exception 'Receipt rent bill belongs to another agreement'; end if;
  if new.payment_method_id is not null and not exists (
    select 1 from public.payment_methods m where m.id = new.payment_method_id and m.user_id = new.user_id
  ) then raise exception 'Receipt payment method belongs to another account'; end if;
  return new;
end;
$$;

create or replace function public.enforce_rent_payment_allocation_account()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if not exists (
    select 1 from public.rent_receipts r
    join public.rent_periods p on p.id = new.rent_period_id
    where r.id = new.receipt_id and r.user_id = new.user_id and p.user_id = new.user_id
      and r.agreement_id = p.agreement_id
  ) then raise exception 'Payment allocation references another account or agreement'; end if;
  return new;
end;
$$;

create or replace function public.protect_rent_receipt_financial_identity()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if current_setting('rentwise.restore_mode', true) = 'on' then return new; end if;
  if new.user_id <> old.user_id or new.display_id <> old.display_id or new.created_at <> old.created_at then
    raise exception 'Record ownership and generated IDs cannot be changed';
  end if;
  if current_setting('rentwise.payment_mode', true) <> 'on' and (
    new.agreement_id <> old.agreement_id or new.rent_period_id is distinct from old.rent_period_id or
    new.collection_date <> old.collection_date or new.amount <> old.amount or
    new.unallocated_amount <> old.unallocated_amount or
    new.payment_method_id is distinct from old.payment_method_id
  ) then raise exception 'A saved receipt is immutable; void it and create a correction instead'; end if;
  return new;
end;
$$;

create or replace function public.protect_rent_bill_identity()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if current_setting('rentwise.restore_mode', true) = 'on' then
    if tg_op = 'DELETE' then return old; end if;
    return new;
  end if;
  if tg_op = 'DELETE' then raise exception 'Rent bills remain in the financial audit trail'; end if;
  if new.user_id <> old.user_id or new.display_id <> old.display_id or new.agreement_id <> old.agreement_id or
     new.rent_month <> old.rent_month or new.issue_date <> old.issue_date or new.due_date <> old.due_date or
     new.base_rent <> old.base_rent or new.created_at <> old.created_at
  then raise exception 'A generated rent bill cannot be rewritten'; end if;
  return new;
end;
$$;

drop trigger if exists rent_receipts_enforce_account on public.rent_receipts;
create trigger rent_receipts_enforce_account before insert or update on public.rent_receipts
for each row execute function public.enforce_rent_receipt_account();

drop trigger if exists rent_periods_protect_insert on public.rent_periods;
create trigger rent_periods_protect_insert before insert on public.rent_periods
for each row execute function public.protect_generated_financial_insert();

drop trigger if exists rent_charges_protect_insert on public.rent_charges;
create trigger rent_charges_protect_insert before insert on public.rent_charges
for each row execute function public.protect_generated_financial_insert();

drop trigger if exists rent_receipts_protect_insert on public.rent_receipts;
create trigger rent_receipts_protect_insert before insert on public.rent_receipts
for each row execute function public.protect_generated_financial_insert();

drop trigger if exists rent_receipts_protect_identity on public.rent_receipts;
create trigger rent_receipts_protect_identity before update on public.rent_receipts
for each row execute function public.protect_rent_receipt_financial_identity();

drop trigger if exists rent_periods_protect_identity on public.rent_periods;
create trigger rent_periods_protect_identity before update or delete on public.rent_periods
for each row execute function public.protect_rent_bill_identity();

drop trigger if exists payment_allocations_enforce_account on public.rent_payment_allocations;
create trigger payment_allocations_enforce_account before insert or update on public.rent_payment_allocations
for each row execute function public.enforce_rent_payment_allocation_account();

drop trigger if exists payment_allocations_protect on public.rent_payment_allocations;
create trigger payment_allocations_protect before insert or update or delete on public.rent_payment_allocations
for each row execute function public.protect_rent_payment_allocation();

alter table public.rent_payment_allocations enable row level security;
drop policy if exists owner_all on public.rent_payment_allocations;
create policy owner_all on public.rent_payment_allocations for all to authenticated
using ((user_id = auth.uid() and public.current_user_is_active()) or public.current_user_is_admin())
with check ((user_id = auth.uid() and public.current_user_is_active()) or public.current_user_is_admin());

grant select, insert, update, delete on public.rent_payment_allocations to authenticated;
grant all privileges on public.rent_payment_allocations to service_role;

revoke all on function public.next_owner_display_id(uuid,text,text,integer) from public, anon, authenticated;
revoke all on function public.generate_rent_bills_for_user(uuid,date) from public, anon, authenticated;
revoke all on function public.apply_available_rent_credit(uuid,uuid) from public, anon, authenticated;
revoke all on function public.generate_all_due_rent_bills() from public, anon, authenticated;
revoke all on function public.ensure_rent_bills(date) from public, anon;
grant execute on function public.ensure_rent_bills(date) to authenticated;
revoke all on function public.add_rent_bill_charge(uuid,text,numeric) from public, anon;
grant execute on function public.add_rent_bill_charge(uuid,text,numeric) to authenticated;
revoke all on function public.record_rent_payment(uuid,uuid,date,numeric,uuid,text,text,jsonb) from public, anon;
grant execute on function public.record_rent_payment(uuid,uuid,date,numeric,uuid,text,text,jsonb) to authenticated;
revoke all on function public.void_rent_receipt(uuid,text) from public, anon;
grant execute on function public.void_rent_receipt(uuid,text) to authenticated;
revoke all on function public.restore_account_backup(jsonb,text) from public, anon;
grant execute on function public.restore_account_backup(jsonb,text) to authenticated;
revoke execute on function public.record_rent_collection(uuid,uuid,date,numeric,date,numeric,uuid,text,text,jsonb) from authenticated;

-- Supabase Cron is preferred, while the app-level ensure function remains a reliable catch-up fallback.
do $$
begin
  execute 'create extension if not exists pg_cron with schema extensions';
  if not exists (select 1 from cron.job where jobname = 'rentwise-generate-monthly-bills') then
    perform cron.schedule('rentwise-generate-monthly-bills', '17 0 * * *', 'select public.generate_all_due_rent_bills();');
  end if;
exception when others then
  raise notice 'Rentwise cron was not installed; app-open catch-up generation remains active: %', sqlerrm;
end;
$$;

select public.generate_all_due_rent_bills();
