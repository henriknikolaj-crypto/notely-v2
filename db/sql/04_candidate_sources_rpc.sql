create or replace function public.log_candidate_source(p_domain text)
returns void
language plpgsql
security definer
as $$
begin
  insert into public.candidate_sources (domain, first_seen, last_seen, hit_count)
  values (lower(p_domain), now(), now(), 1)
  on conflict (domain) do update
    set last_seen = now(),
        hit_count = candidate_sources.hit_count + 1;
end;
$$;

revoke all on function public.log_candidate_source(text) from public;
grant execute on function public.log_candidate_source(text) to authenticated;
