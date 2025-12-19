"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeSanitize from "rehype-sanitize";

type FileOption = {
  id: string;
  name: string | null;
};

type Props = {
  ownerId: string;
  activeFolderId: string | null;
  files: FileOption[];
  hasScope: boolean;
};

type GeneratedNote = {
  id: string;
  title: string | null;
  content: string | null;
  created_at?: string | null;
};

export default function GenerateFromSource(props: Props) {
  const { files, hasScope } = props;
  const router = useRouter();

  // Deduplikér filer pr. id (så React keys er unikke)
  const uniqueFiles = useMemo(() => {
    const seen = new Set<string>();
    const result: FileOption[] = [];

    for (const f of files ?? []) {
      if (!f?.id) continue;
      if (seen.has(f.id)) continue;
      seen.add(f.id);
      result.push(f);
    }

    return result;
  }, [files]);

  const [selectedFileId, setSelectedFileId] = useState<string>(
    uniqueFiles[0]?.id ?? "",
  );
  const [mode, setMode] = useState<"resume" | "golden">("resume");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<GeneratedNote | null>(null);
  const [info, setInfo] = useState<string | null>(null);

  const hasFiles = uniqueFiles.length > 0;

  // Sørg for at selectedFileId altid peger på en gyldig fil
  useEffect(() => {
    if (!hasFiles) {
      setSelectedFileId("");
      return;
    }
    const stillExists = uniqueFiles.some((f) => f.id === selectedFileId);
    if (!stillExists) {
      setSelectedFileId(uniqueFiles[0].id);
    }
  }, [hasFiles, uniqueFiles, selectedFileId]);

  async function handleGenerate() {
    if (!selectedFileId) {
      setError("Vælg først en kilde-fil.");
      return;
    }

    const selected = uniqueFiles.find((f) => f.id === selectedFileId) || null;
    const fileName = selected?.name ?? null;

    if (!fileName) {
      setError("Kilde-filnavn mangler. Prøv at genindlæse siden.");
      return;
    }

    setLoading(true);
    setError(null);
    setInfo(null);

    try {
      const apiMode: "resume" | "golden" = mode;

      const res = await fetch("/api/notes/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          fileId: selectedFileId,
          mode: apiMode,
        }),
      });

      const data = await res.json().catch(() => null);

      if (!res.ok || !data?.ok) {
        setError(
          data?.error || "Der opstod en fejl under genereringen. Prøv igen.",
        );
        return;
      }

      const n: GeneratedNote | null = data.note ?? null;
      if (!n) {
        setError("API returnerede ingen note.");
        return;
      }

      setNote({
        id: n.id,
        title: n.title ?? fileName ?? "Genereret note",
        content: n.content ?? null,
        created_at: n.created_at ?? null,
      });

      setInfo("Noten er gemt i dine noter.");
      router.refresh();
    } catch (e) {
      console.error("GenerateFromSource error", e);
      setError("Uventet fejl. Prøv igen om lidt.");
    } finally {
      setLoading(false);
    }
  }

  const noFilesMessage = !hasScope
    ? "Vælg mindst ét fag / en mappe i venstre side for at se dine filer her."
    : "Der er ingen filer i de valgte mapper endnu. Upload materiale først, og kom så tilbage hertil for at lave resumé eller fokus-noter.";

  const markdownText = note?.content ?? "";

  return (
    <div className="space-y-4">
      {/* Kontrol-boks */}
      <div className="rounded-2xl border border-neutral-200 bg-white p-4 shadow-sm">
        <h2 className="mb-3 text-sm font-semibold text-neutral-900">
          Generér noter ud fra dit materiale
        </h2>

        {!hasFiles ? (
          <p className="text-sm text-neutral-600">{noFilesMessage}</p>
        ) : (
          <div className="space-y-3 text-sm">
            {/* Kilde-vælg */}
            <div className="space-y-1">
              <label className="text-xs font-medium uppercase tracking-wide text-neutral-500">
                KILDE
              </label>
              <select
                className="w-full rounded-lg border border-neutral-300 bg-white px-3 py-2 text-sm outline-none focus:border-neutral-900 focus:ring-1 focus:ring-neutral-900/40"
                value={selectedFileId}
                onChange={(e) => setSelectedFileId(e.target.value)}
              >
                {uniqueFiles.map((f) => (
                  <option key={f.id} value={f.id}>
                    {f.name || f.id}
                  </option>
                ))}
              </select>
              <p className="text-xs text-neutral-500">
                Vælg den fil, du vil lave resumé eller fokus-noter fra.
              </p>
            </div>

            {/* Mode-vælg */}
            <div className="space-y-1">
              <label className="text-xs font-medium uppercase tracking-wide text-neutral-500">
                NOTE-TYPE
              </label>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => setMode("resume")}
                  disabled={loading}
                  className={
                    "flex-1 rounded-lg border px-3 py-2 text-xs font-medium transition-colors " +
                    (mode === "resume"
                      ? "border-neutral-400 bg-neutral-100 text-neutral-900"
                      : "border-neutral-200 bg-white text-neutral-700 hover:bg-neutral-100")
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
                      ? "border-neutral-400 bg-neutral-100 text-neutral-900"
                      : "border-neutral-200 bg-white text-neutral-700 hover:bg-neutral-100")
                  }
                >
                  Fokus-noter
                </button>
              </div>
              <p className="text-xs text-neutral-500">
                Resumé = kort overblik i tekst. Fokus-noter = punktform, ekstra
                eksamensfokus.
              </p>
            </div>

            {/* Knap + status */}
            <div className="flex items-center gap-3 pt-1">
              <button
                type="button"
                onClick={handleGenerate}
                disabled={loading || !hasFiles}
                className={
                  "rounded-lg px-4 py-2 text-xs font-semibold shadow-sm " +
                  (loading || !hasFiles
                    ? "cursor-not-allowed border border-neutral-300 bg-neutral-200 text-neutral-500"
                    : "border border-neutral-300 bg-white text-neutral-800 hover:bg-neutral-100")
                }
              >
                {loading ? "Genererer og gemmer…" : "Generér & gem noter"}
              </button>
              {error && <span className="text-xs text-red-600">{error}</span>}
              {!error && info && (
                <span className="text-xs text-neutral-600">{info}</span>
              )}
            </div>
          </div>
        )}
      </div>

      {/* Resultat-boks */}
      {note && (
        <div className="rounded-2xl border border-neutral-200 bg-white p-4 shadow-sm">
          <div className="mb-2 flex items-center justify-between gap-2">
            <div className="text-xs font-semibold uppercase tracking-wide text-neutral-500">
              Genereret note
            </div>
            {note.title && (
              <div className="truncate text-xs text-neutral-600">
                {note.title}
              </div>
            )}
          </div>

          <div className="max-h-[420px] overflow-auto rounded-xl border border-neutral-200 bg-[#fffef9] px-4 py-3 text-sm leading-relaxed text-neutral-900">
            {markdownText.trim() ? (
              <div className="prose prose-sm max-w-none break-words prose-headings:mt-3 prose-headings:mb-2 prose-p:my-2 prose-ul:my-2 prose-ol:my-2 prose-li:my-1 prose-strong:font-semibold prose-code:before:content-[''] prose-code:after:content-['']">
                <ReactMarkdown
                  remarkPlugins={[remarkGfm]}
                  rehypePlugins={[rehypeSanitize]}
                  components={{
                    pre: ({ children }) => (
                      <pre className="overflow-auto rounded-lg border border-neutral-200 bg-white px-3 py-2 text-[12px] leading-relaxed">
                        {children}
                      </pre>
                    ),
                    code: ({ children }) => (
                      <code className="rounded bg-white px-1 py-0.5 text-[12px]">
                        {children}
                      </code>
                    ),
                  }}
                >
                  {markdownText}
                </ReactMarkdown>
              </div>
            ) : (
              <span className="text-xs text-neutral-500">
                (Ingen indhold returneret fra API’et.)
              </span>
            )}
          </div>

          {note.created_at && (
            <p className="mt-2 text-right text-[10px] text-neutral-500">
              Gemt: {new Date(note.created_at).toLocaleString("da-DK")}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
