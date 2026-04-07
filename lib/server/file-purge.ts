import "server-only";

const UPLOAD_BUCKET = process.env.SUPABASE_UPLOAD_BUCKET || "trainer_uploads";

function asText(value: unknown) {
  return String(value ?? "").trim();
}

export function isMissingTableErr(err: any, table = "training_files") {
  const code = String(err?.code ?? "");
  const msg = String(err?.message ?? "").toLowerCase();
  return code === "42P01" || msg.includes(`relation "${table.toLowerCase()}" does not exist`);
}

export type OwnedFileRow = {
  id: string;
  folder_id: string | null;
  storage_path: string | null;
  md5: string | null;
};

export async function listOwnedFiles(
  admin: any,
  args: { ownerId: string; folderIds?: string[]; md5?: string },
): Promise<OwnedFileRow[]> {
  const { ownerId, folderIds, md5 } = args;

  let query = admin
    .from("files")
    .select("id,folder_id,storage_path,md5")
    .eq("owner_id", ownerId);

  if (Array.isArray(folderIds) && folderIds.length > 0) {
    query = query.in("folder_id", folderIds);
  }

  if (md5) {
    query = query.eq("md5", md5);
  }

  const { data, error } = await query.limit(500);
  if (error) throw error;

  return Array.isArray(data)
    ? data
        .map((row: any) => ({
          id: asText(row?.id),
          folder_id: asText(row?.folder_id) || null,
          storage_path: asText(row?.storage_path) || null,
          md5: asText(row?.md5) || null,
        }))
        .filter((row) => row.id)
    : [];
}

export async function getActiveFolderIdSet(
  admin: any,
  args: { ownerId: string; folderIds: string[] },
): Promise<Set<string>> {
  const { ownerId, folderIds } = args;
  const deduped = Array.from(new Set(folderIds.map((id) => asText(id)).filter(Boolean)));
  if (deduped.length === 0) return new Set<string>();

  const { data, error } = await admin
    .from("folders")
    .select("id")
    .eq("owner_id", ownerId)
    .in("id", deduped)
    .is("archived_at", null);

  if (error) throw error;

  return new Set(
    (Array.isArray(data) ? data : [])
      .map((row: any) => asText(row?.id))
      .filter(Boolean),
  );
}

export async function purgeFileArtifacts(
  admin: any,
  args: {
    ownerId: string;
    fileId: string;
    storagePath?: string | null;
    fileMd5?: string | null;
  },
) {
  const { ownerId, fileId, storagePath, fileMd5 } = args;
  const safeOwnerId = asText(ownerId);
  const safeFileId = asText(fileId);
  const safeStoragePath = asText(storagePath);
  const safeFileMd5 = asText(fileMd5);

  if (!safeOwnerId || !safeFileId) return;

  const notesDelete = await admin.from("notes").delete().eq("owner_id", safeOwnerId).eq("file_id", safeFileId);
  if (notesDelete.error) throw notesDelete.error;

  const audioNotesDelete = await admin
    .from("notes")
    .delete()
    .eq("owner_id", safeOwnerId)
    .eq("source_url", `notely://audio/${safeFileId}`);
  if (audioNotesDelete.error) throw audioNotesDelete.error;

  const flashcardsDelete = await admin.from("flashcards").delete().eq("owner_id", safeOwnerId).eq("file_id", safeFileId);
  if (flashcardsDelete.error) throw flashcardsDelete.error;

  const ocrByFileDelete = await admin.from("ocr_texts").delete().eq("owner_id", safeOwnerId).eq("file_id", safeFileId);
  if (ocrByFileDelete.error) throw ocrByFileDelete.error;

  if (safeFileMd5) {
    const ocrByMd5Delete = await admin.from("ocr_texts").delete().eq("owner_id", safeOwnerId).eq("file_md5", safeFileMd5);
    if (ocrByMd5Delete.error) throw ocrByMd5Delete.error;
  }

  const chunkDelete = await admin.from("doc_chunks").delete().eq("owner_id", safeOwnerId).eq("file_id", safeFileId);
  if (chunkDelete.error) throw chunkDelete.error;

  const legacyDelete = await admin.from("training_files").delete().eq("owner_id", safeOwnerId).eq("id", safeFileId);
  if (legacyDelete.error && !isMissingTableErr(legacyDelete.error)) {
    throw legacyDelete.error;
  }

  const fileDelete = await admin.from("files").delete().eq("owner_id", safeOwnerId).eq("id", safeFileId);
  if (fileDelete.error) throw fileDelete.error;

  if (safeStoragePath) {
    try {
      const storageDelete = await admin.storage.from(UPLOAD_BUCKET).remove([safeStoragePath]);
      if (storageDelete.error) {
        console.warn("[file-purge] storage cleanup warning", storageDelete.error);
      }
    } catch (error) {
      console.warn("[file-purge] storage cleanup warning", error);
    }
  }
}

export async function purgeFilesInFolders(
  admin: any,
  args: { ownerId: string; folderIds: string[] },
): Promise<{ purgedCount: number; fileIds: string[] }> {
  const rows = await listOwnedFiles(admin, args);
  if (rows.length === 0) return { purgedCount: 0, fileIds: [] };

  for (const row of rows) {
    await purgeFileArtifacts(admin, {
      ownerId: args.ownerId,
      fileId: row.id,
      storagePath: row.storage_path,
      fileMd5: row.md5,
    });
  }

  return { purgedCount: rows.length, fileIds: rows.map((row) => row.id) };
}

export async function purgeInactiveDuplicateFiles(
  admin: any,
  args: { ownerId: string; md5: string },
): Promise<{ removedIds: string[]; activeRows: OwnedFileRow[] }> {
  const rows = await listOwnedFiles(admin, { ownerId: args.ownerId, md5: args.md5 });
  if (rows.length === 0) return { removedIds: [], activeRows: [] };

  const activeFolderIds = await getActiveFolderIdSet(admin, {
    ownerId: args.ownerId,
    folderIds: rows.map((row) => row.folder_id).filter((folderId): folderId is string => !!folderId),
  });

  const activeRows = rows.filter((row) => !!row.folder_id && activeFolderIds.has(row.folder_id));
  const staleRows = rows.filter((row) => !row.folder_id || !activeFolderIds.has(row.folder_id));
  const removedIds: string[] = [];

  for (const row of staleRows) {
    await purgeFileArtifacts(admin, {
      ownerId: args.ownerId,
      fileId: row.id,
      storagePath: row.storage_path,
      fileMd5: row.md5,
    });
    removedIds.push(row.id);
  }

  return { removedIds, activeRows };
}
