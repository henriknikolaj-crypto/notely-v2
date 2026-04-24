alter table public.notes
add column if not exists metadata jsonb not null default '{}'::jsonb;
