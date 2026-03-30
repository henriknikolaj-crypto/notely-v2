alter table public.files
  add column if not exists page_count int,
  add column if not exists ocr_pages int,
  add column if not exists extraction_method text,
  add column if not exists extraction_quality text,
  add column if not exists extraction_meta jsonb;

alter table public.doc_chunks
  add column if not exists extraction_method text,
  add column if not exists extraction_quality text;
