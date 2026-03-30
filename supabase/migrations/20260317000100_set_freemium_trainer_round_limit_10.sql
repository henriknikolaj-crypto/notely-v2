insert into public.plan_limits (plan, feature, monthly_limit)
values ('freemium', 'trainer_round', 10)
on conflict (plan, feature)
do update set
  monthly_limit = excluded.monthly_limit,
  updated_at = now();
