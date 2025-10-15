-- Phase 4: plan_limits + ensure_quota_and_decrement
-- Safe to re-run (IF NOT EXISTS / CREATE OR REPLACE)

create table if not exists public.plan_limits (
  plan text primary key,
  monthly_quota integer not null,
  per_import_cost integer not null default 1,
  grace_until_days integer not null default 0, -- optional, for future 429 logic
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create or replace function public.touch_plan_limits_updated_at()
returns trigger language plpgsql as 
begin
  new.updated_at := now();
  return new;
end; ;

drop trigger if exists trg_plan_limits_updated on public.plan_limits;
create trigger trg_plan_limits_updated
before update on public.plan_limits
for each row execute function public.touch_plan_limits_updated_at();

-- Helper: next monthly renew (simple month add)
create or replace function public._next_month_renew(ts timestamptz)
returns timestamptz language sql immutable as 
  select (date_trunc('month', ) + interval '1 month')::timestamptz
;

-- RPC: ensure_quota_and_decrement(owner, cost) with row lock + renewal
-- Returns: ok bool, remaining int, code text
create or replace function public.ensure_quota_and_decrement(
  p_owner_id uuid,
  p_cost int
)
returns table(ok boolean, remaining int, code text)
language plpgsql
security definer
as 
declare
  v_plan text;
  v_quota int;
  v_renew_at timestamptz;
  v_monthly int;
  v_cost int := greatest(1, coalesce(p_cost,1));
begin
  -- Lock the profile row for atomicity
  select plan, quota, quota_renew_at
    into v_plan, v_quota, v_renew_at
  from public.profiles
  where id = p_owner_id
  for update;

  if v_plan is null then
    return query select false, coalesce(v_quota,0), 'PROFILE_NOT_FOUND';
    return;
  end if;

  -- Get plan limits
  select monthly_quota
    into v_monthly
  from public.plan_limits
  where plan = v_plan;

  if v_monthly is null then
    return query select false, coalesce(v_quota,0), 'PLAN_LIMITS_NOT_FOUND';
    return;
  end if;

  -- Renewal: if quota_renew_at is null or past, reset
  if v_renew_at is null or now() >= v_renew_at then
    update public.profiles
       set quota = v_monthly,
           quota_renew_at = public._next_month_renew(coalesce(v_renew_at, now()))
     where id = p_owner_id;
    v_quota := v_monthly;
  end if;

  -- Check quota
  if v_quota < v_cost then
    return query select false, v_quota, 'OUT_OF_CREDITS';
    return;
  end if;

  -- Decrement atomically
  update public.profiles
     set quota = quota - v_cost
   where id = p_owner_id;

  select quota into v_quota from public.profiles where id = p_owner_id;

  return query select true, v_quota, 'OK';
end;
;

-- Simple views (consumption snapshot)
create or replace view public.v_quota_profiles as
select p.id as owner_id, p.email, p.plan, p.quota, p.quota_renew_at
from public.profiles p;

create or replace view public.v_plan_limits as
select * from public.plan_limits;

-- Optional seed (safe upsert) - adjust later if you want
insert into public.plan_limits(plan, monthly_quota, per_import_cost)
values
  ('free', 20, 1),
  ('basic', 200, 1),
  ('pro', 1000, 1)
on conflict (plan) do update
set monthly_quota = excluded.monthly_quota,
    per_import_cost = excluded.per_import_cost;
