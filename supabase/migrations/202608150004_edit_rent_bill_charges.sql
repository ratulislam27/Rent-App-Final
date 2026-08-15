-- Allow landlords to correct an added bill charge without weakening the financial audit trail.

create or replace function public.update_rent_bill_charge(
  p_charge_id uuid,
  p_reason text,
  p_amount numeric
)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_user uuid := auth.uid();
  v_bill_id uuid;
  v_agreement_id uuid;
  v_bill_total numeric;
  v_paid numeric;
begin
  if v_user is null or not public.current_user_is_active() then raise exception 'Authentication required'; end if;
  if trim(coalesce(p_reason, '')) = '' or p_amount <= 0 then
    raise exception 'A charge reason and amount greater than zero are required';
  end if;

  select c.rent_period_id, p.agreement_id
  into v_bill_id, v_agreement_id
  from public.rent_charges c
  join public.rent_periods p on p.id = c.rent_period_id
  where c.id = p_charge_id and c.user_id = v_user and p.user_id = v_user and p.voided_at is null;
  if not found then raise exception 'Bill charge not found'; end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('rent-payment:' || v_agreement_id::text, 0)
  );

  select p.base_rent + coalesce(sum(case when c.id = p_charge_id then p_amount else c.amount end), 0)
  into v_bill_total
  from public.rent_periods p
  left join public.rent_charges c on c.rent_period_id = p.id
  where p.id = v_bill_id
  group by p.base_rent;

  select coalesce(sum(a.allocated_amount), 0)
  into v_paid
  from public.rent_payment_allocations a
  join public.rent_receipts r on r.id = a.receipt_id and r.status = 'valid'
  where a.rent_period_id = v_bill_id;

  if v_paid > v_bill_total + 0.01 then
    raise exception 'The revised bill total cannot be less than the payments already applied';
  end if;

  perform set_config('rentwise.charge_mode', 'on', true);
  update public.rent_charges
  set reason = trim(p_reason), amount = p_amount
  where id = p_charge_id and user_id = v_user;
end;
$$;

create or replace function public.protect_rent_charge_change()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if current_setting('rentwise.restore_mode', true) = 'on' or current_setting('rentwise.charge_mode', true) = 'on' then
    if tg_op = 'DELETE' then return old; end if;
    return new;
  end if;
  raise exception 'Bill charges can only be changed through the corresponding Rentwise operation';
end;
$$;

drop trigger if exists rent_charges_protect_change on public.rent_charges;
create trigger rent_charges_protect_change
before update or delete on public.rent_charges
for each row execute function public.protect_rent_charge_change();

revoke all on function public.update_rent_bill_charge(uuid,text,numeric) from public, anon;
grant execute on function public.update_rent_bill_charge(uuid,text,numeric) to authenticated;
revoke all on function public.protect_rent_charge_change() from public, anon, authenticated;
