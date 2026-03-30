-- plan_limits seed v3
-- NULL monthly_limit = ubegrænset (Basis/Pro)

alter table public.plan_limits
  add column if not exists created_at timestamptz not null default now();

alter table public.plan_limits
  add column if not exists updated_at timestamptz not null default now();

insert into public.plan_limits(plan, feature, monthly_limit)
values
  -- Freemium (tilpas import hvis du vil)
  ('freemium','import',30),
  ('freemium','trainer_round',10),
  ('freemium','mc_generate',60),
  ('freemium','flashcards_generate',60),
  ('freemium','evaluate',10),

  -- Basis: kun upload/import har loft
  ('basis','import',100),
  ('basis','trainer_round',null),
  ('basis','mc_generate',null),
  ('basis','flashcards_generate',null),
  ('basis','evaluate',null),

  -- Pro: kun upload/import har loft
  ('pro','import',200),
  ('pro','trainer_round',null),
  ('pro','mc_generate',null),
  ('pro','flashcards_generate',null),
  ('pro','evaluate',null)
on conflict (plan, feature)
do update set
  monthly_limit = excluded.monthly_limit;