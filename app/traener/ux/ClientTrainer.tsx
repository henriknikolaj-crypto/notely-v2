// app/traener/ux/ClientTrainer.tsx
"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

type Folder = { id: string; name: string };

type Props = {
  // Nyt setup (fra /traener/page.tsx)
  ownerId?: string; // gemt til senere brug
  activeFolderId?: string | null;
  folders?: Folder[];
  scopeFolderIds?: string[]; // mapper, der er valgt som scope

  // Eksisterende/ældre props (beholdt for kompatibilitet)
  folderId?: string | null;
  folderName?: string | null;
  noteId?: string | null;
  selectedNoteTitle?: string | null;
};

type Citation = {
  chunkId: string;
  fileId: string | null;
  title: string | null;
  url: string | null;
};

type EvalResult = {
  feedback: string;
  score: number | null;
  citations: Citation[];
  usedFileId: string | null;
};

type CitationObj = {
  chunkId?: string;
  id?: string;
  fileId?: string | null;
  file_id?: string | null;
  title?: string | null;
  url?: string | null;
};

function clampScore(x: unknown): number | null {
  const n = typeof x === "number" ? x : Number(x);
  if (!Number.isFinite(n)) return null;
  return Math.max(0, Math.min(100, Math.round(n)));
}

function normalizeCitations(input: unknown): Citation[] {
  if (!input) return [];

  // legacy string[]
  if (Array.isArray(input) && input.every((x) => typeof x === "string")) {
    const out: Citation[] = (input as string[])
      .map((s, i) => {
        const t = String(s ?? "").trim();
        if (!t) return null;
        return { chunkId: `legacy-${i}`, fileId: null, title: t, url: null };
      })
      .filter(Boolean) as Citation[];

    return dedupeCitations(out);
  }

  // object[]
  if (Array.isArray(input)) {
    const out: Citation[] = [];
    for (const x of input) {
      if (!x || typeof x !== "object") continue;
      const obj = x as CitationObj;

      const chunkId = String(obj.chunkId ?? obj.id ?? "").trim();
      const fileIdRaw = obj.fileId ?? obj.file_id ?? null;
      const fileId = fileIdRaw ? String(fileIdRaw).trim() : null;

      const title = obj.title != null && String(obj.title).trim() ? String(obj.title).trim() : null;
      const url = obj.url != null && String(obj.url).trim() ? String(obj.url).trim() : null;

      if (!chunkId && !title && !url && !fileId) continue;

      out.push({
        chunkId: chunkId || `c-${out.length}`,
        fileId,
        title,
        url,
      });
    }

    return dedupeCitations(out);
  }

  return [];
}

function dedupeCitations(citations: Citation[]): Citation[] {
  const seen = new Set<string>();
  const out: Citation[] = [];

  for (const c of citations) {
    const key = [
      (c.title ?? "").trim().toLowerCase(),
      (c.url ?? "").trim().toLowerCase(),
      (c.fileId ?? "").trim().toLowerCase(),
    ].join("|");

    if (seen.has(key)) continue;
    seen.add(key);
    out.push(c);
  }

  return out;
}

function citationLabel(c: Citation, i: number) {
  return c.title || c.url || `Kilde ${i + 1}`;
}

