// app/lib/retrieval/fetchDocChunksForScope.ts
import type { SupabaseClient } from "@supabase/supabase-js";

export type DocChunk = {
  content: string;
  file_id: string | null;
};

type Options = {
  ownerId: string;
  folderId?: string | null;
  limit?: number;
};

/**
 * Henter doc_chunks til brug i LLM-prompten.
 *
 * - Hvis folderId er sat:
 *   1) Prøv fil-specifikke chunks (doc_chunks.file_id i filer fra den mappe).
 *   2) Hvis der stadig ikke findes noget → fallback til gamle folder-baserede
 *      doc_chunks (doc_chunks.folder_id = folderId).
 *   3) Hvis stadig ingenting → returnér [] (ingen global fallback).
 *
 * - Hvis folderId IKKE er sat:
 *   → hent de nyeste doc_chunks for ejeren (globalt pensum).
 */
export async function fetchDocChunksForScope(
  sb: SupabaseClient<any, any, any>,
  opts: Options,
): Promise<DocChunk[]> {
  const { ownerId, folderId, limit = 200 } = opts;

  if (folderId) {
    let collected: DocChunk[] = [];

    // 1) Fil-specifikke chunks (nyt format via file_id)
    const { data: files, error: filesErr } = await sb
      .from("files")
      .select("id")
      .eq("owner_id", ownerId)
      .eq("folder_id", folderId);

    if (filesErr) {
      console.error("fetchDocChunksForScope files error:", filesErr);
    } else {
      const fileIds = (files ?? []).map((f) => f.id as string);

      if (fileIds.length > 0) {
        const { data: byFile, error: byFileErr } = await sb
          .from("doc_chunks")
          .select("content, file_id")
          .eq("owner_id", ownerId)
          .in("file_id", fileIds)
          .order("created_at", { ascending: true })
          .limit(limit);

        if (byFileErr) {
          console.error("fetchDocChunksForScope byFile error:", byFileErr);
        } else if (byFile && byFile.length > 0) {
          collected = byFile as DocChunk[];
        }
      }
    }

    // 2) Fallback til gamle folder-baserede chunks hvis ingen fil-baserede
    if (!collected.length) {
      const { data: byFolder, error: byFolderErr } = await sb
        .from("doc_chunks")
        .select("content, file_id")
        .eq("owner_id", ownerId)
        .eq("folder_id", folderId)
        .order("created_at", { ascending: true })
        .limit(limit);

      if (byFolderErr) {
        console.error(
          "fetchDocChunksForScope byFolder error:",
          byFolderErr,
        );
      } else if (byFolder && byFolder.length > 0) {
        collected = byFolder as DocChunk[];
      }
    }

    // 3) Ingen global fallback når folderId er angivet
    return collected;
  }

  // Ingen folder valgt → globalt pensum (fx “alle fag”)
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
