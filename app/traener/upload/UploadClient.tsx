// app/traener/upload/UploadClient.tsx
"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import LimitNotice from "@/app/traener/_ui/LimitNotice";

type Folder = {
  id: string;
  name: string;
};

type FileRow = {
  id: string;
  name: string;
  folderId: string | null;
  sizeBytes: number | null;
  uploadedAt: string | null;
};

type Props = {
  folders: Folder[];
  initialFolderId: string | null;
  ownerId: string;
};

function asString(v: any): string | null {
  if (v == null) return null;
  const s = String(v).trim();
  return s.length ? s : null;
}
function asNumber(v: any): number | null {
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : null;
}

function normalizeFolderRow(x: any): Folder | null {
  const id = asString(x?.id);
  const name = asString(x?.name) ?? asString(x?.title);
  if (!id || !name) return null;
  return { id, name };
}

function normalizeFileRow(x: any): FileRow | null {
  const id = asString(x?.id);
  const name = asString(x?.name) ?? asString(x?.original_name) ?? asString(x?.originalName);
  if (!id || !name) return null;

  return {
    id,
    name,
    folderId: asString(x?.folder_id) ?? asString(x?.folderId),
    sizeBytes: asNumber(x?.size_bytes) ?? asNumber(x?.sizeBytes),
    uploadedAt: asString(x?.uploaded_at) ?? asString(x?.uploadedAt) ?? asString(x?.created_at),
  };
}

