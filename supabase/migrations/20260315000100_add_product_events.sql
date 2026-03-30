create table if not exists public.product_events (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.profiles(id) on delete cascade,
  event_name text not null,
  created_at timestamptz not null default timezone('utc', now()),
  metadata jsonb not null default '{}'::jsonb
);

create index if not exists product_events_owner_created_idx
  on public.product_events (owner_id, created_at desc);

create index if not exists product_events_event_created_idx
  on public.product_events (event_name, created_at desc);

alter table public.product_events enable row level security;

drop policy if exists "product_events_select_own" on public.product_events;
create policy "product_events_select_own"
  on public.product_events
  for select
  to authenticated
  using (auth.uid() = owner_id);
