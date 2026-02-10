-- doc_chunks: file_id-only hardening

-- 1) Slet evt. forældreløse chunks (kør først i DB hvis nødvendigt)
-- delete from doc_chunks dc
-- where not exists (
--   select 1 from files f
--   where f.id = dc.file_id
--     and f.owner_id = dc.owner_id
-- );

-- 2) FK + cascade
alter table doc_chunks
  add constraint doc_chunks_file_fk
  foreign key (file_id) references files(id)
  on delete cascade;

-- 3) file_id må ikke være null
alter table doc_chunks
  alter column file_id set not null;

-- 4) Indekser
create index if not exists doc_chunks_owner_file_created_idx
  on doc_chunks(owner_id, file_id, created_at desc);

create index if not exists files_owner_folder_uploaded_idx
  on files(owner_id, folder_id, uploaded_at desc);
