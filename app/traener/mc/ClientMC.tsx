"use client";

import LimitNotice from "@/app/traener/_ui/LimitNotice";
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";

type MCOption = {
  id: string;
  text: string;
  isCorrect: boolean;
};

type MCCitation = {
  chunkId: string;
  fileId: string | null;
  title: string | null;
  url: string | null;
};

type MCMeta = {
  requestId?: string | null;
  usedChunkIds?: string[] | null;
  usedFileTitle?: string | null;
};

type MCQuestion = {
  id: string;
  question: string;
  options: MCOption[];
  explanation?: string | null;
  citations?: MCCitation[];
  usedFileId?: string | null;
  meta?: MCMeta;
  source: "api" | "fallback";
};

type GenerateMcItemOk = {
  ok: true;
  questionId: string;
  question: string;
  options: MCOption[];
  explanation: string | null;
  citations: MCCitation[];
  usedFileId: string | null;
  meta?: MCMeta;
};

type GenerateMcItemErr = {
  ok: false;
  error?: string;
};

type GenerateMcItem = GenerateMcItemOk | GenerateMcItemErr;

type GenerateMcSingleResponseOk = GenerateMcItemOk;
type GenerateMcSingleResponseErr = { ok: false; error?: string; code?: string; requestId?: string };
type GenerateMcSingleResponse = GenerateMcSingleResponseOk | GenerateMcSingleResponseErr;

type GenerateMcBatchResponseOk = {
  ok: true;
  batchId: string;
  requestedCount: number;
  effectiveCount?: number;
  returnedCount: number;
  items: GenerateMcItem[];
  requestId?: string;
};

type GenerateMcBatchResponseErr = {
  ok: false;
  error?: string;
  code?: string;
  requestId?: string;
};

type GenerateMcBatchResponse = GenerateMcBatchResponseOk | GenerateMcBatchResponseErr;

// Fallback-spørgsmål hvis API'et ikke svarer
const FALLBACK_QUESTIONS: MCQuestion[] = [
  {
    id: "local-q1",
    question: "Hvad er hovedformålet med Notely?",
    options: [
      { id: "a", text: "At være en nordisk studieassistent, der hjælper dig med at forstå dit eget pensum", isCorrect: true },
      { id: "b", text: "At erstatte alle lærebøger, så du aldrig behøver at læse igen", isCorrect: false },
      { id: "c", text: "At være et generelt AI-chatværktøj uden fokus på studier", isCorrect: false },
      { id: "d", text: "Kun at lave marketing-tekster til sociale medier", isCorrect: false },
    ],
    explanation:
      "Notely er tænkt som en studieassistent/eksamenstræner, der arbejder ud fra dit eget pensum – ikke som en erstatning for alt andet.",
    source: "fallback",
  },
  {
    id: "local-q2",
    question: "Hvad er en god tommelfingerregel for Multiple Choice-spørgsmål i Notely?",
    options: [
      { id: "a", text: "Kun ét korrekt svar, tydeligt adskilt fra distraktorerne", isCorrect: true },
      { id: "b", text: "Flere svar, der alle er lige korrekte", isCorrect: false },
      { id: "c", text: "Svarmuligheder, der er så uklare som muligt", isCorrect: false },
      { id: "d", text: "Altid mindst 8 svarmuligheder", isCorrect: false },
    ],
    explanation: "MC-spørgsmål bliver stærkest, når der er én klar korrekt mulighed og nogle plausible distraktorer.",
    source: "fallback",
  },
  {
    id: "local-q3",
    question: "Hvordan skal MC-delen på sigt fungere i Notely ift. dit pensum?",
    options: [
      { id: "a", text: "Spørgsmålene skal genereres ud fra dine egne noter og filer", isCorrect: true },
      { id: "b", text: "Spørgsmålene skal være helt tilfældige uden relation til pensum", isCorrect: false },
      { id: "c", text: "Spørgsmålene skal kun handle om Notelys funktioner", isCorrect: false },
      { id: "d", text: "Spørgsmålene skal kun komme fra en global amerikansk syllabus", isCorrect: false },
    ],
    explanation: "Planen er, at MC-spørgsmål genereres ud fra dit eget materiale, så træningen matcher dit fag.",
    source: "fallback",
  },
];

