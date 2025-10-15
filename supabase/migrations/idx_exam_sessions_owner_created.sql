-- Kør i Supabase SQL editor
create index if not exists idx_exam_sessions_owner_created
  on public.exam_sessions(owner_id, created_at desc);
