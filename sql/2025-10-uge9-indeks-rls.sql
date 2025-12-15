create index if not exists exam_sessions_owner_created_at_idx on exam_sessions(owner_id, created_at desc);
create index if not exists exam_sessions_created_at_idx on exam_sessions(created_at desc);
create index if not exists exam_sessions_owner_score_idx on exam_sessions(owner_id, score);
create index if not exists doc_chunks_owner_created_at_idx on doc_chunks(owner_id, created_at desc);
create index if not exists doc_chunks_owner_study_created_at_idx on doc_chunks(owner_id, study_set_id, created_at desc);

create policy if not exists p_exam_sessions_read_own
on exam_sessions for select
using (auth.uid() = owner_id);
