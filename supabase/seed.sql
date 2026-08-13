-- Run after creating the administrator through Supabase Auth.
-- Replace the email before executing. The partial unique index guarantees that
-- only one platform administrator can exist.
update public.profiles
set is_admin = true
where lower(email) = lower('admin@example.com');

select pg_catalog.set_config('search_path', '', false);
