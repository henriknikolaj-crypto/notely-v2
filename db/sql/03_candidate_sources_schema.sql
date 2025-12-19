-- public.candidate_sources: ukendte domæner som vi ser i ranking
create table if not exists public.candidate_sources (
  domain     text primary key,
  first_seen timestamptz not null default now(),
  last_seen  timestamptz not null default now(),
  hit_count  integer     not null default 1
);

alter table public.candidate_sources enable row level security;

drop policy if exists cs_select on public.candidate_sources;
create policy cs_select on public.candidate_sources for select using (true);

drop policy if exists cs_insert on public.candidate_sources;
create policy cs_insert on public.candidate_sources for insert with check (true);

drop policy if exists cs_update on public.candidate_sources;
create policy cs_update on public.candidate_sources for update using (true) with check (true);
