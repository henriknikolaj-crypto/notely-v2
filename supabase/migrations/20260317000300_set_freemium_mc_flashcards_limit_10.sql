insert into public.plan_limits (plan, feature, monthly_limit, is_unlimited)
values
  ('freemium', 'mc_generate', 10, false),
  ('freemium', 'flashcards_generate', 10, false)
on conflict (plan, feature)
do update set
  monthly_limit = excluded.monthly_limit,
  is_unlimited = excluded.is_unlimited,
  updated_at = now();
