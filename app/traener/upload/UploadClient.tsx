// app/traener/upload/UploadClient.tsx
"use client";

import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { toast } from "sonner";

type Folder = {
  id: string;
  name: string;
};

type FileItem = {
  id: string;
  name?: string | null;
  filename?: string | null;
  file_name?: string | null;
  size?: number | null;
  size_bytes?: number | null;
  created_at?: string | null;
  uploaded_at?: string | null;
  folder_id?: string | null;
};

type Props = {
  folders: Folder[];
  initialFolderId?: string | null;
  ownerId?: string | null;
};

function displayName(file: FileItem) {
  return file.name ?? file.filename ?? file.file_name ?? "Ukendt fil";
}

function displaySize(file: FileItem) {
  const raw =
    typeof file.size_bytes === "number"
      ? file.size_bytes
      : typeof file.size === "number"
        ? file.size
        : null;

  if (!raw || raw <= 0) return "ukendt størrelse";
  const kb = Math.round(raw / 102.4) / 10;
  return `${kb.toLocaleString("da-DK")} kB`;
}

function displayDate(file: FileItem) {
  const iso = file.uploaded_at ?? file.created_at;
  if (!iso) return "";
  const d = new Date(iso);
  return d.toLocaleString("da-DK", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function formatDaDate(iso: string) {
  try {
    const d = new Date(iso);
    return d.toLocaleDateString("da-DK", {
      day: "2-digit",
      month: "short",
      year: "numeric",
    });
  } catch {
    return iso;
  }
}

export default function UploadClient({ folders, initialFolderId }: Props) {
  const firstFolderId = folders[0]?.id ?? null;

  const [uploadFolderId, setUploadFolderId] = useState<string | null>(
    initialFolderId ?? firstFolderId,
  );
  const [listFolderId, setListFolderId] = useState<string | null>(
    initialFolderId ?? firstFolderId,
  );

  const [files, setFiles] = useState<FileItem[]>([]);
  const [fileToUpload, setFileToUpload] = useState<File | null>(null);

  const [statusMsg, setStatusMsg] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const [loadingList, setLoadingList] = useState(false);
  const [uploading, setUploading] = useState(false);

  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const currentUploadFolder = useMemo(
    () => folders.find((f) => f.id === uploadFolderId) ?? null,
    [folders, uploadFolderId],
  );

  const currentListFolder = useMemo(
    () => folders.find((f) => f.id === listFolderId) ?? null,
    [folders, listFolderId],
  );

  const uniqueFiles = useMemo(
    () =>
      files.filter((file, index, self) => {
        if (!file.id) return true;
        return self.findIndex((f) => f.id === file.id) === index;
      }),
    [files],
  );

  useEffect(() => {
    if (initialFolderId == null) return;
    setUploadFolderId(initialFolderId);
    setListFolderId(initialFolderId);
  }, [initialFolderId]);

  async function safeJson(res: Response) {
    try {
      return await res.json();
    } catch {
      return null;
    }
  }

  function setInlineError(msg: string) {
    setErrorMsg(msg);
    setStatusMsg(null);
  }

  function setInlineStatus(msg: string) {
    setStatusMsg(msg);
    setErrorMsg(null);
  }

  async function refreshFiles(targetFolderId: string | null) {
    const folderId = targetFolderId ?? listFolderId;
    if (!folderId) {
      setFiles([]);
      return;
    }

    setLoadingList(true);
    setErrorMsg(null);

    try {
      const res = await fetch(`/api/files?folder_id=${encodeURIComponent(folderId)}`, {
        method: "GET",
        headers: { Accept: "application/json" },
        cache: "no-store",
      });

      const data = (await safeJson(res)) as any;

      if (!res.ok || !data) {
        const msg =
          (data && (data.error as string)) ||
          (data && (data.message as string)) ||
          "Kunne ikke hente filer (ukendt fejl).";
        setInlineError(msg);
        setFiles([]);
        return;
      }

      let items: any = data;
      if (Array.isArray(data?.items)) items = data.items;
      else if (Array.isArray(data?.files)) items = data.files;

      if (!Array.isArray(items)) {
        setInlineError("Uventet svarformat fra /api/files.");
        setFiles([]);
        return;
      }

      setFiles(
        items.map((x: any) => ({
          id: String(x.id),
          name: x.name ?? x.filename ?? x.file_name ?? null,
          filename: x.filename ?? null,
          file_name: x.file_name ?? null,
          size: x.size ?? x.size_bytes ?? null,
          size_bytes: x.size_bytes ?? x.size ?? null,
          created_at: x.created_at ?? null,
          uploaded_at: x.uploaded_at ?? null,
          folder_id: x.folder_id ?? null,
        })),
      );
    } catch (err: any) {
      console.warn("refreshFiles failed:", err?.message ?? err);
      setInlineError(err?.message ?? "Kunne ikke hente filer (ukendt fejl).");
      setFiles([]);
    } finally {
      setLoadingList(false);
    }
  }

  useEffect(() => {
    void refreshFiles(listFolderId ?? null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [listFolderId]);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setStatusMsg(null);
    setErrorMsg(null);

    if (!fileToUpload) {
      setInlineError("Vælg en fil først.");
      return;
    }
    if (!uploadFolderId) {
      setInlineError("Vælg en mappe først.");
      return;
    }

    const uploadingToastId = toast.loading("Uploader fil…");

    try {
      setUploading(true);

      const form = new FormData();
      form.append("file", fileToUpload);
      form.append("folderId", uploadFolderId);
      form.append("folder_id", uploadFolderId);

      const res = await fetch("/api/trainer/upload", { method: "POST", body: form });
      const data = (await safeJson(res)) as any;

      if (!res.ok) {
        if (res.status === 402 && data?.code === "QUOTA_EXCEEDED") {
          const used = data?.usedThisMonth;
          const limit = data?.monthlyLimit;
          const resetIso = (data?.resetAt as string | undefined) ?? (data?.monthEnd as string | undefined);
          const resetAt = resetIso ? formatDaDate(String(resetIso)) : null;

          const msg =
            typeof used === "number" && typeof limit === "number"
              ? `Du har nået din månedlige grænse: ${used}/${limit}.${resetAt ? ` Nulstilles omkring ${resetAt}.` : ""}`
              : data?.message ?? "Du har nået din månedlige grænse for upload.";

          toast.error("Grænse nået", { id: uploadingToastId, description: msg });
          setInlineError(msg);
          return;
        }

        const msg =
          (data && (data.message as string)) ||
          (data && (data.error as string)) ||
          `Upload fejlede (status ${res.status}).`;

        toast.error("Upload mislykkedes", { id: uploadingToastId, description: msg });
        setInlineError(msg);
        return;
      }

      toast.success("Upload gennemført", {
        id: uploadingToastId,
        description: "Materialet er gjort klar og kan bruges på tværs af Notely.",
      });

      setInlineStatus("Upload gennemført. Materialet er gjort klar og kan nu bruges på tværs af Notely.");

      setFileToUpload(null);
      if (fileInputRef.current) fileInputRef.current.value = "";

      setListFolderId(uploadFolderId);
      await refreshFiles(uploadFolderId);

      // Bed ImportStatusBox (hvis den findes på siden) om at refreshe
      window.dispatchEvent(new Event("notely:import-status-refresh"));
    } catch (err: any) {
      console.warn("handleSubmit failed:", err?.message ?? err);
      toast.error("Upload mislykkedes", {
        id: uploadingToastId,
        description: err?.message ?? "Upload fejlede (ukendt fejl).",
      });
      setInlineError(err?.message ?? "Upload fejlede (ukendt fejl).");
    } finally {
      setUploading(false);
    }
  }

  async function handleMove(fileId: string, newFolderId: string) {
    try {
      setErrorMsg(null);

      const res = await fetch(`/api/files/${encodeURIComponent(fileId)}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({ folder_id: newFolderId }),
      });

      const data = (await safeJson(res)) as any;

      if (!res.ok || !data) {
        const msg =
          (data && (data.message as string)) ||
          (data && (data.error as string)) ||
          "Kunne ikke opdatere filens mappe.";
        setInlineError(msg);
        toast.error("Kunne ikke flytte filen", { description: msg });
        return;
      }

      await refreshFiles(listFolderId ?? null);
    } catch (err: any) {
      console.warn("handleMove failed:", err?.message ?? err);
      const msg = err?.message ?? "Kunne ikke flytte filen (ukendt fejl).";
      setInlineError(msg);
      toast.error("Kunne ikke flytte filen", { description: msg });
    }
  }

  async function handleDelete(fileId: string) {
    if (!window.confirm("Er du sikker på, at du vil slette denne fil?")) return;

    const tId = toast.loading("Sletter fil…");

    try {
      setErrorMsg(null);
      setStatusMsg(null);

      const res = await fetch(`/api/files/${encodeURIComponent(fileId)}`, {
        method: "DELETE",
        headers: { Accept: "application/json" },
      });

      const data = (await safeJson(res)) as any;

      if (res.status === 404) {
        setFiles((prev) => prev.filter((f) => f.id !== fileId));
        toast.success("Filen var allerede slettet", { id: tId, description: "Listen er opdateret." });
        setInlineStatus("Filen var allerede slettet i systemet. Listen er opdateret.");
        window.dispatchEvent(new Event("notely:import-status-refresh"));
        return;
      }

      if (!res.ok || !data) {
        const msg =
          (data && (data.message as string)) ||
          (data && (data.error as string)) ||
          "Kunne ikke slette filen (ukendt fejl).";
        toast.error("Sletning mislykkedes", { id: tId, description: msg });
        setInlineError(msg);
        return;
      }

      toast.success("Filen er slettet", { id: tId });
      await refreshFiles(listFolderId ?? null);
      window.dispatchEvent(new Event("notely:import-status-refresh"));
    } catch (err: any) {
      console.warn("handleDelete failed:", err?.message ?? err);
      const msg = err?.message ?? "Kunne ikke slette filen (ukendt fejl).";
      toast.error("Sletning mislykkedes", { id: tId, description: msg });
      setInlineError(msg);
    }
  }

  return (
    <div className="-mt-6 space-y-6">
      <section className="rounded-2xl border border-zinc-200 bg-white px-6 py-5 shadow-sm">
        <div className="mb-6">
          <h2 className="text-lg font-semibold">Upload / ret materiale</h2>
          <p className="mt-1 text-sm text-zinc-600">
            Vælg den mappe materialet hører til, og upload dine noter eller slides som filer (fx PDF).
            Når materialet er gjort klar, kan det bruges på tværs af Notely.
          </p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-6">
          <div className="space-y-1">
            <label className="text-sm font-medium text-zinc-800">Mappe</label>
            <select
              className="mt-1 w-full rounded-xl border border-zinc-300 bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-black"
              value={uploadFolderId ?? ""}
              onChange={(e) => setUploadFolderId(e.target.value || null)}
              disabled={uploading}
            >
              {folders.map((f) => (
                <option key={f.id} value={f.id}>
                  {f.name}
                </option>
              ))}
            </select>

            {currentUploadFolder && (
              <p className="mt-1 text-xs text-zinc-500">
                Mapper styrer, hvilket fag/forløb materialet bliver knyttet til.
              </p>
            )}
          </div>

          <div className="rounded-2xl border border-dashed border-zinc-300 bg-zinc-50 px-4 py-10 text-center">
            <p className="mb-1 text-sm text-zinc-700">Træk en PDF herind eller klik for at vælge.</p>
            <p className="mb-4 text-xs text-zinc-500">
              Maks. størrelse afhænger af din plan (typisk ~10–30 MB pr. fil).
            </p>

            <input
              ref={fileInputRef}
              id="upload-file-input"
              type="file"
              accept=".pdf,application/pdf"
              hidden
              onChange={(e) => {
                const f = e.target.files?.[0] ?? null;
                setFileToUpload(f);
                setStatusMsg(null);
                setErrorMsg(null);
              }}
            />

            <button
              type="button"
              className="rounded-full border border-zinc-300 px-4 py-1.5 text-sm font-medium hover:bg-zinc-100 disabled:opacity-60"
              onClick={() => fileInputRef.current?.click()}
              disabled={uploading}
            >
              Vælg fil
            </button>

            {fileToUpload && (
              <p className="mt-3 text-xs text-zinc-600">
                Valgt fil: <span className="font-medium">{fileToUpload.name}</span>
              </p>
            )}
          </div>

          <div className="flex items-center justify-between gap-4">
            <button
              type="submit"
              disabled={uploading || !fileToUpload || !uploadFolderId}
              className="rounded-full bg-black px-5 py-2 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:bg-zinc-400"
            >
              {uploading ? "Uploader…" : "Upload fil"}
            </button>

            <p className="text-xs text-zinc-500">
              Filen knyttes til{" "}
              <span className="font-medium">{currentUploadFolder?.name ?? "valgt mappe"}</span>.
            </p>
          </div>

          {statusMsg && <p className="text-xs font-medium text-emerald-600">{statusMsg}</p>}
          {errorMsg && <p className="text-xs font-medium text-red-600">{errorMsg}</p>}
        </form>
      </section>

      <section className="rounded-2xl border border-zinc-200 bg-white px-6 py-5 shadow-sm">
        <div className="mb-4 flex items-center justify-between">
          <div>
            <h2 className="text-sm font-semibold">Materiale i dine mapper</h2>
            <p className="mt-1 text-xs text-zinc-500">
              Viser filer i den mappe, du har valgt i dropdownen herunder.
            </p>
            {currentListFolder && (
              <p className="mt-1 text-[11px] text-zinc-400">Aktuel mappe: {currentListFolder.name}</p>
            )}
          </div>

          <button
            type="button"
            onClick={() => refreshFiles(listFolderId ?? null)}
            className="rounded-full border border-zinc-300 px-3 py-1 text-xs font-medium hover:bg-zinc-100"
            disabled={loadingList || uploading}
          >
            Opdater liste
          </button>
        </div>

        <div className="mb-3 flex flex-wrap items-center gap-2 text-xs">
          <span className="text-zinc-600">Vis filer i mappe:</span>
          <select
            className="rounded-xl border border-zinc-300 bg-white px-3 py-1 text-xs focus:outline-none focus:ring-2 focus:ring-black"
            value={listFolderId ?? ""}
            onChange={(e) => setListFolderId(e.target.value || null)}
            disabled={loadingList || uploading}
          >
            {folders.map((f) => (
              <option key={f.id} value={f.id}>
                {f.name}
              </option>
            ))}
          </select>
        </div>

        {loadingList ? (
          <p className="text-xs text-zinc-500">Henter filer…</p>
        ) : uniqueFiles.length === 0 ? (
          <p className="text-xs text-zinc-500">Der er endnu ikke uploadet materiale i denne mappe.</p>
        ) : (
          <ul className="space-y-2">
            {uniqueFiles.map((file, index) => (
              <li
                key={file.id ?? `file-${index}`}
                className="flex items-center justify-between rounded-xl border border-zinc-200 bg-zinc-50 px-4 py-3 text-xs"
              >
                <div className="min-w-0">
                  <div className="truncate font-medium">{displayName(file)}</div>
                  <div className="mt-1 flex flex-wrap gap-3 text-[11px] text-zinc-500">
                    <span>{displaySize(file)}</span>
                    {displayDate(file) && <span>{displayDate(file)}</span>}
                  </div>
                </div>

                <div className="ml-4 flex items-center gap-2">
                  <select
                    className="rounded-xl border border-zinc-300 bg-white px-2 py-1 text-[11px] focus:outline-none focus:ring-1 focus:ring-black"
                    value={file.folder_id ?? ""}
                    onChange={(e) => handleMove(file.id, e.target.value || "")}
                    disabled={uploading}
                    title="Flyt fil til anden mappe"
                  >
                    {folders.map((f) => (
                      <option key={f.id} value={f.id}>
                        {f.name}
                      </option>
                    ))}
                  </select>

                  <button
                    type="button"
                    onClick={() => handleDelete(file.id)}
                    disabled={uploading}
                    className="rounded-full border border-red-200 px-3 py-1 text-[11px] font-medium text-red-600 hover:bg-red-50 disabled:opacity-60"
                  >
                    Slet
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}

        {errorMsg && <p className="mt-3 text-xs font-medium text-red-600">{errorMsg}</p>}
      </section>
    </div>
  );
}
