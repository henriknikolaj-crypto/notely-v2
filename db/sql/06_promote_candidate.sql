create or replace function public.promote_candidate(
  p_domain text,
  p_display_name text default null,
  p_country text default 'INT',
  p_subject text default null,
  p_tier text default 'B',
  p_weight numeric default 0.6
) returns void
language sql
security definer
set search_path = public
as $$
  insert into verified_sources (domain, display_name, country, subject, tier, weight, active, updated_at)
  values (lower(p_domain), p_display_name, p_country, p_subject, p_tier, p_weight, true, now())
  on conflict (domain) do update
    set display_name = coalesce(excluded.display_name, verified_sources.display_name),
        country      = coalesce(excluded.country,      verified_sources.country),
        subject      = coalesce(excluded.subject,      verified_sources.subject),
        tier         = coalesce(excluded.tier,         verified_sources.tier),
        weight       = coalesce(excluded.weight,       verified_sources.weight),
        active       = true,
        updated_at   = now();

  delete from candidate_sources where domain = lower(p_domain);
$$;

revoke all on function public.promote_candidate(text,text,text,text,text,numeric) from public;
grant execute on function public.promote_candidate(text,text,text,text,text,numeric) to authenticated;
