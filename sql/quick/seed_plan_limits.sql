insert into public.plan_limits(plan, monthly_quota, per_import_cost) values
  ('free', 20, 1),
  ('basic', 200, 1),
  ('pro', 1000, 1)
on conflict (plan) do update
set monthly_quota = excluded.monthly_quota,
    per_import_cost = excluded.per_import_cost;
