// lib/trainer/context.ts
import type { PostgrestError } from "@supabase/supabase-js";

type LoadTrainerContextOptions = {
  sb: any; // Supabase client (server-route eller RSC)
  ownerId: string;
  folderId?: string | null; // valgfri, bruges når vi ikke har fileId
  fileId?: string | null;   // valgfri: kun én bestemt fil
  maxChunks?: number;
};

export type TrainerChunk = {
  id: string;
  file_id: string | null;
  folder_id: string | null;
  content: string;
  created_at: string | null;
};

export type TrainerContextResult = {
  chunks: TrainerChunk[];
  contextText: string;
};

/**
 * Henter doc_chunks til Træner/Noter/MC.
 *
 * - Filtrerer altid på owner_id.
 * - Hvis fileId er sat → bruger vi owner_id + file_id.
 *   (folder_id ignoreres, så gamle data uden folder_id også virker.)
 * - Ellers, hvis folderId er sat → bruger vi owner_id + folder_id.
 * - Tager både source_type = 'trainer' og 'user_upload'.
 */
export async function loadTrainerContext(
  opts: LoadTrainerContextOptions
): Promise<TrainerContextResult> {
  const { sb, ownerId, folderId, fileId, maxChunks = 200 } = opts;

  if (!fileId && !folderId) {
    throw new Error(
      "loadTrainerContext kræver mindst fileId eller folderId."
    );
  }

  let query = sb
    .from("doc_chunks")
    .select("id, file_id, folder_id, content, created_at", { head: false })
    .eq("owner_id", ownerId)
    .in("source_type", ["trainer", "user_upload"])
    .order("created_at", { ascending: true })
    .limit(maxChunks);

  if (fileId) {
    // Primært brugt af Noter: én bestemt fil
    query = query.eq("file_id", fileId);
  } else if (folderId) {
    // Bruges når vi vil have alt materiale i en mappe (Træner/MC)
    query = query.eq("folder_id", folderId);
  }

  const {
    data,
    error,
  }: { data: TrainerChunk[] | null; error: PostgrestError | null } =
    await query;

  if (error) {
    console.error("[loadTrainerContext] error", error);
    throw new Error(error.message);
  }

  const chunks = data ?? [];
  const contextText = chunks.map((c) => c.content.trim()).join("\n\n");

  return { chunks, contextText };
}
