import type { SupabaseClient } from "@supabase/supabase-js";

export type DocChunk = {
  content: string;
  file_id: string; // DB håndhæver NOT NULL nu
};

type Options = {
  ownerId: string;
  folderId?: string | null;
  limit?: number;
};

export async function fetchDocChunksForScope(
  sb: SupabaseClient<any, any, any>,
  opts: Options,
): Promise<DocChunk[]> {
  const { ownerId, folderId, limit = 200 } = opts;

  if (folderId) {
    const { data: files, error: filesErr } = await sb
      .from("files")
      .select("id")
      .eq("owner_id", ownerId)
      .eq("folder_id", folderId);

    if (filesErr) {
      console.error("fetchDocChunksForScope files error:", filesErr);
      return [];
    }

    const fileIds = (files ?? []).map((f) => f.id as string).filter(Boolean);
    if (!fileIds.length) return [];

    const { data, error } = await sb
      .from("doc_chunks")
      .select("content, file_id")
      .eq("owner_id", ownerId)
      .in("file_id", fileIds)
      .order("created_at", { ascending: true })
      .limit(limit);

    if (error) {
      console.error("fetchDocChunksForScope doc_chunks error:", error);
      return [];
    }

    return (data ?? []) as DocChunk[];
  }

  const { data, error } = await sb
    .from("doc_chunks")
    .select("content, file_id")
    .eq("owner_id", ownerId)
    .order("created_at", { ascending: true })
    .limit(limit);

  if (error) {
    console.error("fetchDocChunksForScope global error:", error);
    return [];
  }

  return (data ?? []) as DocChunk[];
}
