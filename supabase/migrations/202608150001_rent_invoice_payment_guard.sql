-- Keep the invoice balance authoritative even when two payments are submitted concurrently.
-- The existing RPC validates allocations; this trigger is the final database invariant.

create or replace function public.enforce_rent_invoice_payment_balance()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  v_agreement_id uuid;
  v_bill_total numeric;
  v_paid numeric;
  v_receipt_status text;
begin
  if current_setting('rentwise.restore_mode', true) = 'on' then return new; end if;

  select p.agreement_id,
    p.base_rent + coalesce((
      select sum(c.amount) from public.rent_charges c where c.rent_period_id = p.id
    ), 0)
  into v_agreement_id, v_bill_total
  from public.rent_periods p
  where p.id = new.rent_period_id and p.user_id = new.user_id and p.voided_at is null;
  if not found then raise exception 'A payment allocation references an invalid rent bill'; end if;

  select r.status into v_receipt_status
  from public.rent_receipts r
  where r.id = new.receipt_id and r.user_id = new.user_id and r.agreement_id = v_agreement_id;
  if not found then raise exception 'A payment allocation references an invalid receipt'; end if;
  if v_receipt_status <> 'valid' then raise exception 'A payment cannot be allocated from a void receipt'; end if;

  -- Serialize payments for an agreement before calculating its current paid amount.
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('rent-payment:' || v_agreement_id::text, 0)
  );

  if tg_op = 'UPDATE' then
    select coalesce(sum(a.allocated_amount), 0) into v_paid
    from public.rent_payment_allocations a
    join public.rent_receipts r on r.id = a.receipt_id and r.status = 'valid'
    where a.rent_period_id = new.rent_period_id and a.id <> old.id;
  else
    select coalesce(sum(a.allocated_amount), 0) into v_paid
    from public.rent_payment_allocations a
    join public.rent_receipts r on r.id = a.receipt_id and r.status = 'valid'
    where a.rent_period_id = new.rent_period_id;
  end if;

  if v_paid + new.allocated_amount > v_bill_total + 0.01 then
    raise exception 'A payment allocation exceeds the bill balance';
  end if;
  return new;
end;
$$;

drop trigger if exists payment_allocations_balance_guard on public.rent_payment_allocations;
create trigger payment_allocations_balance_guard
before insert or update on public.rent_payment_allocations
for each row execute function public.enforce_rent_invoice_payment_balance();

revoke all on function public.enforce_rent_invoice_payment_balance() from public, anon, authenticated;

