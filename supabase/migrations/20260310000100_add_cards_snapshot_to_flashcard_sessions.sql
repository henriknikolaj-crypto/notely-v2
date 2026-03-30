alter table if exists public.flashcard_sessions
  add column if not exists cards_snapshot jsonb;
