-- verified_sources: whitelist + tiers
create table if not exists public.verified_sources (
  id uuid primary key default gen_random_uuid(),
  domain text unique not null,             -- fx 'pubmed.ncbi.nlm.nih.gov'
  display_name text,
  country text check (country in ('DK','EU','INT')) default 'INT',
  subject text,                            -- fx 'health','law','stats','science','tech'
  tier text check (tier in ('A','B','C')) not null default 'B',
  weight numeric not null default 1.0,     -- A=1.0, B=0.6, C=0.3 (kan overrides)
  active boolean not null default true,
  notes text,
  inserted_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.verified_sources enable row level security;

-- Læs for alle autentificerede brugere
drop policy if exists vs_select on public.verified_sources;
create policy vs_select on public.verified_sources
for select using (true);

-- Skriv kun via service role (ingen insert/update/delete for klienter)
revoke all on public.verified_sources from anon, authenticated;
grant select on public.verified_sources to authenticated;