export default function ClientTrainer({
  ownerId, // pt. ikke brugt, men fin at have til senere
  activeFolderId,
  folders,
  scopeFolderIds,
  folderId,
  folderName,
  noteId,
  selectedNoteTitle,
}: Props) {
  void ownerId;

  const router = useRouter();

  const effectiveFolderId = folderId ?? activeFolderId ?? null;

  const effectiveFolderName =
    folderName ??
    (effectiveFolderId ? folders?.find((f) => f.id === effectiveFolderId)?.name ?? null : null);

  const scopeNames =
    scopeFolderIds && folders ? folders.filter((f) => scopeFolderIds.includes(f.id)).map((f) => f.name) : [];

  const [question, setQuestion] = useState("");
  const [answer, setAnswer] = useState("");
  const [includeBackground, setIncludeBackground] = useState(true);

  // Den fil /api/generate-question brugte som “primary”
  const [questionFileId, setQuestionFileId] = useState<string | null>(null);

  const [evalResult, setEvalResult] = useState<EvalResult | null>(null);

  const [loadingQuestion, setLoadingQuestion] = useState(false);
  const [loadingEval, setLoadingEval] = useState(false);
  const [savingNote, setSavingNote] = useState(false);

  const [noteSavedMsg, setNoteSavedMsg] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const clearMessages = () => {
    setErrorMsg(null);
    setNoteSavedMsg(null);
  };

  const scopeLabel = (() => {
    if (noteId) {
      return selectedNoteTitle ? `Udvalgt materiale: ${selectedNoteTitle}` : "Udvalgt materiale i mappen";
    }

    if (scopeNames.length > 1) {
      const preview = scopeNames.length <= 3 ? scopeNames.join(", ") : `${scopeNames.slice(0, 3).join(", ")} m.fl.`;
      return `Flere mapper: ${preview}`;
    }

    if (scopeNames.length === 1) return `Hele mappen: ${scopeNames[0]}`;
    if (effectiveFolderName) return `Hele mappen: ${effectiveFolderName}`;

    return "Vælg en mappe eller et materiale i venstre side.";
  })();

  // 1) Generer nyt spørgsmål
  const handleGenerateQuestion = async () => {
    clearMessages();
    setLoadingQuestion(true);

    try {
      const res = await fetch("/api/generate-question", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          folder_id: effectiveFolderId ?? null,
          folderName: effectiveFolderName ?? null,
          note_id: noteId ?? null,
          scopeFolderIds: scopeFolderIds ?? [],
        }),
      });

      const data = await res.json().catch(() => null);
      if (!res.ok || !data) {
        const msg = (data as any)?.error || "Kunne ikke generere spørgsmål";
        throw new Error(msg);
      }

      const q =
        (data as any)?.question ||
        (data as any)?.prompt ||
        "Formulér et kort eksamensspørgsmål inden for dette emne.";

      const usedFileId = (data as any)?.usedFileId ? String((data as any).usedFileId) : null;

      setQuestion(String(q));
      setAnswer("");
      setEvalResult(null);

      // vigtig: gem fil-id fra spørgsmåls-generatoren,
      // så evalueringen kan bruge SAMME kilde (trin #1: send file_id)
      setQuestionFileId(usedFileId);
    } catch (err: any) {
      setErrorMsg(err?.message || "Fejl ved generering af spørgsmål.");
    } finally {
      setLoadingQuestion(false);
    }
  };

  // 2) Evaluer svar
  const handleEvaluate = async () => {
    clearMessages();

    if (!question || !answer.trim()) {
      setErrorMsg("Udfyld både spørgsmål og svar før du evaluerer.");
      return;
    }

    setLoadingEval(true);

    try {
      const res = await fetch("/api/evaluate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          prompt: question, // legacy
          question,
          answer,
          includeBackground,
          folder_id: effectiveFolderId ?? null,
          note_id: noteId ?? null,
          scopeFolderIds: scopeFolderIds ?? [],
          source_type: "trainer",

          // ✅ trin #1: hvis vi har en questionFileId, så låser vi evalueringen til samme fil
          file_id: includeBackground ? (questionFileId ?? null) : null,
        }),
      });

      const data = await res.json().catch(() => null);
      if (!res.ok || !data) {
        const msg = (data as any)?.error || "Kunne ikke evaluere (tomt svar fra server).";
        throw new Error(msg);
      }

      const score = clampScore((data as any).score ?? (data as any).grade);
      const feedback = String((data as any).feedback ?? (data as any).evaluation ?? "").trim();

      // ✅ trin #2A: dedupe i UI (normalizeCitations deduper)
      const citations = normalizeCitations((data as any).citations ?? (data as any).sources ?? []);
      const usedFileId = (data as any).usedFileId ? String((data as any).usedFileId) : null;

      setEvalResult({
        feedback: feedback || "Ingen feedback (tomt svar).",
        score,
        citations,
        usedFileId,
      });

      router.refresh();
    } catch (err: any) {
      setErrorMsg(err?.message || "Fejl ved evaluering.");
    } finally {
      setLoadingEval(false);
    }
  };

  // 3) Gem som note
  const handleSaveNote = async () => {
    clearMessages();

    if (!question && !answer && !evalResult?.feedback) {
      setErrorMsg("Der er intet at gemme som note endnu.");
      return;
    }

    setSavingNote(true);

    try {
      const baseTitle = effectiveFolderName ? `${effectiveFolderName} – træner` : "Træner";

      const title =
        noteId && selectedNoteTitle
          ? `${baseTitle}: ${selectedNoteTitle}`
          : `${baseTitle}: ${question ? question.replace(/\s+/g, " ").slice(0, 80) : "Øvelse"}`;

      const citationsLines =
        evalResult?.citations?.length
          ? dedupeCitations(evalResult.citations).map((c, i) => {
              const label = citationLabel(c, i);
              return c.url ? `- ${label} (${c.url})` : `- ${label}`;
            })
          : [];

      const contentLines = [
        question ? `**Spørgsmål**\n${question}` : "",
        answer ? `\n\n**Svar**\n${answer}` : "",
        evalResult?.score != null ? `\n\n**Score**: ${evalResult.score}/100` : "",
        evalResult?.feedback ? `\n\n**Feedback**\n${evalResult.feedback}` : "",
        citationsLines.length ? `\n\n**Kilder**\n${citationsLines.join("\n")}` : "",
      ].filter(Boolean);

      const content = contentLines.join("");

      const res = await fetch("/api/notes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title,
          content,
          source_title: "Træner",
          source_url: "/traener",
          folder_id: effectiveFolderId ?? null,
          note_type: "trainer_feedback",
        }),
      });

      const data = await res.json().catch(() => null);
      if (!res.ok || !data) {
        const msg = (data as any)?.error || "Kunne ikke gemme note";
        throw new Error(msg);
      }

      setNoteSavedMsg("Note gemt.");
      router.refresh();
    } catch (err: any) {
      setErrorMsg(err?.message || "Fejl ved gem som note.");
    } finally {
      setSavingNote(false);
    }
  };

  return (
    <div className="space-y-4">
      <section className="rounded-2xl border border-zinc-200 bg-white p-4 shadow-sm">
        <h2 className="mb-1 text-base font-semibold">Valgt emne</h2>
        <p className="text-xs text-zinc-600">Træn på hele mapper eller udvalgte noter/materialer fra venstre side.</p>
        <p className="mt-1 text-xs text-zinc-500">{scopeLabel}</p>
      </section>

      <section className="space-y-2 rounded-2xl border border-zinc-200 bg-white p-4 shadow-sm">
        <div className="flex items-center justify-between gap-3">
          <h3 className="text-sm font-semibold">Spørgsmål / øvelse</h3>
          <button
            type="button"
            onClick={handleGenerateQuestion}
            disabled={loadingQuestion}
            className="rounded-lg border border-zinc-200 bg-zinc-100 px-3 py-1 text-xs text-zinc-700 hover:bg-zinc-200 disabled:opacity-50"
          >
            {loadingQuestion ? "Genererer..." : "Generér nyt spørgsmål"}
          </button>
        </div>

        <textarea
          className="mt-1 w-full min-h-[96px] rounded-xl border border-zinc-200 px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-zinc-900/5"
          value={question}
          onChange={(e) => {
            clearMessages();
            setQuestion(e.target.value);
          }}
          placeholder="Skriv eller redigér spørgsmålet her..."
        />

        <p className="text-[10px] text-zinc-500">Du kan tilpasse spørgsmålet til det stof, du vil træne.</p>
      </section>

      <section className="space-y-2 rounded-2xl border border-zinc-200 bg-white p-4 shadow-sm">
        <div className="flex items-center justify-between gap-3">
          <h3 className="text-sm font-semibold">Dit svar / 100</h3>
          <button
            type="button"
            onClick={handleEvaluate}
            disabled={loadingEval}
            className="rounded-lg border border-zinc-200 bg-zinc-100 px-3 py-1 text-xs text-zinc-700 hover:bg-zinc-200 disabled:opacity-50"
          >
            {loadingEval ? "Evaluerer..." : "Evaluer svar"}
          </button>
        </div>

        <label className="flex items-center gap-2 text-[10px] text-zinc-600">
          <input
            type="checkbox"
            checked={includeBackground}
            onChange={(e) => setIncludeBackground(e.target.checked)}
            className="h-3.5 w-3.5 rounded border-zinc-300 accent-zinc-600"
          />
          Inddrag baggrundslitteratur i evalueringen (mere eksamensnært).
        </label>

        <textarea
          className="mt-1 w-full min-h-[140px] rounded-xl border border-zinc-200 px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-zinc-900/5"
          value={answer}
          onChange={(e) => {
            clearMessages();
            setAnswer(e.target.value);
          }}
          placeholder="Skriv dit svar her..."
        />
      </section>

      <section className="space-y-2 rounded-2xl border border-zinc-200 bg-white p-4 shadow-sm">
        <div className="flex items-center justify-between gap-3">
          <h3 className="text-sm font-semibold">Feedback</h3>
          <button
            type="button"
            onClick={handleSaveNote}
            disabled={savingNote}
            className="rounded-lg border border-zinc-300 bg-white px-3 py-1 text-xs hover:bg-zinc-50 disabled:opacity-60"
          >
            {savingNote ? "Gemmer..." : "Gem som note"}
          </button>
        </div>

        <div className="text-xs text-zinc-600">
          {evalResult ? (
            <>
              <div className="font-medium">Score: {evalResult.score ?? 0}/100</div>
              <p className="mt-1 whitespace-pre-wrap">{evalResult.feedback}</p>

              {includeBackground && evalResult.citations.length > 0 && (
                <div className="mt-2 text-[10px] text-zinc-500">
                  <div className="font-semibold text-zinc-600">Baggrundslitteratur / kilder</div>
                  <ul className="mt-1 space-y-0.5">
                    {dedupeCitations(evalResult.citations).map((c, i) => {
                      const label = citationLabel(c, i);
                      return (
                        <li key={c.chunkId || `${c.fileId ?? "file"}-${i}`} className="break-all">
                          {c.url ? (
                            <a className="underline" href={c.url} target="_blank" rel="noreferrer">
                              {label}
                            </a>
                          ) : (
                            <span>{label}</span>
                          )}
                        </li>
                      );
                    })}
                  </ul>
                </div>
              )}
            </>
          ) : (
            <p>Ingen feedback endnu. Skriv dit svar og tryk &quot;Evaluer svar&quot;.</p>
          )}
        </div>
      </section>

      {noteSavedMsg && (
        <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs text-emerald-700">
          {noteSavedMsg}
        </div>
      )}
      {errorMsg && (
        <div className="rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
          {errorMsg}
        </div>
      )}
    </div>
  );
}
