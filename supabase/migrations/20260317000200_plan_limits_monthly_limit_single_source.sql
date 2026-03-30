alter table public.plan_limits
  add column if not exists is_unlimited boolean not null default false;

do $$
begin
  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'plan_limits'
      and column_name = 'limit_per_month'
  ) then
    execute $sql$
      update public.plan_limits
      set monthly_limit = limit_per_month
      where monthly_limit is null
        and limit_per_month is not null
    $sql$;

    execute $sql$
      update public.plan_limits
      set is_unlimited = true
      where monthly_limit is null
    $sql$;

    execute $sql$
      alter table public.plan_limits
      drop column limit_per_month
    $sql$;
  else
    update public.plan_limits
    set is_unlimited = true
    where monthly_limit is null;
  end if;
end $$;

update public.plan_limits
set is_unlimited = false
where monthly_limit is not null;

create or replace function public.quota_try_consume(
  p_owner_id uuid,
  p_feature text,
  p_amount integer default 0
)
returns table (
  ok boolean,
  out_used integer,
  out_monthly_limit integer,
  out_reset_at timestamptz
)
language plpgsql
security definer
set search_path = public
as $$
declare
  now_ts timestamptz := now();
  amount_to_consume integer := greatest(0, coalesce(p_amount, 0));
  plan_raw text;
  plan_key text;
  quota_renew_at_ts timestamptz;
  month_start_ts timestamptz;
  reset_at_ts timestamptz;
  monthly_limit_value integer;
  is_unlimited_value boolean := false;
  used_now integer := 0;
  used_after integer := 0;
  guard_i integer := 0;
begin
  select p.plan, p.quota_renew_at
    into plan_raw, quota_renew_at_ts
  from public.profiles p
  where p.id = p_owner_id;

  plan_key := lower(btrim(coalesce(plan_raw, 'freemium')));
  if plan_key = '' then plan_key := 'freemium'; end if;
  if plan_key = 'free' then plan_key := 'freemium'; end if;
  if plan_key = 'basic' then plan_key := 'basis'; end if;

  if quota_renew_at_ts is null then
    month_start_ts := (date_trunc('month', (now_ts at time zone 'UTC')) at time zone 'UTC');
    reset_at_ts := month_start_ts + interval '1 month';
  else
    reset_at_ts := quota_renew_at_ts;
    while reset_at_ts <= now_ts and guard_i < 120 loop
      reset_at_ts := reset_at_ts + interval '1 month';
      guard_i := guard_i + 1;
    end loop;
    month_start_ts := reset_at_ts - interval '1 month';
  end if;

  select pl.monthly_limit, coalesce(pl.is_unlimited, false)
    into monthly_limit_value, is_unlimited_value
  from public.plan_limits pl
  where pl.plan = plan_key
    and pl.feature = p_feature
  limit 1;

  if not found then
    return query
    select false, 0, null::integer, reset_at_ts;
    return;
  end if;

  if monthly_limit_value is null then
    is_unlimited_value := true;
  end if;

  insert into public.quota_usage (owner_id, feature, month_start, reset_at, used, reserved)
  values (p_owner_id, p_feature, month_start_ts, reset_at_ts, 0, 0)
  on conflict (owner_id, feature, month_start)
  do update set
    reset_at = excluded.reset_at,
    updated_at = now()
  returning used into used_now;

  used_now := coalesce(used_now, 0);

  if is_unlimited_value then
    if amount_to_consume > 0 then
      update public.quota_usage
      set used = public.quota_usage.used + amount_to_consume,
          reset_at = reset_at_ts,
          updated_at = now()
      where owner_id = p_owner_id
        and feature = p_feature
        and month_start = month_start_ts
      returning used into used_after;
    else
      used_after := used_now;
    end if;

    return query
    select true, coalesce(used_after, used_now), null::integer, reset_at_ts;
    return;
  end if;

  if amount_to_consume = 0 then
    return query
    select true, used_now, monthly_limit_value, reset_at_ts;
    return;
  end if;

  if used_now + amount_to_consume > monthly_limit_value then
    return query
    select false, used_now, monthly_limit_value, reset_at_ts;
    return;
  end if;

  update public.quota_usage
  set used = public.quota_usage.used + amount_to_consume,
      reset_at = reset_at_ts,
      updated_at = now()
  where owner_id = p_owner_id
    and feature = p_feature
    and month_start = month_start_ts
  returning used into used_after;

  return query
  select true, coalesce(used_after, used_now), monthly_limit_value, reset_at_ts;
end;
$$;