type Props = {
  scopeFolderIds?: string[];
};

const DEFAULT_SESSION_SIZE = 10;
const QUOTA_MSG = "Du har nået din grænse for Multiple Choice denne måned.";

function clampInt(n: number, min: number, max: number) {
  const x = Number.isFinite(n) ? Math.round(n) : min;
  return Math.min(max, Math.max(min, x));
}

function pickQuota(json: any): { used: number; limit: number | null } {
  const used =
    (typeof json?.mc_generate?.usedThisMonth === "number" ? json.mc_generate.usedThisMonth : null) ??
    (typeof json?.mcUsedThisMonth === "number" ? json.mcUsedThisMonth : 0);

  const limit =
    (typeof json?.mc_generate?.limitPerMonth === "number" ? json.mc_generate.limitPerMonth : null) ??
    (typeof json?.mcLimitPerMonth === "number" ? json.mcLimitPerMonth : null);

  return { used: Number.isFinite(used) ? used : 0, limit: typeof limit === "number" ? limit : null };
}

function toApiQuestion(v: GenerateMcItemOk): MCQuestion {
  return {
    id: v.questionId,
    question: v.question,
    options: v.options,
    explanation: v.explanation,
    citations: v.citations ?? [],
    usedFileId: v.usedFileId ?? null,
    meta: v.meta ?? {},
    source: "api",
  };
}

type BatchResult = "OK" | "NOT_FOUND" | "STOP" | "NEEDS_SINGLE";

