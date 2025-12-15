-- Tilføj kilde-type og mappe-reference til exam_sessions
alter table public.exam_sessions
  add column if not exists source_type text,
  add column if not exists folder_id uuid;

-- (Valgfri, men god til Overblik-siden senere)
create index if not exists exam_sessions_owner_source_created_idx
  on public.exam_sessions (owner_id, source_type, created_at desc);
