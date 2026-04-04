"use client";

import LimitNotice from "@/app/traener/_ui/LimitNotice";
import { fetchQuotaCurrent } from "@/lib/quota/current-client";
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
  source: "api";
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

type Props = {
  scopeFolderIds?: string[];
};

const DEFAULT_SESSION_SIZE = 10;
const QUOTA_MSG = "Du har nået din grænse for Multiple Choice denne måned.";

type FetchSingleResult =
  | { status: "OK"; question: MCQuestion }
  | { status: "STOP"; question: null };

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

function normalizeQuestionKey(value: string) {
  return String(value ?? "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .replace(/[.,;:!?()"'’”“\[\]{}]/g, "")
    .trim();
}

function logMcClientDebug(event: string, details: Record<string, unknown>) {
  if (process.env.NODE_ENV !== "production") {
    console.debug(`[mc-ui] ${event}`, details);
  }
}

function getQuotaLogDetails(json: any) {
  const { used, limit } = pickQuota(json);
  return {
    usedThisMonth: used,
    monthlyLimit: limit,
    remainingThisMonth: typeof limit === "number" ? Math.max(0, limit - used) : null,
  };
}

export default function ClientMC({ scopeFolderIds }: Props) {
  const effectiveScopeFolderIds = useMemo(
    () =>
      Array.from(
        new Set((scopeFolderIds ?? []).map((id) => String(id ?? "").trim()).filter(Boolean)),
      ),
    [scopeFolderIds],
  );
  const scopeKey = useMemo(() => JSON.stringify(effectiveScopeFolderIds), [effectiveScopeFolderIds]);
  const prefetchRequestSeqRef = useRef(0);
  const roundTokenRef = useRef(0);
  const activeRequestKindRef = useRef<"batch" | "single" | null>(null);
  const batchInFlightRef = useRef(false);
  const pendingQueueAdvanceRef = useRef(false);

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

  const [batchInFlight, setBatchInFlight] = useState(false);
  const [loadingNext, setLoadingNext] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [quotaBlocked, setQuotaBlocked] = useState<string | null>(null);

  // batch queue
  const [queue, setQueue] = useState<MCQuestion[]>([]);
  const foregroundAbortRef = useRef<AbortController | null>(null);
  const prefetchAbortRef = useRef<AbortController | null>(null);

  // anti-repeat i en runde
  const recentQuestionsRef = useRef<string[]>([]);
  const recentChunkIdsRef = useRef<string[]>([]);

  // afgør om batch endpoint findes
  const batchSupportedRef = useRef<boolean | null>(null);
  const hasScope = effectiveScopeFolderIds.length > 0;

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

  const computeSessionSize = useCallback(async (reason = "unspecified") => {
    try {
      const json = await fetchQuotaCurrent({ force: true });
      if (!json?.ok) return DEFAULT_SESSION_SIZE;

      const { used, limit } = pickQuota(json);
      logMcClientDebug("quota:current", {
        reason,
        scopeKey,
        ...getQuotaLogDetails(json),
      });
      if (typeof limit === "number" && limit > 0) {
        const remaining = Math.max(0, limit - used);
        return remaining >= DEFAULT_SESSION_SIZE ? DEFAULT_SESSION_SIZE : 0;
      }
      return DEFAULT_SESSION_SIZE;
    } catch {
      return DEFAULT_SESSION_SIZE;
    }
  }, [scopeKey]);

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

  const resetRoundToIdle = useCallback((message?: string) => {
    setStarted(false);
    setCurrentQuestion(null);
    setSelectedId(null);
    setChecked(false);
    setIsFinished(false);
    setQueue([]);
    setQuestionNumber(1);
    if (message) setLoadError(message);
  }, []);

  const appendQuestionsToQueue = useCallback((incoming: MCQuestion[]) => {
    if (incoming.length === 0) return;

    setQueue((prev) => {
      const seen = new Set<string>([
        ...recentQuestionsRef.current.map(normalizeQuestionKey),
        ...prev.map((item) => normalizeQuestionKey(item.question)),
      ]);

      const next = [...prev];
      for (const item of incoming) {
        const key = normalizeQuestionKey(item.question);
        if (!key || seen.has(key)) continue;
        seen.add(key);
        next.push(item);
      }
      logMcClientDebug("queue:append", {
        roundToken: roundTokenRef.current,
        scopeKey,
        addedCount: next.length - prev.length,
        queueLengthBefore: prev.length,
        queueLengthAfter: next.length,
      });
      return next;
    });
  }, [scopeKey]);

  const advanceToQueuedQuestion = useCallback(
    (nextQ: MCQuestion, mode: "queue-next" | "queue-wait-resume") => {
      setQueue((prev) => prev.slice(1));
      setCurrentQuestion(nextQ);
      logMcClientDebug("currentQuestion:set", {
        mode,
        roundToken: roundTokenRef.current,
        scopeKey,
        questionId: nextQ.id,
        usedFileId: nextQ.usedFileId ?? null,
      });
      setQuestionNumber((prev) => prev + 1);
      setSelectedId(null);
      setChecked(false);
      setSaveError(null);
      setLoadError(null);
      setLoadingNext(false);
      registerAntiRepeat(nextQ);
    },
    [registerAntiRepeat, scopeKey],
  );

  useEffect(() => {
    if (!pendingQueueAdvanceRef.current) return;
    if (queue.length > 0) {
      const nextQ = queue[0];
      if (!nextQ) return;
      pendingQueueAdvanceRef.current = false;
      advanceToQueuedQuestion(nextQ, "queue-wait-resume");
      return;
    }
    if (batchInFlight) return;
    pendingQueueAdvanceRef.current = false;
    setLoadingNext(false);
    logMcClientDebug("handleNext:wait-ended-no-queue", {
      roundToken: roundTokenRef.current,
      scopeKey,
      questionNumber,
      sessionTotal,
    });
  }, [advanceToQueuedQuestion, batchInFlight, questionNumber, queue, scopeKey, sessionTotal]);

  const fetchBatch = useCallback(
    async (
      count: number,
      opts?: { roundToken?: number; avoidQuestions?: string[]; avoidChunkIds?: string[] },
    ): Promise<BatchResult> => {
      if (effectiveScopeFolderIds.length === 0) {
        if (process.env.NODE_ENV !== "production") {
          console.debug("[mc-ui] fetchBatch:rejected-empty-scope", { count });
        }
        return "STOP";
      }

      const batchRequestSeq = ++prefetchRequestSeqRef.current;
      const roundToken = opts?.roundToken ?? roundTokenRef.current;
      const isStale = () => batchRequestSeq !== prefetchRequestSeqRef.current || roundToken !== roundTokenRef.current;
      batchInFlightRef.current = true;
      setBatchInFlight(true);
      logMcClientDebug("fetchBatch:start", {
        batchRequestSeq,
        count,
        roundToken,
        scopeKey,
        scopeFolderIds: effectiveScopeFolderIds,
        queueLength: queue.length,
        questionNumber,
        sessionTotal,
      });

      if (prefetchAbortRef.current) {
        prefetchAbortRef.current.abort();
        if (process.env.NODE_ENV !== "production") {
          console.debug("[mc-ui] previous-request-aborted-by-new-request", {
            newKind: "batch",
            scopeFolderIds: effectiveScopeFolderIds,
          });
        }
      }
      const ac = new AbortController();
      prefetchAbortRef.current = ac;

      try {
        const avoidQuestions = Array.from(
          new Set([...(recentQuestionsRef.current.slice(-12) ?? []), ...((opts?.avoidQuestions ?? []).slice(-12) ?? [])]),
        ).slice(-12);
        const avoidChunkIds = Array.from(
          new Set([...(recentChunkIdsRef.current.slice(-80) ?? []), ...((opts?.avoidChunkIds ?? []).slice(-80) ?? [])]),
        ).slice(-80);

        const payload = {
          scopeFolderIds: effectiveScopeFolderIds,
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
        if (process.env.NODE_ENV !== "production") {
          console.debug("[mc-ui] fetchBatch:resolved", {
            batchRequestSeq,
            status: res.status,
            ok: res.ok,
            aborted: ac.signal.aborted,
          });
        }

        if (res.status === 404) {
          batchSupportedRef.current = false;
          return "NOT_FOUND";
        }
        batchSupportedRef.current = true;

        if (res.status === 429) {
          return "STOP";
        }

        if (res.status === 401) {
          return "STOP";
        }

        if (!res.ok) {
          const j = await readJsonSafe<any>(res);
          if (process.env.NODE_ENV !== "production") {
            console.debug("[mc-ui] fetchBatch:error-response", {
              batchRequestSeq,
              status: res.status,
              error: String(j?.error ?? `Kunne ikke generere MC-batch (${res.status}).`),
            });
          }
          return "NEEDS_SINGLE";
        }

        const data = (await readJsonSafe<GenerateMcBatchResponse>(res)) as GenerateMcBatchResponse | null;
        if (process.env.NODE_ENV !== "production") {
          console.debug("[mc-ui] fetchBatch:parsed", {
            batchRequestSeq,
            jsonOk: !!data && (data as any)?.ok === true,
            requestId: (data as any)?.requestId ?? null,
            returnedCount: (data as any)?.returnedCount ?? null,
            itemsLength: Array.isArray((data as any)?.items) ? (data as any).items.length : null,
          });
        }
        if (!data || (data as any).ok === false) {
          return "NEEDS_SINGLE";
        }

        const ok = data as GenerateMcBatchResponseOk;
        const items = Array.isArray(ok.items) ? ok.items : [];

        const apiQuestionsAll: MCQuestion[] = items
          .filter((it) => it && (it as any).ok === true)
          .map((it) => toApiQuestion(it as GenerateMcItemOk))
          .filter((q) => (q.question ?? "").trim().length > 0 && Array.isArray(q.options) && q.options.length === 4);

        if (apiQuestionsAll.length === 0) {
          if (process.env.NODE_ENV !== "production") {
            console.debug("[mc-ui] fetchBatch:no-valid-questions", {
              batchRequestSeq,
              rawItemsLength: items.length,
            });
          }
          return "NEEDS_SINGLE";
        }

        const effective =
          typeof ok.effectiveCount === "number" && Number.isFinite(ok.effectiveCount)
            ? Math.max(1, ok.effectiveCount)
            : typeof ok.returnedCount === "number" && Number.isFinite(ok.returnedCount)
              ? Math.max(1, ok.returnedCount)
              : apiQuestionsAll.length;

        const apiQuestions = apiQuestionsAll.slice(0, Math.min(effective, apiQuestionsAll.length));
        if (isStale()) {
          logMcClientDebug("fetchBatch:stale-ignored", {
            batchRequestSeq,
            roundToken,
            scopeKey,
            questionCount: apiQuestions.length,
          });
          return "STOP";
        }

        if (process.env.NODE_ENV !== "production") {
          console.debug("[mc-ui] fetchBatch:set-state", {
            batchRequestSeq,
            requestId: ok.requestId ?? null,
            requestedCount: ok.requestedCount,
            effectiveCount: ok.effectiveCount ?? null,
            returnedCount: ok.returnedCount,
            questionCount: apiQuestions.length,
            firstQuestionId: apiQuestions[0]?.id ?? null,
          });
        }

        appendQuestionsToQueue(apiQuestions);
        dispatchQuotaChanged();
        return "OK";
      } catch (err: any) {
        if (process.env.NODE_ENV !== "production") {
          console.debug("[mc-ui] fetchBatch:catch", {
            batchRequestSeq,
            name: err?.name ?? null,
            message: err?.message ?? String(err),
            stale: isStale(),
          });
        }
        if (err?.name === "AbortError") return "STOP";
        if (isStale()) return "STOP";
        console.error("generate-mc-batch error:", err);
        return "NEEDS_SINGLE";
      } finally {
        batchInFlightRef.current = false;
        setBatchInFlight(false);
        if (prefetchAbortRef.current === ac) prefetchAbortRef.current = null;
      }
    },
    [appendQuestionsToQueue, dispatchQuotaChanged, effectiveScopeFolderIds, questionNumber, queue.length, readJsonSafe, sessionTotal],
  );

  const fetchSingle = useCallback(
    async (mode: "initial" | "next", opts?: { roundToken?: number }): Promise<FetchSingleResult> => {
      if (effectiveScopeFolderIds.length === 0) {
        if (process.env.NODE_ENV !== "production") {
          console.debug("[mc-ui] fetchSingle:rejected-empty-scope", { mode });
        }
        resetRoundToIdle("Vælg eller skift mappe her, før du starter Multiple Choice.");
        setLoadingNext(false);
        return { status: "STOP", question: null };
      }

      const roundToken = opts?.roundToken ?? roundTokenRef.current;
      const isStale = () => roundToken !== roundTokenRef.current;

      setLoadingNext(true);
      activeRequestKindRef.current = "single";
      setLoadError(null);
      setQuotaBlocked(null);
      logMcClientDebug("fetchSingle:start", {
        mode,
        roundToken,
        scopeKey,
        scopeFolderIds: effectiveScopeFolderIds,
        queueLength: queue.length,
        batchInFlight: batchInFlightRef.current,
        questionNumber,
        sessionTotal,
      });

      if (foregroundAbortRef.current) {
        foregroundAbortRef.current.abort();
        if (process.env.NODE_ENV !== "production") {
          console.debug("[mc-ui] previous-request-aborted-by-new-request", {
            newKind: "single",
            scopeFolderIds: effectiveScopeFolderIds,
          });
        }
      }
      const ac = new AbortController();
      foregroundAbortRef.current = ac;

      try {
        const avoidQuestions = recentQuestionsRef.current.slice(-12);
        const avoidChunkIds = recentChunkIdsRef.current.slice(-80);

        const payload = {
          scopeFolderIds: effectiveScopeFolderIds,
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
          if (isStale()) return { status: "STOP", question: null };
          applyQuotaBlocked(String(j?.error ?? ""));
          return { status: "STOP", question: null };
        }

        if (res.status === 401) {
          const j = await readJsonSafe<any>(res);
          if (isStale()) return { status: "STOP", question: null };
          setLoadError(String(j?.error ?? "Unauthorized. Log ind igen."));
          return { status: "STOP", question: null };
        }

        if (!res.ok) {
          const j = await readJsonSafe<any>(res);
          const msg =
            String(j?.error ?? j?.message ?? "").trim() || `Kunne ikke generere spørgsmål fra dit materiale (${res.status}).`;
          if (isStale()) return { status: "STOP", question: null };
          resetRoundToIdle(msg);
          return { status: "STOP", question: null };
        }

        const data = (await readJsonSafe<GenerateMcSingleResponse>(res)) as GenerateMcSingleResponse | null;
        if (!data || (data as any).ok === false) {
          const msg = String((data as any)?.error ?? "Kunne ikke generere MC-spørgsmål.");
          if (isStale()) return { status: "STOP", question: null };
          resetRoundToIdle(msg);
          return { status: "STOP", question: null };
        }

        const ok = data as GenerateMcSingleResponseOk;
        const apiQuestion = toApiQuestion(ok);
        if (isStale()) {
          logMcClientDebug("fetchSingle:stale-ignored", {
            mode,
            roundToken,
            scopeKey,
            reason: "success-after-round-change",
          });
          return { status: "STOP", question: null };
        }

        setCurrentQuestion(apiQuestion);
        logMcClientDebug("currentQuestion:set", {
          mode,
          roundToken,
          scopeKey,
          requestId: apiQuestion.meta?.requestId ?? null,
          questionId: apiQuestion.id,
          usedFileId: apiQuestion.usedFileId ?? null,
          queueLength: queue.length,
          batchInFlight: batchInFlightRef.current,
        });
        dispatchQuotaChanged();
        registerAntiRepeat(apiQuestion);

        if (mode === "next") setQuestionNumber((prev) => prev + 1);
        else setQuestionNumber(1);

        return { status: "OK", question: apiQuestion };
      } catch (err: any) {
        if (err?.name === "AbortError") {
          if (process.env.NODE_ENV !== "production") {
            console.debug("[mc-ui] fetchSingle:aborted", { scopeFolderIds: effectiveScopeFolderIds });
          }
          return { status: "STOP", question: null };
        }
        if (isStale()) {
          logMcClientDebug("fetchSingle:stale-ignored", {
            mode,
            roundToken,
            scopeKey,
            reason: "error-after-round-change",
          });
          return { status: "STOP", question: null };
        }
        console.error("generate-mc-question error:", err);
        resetRoundToIdle("Kunne ikke hente nyt spørgsmål fra dit valgte materiale.");
        return { status: "STOP", question: null };
      } finally {
        if (!isStale()) {
          activeRequestKindRef.current = null;
          setLoadingNext(false);
          setSelectedId(null);
          setChecked(false);
          setSaveError(null);
        }
        if (foregroundAbortRef.current === ac) foregroundAbortRef.current = null;
      }
    },
    [applyQuotaBlocked, dispatchQuotaChanged, effectiveScopeFolderIds, questionNumber, queue.length, readJsonSafe, registerAntiRepeat, resetRoundToIdle, scopeKey, sessionTotal],
  );

  const startNewRound = useCallback(async () => {
    if (effectiveScopeFolderIds.length === 0) {
      setStarted(false);
      setCurrentQuestion(null);
      setQueue([]);
      setIsFinished(false);
      setLoadingNext(false);
      setLoadError("Vælg eller skift mappe her, før du starter Multiple Choice.");
      return;
    }

    if (foregroundAbortRef.current) {
      foregroundAbortRef.current.abort();
      foregroundAbortRef.current = null;
    }
    if (prefetchAbortRef.current) {
      prefetchAbortRef.current.abort();
      prefetchAbortRef.current = null;
    }
    prefetchRequestSeqRef.current += 1;
    activeRequestKindRef.current = null;
    batchInFlightRef.current = false;
    pendingQueueAdvanceRef.current = false;
    setBatchInFlight(false);
    const roundToken = ++roundTokenRef.current;
    logMcClientDebug("round:start", {
      roundToken,
      scopeKey,
      scopeFolderIds: effectiveScopeFolderIds,
    });

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

    const sz = await computeSessionSize("startNewRound");
    if (roundToken !== roundTokenRef.current) return;

    if (sz <= 0) {
      setSessionTotal(0);
      applyQuotaBlocked(QUOTA_MSG);
      return;
    }

    setSessionTotal(sz);
    setQuestionNumber(1);

    const batchSupported = batchSupportedRef.current;

    if (batchSupported === false) {
      await fetchSingle("initial", { roundToken });
      return;
    }

    const firstResult = await fetchSingle("initial", { roundToken });
    if (firstResult.status !== "OK" || !firstResult.question) {
      return;
    }

    if (sz <= 1) return;

    void fetchBatch(sz - 1, {
      roundToken,
      avoidQuestions: [firstResult.question.question],
      avoidChunkIds: Array.isArray(firstResult.question.meta?.usedChunkIds)
        ? firstResult.question.meta.usedChunkIds.map((id) => String(id))
        : [],
    });
  }, [applyQuotaBlocked, computeSessionSize, effectiveScopeFolderIds, fetchBatch, fetchSingle]);

  // scope-skift: stop alt og tilbage til “Start”
  useEffect(() => {
    const scopeChangeRoundToken = roundTokenRef.current + 1;

    if (foregroundAbortRef.current) {
      foregroundAbortRef.current.abort();
      foregroundAbortRef.current = null;
      if (process.env.NODE_ENV !== "production") {
        console.debug("[mc-ui] request-aborted-on-scope-change", {
          activeRequestKind: activeRequestKindRef.current,
          scopeKey,
        });
      }
    }
    if (prefetchAbortRef.current) {
      prefetchAbortRef.current.abort();
      prefetchAbortRef.current = null;
      if (process.env.NODE_ENV !== "production") {
        console.debug("[mc-ui] request-aborted-on-scope-change", {
          activeRequestKind: activeRequestKindRef.current,
          scopeKey,
        });
      }
    }
    prefetchRequestSeqRef.current += 1;
    roundTokenRef.current = scopeChangeRoundToken;
    activeRequestKindRef.current = null;
    batchInFlightRef.current = false;
    pendingQueueAdvanceRef.current = false;
    setBatchInFlight(false);

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
    recentQuestionsRef.current = [];
    recentChunkIdsRef.current = [];

    void (async () => {
      if (!hasScope) {
        setSessionTotal(DEFAULT_SESSION_SIZE);
        setQuotaBlocked(null);
        return;
      }
      const sz = await computeSessionSize("scopeChange");
      if (scopeChangeRoundToken !== roundTokenRef.current) return;
      setSessionTotal(sz);
      if (sz <= 0) setQuotaBlocked(QUOTA_MSG);
      else setQuotaBlocked(null);
    })();
  }, [computeSessionSize, hasScope, scopeKey]);

  useEffect(() => {
    return () => {
      if (foregroundAbortRef.current) {
        foregroundAbortRef.current.abort();
        foregroundAbortRef.current = null;
        if (process.env.NODE_ENV !== "production") {
          console.debug("[mc-ui] request-aborted-on-unmount", {
            activeRequestKind: activeRequestKindRef.current,
          });
        }
      }
      if (prefetchAbortRef.current) {
        prefetchAbortRef.current.abort();
        prefetchAbortRef.current = null;
      }
      prefetchRequestSeqRef.current += 1;
      roundTokenRef.current += 1;
      activeRequestKindRef.current = null;
      batchInFlightRef.current = false;
      pendingQueueAdvanceRef.current = false;
    };
  }, []);

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
      const sz = await computeSessionSize("finishCheck");
      if (sz <= 0) setQuotaBlocked(QUOTA_MSG);
      setIsFinished(true);
      setCurrentQuestion(null);
      return;
    }

    // batch-queue
    if (queue.length > 0) {
      const nextQ = queue[0];

      if (nextQ) {
        advanceToQueuedQuestion(nextQ, "queue-next");
        return;
      }
    }

    if (batchInFlightRef.current) {
      pendingQueueAdvanceRef.current = true;
      setLoadingNext(true);
      setLoadError(null);
      logMcClientDebug("handleNext:waiting-for-batch", {
        roundToken: roundTokenRef.current,
        scopeKey,
        queueLength: queue.length,
        batchInFlight: true,
        questionNumber,
        sessionTotal,
      });
      return;
    }

    logMcClientDebug("handleNext:queue-empty-fallback-single", {
      roundToken: roundTokenRef.current,
      scopeKey,
      queueLength: queue.length,
      batchInFlight: batchInFlightRef.current,
      questionNumber,
      sessionTotal,
    });
    await fetchSingle("next", { roundToken: roundTokenRef.current });
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
    return (
      <div className="space-y-4">
        <div className="rounded-2xl border border-zinc-200 bg-white p-4">
          <div className="text-sm font-semibold text-zinc-900">Multiple Choice</div>
          <div className="mt-1 text-xs text-zinc-600">Vælg en mappe for at starte en runde.</div>

          {quotaBlocked ? <LimitNotice className="mt-3">{quotaBlocked}</LimitNotice> : null}
          {!quotaBlocked && loadError ? <div className="mt-3 text-xs text-red-600">{loadError}</div> : null}

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
