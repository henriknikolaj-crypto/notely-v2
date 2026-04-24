"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import FocusNoteContent from "@/app/notes/ui/FocusNoteContent";
import ResumeNoteContent from "@/app/notes/ui/ResumeNoteContent";
import { looksLikeRawNextResponse } from "@/lib/notes/contentSafety";

type FolderOption = {
  id: string;
  name: string;
};

type FileOption = {
  id: string;
  name: string | null;
};

type GeneratedNote = {
  id: string;
  title: string | null;
  content: string | null;
  created_at?: string | null;
};

type Props = {
  folders: FolderOption[];
  selectedFolderId: string | null;
  files: FileOption[];
};

async function readJsonResponse(res: Response) {
  const contentType = res.headers.get("content-type") ?? "";
  if (!contentType.toLowerCase().includes("application/json")) return null;
  return res.json().catch(() => null);
}

export default function MobileNotesFlow({ folders, selectedFolderId, files }: Props) {
  const router = useRouter();
  const uniqueFiles = useMemo(() => {
    const seen = new Set<string>();
    const result: FileOption[] = [];

    for (const file of files ?? []) {
      if (!file?.id) continue;
      if (seen.has(file.id)) continue;
      seen.add(file.id);
      result.push(file);
    }

    return result;
  }, [files]);

  const [selectedFileId, setSelectedFileId] = useState("");
  const [mode, setMode] = useState<"resume" | "golden">("resume");
  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [statusTone, setStatusTone] = useState<"error" | "info">("info");
  const [note, setNote] = useState<GeneratedNote | null>(null);

  useEffect(() => {
    setSelectedFileId("");
    setStatus(null);
    setStatusTone("info");
  }, [selectedFolderId]);

  async function handleGenerate() {
    if (!selectedFileId) {
      setStatusTone("error");
      setStatus("Vælg først en fil.");
      return;
    }

    const selected = uniqueFiles.find((file) => file.id === selectedFileId) || null;
    const fileName = selected?.name ?? null;

    if (!fileName) {
      setStatusTone("error");
      setStatus("Kilde-filnavn mangler. Prøv at genindlæse siden.");
      return;
    }

    setLoading(true);
    setStatus(null);

    try {
      const res = await fetch("/api/notes/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          fileId: selectedFileId,
          mode,
        }),
      });

      const data = await readJsonResponse(res);
      if (!res.ok || !data?.ok) {
        setStatusTone("error");
        setStatus(data?.error || "Der opstod en fejl under genereringen. Prøv igen.");
        return;
      }

      const generated = (data?.note ?? null) as GeneratedNote | null;
      if (!generated) {
        setStatusTone("error");
        setStatus("API returnerede ingen note.");
        return;
      }
      if (looksLikeRawNextResponse(generated.content)) {
        setStatusTone("error");
        setStatus("Noten kunne ikke vises korrekt. Prøv at generere den igen.");
        return;
      }

      setNote({
        id: generated.id,
        title: generated.title ?? fileName ?? "Genereret note",
        content: generated.content ?? null,
        created_at: generated.created_at ?? null,
      });
      setStatusTone("info");
      setStatus(mode === "golden" ? "Fokus-noterne er genereret og gemt." : "Resuméet er genereret og gemt.");
      router.refresh();
    } catch (error) {
      console.error("MobileNotesFlow error", error);
      setStatusTone("error");
      setStatus("Uventet fejl. Prøv igen om lidt.");
    } finally {
      setLoading(false);
    }
  }

  function handleFolderChange(folderId: string) {
    if (!folderId) {
      router.replace("/m/noter");
      return;
    }
    router.replace(`/m/noter?scope=${encodeURIComponent(folderId)}`);
  }

  const hasFolder = !!selectedFolderId;
  const hasFiles = uniqueFiles.length > 0;
  const selectedFolderName = folders.find((folder) => folder.id === selectedFolderId)?.name ?? null;
  const markdownText = note?.content ?? "";

  return (
    <div className="space-y-4">
      <section className="rounded-2xl border border-zinc-200 bg-white p-4 shadow-sm">
        <div className="space-y-1">
          <label className="text-xs font-medium uppercase tracking-wide text-zinc-500">Mappe</label>
          <select
            className="w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm outline-none focus:border-zinc-900 focus:ring-1 focus:ring-zinc-900/40"
            value={selectedFolderId ?? ""}
            onChange={(e) => handleFolderChange(e.target.value)}
          >
            <option value="">Vælg mappe</option>
            {folders.map((folder) => (
              <option key={folder.id} value={folder.id}>
                {folder.name}
              </option>
            ))}
          </select>
          <p className="text-xs text-zinc-500">Vælg én mappe for at se de filer, du kan bruge som kilde.</p>
        </div>
      </section>

      {!hasFolder ? (
        <section className="rounded-2xl border border-zinc-200 bg-white p-4 shadow-sm">
          <h2 className="text-sm font-semibold text-zinc-900">Vælg mappe</h2>
          <p className="mt-1 text-sm text-zinc-600">Vælg en mappe med materiale for at se filer og generere noter.</p>
          <div className="mt-3 flex flex-wrap gap-2">
            <Link
              href="/upload"
              className="rounded-lg border border-zinc-300 bg-white px-4 py-2 text-xs font-semibold text-zinc-800 hover:bg-zinc-100"
            >
              Gå til Upload / ret materiale
            </Link>
          </div>
        </section>
      ) : !hasFiles ? (
        <section className="rounded-2xl border border-zinc-200 bg-white p-4 shadow-sm">
          <h2 className="text-sm font-semibold text-zinc-900">Ingen filer fundet</h2>
          <p className="mt-1 text-sm text-zinc-600">
            {selectedFolderName
              ? `Der blev ikke fundet brugbart materiale i ${selectedFolderName}.`
              : "Der blev ikke fundet brugbart materiale i den valgte mappe."}{" "}
            Upload materiale, eller vælg en anden mappe for at fortsætte.
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            <Link
              href="/upload"
              className="rounded-lg border border-zinc-300 bg-white px-4 py-2 text-xs font-semibold text-zinc-800 hover:bg-zinc-100"
            >
              Gå til Upload / ret materiale
            </Link>
          </div>
        </section>
      ) : (
        <section className="space-y-4 rounded-2xl border border-zinc-200 bg-white p-4 shadow-sm">
          <div className="space-y-1">
            <label className="text-xs font-medium uppercase tracking-wide text-zinc-500">Fil / kilde</label>
            <select
              className="w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm outline-none focus:border-zinc-900 focus:ring-1 focus:ring-zinc-900/40"
              value={selectedFileId}
              onChange={(e) => setSelectedFileId(e.target.value)}
            >
              <option value="">Vælg fil</option>
              {uniqueFiles.map((file) => (
                <option key={file.id} value={file.id}>
                  {file.name || file.id}
                </option>
              ))}
            </select>
            {!selectedFileId ? (
              <div className="rounded-lg border border-dashed border-zinc-200 bg-zinc-50 px-3 py-2 text-xs text-zinc-600">
                Vælg en fil for at fortsætte til note-generering.
              </div>
            ) : null}
          </div>

          <div className="space-y-1">
            <label className="text-xs font-medium uppercase tracking-wide text-zinc-500">Note-type</label>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => setMode("resume")}
                disabled={loading}
                className={
                  "flex-1 rounded-lg border px-3 py-2 text-xs font-medium transition-colors " +
                  (mode === "resume"
                    ? "border-zinc-400 bg-zinc-100 text-zinc-900"
                    : "border-zinc-200 bg-white text-zinc-700 hover:bg-zinc-100")
                }
              >
                Resumé
              </button>
              <button
                type="button"
                onClick={() => setMode("golden")}
                disabled={loading}
                className={
                  "flex-1 rounded-lg border px-3 py-2 text-xs font-medium transition-colors " +
                  (mode === "golden"
                    ? "border-zinc-400 bg-zinc-100 text-zinc-900"
                    : "border-zinc-200 bg-white text-zinc-700 hover:bg-zinc-100")
                }
              >
                Fokus-noter
              </button>
            </div>
          </div>

          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={handleGenerate}
              disabled={loading || !selectedFileId}
              className={
                "rounded-lg px-4 py-2 text-xs font-semibold shadow-sm " +
                (loading || !selectedFileId
                  ? "cursor-not-allowed border border-zinc-300 bg-zinc-200 text-zinc-500"
                  : "border border-zinc-300 bg-white text-zinc-800 hover:bg-zinc-100")
              }
            >
              {loading ? "Genererer og gemmer…" : "Generér & gem noter"}
            </button>
            {status ? (
              <span
                className={
                  "rounded-lg border px-3 py-2 text-xs " +
                  (statusTone === "error"
                    ? "border-red-200 bg-red-50 text-red-700"
                    : "border-zinc-200 bg-zinc-50 text-zinc-700")
                }
              >
                {status}
              </span>
            ) : null}
          </div>
        </section>
      )}

      {note ? (
        <section className="rounded-2xl border border-zinc-200 bg-white p-4 shadow-sm">
          <div className="mb-2 flex items-center justify-between gap-2">
            <div className="text-xs font-semibold uppercase tracking-wide text-zinc-500">Genereret note</div>
            {note.title ? <div className="truncate text-xs text-zinc-600">{note.title}</div> : null}
          </div>

          <div className="max-h-[420px] overflow-auto rounded-xl border border-zinc-200 bg-white px-4 py-3 text-sm leading-relaxed text-zinc-900">
            {markdownText.trim() ? (
              mode === "golden" ? <FocusNoteContent content={markdownText} /> : <ResumeNoteContent content={markdownText} />
            ) : (
              <span className="text-xs text-zinc-500">(Ingen indhold returneret fra API’et.)</span>
            )}
          </div>
        </section>
      ) : null}
    </div>
  );
}
