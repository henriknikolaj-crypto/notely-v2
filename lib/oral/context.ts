import "server-only";

type Citation = {
  chunkId: string;
  fileId: string | null;
  title: string | null;
  url: string | null;
};

type ContextInput = {
  scopeFolderIds?: string[];
  folderId?: string | null;
  fileId?: string | null;
};

type ContextResult = {
  contextText: string;
  usedFileId: string | null;
  contextChunkCount: number;
  citations: Citation[];
};

function fileTitle(row: any) {
  return (row?.name as string | null) || (row?.original_name as string | null) || "Ukendt kilde";
}

function normalizeIds(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((x) => (typeof x === "string" ? x.trim() : String(x ?? "").trim()))
    .filter(Boolean);
}

export async function buildOralContext(opts: {
  sb: any;
  ownerId: string;
  input: ContextInput;
  maxChars?: number;
}): Promise<ContextResult> {
  const { sb, ownerId, input, maxChars = 8000 } = opts;

  type ChunkRow = {
    id: string;
    content: string | null;
    file_id: string | null;
    created_at?: string | null;
  };

  type FileRow = {
    id: string;
    name: string | null;
    original_name: string | null;
    folder_id: string | null;
    created_at?: string | null;
  };

  const explicitFileId =
    typeof input.fileId === "string" && input.fileId.trim().length > 0 ? input.fileId.trim() : null;

  const scopeFolderIds = normalizeIds(input.scopeFolderIds);
  const fallbackFolder =
    typeof input.folderId === "string" && input.folderId.trim().length > 0 ? input.folderId.trim() : null;
  const effectiveFolderIds = scopeFolderIds.length > 0 ? scopeFolderIds : fallbackFolder ? [fallbackFolder] : [];

  async function buildFromFileId(fileId: string): Promise<ContextResult> {
    const { data: fileRow } = await sb
      .from("files")
      .select("id,name,original_name,folder_id,created_at")
      .eq("owner_id", ownerId)
      .eq("id", fileId)
      .maybeSingle();

    const title = fileRow ? fileTitle(fileRow) : "Ukendt kilde";

    const { data: chunks, error } = await sb
      .from("doc_chunks")
      .select("id, content, file_id, created_at")
      .eq("owner_id", ownerId)
      .eq("file_id", fileId)
      .order("created_at", { ascending: true })
      .limit(80);

    if (error) {
      console.error("[oral/context] doc_chunks error:", error);
      return { contextText: "", usedFileId: fileId, contextChunkCount: 0, citations: [] };
    }

    const rows: ChunkRow[] = (chunks ?? []) as ChunkRow[];
    const nonEmptyRows = rows.filter((r) => (r.content ?? "").trim().length > 0);
    const nonEmpty = nonEmptyRows.map((r) => (r.content ?? "").trim());
    if (nonEmpty.length === 0) {
      return { contextText: "", usedFileId: fileId, contextChunkCount: 0, citations: [] };
    }

    let contextText = nonEmpty.join("\n\n---\n\n");
    if (contextText.length > maxChars) contextText = contextText.slice(0, maxChars);

    return {
      contextText,
      usedFileId: fileId,
      contextChunkCount: nonEmpty.length,
      citations: [
        {
          chunkId: String(nonEmptyRows[0]?.id ?? fileId),
          fileId,
          title,
          url: null,
        },
      ],
    };
  }

  if (explicitFileId) {
    return buildFromFileId(explicitFileId);
  }

  let filesQuery = sb
    .from("files")
    .select("id, name, original_name, folder_id, created_at")
    .eq("owner_id", ownerId)
    .order("created_at", { ascending: false });

  if (effectiveFolderIds.length > 0) {
    filesQuery = filesQuery.in("folder_id", effectiveFolderIds);
  }

  const { data: fileRows, error: filesErr } = await filesQuery;
  if (filesErr) console.error("[oral/context] files error:", filesErr);

  let filesInScope: FileRow[] = (fileRows ?? []) as FileRow[];
  if (!filesInScope.length && effectiveFolderIds.length > 0) {
    const { data: allFiles, error: allFilesErr } = await sb
      .from("files")
      .select("id, name, original_name, folder_id, created_at")
      .eq("owner_id", ownerId)
      .order("created_at", { ascending: false });
    if (allFilesErr) console.error("[oral/context] global files error:", allFilesErr);
    filesInScope = (allFiles ?? []) as FileRow[];
  }

  if (!filesInScope.length) {
    return {
      contextText: "",
      usedFileId: null,
      contextChunkCount: 0,
      citations: [],
    };
  }

  const recentFiles = filesInScope.slice(0, Math.min(filesInScope.length, 5));
  const idx = Math.floor(Math.random() * recentFiles.length);
  const chosenFile = recentFiles[idx];
  return buildFromFileId(String(chosenFile.id));
}
