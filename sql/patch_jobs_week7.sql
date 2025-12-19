-- === Jobs table patch (idempotent) ===
alter table if exists public.jobs
  add column if not exists meta jsonb,
  add column if not exists latency_ms integer,
  add column if not exists tokens_input integer,
  add column if not exists tokens_output integer,
  add column if not exists result jsonb,
  add column if not exists error text;

-- Sørg for basiskolonner (skulle allerede eksistere, men for en god ordens skyld):
alter table if exists public.jobs
  add column if not exists type text,
  add column if not exists owner_id uuid,
  add column if not exists status text,
  add column if not exists created_at timestamptz default now();

-- Hjælpeindeks til seneste jobs
create index if not exists jobs_owner_created_idx on public.jobs(owner_id, created_at desc);
