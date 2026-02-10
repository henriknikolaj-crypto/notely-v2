-- Plan/entitlements: plan_limits + quota_usage + profiles columns + rate limit RPC
-- Idempotent-ish: safe to re-run on partially applied schema

-- 1) profiles: plan + (legacy) quota fields
alter table public.profiles add column if not exists plan text;
alter table public.profiles add column if not exists quota integer;
alter table public.profiles add column if not exists quota_renew_at timestamptz;

update public.profiles
set plan = 'freemium'
where plan is null or btrim(plan) = '';

alter table public.profiles
  alter column plan set default 'freemium';

-- 2) plan_limits (plan + feature => monthly_limit)
create table if not exists public.plan_limits (
  plan text not null,
  feature text not null,
  monthly_limit integer null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.plan_limits add column if not exists monthly_limit integer null;
alter table public.plan_limits add column if not exists created_at timestamptz not null default now();
alter table public.plan_limits add column if not exists updated_at timestamptz not null default now();

-- dedupe + ensure PK exists
do $$
begin
  delete from public.plan_limits a
  using public.plan_limits b
  where a.ctid < b.ctid and a.plan = b.plan and a.feature = b.feature;

  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.plan_limits'::regclass and contype = 'p'
  ) then
    alter table public.plan_limits add primary key (plan, feature);
  end if;
end $$;

-- 3) quota_usage (cache for monthly usage)
create table if not exists public.quota_usage (
  owner_id uuid not null,
  feature text not null,
  month_start timestamptz not null,
  reset_at timestamptz not null,
  used integer not null default 0,
  reserved integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.quota_usage add column if not exists reset_at timestamptz not null default now();
alter table public.quota_usage add column if not exists used integer not null default 0;
alter table public.quota_usage add column if not exists reserved integer not null default 0;
alter table public.quota_usage add column if not exists created_at timestamptz not null default now();
alter table public.quota_usage add column if not exists updated_at timestamptz not null default now();

create index if not exists quota_usage_owner_feature_month_idx
  on public.quota_usage (owner_id, feature, month_start desc);

do $$
begin
  -- dedupe + ensure PK
  delete from public.quota_usage a
  using public.quota_usage b
  where a.ctid < b.ctid
    and a.owner_id = b.owner_id
    and a.feature = b.feature
    and a.month_start = b.month_start;

  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.quota_usage'::regclass and contype = 'p'
  ) then
    alter table public.quota_usage add primary key (owner_id, feature, month_start);
  end if;
end $$;

-- 4) updated_at trigger helper
create or replace function public.notely_set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

do $$
begin
  if not exists (select 1 from pg_trigger where tgname = 'trg_plan_limits_updated_at') then
    create trigger trg_plan_limits_updated_at
    before update on public.plan_limits
    for each row execute function public.notely_set_updated_at();
  end if;

  if not exists (select 1 from pg_trigger where tgname = 'trg_quota_usage_updated_at') then
    create trigger trg_quota_usage_updated_at
    before update on public.quota_usage
    for each row execute function public.notely_set_updated_at();
  end if;
end $$;

-- 5) Backfill quota_usage for import (best-effort) + safe enum handling
do $$
begin
  if to_regclass('public.jobs') is not null then
    insert into public.quota_usage (owner_id, feature, month_start, reset_at, used, reserved)
    select
      j.owner_id,
      'import' as feature,
      (date_trunc('month', (coalesce(j.queued_at, j.created_at, now()) at time zone 'UTC')) at time zone 'UTC') as month_start,
      ((date_trunc('month', (coalesce(j.queued_at, j.created_at, now()) at time zone 'UTC')) at time zone 'UTC') + interval '1 month') as reset_at,
      count(*)::int as used,
      0 as reserved
    from public.jobs j
    where j.kind = 'import'
      and j.status::text in ('succeeded','finished','completed')
    group by j.owner_id, 3, 4
    on conflict (owner_id, feature, month_start)
    do update set
      used = excluded.used,
      reset_at = excluded.reset_at,
      updated_at = now();
  end if;
exception when others then
  raise notice 'quota_usage backfill skipped: %', SQLERRM;
end $$;

-- 6) Keep quota_usage in sync automatically for import jobs (best-effort)
create or replace function public.notely_quota_usage_from_jobs()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  ts timestamptz;
  mstart timestamptz;
  rset timestamptz;
  new_is_done boolean;
  old_is_done boolean;
