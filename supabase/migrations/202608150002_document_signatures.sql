-- A landlord-managed signature image for tenant-facing printable documents.

alter table public.user_settings
add column if not exists signature_path text;

