import "server-only";

export async function hasOwnUsableMaterial(sb: any, ownerId: string): Promise<boolean> {
  const { data: filesData, error: filesError } = await sb
    .from("files")
    .select("id")
    .eq("owner_id", ownerId)
    .order("created_at", { ascending: false })
    .limit(200);

  if (filesError) {
    console.error("material readiness files error:", filesError);
    return false;
  }

  const fileIds = (filesData ?? [])
    .map((row: any) => String(row?.id ?? "").trim())
    .filter(Boolean);

  if (fileIds.length === 0) return false;

  const { data: chunkData, error: chunkError } = await sb
    .from("doc_chunks")
    .select("id,content")
    .eq("owner_id", ownerId)
    .in("file_id", fileIds)
    .not("content", "is", null)
    .limit(20);

  if (chunkError) {
    console.error("material readiness doc_chunks error:", chunkError);
    return false;
  }

  return (
    Array.isArray(chunkData) &&
    chunkData.some((row: any) => String(row?.content ?? "").trim().length > 0)
  );
}