begin
  if new.owner_id is null then
    return new;
  end if;

  new_is_done := (new.status::text in ('succeeded','finished','completed'));
  old_is_done := (tg_op = 'UPDATE') and (old.status::text in ('succeeded','finished','completed'));

  if new.kind = 'import' and new_is_done then
    if tg_op = 'UPDATE' and (old.status is not distinct from new.status) then
      return new;
    end if;
    if old_is_done then
      return new;
    end if;

    ts := coalesce(new.queued_at, new.created_at, now());
    mstart := (date_trunc('month', (ts at time zone 'UTC')) at time zone 'UTC');
    rset := mstart + interval '1 month';

    insert into public.quota_usage (owner_id, feature, month_start, reset_at, used, reserved)
    values (new.owner_id, 'import', mstart, rset, 1, 0)
    on conflict (owner_id, feature, month_start)
    do update set
      used = public.quota_usage.used + 1,
      reset_at = excluded.reset_at,
      updated_at = now();
  end if;

  return new;
end;
$$;

do $$
begin
  if to_regclass('public.jobs') is not null then
    if not exists (select 1 from pg_trigger where tgname = 'trg_jobs_quota_usage') then
      create trigger trg_jobs_quota_usage
      after insert or update of status on public.jobs
      for each row execute function public.notely_quota_usage_from_jobs();
    end if;
  end if;
exception when others then
  raise notice 'jobs quota trigger skipped: %', SQLERRM;
end $$;

-- 7) Rate limit state + RPC rate_limit_check (lib/rateLimit.ts calls this)
create table if not exists public.rate_limit_state (
  owner_id uuid not null,
  key text not null,
  window_start timestamptz not null,
  count integer not null default 0,
  last_hit_at timestamptz null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (owner_id, key)
);

alter table public.rate_limit_state add column if not exists created_at timestamptz not null default now();
alter table public.rate_limit_state add column if not exists updated_at timestamptz not null default now();

do $$
begin
  if not exists (select 1 from pg_trigger where tgname = 'trg_rate_limit_state_updated_at') then
    create trigger trg_rate_limit_state_updated_at
    before update on public.rate_limit_state
    for each row execute function public.notely_set_updated_at();
  end if;
end $$;

-- drop ALL existing overloads, then recreate (fixes "cannot change return type")
do $$
declare r record;
begin
  for r in
    select (n.nspname || '.' || p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ')') as sig
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'rate_limit_check'
  loop
    execute 'drop function if exists ' || r.sig;
  end loop;
end $$;

create or replace function public.rate_limit_check(
  p_owner_id uuid,
  p_key text,
  p_limit integer,
  p_window_seconds integer,
  p_min_interval_ms integer default 0
)
returns table (allowed boolean, retry_after_ms integer)
language plpgsql
security definer
set search_path = public
as $$
declare
  now_ts timestamptz := now();
  row_rec record;
  window_end timestamptz;
  delta_ms integer;
  retry_ms integer;
begin
  if p_limit is null or p_limit <= 0 or p_window_seconds is null or p_window_seconds <= 0 then
    return query select true, 0;
    return;
  end if;

  select * into row_rec
  from public.rate_limit_state
  where owner_id = p_owner_id and key = p_key;

  if not found then
    insert into public.rate_limit_state(owner_id, key, window_start, count, last_hit_at)
    values (p_owner_id, p_key, now_ts, 1, now_ts);
    return query select true, 0;
    return;
  end if;

  if p_min_interval_ms is not null and p_min_interval_ms > 0 and row_rec.last_hit_at is not null then
    delta_ms := floor(extract(epoch from (now_ts - row_rec.last_hit_at)) * 1000);
    if delta_ms < p_min_interval_ms then
      return query select false, (p_min_interval_ms - delta_ms);
      return;
    end if;
  end if;

  window_end := row_rec.window_start + make_interval(secs => p_window_seconds);

  if now_ts >= window_end then
    update public.rate_limit_state
    set window_start = now_ts, count = 1, last_hit_at = now_ts, updated_at = now()
    where owner_id = p_owner_id and key = p_key;

    return query select true, 0;
    return;
  end if;

  if row_rec.count >= p_limit then
    retry_ms := greatest(0, floor(extract(epoch from (window_end - now_ts)) * 1000));
    return query select false, retry_ms;
    return;
  end if;

  update public.rate_limit_state
  set count = row_rec.count + 1, last_hit_at = now_ts, updated_at = now()
  where owner_id = p_owner_id and key = p_key;

  return query select true, 0;
end;
$$;

-- 8) Seed plan_limits
insert into public.plan_limits(plan, feature, monthly_limit)
values
  ('freemium','import',10),
  ('freemium','trainer_round',5),
  ('freemium','mc_generate',60),
  ('freemium','flashcards_generate',60),
  ('freemium','evaluate',10),

  ('basis','import',100),
  ('basis','trainer_round',null),
  ('basis','mc_generate',1000000),
  ('basis','flashcards_generate',1000000),
  ('basis','evaluate',1000000),

  ('pro','import',200),
  ('pro','trainer_round',null),
  ('pro','mc_generate',1000000),
  ('pro','flashcards_generate',1000000),
  ('pro','evaluate',1000000)
on conflict (plan, feature)
do update set
  monthly_limit = excluded.monthly_limit,
  updated_at = now();