function fmtDa(iso: string | null) {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return new Intl.DateTimeFormat("da-DK", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(d);
}

function humanBytes(n: number | null) {
  if (n == null || !Number.isFinite(n)) return "";
  const kb = 1024;
  const mb = kb * 1024;
  if (n >= mb) return `${(n / mb).toFixed(1).replace(".", ",")} MB`;
  if (n >= kb) return `${Math.round(n / kb)} KB`;
  return `${n} B`;
}

function safeJson(text: string) {
  try {
    return text ? JSON.parse(text) : null;
  } catch {
    return null;
  }
}

export default function UploadClient({ folders: initialFolders, initialFolderId, ownerId }: Props) {
  // NOTE: props bruges primært til at fixe typecheck + give hurtig initial state
  void ownerId;

  // folders
  const [folders, setFolders] = useState<Folder[]>(() => (Array.isArray(initialFolders) ? initialFolders : []));
  const [foldersLoading, setFoldersLoading] = useState(() => (Array.isArray(initialFolders) ? false : true));
  const [foldersError, setFoldersError] = useState<string | null>(null);

  // selection
  const [uploadFolderId, setUploadFolderId] = useState<string | null>(() => initialFolderId ?? null);
  const [listFolderId, setListFolderId] = useState<string | null>(() => initialFolderId ?? null);

  // keep latest listFolderId for async flows
  const listFolderIdRef = useRef<string | null>(null);
  useEffect(() => {
    listFolderIdRef.current = listFolderId;
  }, [listFolderId]);

  // files list
  const [files, setFiles] = useState<FileRow[]>([]);
  const [filesLoading, setFilesLoading] = useState(false);
  const [filesError, setFilesError] = useState<string | null>(null);

  // upload
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [pickedFile, setPickedFile] = useState<File | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [quotaBlocked, setQuotaBlocked] = useState<string | null>(null);

  // delete
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  // move
  const [movingId, setMovingId] = useState<string | null>(null);
  const [moveError, setMoveError] = useState<string | null>(null);
  const [moveNotice, setMoveNotice] = useState<string | null>(null);

  const dispatchQuotaChanged = useCallback(() => {
    if (typeof window === "undefined") return;
    window.dispatchEvent(new Event("notely-quota-changed"));
    window.dispatchEvent(new Event("notely:import-status-refresh"));
  }, []);

  const dispatchImportStatusRefresh = useCallback(() => {
    if (typeof window === "undefined") return;
    window.dispatchEvent(new Event("notely:import-status-refresh"));
  }, []);

  const folderOptions = useMemo(() => folders, [folders]);

  const loadFolders = useCallback(async () => {
    setFoldersLoading(true);
    setFoldersError(null);

    try {
      const res = await fetch("/api/folders", {
        method: "GET",
        cache: "no-store",
        headers: { Accept: "application/json" },
      });

      const text = await res.text();
      const json = safeJson(text);

      if (!res.ok) {
        setFolders([]);
        const msg = (json && (json.error || json.message)) || `Kunne ikke hente mapper (${res.status}).`;
        setFoldersError(String(msg));
        setUploadFolderId(null);
        setListFolderId(null);
        return;
      }

      if (!json || json.ok === false) {
        setFolders([]);
        setFoldersError(String(json?.error ?? json?.message ?? "Kunne ikke hente mapper."));
        setUploadFolderId(null);
        setListFolderId(null);
        return;
      }

      const raw = Array.isArray(json.folders)
        ? json.folders
        : Array.isArray(json.items)
          ? json.items
          : Array.isArray(json.data)
            ? json.data
            : [];

      const normalized = raw.map(normalizeFolderRow).filter(Boolean) as Folder[];
      setFolders(normalized);

      if (normalized.length > 0) {
        setFoldersError(null);

        const fallback = normalized[0].id;

        setUploadFolderId((prev) => {
          if (prev && normalized.some((f) => f.id === prev)) return prev;
          if (initialFolderId && normalized.some((f) => f.id === initialFolderId)) return initialFolderId;
          return fallback;
        });

        setListFolderId((prev) => {
          if (prev && normalized.some((f) => f.id === prev)) return prev;
          if (initialFolderId && normalized.some((f) => f.id === initialFolderId)) return initialFolderId;
          return fallback;
        });
      } else {
        setUploadFolderId(null);
        setListFolderId(null);
        setFoldersError("Ingen mapper fundet endnu (opret en mappe længere nede).");
      }
    } catch (e) {
      console.error("[UploadClient] loadFolders error", e);
      setFolders([]);
      setUploadFolderId(null);
      setListFolderId(null);
      setFoldersError("Kunne ikke hente mapper.");
    } finally {
      setFoldersLoading(false);
    }
  }, [initialFolderId]);

  const loadFiles = useCallback(async (folderId: string | null) => {
    if (!folderId) {
      setFiles([]);
      return;
    }

    setFilesLoading(true);
    setFilesError(null);

    try {
      const url = `/api/files?folder_id=${encodeURIComponent(folderId)}`;
      const res = await fetch(url, { method: "GET", cache: "no-store", headers: { Accept: "application/json" } });
      const text = await res.text();
      const json = safeJson(text);

      if (!res.ok) {
        setFiles([]);
        setFilesError(String((json && (json.error || json.message)) || `Kunne ikke hente filer (${res.status}).`));
        return;
      }

      if (!json || json.ok === false) {
        setFiles([]);
        setFilesError(String(json?.error ?? json?.message ?? "Kunne ikke hente filer."));
        return;
      }

      const raw = Array.isArray(json.files) ? json.files : Array.isArray(json.items) ? json.items : [];
      const normalized = raw.map(normalizeFileRow).filter(Boolean) as FileRow[];
      setFiles(normalized);
    } catch (e) {
      console.error("[UploadClient] loadFiles error", e);
      setFiles([]);
      setFilesError("Kunne ikke hente filer.");
    } finally {
      setFilesLoading(false);
    }
  }, []);

  useEffect(() => {
    // Hvis der allerede er initial folders, kan vi nøjes med at hente filer først
    void loadFolders();
  }, [loadFolders]);

  useEffect(() => {
    void loadFiles(listFolderId);
  }, [listFolderId, loadFiles]);

  function onPickFile(f: File | null) {
    setUploadError(null);
    setQuotaBlocked(null);
    setPickedFile(f);
  }

  const canUpload = !!pickedFile && !!uploadFolderId && !uploading && !quotaBlocked && !foldersLoading;

  async function doUpload() {
    if (!pickedFile || !uploadFolderId) return;

    setUploading(true);
    setUploadError(null);

    try {
      const fd = new FormData();
      fd.append("file", pickedFile);
      fd.append("folder_id", uploadFolderId);

      const res = await fetch("/api/trainer/upload", { method: "POST", body: fd });

      if (res.status === 402 || res.status === 429) {
        const j = safeJson(await res.text());
        const msg = String(j?.message ?? j?.error ?? "Du har nået din månedlige upload-kvote.");
        setQuotaBlocked(msg);
        dispatchQuotaChanged();
        return;
      }

      if (res.status === 409) {
        const j = safeJson(await res.text());
        const msg = String(
          j?.message ??
            j?.error ??
            "Denne fil er allerede uploadet. Du kan ikke uploade den samme fil to gange.",
        );
        setUploadError(msg);
        return;
      }

      if (res.status === 401) {
        const j = safeJson(await res.text());
        setUploadError(String(j?.error ?? "Login kræves."));
        return;
      }

      if (res.status === 413) {
        const j = safeJson(await res.text());
        setUploadError(String(j?.message ?? j?.error ?? "Filen er for stor til din plan."));
        return;
      }

      if (!res.ok) {
        const j = safeJson(await res.text());
        setUploadError(String(j?.message ?? j?.error ?? `Upload fejlede (${res.status}).`));
        return;
      }

      setPickedFile(null);
      if (fileInputRef.current) fileInputRef.current.value = "";
      dispatchQuotaChanged();

      await loadFolders();
      await loadFiles(listFolderIdRef.current ?? uploadFolderId);
    } catch (e) {
      console.error("[UploadClient] upload error", e);
      setUploadError("Upload fejlede. Prøv igen.");
    } finally {
      setUploading(false);
    }
  }

  async function moveFile(fileId: string, newFolderId: string) {
    setMoveError(null);
    setMoveNotice(null);
    setMovingId(fileId);

    const prevFolderId = files.find((x) => x.id === fileId)?.folderId ?? null;
    const currentList = listFolderIdRef.current;
    const destName = folderOptions.find((x) => x.id === newFolderId)?.name ?? "den nye mappe";

    // optimistic update (så dropdown skifter med det samme)
    setFiles((prev) => prev.map((f) => (f.id === fileId ? { ...f, folderId: newFolderId } : f)));

    let res: Response | null = null;

    try {
      res = await fetch(`/api/files/${encodeURIComponent(fileId)}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({ folder_id: newFolderId }),
      });
    } catch {
      res = null;
    }

    if (!res || !res.ok) {
      const j = res ? safeJson(await res.text()) : null;
      setMoveError(String(j?.error ?? j?.message ?? "Kunne ikke flytte filen. (Tjek API/RLS)"));

      // revert optimistic
      setFiles((prev) => prev.map((f) => (f.id === fileId ? { ...f, folderId: prevFolderId } : f)));
      setMovingId(null);
      return;
    }

    // Hvis du flytter væk fra den mappe du står og kigger i: filen forsvinder fra listen (korrekt)
    if (currentList && prevFolderId === currentList && newFolderId !== currentList) {
      setFiles((prev) => prev.filter((f) => f.id !== fileId));
      setMoveNotice(`Filen er flyttet til "${destName}". Skift mappe for at se den.`);
    } else {
      await loadFiles(currentList);
      setMoveNotice(`Filen er flyttet til "${destName}".`);
    }

    setMovingId(null);
    dispatchImportStatusRefresh();
  }

  async function deleteFile(fileId: string) {
    const file = files.find((x) => x.id === fileId);
    const name = file?.name ?? "filen";

    const ok = window.confirm(
      `Er du sikker på, at du vil slette "${name}"?\n\n` +
        `Filen bliver slettet permanent.\n` +
        `Bemærk: Sletning giver ikke sider tilbage i denne måned.`,
    );

    if (!ok) return;

    setDeleteError(null);
    setDeletingId(fileId);

    let res: Response | null = null;

    try {
      res = await fetch(`/api/files/${encodeURIComponent(fileId)}`, { method: "DELETE" });
    } catch {
      res = null;
    }

    if (!res || res.status === 404) {
      try {
        res = await fetch(`/api/files?fileId=${encodeURIComponent(fileId)}`, { method: "DELETE" });
      } catch {
        res = null;
      }
    }

    if (!res || !res.ok) {
      const j = res ? safeJson(await res.text()) : null;
      setDeleteError(String(j?.error ?? j?.message ?? "Kunne ikke slette filen. Prøv igen."));
      setDeletingId(null);
      return;
    }

    setFiles((prev) => prev.filter((f) => f.id !== fileId));
    setDeletingId(null);

    await loadFiles(listFolderIdRef.current);
    dispatchImportStatusRefresh();
  }

  return (
    <div className="space-y-6">
      {/* Upload card */}
      <div className="rounded-2xl border border-zinc-200 bg-white p-5 shadow-sm">
        <div className="text-sm font-semibold text-zinc-900">Upload materiale</div>
        <div className="mt-1 text-xs text-zinc-600">
          Vælg mappe og upload noter/slides som PDF. Når materialet er gjort klar, kan det bruges på tværs af Notely.
        </div>

        <div className="mt-4">
          <div className="text-xs font-medium text-zinc-900">Mappe</div>

          <select
            className="mt-2 w-full rounded-xl border border-zinc-200 bg-white px-3 py-2 text-sm"
            value={uploadFolderId ?? ""}
            onChange={(e) => setUploadFolderId(e.target.value || null)}
            disabled={foldersLoading || folderOptions.length === 0}
          >
            {foldersLoading ? <option value="">Indlæser...</option> : null}
            {!foldersLoading && folderOptions.length === 0 ? <option value="">Ingen mapper</option> : null}
            {!foldersLoading &&
              folderOptions.map((f) => (
                <option key={f.id} value={f.id}>
                  {f.name}
                </option>
              ))}
          </select>

          <div className="mt-1 text-[11px] text-zinc-500">
            Mapper styrer, hvilket fag/forløb materialet bliver knyttet til.
          </div>
          {foldersError ? <div className="mt-2 text-[11px] text-red-600">{foldersError}</div> : null}
        </div>

        {/* Dropzone */}
        <label
          className={[
            "mt-4 block cursor-pointer rounded-2xl border border-dashed p-6 text-center",
            dragOver ? "border-zinc-700 bg-zinc-50" : "border-zinc-200 bg-white",
            uploading ? "opacity-60 cursor-default" : "",
          ].join(" ")}
          onDragEnter={(e) => {
            e.preventDefault();
            e.stopPropagation();
            setDragOver(true);
          }}
          onDragOver={(e) => {
            e.preventDefault();
            e.stopPropagation();
            setDragOver(true);
          }}
          onDragLeave={(e) => {
            e.preventDefault();
            e.stopPropagation();
            setDragOver(false);
          }}
          onDrop={(e) => {
            e.preventDefault();
            e.stopPropagation();
            setDragOver(false);
            const f = e.dataTransfer?.files?.[0] ?? null;
            onPickFile(f);
          }}
        >
          <div className="text-sm font-medium text-zinc-900">Træk en PDF herind eller klik for at vælge.</div>
          <div className="mt-1 text-xs text-zinc-500">Maks. størrelse afhænger af din plan (typisk ~10–30 MB pr. fil).</div>

          <div className="mt-4 flex items-center justify-center gap-2">
            <span className="rounded-full border border-zinc-300 bg-white px-4 py-2 text-xs font-medium">Vælg fil</span>

            {pickedFile ? (
              <button
                type="button"
                className="rounded-full border border-zinc-300 bg-white px-3 py-2 text-xs"
                onClick={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  setPickedFile(null);
                  if (fileInputRef.current) fileInputRef.current.value = "";
                }}
              >
                Fjern
              </button>
            ) : null}
          </div>

          {pickedFile ? (
            <div className="mt-3 text-xs text-zinc-700">
              Valgt fil: <span className="font-medium">{pickedFile.name}</span>
            </div>
          ) : null}

          <input
            ref={fileInputRef}
            type="file"
            accept="application/pdf"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0] ?? null;
              onPickFile(f);
            }}
          />
        </label>

        {quotaBlocked ? <LimitNotice className="mt-4">{quotaBlocked}</LimitNotice> : null}
        {uploadError ? <div className="mt-3 text-xs text-red-600">{uploadError}</div> : null}

        <div className="mt-4 flex items-center justify-between">
          <button
            type="button"
            onClick={() => void doUpload()}
            disabled={!canUpload}
            className="rounded-full bg-zinc-900 px-5 py-2 text-xs font-semibold text-white disabled:opacity-40"
          >
            {uploading ? "Uploader..." : "Upload fil"}
          </button>

          <button
            type="button"
            onClick={() => void loadFolders()}
            className="rounded-full border border-zinc-300 bg-white px-4 py-2 text-xs font-medium"
          >
            Opdater mapper
          </button>
        </div>
      </div>

      {/* Files list */}
      <div className="rounded-2xl border border-zinc-200 bg-white p-5 shadow-sm">
        <div className="flex items-center justify-between">
          <div>
            <div className="text-sm font-semibold text-zinc-900">Materiale i dine mapper</div>
            <div className="mt-1 text-xs text-zinc-600">Viser filer i den mappe, du vælger herunder.</div>
          </div>

          <button
            type="button"
            onClick={() => void loadFiles(listFolderIdRef.current)}
            className="rounded-full border border-zinc-300 bg-white px-4 py-2 text-xs font-medium"
          >
            Opdater liste
          </button>
        </div>

        <div className="mt-4 flex items-center gap-3">
          <div className="text-xs text-zinc-700">Vis filer i mappe:</div>

          <select
            className="rounded-full border border-zinc-200 bg-white px-3 py-2 text-xs"
            value={listFolderId ?? ""}
            onChange={(e) => setListFolderId(e.target.value || null)}
            disabled={foldersLoading || folderOptions.length === 0}
          >
            {foldersLoading ? <option value="">Indlæser...</option> : null}
            {!foldersLoading && folderOptions.length === 0 ? <option value="">Ingen mapper</option> : null}
            {!foldersLoading &&
              folderOptions.map((f) => (
                <option key={f.id} value={f.id}>
                  {f.name}
                </option>
              ))}
          </select>
        </div>

        {filesError ? <div className="mt-3 text-xs text-red-600">{filesError}</div> : null}
        {deleteError ? <div className="mt-3 text-xs text-red-600">{deleteError}</div> : null}
        {moveError ? <div className="mt-3 text-xs text-red-600">{moveError}</div> : null}
        {moveNotice ? <div className="mt-3 text-xs text-zinc-700">{moveNotice}</div> : null}

        <div className="mt-4 space-y-3">
          {filesLoading ? <div className="text-xs text-zinc-500">Henter filer…</div> : null}

          {!filesLoading && (!listFolderId || files.length === 0) ? (
            <div className="text-xs text-zinc-500">
              {listFolderId ? "Ingen filer i denne mappe endnu." : "Vælg en mappe."}
            </div>
          ) : null}

          {files.map((f) => (
            <div
              key={f.id}
              className="flex items-center justify-between rounded-xl border border-zinc-200 bg-white px-4 py-3"
            >
              <div>
                <div className="text-sm font-medium text-zinc-900">{f.name}</div>
                <div className="mt-1 text-[11px] text-zinc-500">
                  {humanBytes(f.sizeBytes)} {f.uploadedAt ? `· ${fmtDa(f.uploadedAt)}` : ""}
                </div>
              </div>

              <div className="flex items-center gap-2">
                <select
                  className="rounded-full border border-zinc-200 bg-white px-3 py-2 text-xs"
                  value={f.folderId ?? ""}
                  onChange={(e) => {
                    const v = e.target.value || null;
                    if (!v) return;
                    void moveFile(f.id, v);
                  }}
                  disabled={folderOptions.length === 0 || deletingId === f.id || movingId === f.id}
                  title="Flyt til anden mappe"
                >
                  {folderOptions.map((fo) => (
                    <option key={fo.id} value={fo.id}>
                      {fo.name}
                    </option>
                  ))}
                </select>

                <button
                  type="button"
                  onClick={() => void deleteFile(f.id)}
                  disabled={deletingId === f.id || movingId === f.id}
                  className="rounded-full border border-red-300 bg-white px-3 py-2 text-xs font-medium text-red-700 disabled:opacity-40"
                >
                  {deletingId === f.id ? "Sletter..." : "Slet"}
                </button>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
