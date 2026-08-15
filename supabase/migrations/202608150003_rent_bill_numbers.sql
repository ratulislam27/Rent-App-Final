-- Use bill identifiers consistently throughout the rent-billing workflow.
-- Existing numeric sequences are preserved (INV000001 becomes BIL000001).

do $$
begin
  perform set_config('rentwise.restore_mode', 'on', true);
  update public.rent_periods
  set display_id = 'BIL' || substring(display_id from 4)
  where display_id ~ '^INV[0-9]{6}$';
  perform set_config('rentwise.restore_mode', 'off', true);
end;
$$;

create or replace function public.normalize_rent_bill_display_id()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.display_id ~ '^INV[0-9]+$' then
    new.display_id := 'BIL' || substring(new.display_id from 4);
  end if;
  return new;
end;
$$;

drop trigger if exists rent_periods_normalize_display_id on public.rent_periods;
create trigger rent_periods_normalize_display_id before insert on public.rent_periods
for each row execute function public.normalize_rent_bill_display_id();

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

revoke all on function public.normalize_rent_bill_display_id() from public, anon, authenticated;

