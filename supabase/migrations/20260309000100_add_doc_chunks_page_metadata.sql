alter table public.doc_chunks
  add column if not exists page_from int,
  add column if not exists page_to int,
  add column if not exists source_page int,
  add column if not exists printed_page text,
  add column if not exists page_label text,
  add column if not exists position text;