export default function ClientMC({ scopeFolderIds }: Props) {
  const scopeKey = useMemo(() => JSON.stringify(scopeFolderIds ?? []), [scopeFolderIds]);

  const [started, setStarted] = useState(false);

  const [currentQuestion, setCurrentQuestion] = useState<MCQuestion | null>(null);

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [checked, setChecked] = useState(false);

  const [sessionTotal, setSessionTotal] = useState(DEFAULT_SESSION_SIZE);
  const [questionNumber, setQuestionNumber] = useState(1);
  const [correctCount, setCorrectCount] = useState(0);
  const [isFinished, setIsFinished] = useState(false);

  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  const [loadingNext, setLoadingNext] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [quotaBlocked, setQuotaBlocked] = useState<string | null>(null);

  const [fallbackIndex, setFallbackIndex] = useState(0);

  // batch queue
  const [queue, setQueue] = useState<MCQuestion[]>([]);
  const [queuePos, setQueuePos] = useState(0);

  const abortRef = useRef<AbortController | null>(null);

  // anti-repeat i en runde
  const recentQuestionsRef = useRef<string[]>([]);
  const recentChunkIdsRef = useRef<string[]>([]);

  // afgør om batch endpoint findes
  const batchSupportedRef = useRef<boolean | null>(null);

  const dispatchQuotaChanged = useCallback(() => {
    if (typeof window !== "undefined") window.dispatchEvent(new Event("notely-quota-changed"));
  }, []);

  const dispatchMcUpdated = useCallback(() => {
    if (typeof window !== "undefined") window.dispatchEvent(new Event("notely:mc-updated"));
  }, []);

  const readJsonSafe = useCallback(async <T,>(res: Response): Promise<T | null> => {
    try {
      const txt = await res.text();
      if (!txt.trim()) return null;
      return JSON.parse(txt) as T;
    } catch {
      return null;
    }
  }, []);

  const registerAntiRepeat = useCallback((q: MCQuestion | null) => {
    if (!q) return;

    const qt = String(q.question ?? "").trim();
    if (qt) recentQuestionsRef.current = [...recentQuestionsRef.current, qt].slice(-20);

    const usedChunkIds = (q.meta?.usedChunkIds ?? []) || [];
    if (Array.isArray(usedChunkIds) && usedChunkIds.length > 0) {
      const merged = [...recentChunkIdsRef.current, ...usedChunkIds.map((x) => String(x))];

      const seen = new Set<string>();
      const out: string[] = [];
      for (let i = merged.length - 1; i >= 0; i--) {
        const s = String(merged[i] ?? "").trim();
        if (!s) continue;
        if (seen.has(s)) continue;
        seen.add(s);
        out.push(s);
        if (out.length >= 120) break;
      }
      recentChunkIdsRef.current = out.reverse();
    }
  }, []);

  const computeSessionSize = useCallback(async () => {
    try {
      const res = await fetch("/api/quota/current", { method: "GET", cache: "no-store" });
      if (!res.ok) return DEFAULT_SESSION_SIZE;

      const json = await readJsonSafe<any>(res);
      if (!json?.ok) return DEFAULT_SESSION_SIZE;

      const { used, limit } = pickQuota(json);
      if (typeof limit === "number" && limit > 0) {
        const remaining = Math.max(0, limit - used);
        return clampInt(Math.min(DEFAULT_SESSION_SIZE, remaining), 0, DEFAULT_SESSION_SIZE);
      }
      return DEFAULT_SESSION_SIZE;
    } catch {
      return DEFAULT_SESSION_SIZE;
    }
  }, [readJsonSafe]);

  const applyQuotaBlocked = useCallback(
    (msg?: string | null) => {
      const m = msg && msg.trim() ? msg : QUOTA_MSG;
      setQuotaBlocked(m);
      setCurrentQuestion(null);
      setIsFinished(true);
      dispatchQuotaChanged();
    },
    [dispatchQuotaChanged],
  );

  const applyFallback = useCallback(
    (mode: "initial" | "next", reason?: string) => {
      if (reason) setLoadError((prev) => prev || reason);

      setFallbackIndex((prev) => {
        const next = (prev + (mode === "next" ? 1 : 0)) % FALLBACK_QUESTIONS.length;
        const q = FALLBACK_QUESTIONS[next];
        setCurrentQuestion(q);
        registerAntiRepeat(q);
        return next;
      });

      if (mode === "next") setQuestionNumber((prev) => prev + 1);
      else setQuestionNumber(1);
    },
    [registerAntiRepeat],
  );

  const fetchBatch = useCallback(
    async (count: number): Promise<BatchResult> => {
      setLoadingNext(true);
      setLoadError(null);
      setQuotaBlocked(null);

      if (abortRef.current) abortRef.current.abort();
      const ac = new AbortController();
      abortRef.current = ac;

      try {
        const avoidQuestions = recentQuestionsRef.current.slice(-12);
        const avoidChunkIds = recentChunkIdsRef.current.slice(-80);

        const payload = {
          scopeFolderIds: scopeFolderIds ?? [],
          difficulty: "medium" as const,
          maxContextChunks: 10,
          count,
          avoidQuestions,
          avoidChunkIds,
          avoidTopics: [],
        };

        const res = await fetch("/api/generate-mc-batch", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
          signal: ac.signal,
        });

        if (res.status === 404) {
          batchSupportedRef.current = false;
          return "NOT_FOUND";
        }
        batchSupportedRef.current = true;

        if (res.status === 429) {
          const j = await readJsonSafe<any>(res);
          applyQuotaBlocked(String(j?.error ?? ""));
          return "STOP";
        }

        if (res.status === 401) {
          const j = await readJsonSafe<any>(res);
          setLoadError(String(j?.error ?? "Unauthorized. Log ind igen."));
          return "STOP";
        }

        if (!res.ok) {
          const j = await readJsonSafe<any>(res);
          setLoadError(String(j?.error ?? `Kunne ikke generere MC-batch (${res.status}).`));
          return "NEEDS_SINGLE";
        }

        const data = (await readJsonSafe<GenerateMcBatchResponse>(res)) as GenerateMcBatchResponse | null;
        if (!data || (data as any).ok === false) {
          setLoadError(String((data as any)?.error ?? "Kunne ikke generere MC-batch."));
          return "NEEDS_SINGLE";
        }

        const ok = data as GenerateMcBatchResponseOk;
        const items = Array.isArray(ok.items) ? ok.items : [];

        const apiQuestionsAll: MCQuestion[] = items
          .filter((it) => it && (it as any).ok === true)
          .map((it) => toApiQuestion(it as GenerateMcItemOk))
          .filter((q) => (q.question ?? "").trim().length > 0 && Array.isArray(q.options) && q.options.length === 4);

        if (apiQuestionsAll.length === 0) {
          setLoadError("Batch returnerede ingen gyldige spørgsmål.");
          return "NEEDS_SINGLE";
        }

        const effective =
          typeof ok.effectiveCount === "number" && Number.isFinite(ok.effectiveCount)
            ? Math.max(1, ok.effectiveCount)
            : typeof ok.returnedCount === "number" && Number.isFinite(ok.returnedCount)
              ? Math.max(1, ok.returnedCount)
              : apiQuestionsAll.length;

        const apiQuestions = apiQuestionsAll.slice(0, Math.min(effective, apiQuestionsAll.length));

        setSessionTotal(apiQuestions.length);
        setQueue(apiQuestions);
        setQueuePos(0);

        const first = apiQuestions[0] ?? null;
        setCurrentQuestion(first);
        setQuestionNumber(1);

        dispatchQuotaChanged();
        registerAntiRepeat(first);

        return "OK";
      } catch (err: any) {
        if (err?.name === "AbortError") return "STOP";
        console.error("generate-mc-batch error:", err);
        setLoadError("Kunne ikke generere MC-batch. Prøver enkelt-spørgsmål …");
        return "NEEDS_SINGLE";
      } finally {
        setLoadingNext(false);
        setSelectedId(null);
        setChecked(false);
        setSaveError(null);
      }
    },
    [applyQuotaBlocked, dispatchQuotaChanged, readJsonSafe, registerAntiRepeat, scopeFolderIds],
  );

  const fetchSingle = useCallback(
    async (mode: "initial" | "next"): Promise<"OK" | "STOP"> => {
      setLoadingNext(true);
      setLoadError(null);
      setQuotaBlocked(null);

      if (abortRef.current) abortRef.current.abort();
      const ac = new AbortController();
      abortRef.current = ac;

      try {
        const avoidQuestions = recentQuestionsRef.current.slice(-12);
        const avoidChunkIds = recentChunkIdsRef.current.slice(-80);

        const payload = {
          scopeFolderIds: scopeFolderIds ?? [],
          difficulty: "medium" as const,
          maxContextChunks: 10,
          avoidQuestions,
          avoidChunkIds,
          avoidTopics: [],
        };

        const res = await fetch("/api/generate-mc-question", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
          signal: ac.signal,
        });

        if (res.status === 429) {
          const j = await readJsonSafe<any>(res);
          applyQuotaBlocked(String(j?.error ?? ""));
          return "STOP";
        }

        if (res.status === 401) {
          const j = await readJsonSafe<any>(res);
          setLoadError(String(j?.error ?? "Unauthorized. Log ind igen."));
          return "STOP";
        }

        if (!res.ok) {
          const j = await readJsonSafe<any>(res);
          const msg =
            String(j?.error ?? j?.message ?? "").trim() || `Kunne ikke generere spørgsmål fra dit materiale (${res.status}).`;
          setLoadError(msg);
          applyFallback(mode, msg);
          return "OK";
        }

        const data = (await readJsonSafe<GenerateMcSingleResponse>(res)) as GenerateMcSingleResponse | null;
        if (!data || (data as any).ok === false) {
          const msg = String((data as any)?.error ?? "Kunne ikke generere MC-spørgsmål.");
          setLoadError(msg);
          applyFallback(mode, msg);
          return "OK";
        }

        const ok = data as GenerateMcSingleResponseOk;
        const apiQuestion = toApiQuestion(ok);

        setCurrentQuestion(apiQuestion);
        dispatchQuotaChanged();
        registerAntiRepeat(apiQuestion);

        if (mode === "next") setQuestionNumber((prev) => prev + 1);
        else setQuestionNumber(1);

        return "OK";
      } catch (err: any) {
        if (err?.name === "AbortError") return "STOP";
        console.error("generate-mc-question error:", err);
        applyFallback(mode, "Kunne ikke hente nyt spørgsmål – bruger demo-spørgsmål i stedet.");
        return "OK";
      } finally {
        setLoadingNext(false);
        setSelectedId(null);
        setChecked(false);
        setSaveError(null);
      }
    },
    [applyFallback, applyQuotaBlocked, dispatchQuotaChanged, readJsonSafe, registerAntiRepeat, scopeFolderIds],
  );

  const startNewRound = useCallback(async () => {
    setStarted(true);

    setCurrentQuestion(null);
    setSelectedId(null);
    setChecked(false);

    setIsFinished(false);
    setQuotaBlocked(null);
    setLoadError(null);
    setSaveError(null);

    setCorrectCount(0);

    recentQuestionsRef.current = [];
    recentChunkIdsRef.current = [];

    setQueue([]);
    setQueuePos(0);

    const sz = await computeSessionSize();

    if (sz <= 0) {
      setSessionTotal(0);
      applyQuotaBlocked(QUOTA_MSG);
      return;
    }

    setSessionTotal(sz);
    setQuestionNumber(1);

    const batchSupported = batchSupportedRef.current;

    if (batchSupported === false) {
      await fetchSingle("initial");
      return;
    }

    const r = await fetchBatch(sz);

    if (r === "NOT_FOUND" || r === "NEEDS_SINGLE") {
      await fetchSingle("initial");
      return;
    }
    // STOP eller OK: intet mere at gøre
  }, [applyQuotaBlocked, computeSessionSize, fetchBatch, fetchSingle]);

  // scope-skift: stop alt og tilbage til “Start”
  useEffect(() => {
    if (abortRef.current) abortRef.current.abort();

    setStarted(false);

    setCurrentQuestion(null);
    setSelectedId(null);
    setChecked(false);

    setCorrectCount(0);
    setIsFinished(false);

    setSaving(false);
    setSaveError(null);

    setLoadingNext(false);
    setLoadError(null);

    setQueue([]);
    setQueuePos(0);

    recentQuestionsRef.current = [];
    recentChunkIdsRef.current = [];

    void (async () => {
      const sz = await computeSessionSize();
      setSessionTotal(sz);
      if (sz <= 0) setQuotaBlocked(QUOTA_MSG);
      else setQuotaBlocked(null);
    })();
  }, [scopeKey, computeSessionSize]);

  const correctOption = currentQuestion?.options.find((o) => o.isCorrect) || null;

  const isCorrect =
    checked && selectedId && currentQuestion
      ? (currentQuestion.options.find((o) => o.id === selectedId)?.isCorrect ?? false)
      : false;

  function handleSelect(optionId: string) {
    if (checked) return;
    setSelectedId(optionId);
  }

  async function handleCheck() {
    if (!selectedId || checked || !currentQuestion) return;

    const selectedOption = currentQuestion.options.find((o) => o.id === selectedId);
    if (!selectedOption) return;

    const correct = !!selectedOption.isCorrect;

    setChecked(true);
    setSaving(true);
    setSaveError(null);

    if (correct) setCorrectCount((prev) => prev + 1);

    try {
      const res = await fetch("/api/mc-submit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          questionId: currentQuestion.id,
          question: currentQuestion.question,
          selectedOptionId: selectedOption.id,
          selectedOptionText: selectedOption.text,
          isCorrect: correct,
          scopeFolderIds,
          explanation: currentQuestion.explanation ?? null,
          meta: currentQuestion.meta ?? null,
          usedFileId: currentQuestion.usedFileId ?? null,
        }),
      });

      if (!res.ok) throw new Error(`mc-submit bad status: ${res.status}`);
      dispatchMcUpdated();
    } catch (err) {
      console.error("mc-submit fetch error:", err);
      setSaveError("Kunne ikke gemme resultatet (lokal fejl).");
    } finally {
      setSaving(false);
    }
  }

  async function handleNext() {
    if (!checked || loadingNext) return;

    // slut på runden
    if (questionNumber >= sessionTotal) {
      const sz = await computeSessionSize();
      if (sz <= 0) setQuotaBlocked(QUOTA_MSG);
      setIsFinished(true);
      setCurrentQuestion(null);
      return;
    }

    // batch-queue
    if (queue.length > 0) {
      const nextPos = queuePos + 1;
      const nextQ = queue[nextPos];

      if (nextQ) {
        setQueuePos(nextPos);
        setCurrentQuestion(nextQ);
        setQuestionNumber((prev) => prev + 1);

        setSelectedId(null);
        setChecked(false);
        setSaveError(null);
        setLoadError(null);

        registerAntiRepeat(nextQ);
        return;
      }

      const sz = await computeSessionSize();
      if (sz <= 0) setQuotaBlocked(QUOTA_MSG);

      setIsFinished(true);
      setCurrentQuestion(null);
      return;
    }

    await fetchSingle("next");
  }

  const shownSources = useMemo(() => {
    const cits = currentQuestion?.citations ?? [];
    if (cits.length === 0) return [];

    const usedFileId = currentQuestion?.usedFileId ?? null;
    const filtered = usedFileId ? cits.filter((c) => c.fileId === usedFileId) : cits;

    const seen = new Set<string>();
    const out: Array<{ key: string; title: string; url: string | null; fileId: string | null }> = [];

    for (const c of filtered) {
      const title = (c.title ?? "").trim();
      if (!title) continue;

      const k = `${c.fileId ?? ""}|${title}|${c.url ?? ""}`;
      if (seen.has(k)) continue;
      seen.add(k);

      out.push({ key: k, title, url: c.url ?? null, fileId: c.fileId ?? null });
    }

    return out.slice(0, 3);
  }, [currentQuestion]);

  const requestIdShown = currentQuestion?.meta?.requestId ? String(currentQuestion.meta.requestId) : null;

  // START state
  if (!started && !currentQuestion && !isFinished) {
    const hasScope = (scopeFolderIds ?? []).length > 0;

    return (
      <div className="space-y-4">
        <div className="rounded-2xl border border-zinc-200 bg-white p-4">
          <div className="text-sm font-semibold text-zinc-900">Multiple Choice</div>
          <div className="mt-1 text-xs text-zinc-600">Vælg først mappe(r) i venstre side. Tryk derefter “Start” for at generere en runde.</div>

          {quotaBlocked ? <LimitNotice className="mt-3">{quotaBlocked}</LimitNotice> : null}

          <div className="mt-4 flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => void startNewRound()}
              disabled={!hasScope || !!quotaBlocked}
              className="rounded-full bg-zinc-900 px-4 py-2 text-xs font-medium text-white disabled:opacity-40"
            >
              Start
            </button>
          </div>
        </div>
      </div>
    );
  }

  // FINISHED state
  if (isFinished && !currentQuestion) {
    const isQuota = !!quotaBlocked;

    return (
      <div className="space-y-4">
        <div className="rounded-2xl border border-zinc-200 bg-white p-4">
          <div className="text-sm font-semibold text-zinc-900">Session afsluttet</div>
          <div className="mt-1 text-xs text-zinc-600">{isQuota ? quotaBlocked : "Du er færdig med denne runde."}</div>

          {!isQuota && (
            <div className="mt-3 text-xs text-zinc-700">
              Resultat: <span className="font-medium">{correctCount}/{sessionTotal}</span>
            </div>
          )}

          <div className="mt-4 flex flex-wrap gap-2">
            {isQuota ? null : (
              <button type="button" onClick={() => void startNewRound()} className="rounded-full bg-zinc-900 px-4 py-2 text-xs font-medium text-white">
                Ny runde
              </button>
            )}
          </div>
        </div>
      </div>
    );
  }

  // LOADING
  if (!currentQuestion) {
    return (
      <div className="space-y-2 text-xs text-zinc-600">
        <div>Genererer spørgsmål …</div>
        {loadError && <div className="text-[11px] text-zinc-500">{loadError}</div>}
      </div>
    );
  }

  // NORMAL
  let footerMsg: ReactNode = null;
  if (checked && correctOption) {
    footerMsg = isCorrect ? <>Flot – du svarede rigtigt.</> : <>Korrekt svar: <span className="font-medium">{correctOption.text}</span></>;
  } else {
    footerMsg = <>Vælg et svar og tryk “Tjek svar”.</>;
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between text-xs text-zinc-600">
        <span>
          Spørgsmål {questionNumber}/{sessionTotal}
          {currentQuestion.source === "fallback" && <span className="ml-2 italic text-zinc-400">(demo)</span>}
        </span>
        <span>
          Rigtige i denne session: <span className="font-medium">{correctCount}/{sessionTotal}</span>
        </span>
      </div>

      <div className="text-sm font-medium text-zinc-900">{currentQuestion.question}</div>

      <div className="space-y-2">
        {currentQuestion.options.map((opt) => {
          const isActive = selectedId === opt.id;
          const showCorrect = checked && opt.isCorrect;
          const showWrong = checked && isActive && !opt.isCorrect;

          return (
            <button
              key={opt.id}
              type="button"
              onClick={() => handleSelect(opt.id)}
              className={[
                "flex w-full items-center justify-between rounded-xl border px-3 py-2 text-left text-sm transition",
                !checked && !isActive ? "border-zinc-200 bg-white hover:border-zinc-400" : "",
                isActive && !checked ? "border-zinc-900 bg-zinc-900 text-white" : "",
                showCorrect ? "border-emerald-500 bg-emerald-50 text-emerald-900" : "",
                showWrong ? "border-red-500 bg-red-50 text-red-900" : "",
              ].filter(Boolean).join(" ")}
            >
              <span>{opt.text}</span>
              {showCorrect && <span className="ml-3 text-xs font-semibold">Korrekt svar</span>}
              {showWrong && <span className="ml-3 text-xs font-semibold">Forkert svar</span>}
            </button>
          );
        })}
      </div>

      <div className="flex flex-col gap-3 border-t border-zinc-100 pt-3 text-xs text-zinc-600 sm:flex-row sm:items-center sm:justify-between">
        <div>{footerMsg}</div>

        <div className="flex items-center gap-3">
          {saving && <span className="text-[11px] text-zinc-500">Gemmer resultat …</span>}
          {saveError && !saving && <span className="text-[11px] text-red-600">{saveError}</span>}
          {loadError && !loadingNext && (
            <span className="text-[11px] text-zinc-500">
              {loadError}
              {requestIdShown ? <span className="ml-2 text-zinc-400">RequestId: {requestIdShown}</span> : null}
            </span>
          )}

          <div className="flex gap-2">
            <button
              type="button"
              onClick={handleCheck}
              disabled={!selectedId || checked}
              className="rounded-full border border-zinc-900 px-4 py-1.5 text-xs font-medium disabled:opacity-40"
            >
              Tjek svar
            </button>
            <button
              type="button"
              onClick={handleNext}
              disabled={!checked || loadingNext}
              className="rounded-full bg-zinc-900 px-4 py-1.5 text-xs font-medium text-white disabled:opacity-40"
            >
              {loadingNext ? "Henter…" : questionNumber >= sessionTotal ? "Afslut" : "Næste spørgsmål"}
            </button>
          </div>
        </div>
      </div>

      {checked && currentQuestion.explanation && (
        <div className="rounded-xl bg-zinc-50 p-3 text-xs text-zinc-700">{currentQuestion.explanation}</div>
      )}

      {checked && shownSources.length > 0 && (
        <div className="rounded-xl border border-zinc-200 bg-white p-3">
          <div className="text-[11px] font-semibold tracking-wide text-zinc-500">KILDER</div>
          <div className="mt-2 space-y-1 text-xs">
            {shownSources.map((s) => {
              const href = s.url ? s.url : s.fileId ? `/traener/upload?fileId=${encodeURIComponent(s.fileId)}` : null;

              return href ? (
                <a
                  key={s.key}
                  href={href}
                  target={s.url ? "_blank" : undefined}
                  rel={s.url ? "noreferrer" : undefined}
                  className="block text-zinc-900 underline decoration-zinc-300 underline-offset-2 hover:decoration-zinc-600"
                >
                  {s.title}
                </a>
              ) : (
                <div key={s.key} className="text-zinc-900">{s.title}</div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
