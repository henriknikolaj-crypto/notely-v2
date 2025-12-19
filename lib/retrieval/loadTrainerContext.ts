// lib/retrieval/loadTrainerContext.ts
import type { SupabaseClient } from "@supabase/supabase-js";

type DocChunkRow = {
  id: string;
  content: string;
  source_type: string | null;
  academic_weight: number | null;
  file_id: string | null;
  folder_id: string | null;
};

export async function loadTrainerContext(
  supabase: SupabaseClient<any, "public", any>,
  ownerId: string,
  opts: {
    folderId?: string | null;
    fileIds?: string[] | null;
    limit?: number;
  },
): Promise<DocChunkRow[]> {
  const { folderId, fileIds, limit = 200 } = opts;

  let query = supabase
    .from("doc_chunks")
    .select(
      "id, content, source_type, academic_weight, file_id, folder_id",
    )
    .eq("owner_id", ownerId);

  // 1) Filtrér på mappe (standard i Træner)
  if (folderId) {
    query = query.eq("folder_id", folderId);
  }

  // 2) Hvis UI har valgt specifikke filer, filtrér yderligere
  if (fileIds && fileIds.length > 0) {
    query = query.in("file_id", fileIds);
  }

  query = query.limit(limit);

  const { data, error } = await query;
  if (error) throw error;
  return (data ?? []) as DocChunkRow[];
}
