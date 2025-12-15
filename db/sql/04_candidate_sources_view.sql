create or replace view public.candidate_sources_sorted as
select domain, first_seen, last_seen, hit_count
from public.candidate_sources
order by hit_count desc, last_seen desc;
