// app/traener/ux/ClientTrainer.tsx
"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import LimitNotice from "../_ui/LimitNotice";

type Folder = { id: string; name: string };

type Props = {
  ownerId?: string;
  activeFolderId?: string | null;
  folders?: Folder[];
  scopeFolderIds?: string[];

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

const EVAL_ATTEMPTS_MAX = 2;

function clampScore(x: unknown): number | null {
  const n = typeof x === "number" ? x : Number(x);
  if (!Number.isFinite(n)) return null;
  return Math.max(0, Math.min(100, Math.round(n)));
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

function normalizeCitations(input: unknown): Citation[] {
  if (!input) return [];

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

function citationLabel(c: Citation, i: number) {
  return c.title || c.url || `Kilde ${i + 1}`;
}

async function readJsonSafe(res: Response) {
  const text = await res.text();
  try {
    return text.trim() ? JSON.parse(text) : {};
  } catch {
    const snippet = text.replace(/\s+/g, " ").slice(0, 160);
    throw new Error(`HTTP ${res.status}: ${snippet}`);
  }
}

function clampInt(n: any, min: number, max: number) {
  const x = Number.isFinite(Number(n)) ? Math.round(Number(n)) : min;
  return Math.min(max, Math.max(min, x));
}

function pickTrainerQuota(json: any): { used: number; limit: number | null } {
  const used =
    (typeof json?.trainer_round?.usedThisMonth === "number" ? json.trainer_round.usedThisMonth : null) ??
    (typeof json?.trainer_round?.used_this_month === "number" ? json.trainer_round.used_this_month : null) ??
    (typeof json?.trainerUsedThisMonth === "number" ? json.trainerUsedThisMonth : null) ??
    0;

  const limit =
    (typeof json?.trainer_round?.limitPerMonth === "number" ? json.trainer_round.limitPerMonth : null) ??
    (typeof json?.trainer_round?.limit_per_month === "number" ? json.trainer_round.limit_per_month : null) ??
    (typeof json?.trainerLimitPerMonth === "number" ? json.trainerLimitPerMonth : null) ??
    (typeof json?.trainer_round?.monthlyLimit === "number" ? json.trainer_round.monthlyLimit : null) ??
    null;

  return { used: clampInt(used, 0, 1_000_000), limit: typeof limit === "number" ? clampInt(limit, 0, 1_000_000) : null };
}

export default function ClientTrainer({
  ownerId,
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
    folderName ?? (effectiveFolderId ? folders?.find((f) => f.id === effectiveFolderId)?.name ?? null : null);

  const scopeNames =
    scopeFolderIds && folders ? folders.filter((f) => scopeFolderIds.includes(f.id)).map((f) => f.name) : [];

  const [question, setQuestion] = useState("");
  const [answer, setAnswer] = useState("");
  const includeBackground = true;

  const [questionFileId, setQuestionFileId] = useState<string | null>(null);
  const [evalResult, setEvalResult] = useState<EvalResult | null>(null);

  // ✅ runde-id (betales på generate)
  const [roundId, setRoundId] = useState<string | null>(null);

  // ✅ antal eval-forsøg brugt i denne runde (lokalt UI)
  const [evalAttemptsUsed, setEvalAttemptsUsed] = useState(0);

  // ✅ “Tilpas / Færdig”
  const [questionEditable, setQuestionEditable] = useState(false);

  const [loadingQuestion, setLoadingQuestion] = useState(false);
  const [loadingEval, setLoadingEval] = useState(false);
  const [savingNote, setSavingNote] = useState(false);

  const [noteSavedMsg, setNoteSavedMsg] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // ✅ quota state som MC: vis med det samme + disable knap
  const [limitReached, setLimitReached] = useState(false);
  const [limitMessage, setLimitMessage] = useState<string | null>(null);

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

  const dispatchQuotaChanged = () => {
    try {
      window.dispatchEvent(new Event("notely-quota-changed"));
    } catch {
      // ignore
    }
  };

  const checkQuotaNow = useMemo(() => {
    return async () => {
      try {
        const res = await fetch("/api/quota/current", { method: "GET", cache: "no-store" });
        if (!res.ok) return;

        const json = await readJsonSafe(res).catch(() => null);
        if (!json?.ok) return;

        const { used, limit } = pickTrainerQuota(json);
        if (typeof limit === "number" && limit > 0 && used >= limit) {
          setLimitReached(true);
          setLimitMessage(null);
        } else {
          setLimitReached(false);
          setLimitMessage(null);
        }
      } catch {
        // fail-open
      }
    };
  }, []);

  // ✅ ved load + når sidebar siger quota ændret
  useEffect(() => {
    let alive = true;

    void (async () => {
      if (!alive) return;
      await checkQuotaNow();
    })();

    const onQuota = () => void checkQuotaNow();
    window.addEventListener("notely-quota-changed", onQuota);
    return () => {
      alive = false;
      window.removeEventListener("notely-quota-changed", onQuota);
    };
  }, [checkQuotaNow]);

  const handleGenerateQuestion = async () => {
    clearMessages();

    if (limitReached) return;

    setLoadingQuestion(true);

    try {
      const res = await fetch("/api/generate-question", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          folderId: effectiveFolderId ?? null,
          scopeFolderIds: scopeFolderIds ?? [],
          roundId,
        }),
      });

      const data = await res.json().catch(() => null);

      // ✅ quota / limit
      if (res.status === 402 || res.status === 429) {
        setLimitReached(true);
        setLimitMessage(String((data as any)?.error ?? "").trim() || null);
        dispatchQuotaChanged();
        router.refresh();
        return;
      }

      if (!res.ok || !data) {
        const msg = (data as any)?.error || "Kunne ikke generere spørgsmål";
        throw new Error(msg);
      }

      const q =
        (data as any)?.question ||
        (data as any)?.prompt ||
        "Formulér et kort eksamensspørgsmål inden for dette emne.";

      const usedFileId = (data as any)?.usedFileId ? String((data as any).usedFileId) : null;
      const newRoundIdRaw = (data as any)?.roundId ?? (data as any)?.round_id ?? null;
      const newRoundId = newRoundIdRaw ? String(newRoundIdRaw) : null;

      setQuestion(String(q));
      setQuestionEditable(false);
      setAnswer("");
      setEvalResult(null);

      setQuestionFileId(usedFileId);
      setRoundId(newRoundId);

      // ✅ ny runde => reset eval-forsøg (så knappen starter som “Evaluer svar”)
      setEvalAttemptsUsed(0);

      dispatchQuotaChanged();
      router.refresh();
    } catch (err: any) {
      setErrorMsg(err?.message || "Fejl ved generering af spørgsmål.");
    } finally {
      setLoadingQuestion(false);
    }
  };

  const handleEvaluate = async () => {
    clearMessages();

    if (!question || !answer.trim()) {
      setErrorMsg("Udfyld både spørgsmål og svar før du evaluerer.");
      return;
    }

    if (!roundId) {
      setErrorMsg("Tryk “Generér nyt spørgsmål” først for at starte en runde.");
      return;
    }

    // ✅ 2 forsøg pr. runde (UI-guard)
    if (evalAttemptsUsed >= EVAL_ATTEMPTS_MAX) {
      setErrorMsg("Denne runde er brugt op. Generér et nyt spørgsmål for at starte en ny runde.");
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

          round_id: roundId,
          file_id: questionFileId ?? null,
        }),
      });

      const data = await res.json().catch(() => null);

      // ✅ hvis runden er brugt op (server-guard), så disable “Prøv igen”
      if (res.status === 402) {
        const msg = String((data as any)?.error ?? "").trim() || "Denne runde er brugt op. Generér et nyt spørgsmål.";
        setEvalAttemptsUsed(EVAL_ATTEMPTS_MAX);
        setErrorMsg(msg);
        router.refresh();
        return;
      }

      if (!res.ok || !data) {
        const msg = (data as any)?.error || "Kunne ikke evaluere (tomt svar fra server).";
        throw new Error(msg);
      }

      const score = clampScore((data as any).score ?? (data as any).grade);
      const feedback = String((data as any).feedback ?? (data as any).evaluation ?? "").trim();

      const citations = normalizeCitations((data as any).citations ?? (data as any).sources ?? []);
      const usedFileId = (data as any).usedFileId ? String((data as any).usedFileId) : null;

      setEvalResult({
        feedback: feedback || "Ingen feedback (tomt svar).",
        score,
        citations,
        usedFileId,
      });

      // ✅ efter første eval: knappen skal næste gang stå “Prøv igen”
      setEvalAttemptsUsed((n) => Math.min(EVAL_ATTEMPTS_MAX, n + 1));

      router.refresh();
    } catch (err: any) {
      setErrorMsg(err?.message || "Fejl ved evaluering.");
    } finally {
      setLoadingEval(false);
    }
  };

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
          ? dedupeCitations(evalResult.citations).map((c, idx) => {
              const label = citationLabel(c, idx);
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

  const evalBtnText =
    loadingEval ? "Evaluerer..." : evalAttemptsUsed === 1 ? "Prøv igen" : "Evaluer svar";

  const evalBtnDisabled = loadingEval || evalAttemptsUsed >= EVAL_ATTEMPTS_MAX;

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

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setQuestionEditable((v) => !v)}
              disabled={!question}
              className="rounded-lg border border-zinc-200 bg-white px-3 py-1 text-xs text-zinc-700 hover:bg-zinc-50 disabled:opacity-50"
              title="Lås op for redigering af spørgsmålet"
            >
              {questionEditable ? "Færdig" : "Tilpas"}
            </button>

            <button
              type="button"
              onClick={handleGenerateQuestion}
              disabled={loadingQuestion || limitReached}
              className="rounded-lg border border-zinc-200 bg-zinc-100 px-3 py-1 text-xs text-zinc-700 hover:bg-zinc-200 disabled:opacity-50"
            >
              {loadingQuestion ? "Genererer..." : "Generér nyt spørgsmål"}
            </button>
          </div>
        </div>

        {limitReached ? <LimitNotice feature="trainer_round" message={limitMessage} /> : null}

        <textarea
          readOnly={!questionEditable}
          className="mt-1 w-full min-h-[96px] rounded-xl border border-zinc-200 px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-zinc-900/5 read-only:bg-zinc-50"
          value={question}
          onChange={(e) => {
            clearMessages();
            setQuestion(e.target.value);
          }}
          placeholder="Tryk “Generér nyt spørgsmål” for at starte."
        />

        <p className="text-[10px] text-zinc-500">Du kan tilpasse spørgsmålet til det stof, du vil træne.</p>
      </section>

      <section className="space-y-2 rounded-2xl border border-zinc-200 bg-white p-4 shadow-sm">
        <div className="flex items-center justify-between gap-3">
          <h3 className="text-sm font-semibold">Dit svar / 100</h3>
          <button
            type="button"
            onClick={handleEvaluate}
            disabled={evalBtnDisabled}
            className="rounded-lg border border-zinc-200 bg-zinc-100 px-3 py-1 text-xs text-zinc-700 hover:bg-zinc-200 disabled:opacity-50"
            title={evalAttemptsUsed >= EVAL_ATTEMPTS_MAX ? "Runden er brugt op – generér nyt spørgsmål." : undefined}
          >
            {evalBtnText}
          </button>
        </div>

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

              {evalResult.citations.length > 0 && (
                <div className="mt-2 text-[10px] text-zinc-500">
                  <div className="font-semibold text-zinc-600">Baggrundslitteratur / kilder</div>
                  <ul className="mt-1 space-y-0.5">
                    {dedupeCitations(evalResult.citations).map((c, idx) => {
                      const label = citationLabel(c, idx);
                      return (
                        <li key={c.chunkId || `${c.fileId ?? "file"}-${idx}`} className="break-all">
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
