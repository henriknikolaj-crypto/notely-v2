create table if not exists public.candidate_sources (
  domain text primary key,
  first_seen timestamptz not null default now(),
  last_seen  timestamptz not null default now(),
  hit_count  integer not null default 1
);
alter table public.candidate_sources enable row level security;

-- Alle autentificerede må indsende domæner (kun insert/upsert)
drop policy if exists cs_upsert on public.candidate_sources;
create policy cs_upsert on public.candidate_sources
for insert with check (true);

drop policy if exists cs_update on public.candidate_sources;
create policy cs_update on public.candidate_sources
for update using (true) with check (true);

grant select, insert, update on public.candidate_sources to authenticated;
revoke delete on public.candidate_sources from authenticated, anon;
