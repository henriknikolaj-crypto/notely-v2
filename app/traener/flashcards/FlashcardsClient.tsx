// app/traener/flashcards/FlashcardsClient.tsx
"use client";

import * as React from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { fetchQuotaCurrent } from "@/lib/quota/current-client";
import { FlipCard } from "./FlipCard";
import LimitNotice from "../_ui/LimitNotice";

type Citation = {
  file_id?: string | null;
  title?: string | null;
  url?: string | null;

  // legacy
  fileId?: string | null;
  detail?: string | null;
};

type Flashcard = {
  id: string;
  question?: string;
  answer?: string;
  front: string;
  back: string;
  citation?: Citation | null;
};

type Quota =
  | {
      feature?: string;
      plan?: string;
      usedThisMonth?: number;
      monthlyLimit?: number;
      remaining?: number;
      remainingThisMonth?: number; // bagudkompat
    }
  | null;

type Props = {
  scopeFolderIds?: string[];
};

type AvoidCardInput = {
  front: string;
  back: string;
};

const QUOTA_MSG = "Du har nået din grænse for Flashcards denne måned.";
const DEFAULT_SESSION_SIZE = 10;

async function readJsonSafe(res: Response) {
  const text = await res.text();
  try {
    return text.trim() ? JSON.parse(text) : {};
  } catch {
    const snippet = text.replace(/\s+/g, " ").slice(0, 160);
    throw new Error(`HTTP ${res.status}: ${snippet}`);
  }
}

function toText(v: any): string {
  if (v == null) return "";
  if (typeof v === "string") return v;
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  if (Array.isArray(v)) return v.map(toText).join("\n").trim();
  if (typeof v === "object") {
    if (typeof v.text === "string") return v.text;
    if (typeof v.content === "string") return v.content;
    if (typeof v.value === "string") return v.value;
  }
  return "";
}

function pickText(...vals: any[]): string {
  for (const v of vals) {
    const s = toText(v).trim();
    if (s) return s;
  }
  return "";
}

function normalizeCard(raw: any): Flashcard | null {
  const id = pickText(raw?.id, raw?.card_id, raw?.flashcard_id);
  if (!id) return null;

  // API'et (som i dit screenshot) sender typisk front/back.
  // Vi normaliserer derfor ALWAYS til front/back, og gemmer question/answer hvis de findes.
  const q = pickText(
    raw?.question,
    raw?.q,
    raw?.prompt,
    raw?.term,
    raw?.questionText,
    raw?.question_text,
    raw?.frontText,
    raw?.front_text,
    raw?.sporgsmaal,
    raw?.["spørgsmål"],
    raw?.data?.question,
    raw?.card?.question,
    raw?.front?.text,
    raw?.front?.content,
    raw?.front,
  );

  const a = pickText(
    raw?.answer,
    raw?.a,
    raw?.completion,
    raw?.definition,
    raw?.answerText,
    raw?.answer_text,
    raw?.backText,
    raw?.back_text,
    raw?.svar,
    raw?.data?.answer,
    raw?.card?.answer,
    raw?.back?.text,
    raw?.back?.content,
    raw?.back,
  );

  const front = pickText(raw?.front, q);
  const back = pickText(raw?.back, a);

  // Vi kræver front/back – ellers ender UI med blanke kort.
  if (!front || !back) return null;

  const citRaw =
    raw?.citation ??
    (Array.isArray(raw?.citations) && raw.citations.length ? raw.citations[0] : null) ??
    null;

  const cit: Citation | null =
    citRaw && typeof citRaw === "object"
      ? {
          file_id: citRaw.file_id ?? citRaw.fileId ?? raw?.citation_file_id ?? null,
          title: citRaw.title ?? raw?.citation_title ?? null,
          url: citRaw.url ?? raw?.citation_url ?? null,
          detail: citRaw.detail ?? raw?.citation_detail ?? null,
        }
      : {
          file_id: raw?.citation_file_id ?? null,
          title: raw?.citation_title ?? null,
          url: raw?.citation_url ?? null,
          detail: raw?.citation_detail ?? null,
        };

  return {
    id,
    question: q || undefined,
    answer: a || undefined,
    front,
    back,
    citation: cit ?? null,
  };
}

function getScopeFromUrl(sp: ReturnType<typeof useSearchParams> | null): string[] {
  const s = sp?.get("scope");
  if (!s || !s.trim()) return [];
  return s
    .split(",")
    .map((x) => x.trim())
    .filter(Boolean);
}

function buildScopeFolderIds(propsScope: string[] | undefined, urlScopeIds: string[]) {
  const out: string[] = [];
  const seen = new Set<string>();

  for (const x of propsScope ?? []) {
    const s = String(x || "").trim();
    if (s && !seen.has(s)) {
      seen.add(s);
      out.push(s);
    }
  }

  if (out.length === 0 && urlScopeIds.length > 0) {
    for (const s of urlScopeIds) {
      const t = String(s || "").trim();
      if (t && !seen.has(t)) {
        seen.add(t);
        out.push(t);
      }
    }
  }

  return out;
}

function pickFlashcardsQuota(json: any): { used: number; limit: number | null } {
  const used =
    (typeof json?.flashcards_generate?.usedThisMonth === "number" ? json.flashcards_generate.usedThisMonth : null) ??
    (typeof json?.flashcardsUsedThisMonth === "number" ? json.flashcardsUsedThisMonth : 0);

  const limit =
    (typeof json?.flashcards_generate?.limitPerMonth === "number" ? json.flashcards_generate.limitPerMonth : null) ??
    (typeof json?.flashcardsLimitPerMonth === "number" ? json.flashcardsLimitPerMonth : null);

  return { used: Number.isFinite(used) ? used : 0, limit: typeof limit === "number" ? limit : null };
}

function pickQuotaPayload(data: any): Quota {
  const quota = data?.quota ?? data?.limits ?? null;
  return quota && typeof quota === "object" ? (quota as Quota) : null;
}

function normalizeFlashcardTextForDedupe(value: string) {
  return String(value ?? "")
    .toLowerCase()
    .trim()
    .replace(/\s+/g, " ")
    .replace(/[.,;:!?()"'’”“\[\]{}\-_/\\]/g, "")
    .trim();
}

const FLASHCARD_GENERIC_QUESTION_PREFIXES = [
  "hvad er",
  "hvilke",
  "hvilken",
  "hvilket",
  "ifølge teksten",
  "ifølge materialet",
  "ifølge kilden",
];

const FLASHCARD_GENERIC_QUESTION_TOKENS = new Set([
  "hvad",
  "hvilke",
  "hvilken",
  "hvilket",
  "ifolge",
  "teksten",
  "materialet",
  "kilden",
]);

type FlashcardDedupeFingerprint = {
  questionKey: string;
  answerKey: string;
  questionTokens: string[];
  answerTokens: string[];
  questionSortedKey: string;
  answerSortedKey: string;
  combinedKey: string;
};

function stripGenericQuestionPrefixes(value: string) {
  let normalized = normalizeFlashcardTextForDedupe(value);
  let changed = true;
  while (changed) {
    changed = false;
    for (const prefix of FLASHCARD_GENERIC_QUESTION_PREFIXES) {
      if (normalized.startsWith(`${prefix} `)) {
        normalized = normalized.slice(prefix.length).trim();
        changed = true;
      }
    }
  }
  return normalized;
}

function normalizeFlashcardToken(token: string) {
  let normalized = normalizeFlashcardTextForDedupe(token);
  if (normalized.length > 6 && normalized.endsWith("er")) normalized = normalized.slice(0, -2);
  else if (normalized.length > 6 && (normalized.endsWith("en") || normalized.endsWith("et"))) normalized = normalized.slice(0, -2);
  else if (normalized.length > 4 && normalized.endsWith("s") && !normalized.endsWith("ss")) normalized = normalized.slice(0, -1);
  return normalized;
}

function tokenizeFlashcardText(value: string, opts?: { stripQuestionPrefixes?: boolean }) {
  const normalized = opts?.stripQuestionPrefixes ? stripGenericQuestionPrefixes(value) : normalizeFlashcardTextForDedupe(value);
  return normalized
    .split(" ")
    .map(normalizeFlashcardToken)
    .filter((token) => token.length >= 3)
    .filter((token) => !FLASHCARD_GENERIC_QUESTION_TOKENS.has(token));
}

function calculateTokenOverlap(tokensA: string[], tokensB: string[]) {
  const setA = new Set(tokensA);
  const setB = new Set(tokensB);
  if (setA.size === 0 || setB.size === 0) return 0;

  let overlap = 0;
  for (const token of setA) {
    if (setB.has(token)) overlap += 1;
  }
  return overlap / Math.min(setA.size, setB.size);
}

function buildFlashcardDedupeFingerprint(card: Flashcard): FlashcardDedupeFingerprint {
  const questionSource = card.question?.trim() || card.front || "";
  const answerSource = card.answer?.trim() || card.back || "";
  const questionKey = stripGenericQuestionPrefixes(questionSource);
  const answerKey = normalizeFlashcardTextForDedupe(answerSource);
  const questionTokens = tokenizeFlashcardText(questionSource, { stripQuestionPrefixes: true });
  const answerTokens = tokenizeFlashcardText(answerSource);
  const questionSortedKey = Array.from(new Set(questionTokens)).sort().join(" ");
  const answerSortedKey = Array.from(new Set(answerTokens)).sort().join(" ");
  return {
    questionKey,
    answerKey,
    questionTokens,
    answerTokens,
    questionSortedKey,
    answerSortedKey,
    combinedKey: `${questionKey}|${answerKey}`,
  };
}

function detectNearDuplicateFlashcard(
  candidate: FlashcardDedupeFingerprint,
  existing: FlashcardDedupeFingerprint,
): { reason: string; questionOverlap: number; answerOverlap: number } | null {
  if (candidate.combinedKey && candidate.combinedKey === existing.combinedKey) {
    return { reason: "normalized collision", questionOverlap: 1, answerOverlap: 1 };
  }

  const questionOverlap = calculateTokenOverlap(candidate.questionTokens, existing.questionTokens);
  const answerOverlap = calculateTokenOverlap(candidate.answerTokens, existing.answerTokens);
  const answerExact = Boolean(candidate.answerKey) && candidate.answerKey === existing.answerKey;
  const questionSortedExact =
    Boolean(candidate.questionSortedKey) && candidate.questionSortedKey === existing.questionSortedKey;
  const answerSortedExact = Boolean(candidate.answerSortedKey) && candidate.answerSortedKey === existing.answerSortedKey;
  const questionContains =
    Boolean(candidate.questionKey) &&
    Boolean(existing.questionKey) &&
    (candidate.questionKey.includes(existing.questionKey) || existing.questionKey.includes(candidate.questionKey));

  if (questionSortedExact && (answerExact || answerSortedExact || answerOverlap >= 0.55)) {
    return {
      reason: answerExact ? "same-question-tokens+same-answer" : "same-question-tokens+answer-similar",
      questionOverlap: Math.max(questionOverlap, 0.95),
      answerOverlap,
    };
  }
  if (questionOverlap >= 0.92) {
    return { reason: "question-overlap>=0.92", questionOverlap, answerOverlap };
  }
  if (questionOverlap >= 0.7 && (answerExact || answerSortedExact)) {
    return { reason: "same-answer+question-overlap>=0.70", questionOverlap, answerOverlap: Math.max(answerOverlap, 0.95) };
  }
  if (questionOverlap >= 0.78 && (answerExact || answerOverlap >= 0.72)) {
    return { reason: answerExact ? "high-question-overlap+same-answer" : "high-question+answer-overlap", questionOverlap, answerOverlap };
  }
  if (questionOverlap >= 0.85 && answerOverlap >= 0.45) {
    return { reason: "question-overlap>=0.85+answer-overlap", questionOverlap, answerOverlap };
  }
  if (questionContains && (answerExact || answerOverlap >= 0.65)) {
    return { reason: answerExact ? "question-contains+same-answer" : "question-contains+answer-overlap", questionOverlap, answerOverlap };
  }
  if (answerExact && questionOverlap >= 0.62) {
    return { reason: "same-answer+question-overlap", questionOverlap, answerOverlap };
  }
  return null;
}

function buildAvoidCardsPayload(
  shownCards: Flashcard[],
  queuedCards: Flashcard[],
  extraCards: Flashcard[] = [],
): AvoidCardInput[] {
  const out: AvoidCardInput[] = [];
  const seen = new Set<string>();
  for (const card of [...extraCards, ...shownCards, ...queuedCards]) {
    const front = String(card.question?.trim() || card.front || "").trim();
    const back = String(card.answer?.trim() || card.back || "").trim();
    if (!front || !back) continue;
    const key = `${stripGenericQuestionPrefixes(front)}|${normalizeFlashcardTextForDedupe(back)}`;
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push({ front, back });
    if (out.length >= 18) break;
  }
  return out;
}

function logFlashcardsDebug(event: string, details: Record<string, unknown>) {
  if (process.env.NODE_ENV !== "production") {
    console.debug(`[flashcards-ui] ${event}`, details);
  }
}

export default function FlashcardsClient({ scopeFolderIds }: Props) {
  const sp = useSearchParams();
  const urlScopeIds = React.useMemo(() => getScopeFromUrl(sp), [sp]);

  const effectiveScopeFolderIds = React.useMemo(
    () => buildScopeFolderIds(scopeFolderIds, urlScopeIds),
    [scopeFolderIds, urlScopeIds],
  );
  const scopeKey = React.useMemo(() => JSON.stringify(effectiveScopeFolderIds), [effectiveScopeFolderIds]);
  const roundTokenRef = React.useRef(0);
  const foregroundRequestSeqRef = React.useRef(0);
  const prefetchRequestSeqRef = React.useRef(0);
  const foregroundAbortRef = React.useRef<AbortController | null>(null);
  const prefetchAbortRef = React.useRef<AbortController | null>(null);

  const [cards, setCards] = React.useState<Flashcard[]>([]);
  const [i, setI] = React.useState(0);
  const [queue, setQueue] = React.useState<Flashcard[]>([]);
  const [flipped, setFlipped] = React.useState(false);
  const [sessionTotal, setSessionTotal] = React.useState(DEFAULT_SESSION_SIZE);

  const [loading, setLoading] = React.useState(false);
  const [isPrefetching, setIsPrefetching] = React.useState(false);
  const [prefetchDotCount, setPrefetchDotCount] = React.useState(1);
  const [notice, setNotice] = React.useState<string | null>(null);
  const [errorMsg, setErrorMsg] = React.useState<string | null>(null);
  const [limitReached, setLimitReached] = React.useState(false);

  const [quota, setQuota] = React.useState<Quota>(null);
  void quota;

  const hasCards = cards.length > 0;
  const card = hasCards ? cards[i] : null;
  const currentCardNumber = hasCards ? Math.min(i + 1, sessionTotal) : 0;
  const isSessionFinished = hasCards && currentCardNumber >= sessionTotal;
  const hasActiveSession = hasCards && !isSessionFinished;
  const loadedSessionCards = cards.length + queue.length;
  const canFinishSessionWithoutMoreFetch = loadedSessionCards >= sessionTotal;

  const canPrev = hasCards && i > 0;
  const canNext = hasCards && !isSessionFinished;

  const pageLabel = hasCards ? `Kort ${currentCardNumber} / ${sessionTotal}` : "Ingen kort endnu.";
  const generatingDots = loading ? "..." : ".".repeat(prefetchDotCount);
  const generatingStatusLabel =
    loading || (hasActiveSession && isPrefetching) ? (
      <span className="inline-flex min-w-[8.5rem] items-center justify-center gap-0.5">
        <span>Genererer</span>
        <span className="inline-block min-w-[3ch] text-left font-mono">{generatingDots}</span>
      </span>
    ) : null;

  const citation = card?.citation ?? null;
  const citationTitle = String(citation?.title ?? "").trim();
  const citationUrl = String(citation?.url ?? "").trim();
  const citationFileId = String(citation?.file_id ?? citation?.fileId ?? "").trim();
  const citationDetail = String(citation?.detail ?? "").trim();

  React.useEffect(() => {
    setFlipped(false);
  }, [card?.id]);

  React.useEffect(() => {
    setCards([]);
    setI(0);
    setQueue([]);
    setFlipped(false);
    setErrorMsg(null);
    setNotice(null);
    setLoading(false);
    setIsPrefetching(false);
    setPrefetchDotCount(1);
    setSessionTotal(DEFAULT_SESSION_SIZE);
    if (foregroundAbortRef.current) {
      foregroundAbortRef.current.abort();
      foregroundAbortRef.current = null;
    }
    if (prefetchAbortRef.current) {
      prefetchAbortRef.current.abort();
      prefetchAbortRef.current = null;
    }
    foregroundRequestSeqRef.current += 1;
    prefetchRequestSeqRef.current += 1;
    roundTokenRef.current += 1;
  }, [scopeKey]);

  const resetToStartState = React.useCallback(() => {
    if (foregroundAbortRef.current) {
      foregroundAbortRef.current.abort();
      foregroundAbortRef.current = null;
    }
    if (prefetchAbortRef.current) {
      prefetchAbortRef.current.abort();
      prefetchAbortRef.current = null;
    }
    foregroundRequestSeqRef.current += 1;
    prefetchRequestSeqRef.current += 1;
    roundTokenRef.current += 1;
    setCards([]);
    setI(0);
    setQueue([]);
    setFlipped(false);
    setLoading(false);
    setIsPrefetching(false);
    setPrefetchDotCount(1);
    setErrorMsg(null);
    setNotice(null);
    setSessionTotal(DEFAULT_SESSION_SIZE);
  }, []);

  React.useEffect(() => {
    if (!isPrefetching) {
      setPrefetchDotCount(1);
      return;
    }
    const timer = window.setInterval(() => {
      setPrefetchDotCount((prev) => (prev >= 3 ? 1 : prev + 1));
    }, 450);
    return () => window.clearInterval(timer);
  }, [isPrefetching]);

  const dispatchQuotaChanged = React.useCallback(() => {
    try {
      window.dispatchEvent(new Event("notely-quota-changed"));
      window.dispatchEvent(new Event("flashcards:changed"));
    } catch {
      // ignore
    }
  }, []);

  const syncQuotaFromPayload = React.useCallback(
    (data: any) => {
      const nextQuota = pickQuotaPayload(data);
      if (!nextQuota) return;
      setQuota(nextQuota);
      dispatchQuotaChanged();
    },
    [dispatchQuotaChanged],
  );

  const precheckQuotaForNewSet = React.useCallback(async () => {
    try {
      const json = await fetchQuotaCurrent({ force: true });
      if (!json?.ok) return false;

      const { used, limit } = pickFlashcardsQuota(json);
      if (typeof limit === "number" && limit > 0) {
        const remaining = Math.max(0, limit - used);
        if (remaining < DEFAULT_SESSION_SIZE) {
          setLimitReached(true);
          setNotice(QUOTA_MSG);
          setErrorMsg(null);
          return true;
        }
      }

      return false;
    } catch {
      return false;
    }
  }, []);

  const precheckQuota = React.useCallback(async (force = false) => {
    try {
      const json = await fetchQuotaCurrent({ force });
      if (!json?.ok) return false;

      const { used, limit } = pickFlashcardsQuota(json);
      if (typeof limit === "number" && limit > 0) {
        const remaining = Math.max(0, limit - used);
        if (remaining <= 0) {
          setLimitReached(true);
          setNotice(QUOTA_MSG);
          setErrorMsg(null);
          return true;
        }
      }
      setLimitReached(false);
      setNotice(null);
      return false;
    } catch {
      return false;
    }
  }, []);

  React.useEffect(() => {
    void precheckQuota();

    const onQuota = () => void precheckQuota(true);
    window.addEventListener("notely-quota-changed", onQuota);
    return () => window.removeEventListener("notely-quota-changed", onQuota);
  }, [precheckQuota]);

  React.useEffect(() => {
    void precheckQuota(true);
  }, [precheckQuota, scopeKey]);

  React.useEffect(() => {
    return () => {
      if (foregroundAbortRef.current) {
        foregroundAbortRef.current.abort();
        foregroundAbortRef.current = null;
      }
      if (prefetchAbortRef.current) {
        prefetchAbortRef.current.abort();
        prefetchAbortRef.current = null;
      }
      foregroundRequestSeqRef.current += 1;
      prefetchRequestSeqRef.current += 1;
      roundTokenRef.current += 1;
    };
  }, []);

  const normalizeResponseCards = React.useCallback((data: any) => {
    const rawCards: any[] = Array.isArray(data?.cards)
      ? data.cards
      : Array.isArray(data?.flashcards)
        ? data.flashcards
        : Array.isArray(data?.items)
          ? data.items
          : [];

    return rawCards.map(normalizeCard).filter(Boolean) as Flashcard[];
  }, []);

  const appendQueue = React.useCallback((incoming: Flashcard[]) => {
    if (incoming.length === 0) return;
    setQueue((prev) => {
      const remainingSlots = Math.max(0, sessionTotal - cards.length - prev.length);
      if (remainingSlots <= 0) return prev;
      const seenIds = new Set<string>([...cards.map((card) => card.id), ...prev.map((card) => card.id)]);
      const seenCards = [...cards, ...prev].map((card) => ({
        id: card.id,
        fingerprint: buildFlashcardDedupeFingerprint(card),
      }));
      const next = [...prev];
      for (const item of incoming) {
        if (next.length - prev.length >= remainingSlots) break;
        if (!item?.id || seenIds.has(item.id)) continue;

        const candidateFingerprint = buildFlashcardDedupeFingerprint(item);
        const nearDuplicate = seenCards
          .map((existing) => ({
            existingId: existing.id,
            match: detectNearDuplicateFlashcard(candidateFingerprint, existing.fingerprint),
          }))
          .find((entry) => entry.match);

        if (nearDuplicate?.match) {
          logFlashcardsDebug("queue:drop-near-duplicate", {
            roundToken: roundTokenRef.current,
            scopeKey,
            cardId: item.id,
            againstCardId: nearDuplicate.existingId,
            reason: nearDuplicate.match.reason,
            questionOverlap: Number(nearDuplicate.match.questionOverlap.toFixed(2)),
            answerOverlap: Number(nearDuplicate.match.answerOverlap.toFixed(2)),
          });
          continue;
        }

        seenIds.add(item.id);
        seenCards.push({
          id: item.id,
          fingerprint: candidateFingerprint,
        });
        next.push(item);
      }
      logFlashcardsDebug("queue:append", {
        roundToken: roundTokenRef.current,
        scopeKey,
        addedCount: next.length - prev.length,
        queueLengthBefore: prev.length,
        queueLengthAfter: next.length,
      });
      return next;
    });
  }, [cards, scopeKey, sessionTotal]);

  const setCurrentCard = React.useCallback(
    (nextCard: Flashcard, mode: "single-initial" | "single-next" | "queue-next") => {
      setCards((prev) => {
        if (mode === "single-initial") return [nextCard];
        if (mode === "queue-next") return [...prev, nextCard];
        return [...prev, nextCard];
      });
      setI((prev) => (mode === "single-initial" ? 0 : prev + 1));
      setFlipped(false);
      setErrorMsg(null);
      logFlashcardsDebug("currentCard:set", {
        roundToken: roundTokenRef.current,
        scopeKey,
        mode,
        cardId: nextCard.id,
        citationFileId: String(nextCard.citation?.file_id ?? nextCard.citation?.fileId ?? "").trim() || null,
      });
    },
    [scopeKey],
  );

  const fetchSingleCard = React.useCallback(
    async (mode: "initial" | "next", roundToken: number): Promise<Flashcard | null> => {
      const requestSeq = ++foregroundRequestSeqRef.current;
      const isStale = () => requestSeq !== foregroundRequestSeqRef.current || roundToken !== roundTokenRef.current;
      const shouldSurfaceBlockingError = mode === "initial" || !canFinishSessionWithoutMoreFetch;

      if (foregroundAbortRef.current) {
        foregroundAbortRef.current.abort();
      }
      const ac = new AbortController();
      foregroundAbortRef.current = ac;

      setLoading(true);

      try {
        const res = await fetch("/api/flashcards/generate", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            scopeFolderIds: effectiveScopeFolderIds,
            count: 1,
            difficulty: "medium",
            maxContextChunks: 14,
            avoidCards: buildAvoidCardsPayload(cards, queue),
          }),
          signal: ac.signal,
        });

        const data = await readJsonSafe(res);

        syncQuotaFromPayload(data);

        if (!res.ok) {
          const msg = String(data?.error ?? data?.message ?? "Uventet fejl fra serveren.");
          if (isStale()) {
            logFlashcardsDebug("stale single ignored", { roundToken, scopeKey, mode, reason: "error-response" });
            return null;
          }
          if (res.status === 402 || res.status === 429) {
            setLimitReached(true);
            setNotice(msg || QUOTA_MSG);
            setErrorMsg(null);
            void precheckQuota(true);
            return null;
          }
          if (shouldSurfaceBlockingError) {
            setErrorMsg(`Fejl (${res.status}): ${msg}`);
          } else {
            logFlashcardsDebug("single:error-suppressed", {
              roundToken,
              scopeKey,
              mode,
              reason: "nonblocking-error-response",
              status: res.status,
              message: msg,
            });
          }
          return null;
        }

        const nextCards = normalizeResponseCards(data);
        if (isStale()) {
          logFlashcardsDebug("stale single ignored", { roundToken, scopeKey, mode, reason: "success-after-round-change" });
          return null;
        }

        if (res.ok && data?.ok && nextCards.length > 0) {
          setLimitReached(false);
          if (data?.warning) setNotice(String(data.warning));
          setErrorMsg(null);
          return nextCards[0] ?? null;
        }

        if (nextCards.length === 0) {
          const msg = String(data?.warning ?? data?.error ?? "Kunne ikke generere kort fra API-svaret.");
          if (shouldSurfaceBlockingError) {
            setErrorMsg(msg);
          } else {
            logFlashcardsDebug("single:error-suppressed", {
              roundToken,
              scopeKey,
              mode,
              reason: "nonblocking-empty-output",
              message: msg,
            });
          }
        }
        return null;
      } catch (err: any) {
        if (err?.name === "AbortError") return null;
        if (isStale()) {
          logFlashcardsDebug("stale single ignored", { roundToken, scopeKey, mode, reason: "catch-after-round-change" });
          return null;
        }
        console.error("flashcards single generate error:", err);
        if (shouldSurfaceBlockingError) {
          setErrorMsg("Fejl (netværk): Kunne ikke generere kort.");
        } else {
          logFlashcardsDebug("single:error-suppressed", {
            roundToken,
            scopeKey,
            mode,
            reason: "nonblocking-network-error",
            message: String(err?.message ?? err ?? "unknown"),
          });
        }
        return null;
      } finally {
        if (!isStale()) setLoading(false);
        if (foregroundAbortRef.current === ac) foregroundAbortRef.current = null;
      }
    },
    [canFinishSessionWithoutMoreFetch, dispatchQuotaChanged, effectiveScopeFolderIds, normalizeResponseCards, precheckQuota, queue, scopeKey],
  );

  const fetchInitialSessionCards = React.useCallback(
    async (roundToken: number): Promise<Flashcard[] | null> => {
      const requestSeq = ++foregroundRequestSeqRef.current;
      const isStale = () => requestSeq !== foregroundRequestSeqRef.current || roundToken !== roundTokenRef.current;

      if (foregroundAbortRef.current) {
        foregroundAbortRef.current.abort();
      }
      const ac = new AbortController();
      foregroundAbortRef.current = ac;

      setLoading(true);
      setIsPrefetching(false);

      try {
        const collected: Flashcard[] = [];
        const seenIds = new Set<string>();
        let attempts = 0;
        let latestWarning: string | null = null;

        while (collected.length < DEFAULT_SESSION_SIZE && attempts < 4) {
          attempts += 1;
          const remaining = DEFAULT_SESSION_SIZE - collected.length;
          const res = await fetch("/api/flashcards/generate", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              scopeFolderIds: effectiveScopeFolderIds,
              count: remaining,
              difficulty: "medium",
              maxContextChunks: 14,
              avoidCards: buildAvoidCardsPayload([], [], collected),
            }),
            signal: ac.signal,
          });

          const data = await readJsonSafe(res);
          syncQuotaFromPayload(data);

          if (isStale()) {
            logFlashcardsDebug("stale initial batch ignored", {
              roundToken,
              scopeKey,
              requestedCount: remaining,
              reason: "response-after-round-change",
            });
            return null;
          }

          if (!res.ok) {
            const msg = String(data?.error ?? data?.message ?? "Uventet fejl fra serveren.");
            if (res.status === 402 || res.status === 429) {
              setLimitReached(true);
              setNotice(msg || QUOTA_MSG);
              setErrorMsg(null);
              void precheckQuota(true);
              return null;
            }
            setErrorMsg(`Fejl (${res.status}): ${msg}`);
            return null;
          }

          const nextCards = normalizeResponseCards(data);
          if (!data?.ok || nextCards.length === 0) {
            const msg = String(data?.warning ?? data?.error ?? "Kunne ikke generere 10 flashcards. Prøv igen.");
            setErrorMsg(msg);
            return null;
          }

          if (data?.warning) latestWarning = String(data.warning);

          let addedCount = 0;
          for (const nextCard of nextCards) {
            if (!nextCard?.id || seenIds.has(nextCard.id)) continue;
            seenIds.add(nextCard.id);
            collected.push(nextCard);
            addedCount += 1;
            if (collected.length >= DEFAULT_SESSION_SIZE) break;
          }

          logFlashcardsDebug("round:batch-fill", {
            roundToken,
            scopeKey,
            attempt: attempts,
            requestedCount: remaining,
            returnedCount: nextCards.length,
            acceptedCount: addedCount,
            collectedCount: collected.length,
          });

          if (addedCount === 0) break;
        }

        if (isStale()) {
          logFlashcardsDebug("stale initial batch ignored", {
            roundToken,
            scopeKey,
            reason: "post-fill-round-change",
          });
          return null;
        }

        if (collected.length < DEFAULT_SESSION_SIZE) {
          setErrorMsg("Kunne ikke klargøre 10 flashcards. Prøv igen.");
          return null;
        }

        setLimitReached(false);
        setErrorMsg(null);
        setNotice(latestWarning);
        return collected;
      } catch (err: any) {
        if (err?.name === "AbortError") return null;
        if (isStale()) {
          logFlashcardsDebug("stale initial batch ignored", {
            roundToken,
            scopeKey,
            reason: "catch-after-round-change",
          });
          return null;
        }
        console.error("flashcards initial batch error:", err);
        setErrorMsg("Fejl (netværk): Kunne ikke generere 10 flashcards.");
        return null;
      } finally {
        if (!isStale()) setLoading(false);
        if (foregroundAbortRef.current === ac) foregroundAbortRef.current = null;
      }
    },
    [effectiveScopeFolderIds, normalizeResponseCards, precheckQuota, scopeKey, syncQuotaFromPayload],
  );

  const prefetchBatch = React.useCallback(
    async (count: number, roundToken: number, extraAvoidCards: Flashcard[] = []) => {
      if (count <= 0) {
        setIsPrefetching(false);
        return;
      }
      const requestSeq = ++prefetchRequestSeqRef.current;
      const isStale = () => requestSeq !== prefetchRequestSeqRef.current || roundToken !== roundTokenRef.current;

      if (prefetchAbortRef.current) {
        prefetchAbortRef.current.abort();
      }
      const ac = new AbortController();
      prefetchAbortRef.current = ac;
      setIsPrefetching(true);

      try {
        const res = await fetch("/api/flashcards/generate", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            scopeFolderIds: effectiveScopeFolderIds,
            count,
            difficulty: "medium",
            maxContextChunks: 14,
            avoidCards: buildAvoidCardsPayload(cards, queue, extraAvoidCards),
          }),
          signal: ac.signal,
        });

        const data = await readJsonSafe(res);
        syncQuotaFromPayload(data);
        const nextCards = normalizeResponseCards(data);

        if (isStale()) {
          logFlashcardsDebug("stale batch ignored", {
            roundToken,
            scopeKey,
            requestedCount: count,
            returnedCount: nextCards.length,
          });
          return;
        }

        if (!res.ok || !data?.ok || nextCards.length === 0) {
          if (res.status === 402 || res.status === 429) {
            setLimitReached(true);
            setNotice(String(data?.error ?? data?.message ?? QUOTA_MSG));
            setErrorMsg(null);
            void precheckQuota(true);
          }
          return;
        }
        setLimitReached(false);
        if (data?.warning) setNotice(String(data.warning));
        if (cards.length + queue.length + nextCards.length >= sessionTotal) {
          setErrorMsg(null);
        }
        appendQueue(nextCards);
      } catch (err: any) {
        if (err?.name === "AbortError") return;
        if (isStale()) {
          logFlashcardsDebug("stale batch ignored", {
            roundToken,
            scopeKey,
            requestedCount: count,
            reason: "catch-after-round-change",
          });
          return;
        }
        console.error("flashcards batch prefetch error:", err);
      } finally {
        if (!isStale()) setIsPrefetching(false);
        if (prefetchAbortRef.current === ac) prefetchAbortRef.current = null;
      }
    },
    [appendQueue, cards, effectiveScopeFolderIds, normalizeResponseCards, precheckQuota, queue, scopeKey, sessionTotal, syncQuotaFromPayload],
  );

  const generate = React.useCallback(async () => {
    if (limitReached) return;
    if (effectiveScopeFolderIds.length === 0) {
      setErrorMsg("Vælg eller skift mappe her, før du genererer flashcards.");
      return;
    }

    const quotaBlocked = await precheckQuotaForNewSet();
    if (quotaBlocked) return;

    if (foregroundAbortRef.current) {
      foregroundAbortRef.current.abort();
      foregroundAbortRef.current = null;
    }
    if (prefetchAbortRef.current) {
      prefetchAbortRef.current.abort();
      prefetchAbortRef.current = null;
    }
    foregroundRequestSeqRef.current += 1;
    prefetchRequestSeqRef.current += 1;
    const roundToken = ++roundTokenRef.current;
    logFlashcardsDebug("round:start", {
      roundToken,
      scopeKey,
      scopeFolderIds: effectiveScopeFolderIds,
    });

    setNotice(null);
    setErrorMsg(null);
    setCards([]);
    setQueue([]);
    setI(0);
    setFlipped(false);
    setSessionTotal(DEFAULT_SESSION_SIZE);

    const sessionCards = await fetchInitialSessionCards(roundToken);
    if (!sessionCards || sessionCards.length === 0) return;

    if (roundToken !== roundTokenRef.current) {
      logFlashcardsDebug("stale batch ignored", { roundToken, scopeKey, reason: "post-return-round-change" });
      return;
    }

    const [firstCard, ...restCards] = sessionCards;
    setCurrentCard(firstCard, "single-initial");
    setQueue(restCards);
  }, [effectiveScopeFolderIds, fetchInitialSessionCards, limitReached, precheckQuotaForNewSet, scopeKey, setCurrentCard]);

  function prev() {
    if (!canPrev) return;
    setI((x) => Math.max(0, x - 1));
  }

  function next() {
    if (isSessionFinished) {
      resetToStartState();
      return;
    }
    if (!canNext || loading) return;
    if (i < cards.length - 1) {
      setI((x) => Math.min(cards.length - 1, x + 1));
      setFlipped(false);
      return;
    }

    const nextQueued = queue[0] ?? null;
    if (nextQueued) {
      setQueue((prev) => prev.slice(1));
      setCurrentCard(nextQueued, "queue-next");
      return;
    }

    const roundToken = roundTokenRef.current;
    void (async () => {
      const nextCard = await fetchSingleCard("next", roundToken);
      if (!nextCard || roundToken !== roundTokenRef.current) return;
      setCurrentCard(nextCard, "single-next");
    })();
  }

  function flip() {
    if (!hasCards) return;
    setFlipped((x) => !x);
  }

  const hasScope = effectiveScopeFolderIds.length > 0;

  // VIGTIGT: front/back er canonical (API sender dem). Brug || (ikke ??) så "" ikke blokerer fallback.
  const frontText = card ? (card.question?.trim() || card.front || "") : "";
  const backText = card ? (card.answer?.trim() || card.back || "") : "";
  const frontLooksLong = frontText.length > 110;
  const backLooksLong = backText.length > 240 || backText.split(/\r?\n/).length >= 4;
  const frontContent = (
    <div className={frontLooksLong ? "block -translate-y-6 sm:-translate-y-8" : "block"}>
      {frontText || <span className="inline-block translate-y-14 sm:translate-y-16">Vælg en mappe for at generere kort.</span>}
    </div>
  );
  const backContent = (
    <div className={backLooksLong ? "block -translate-y-8 sm:-translate-y-10" : "block"}>
      {backText}
    </div>
  );

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <div className="text-sm text-zinc-600">
          <span className="font-medium text-zinc-900">{pageLabel}</span>
        </div>

        <button
          type="button"
          onClick={generate}
          disabled={loading || !hasScope || limitReached || hasActiveSession}
          className="rounded-full border border-zinc-300 bg-white px-4 py-2 text-sm font-semibold text-zinc-900 hover:bg-zinc-50 disabled:opacity-50"
        >
          {generatingStatusLabel ?? (hasActiveSession ? "Klar" : "Generér 10 nye kort")}
        </button>
      </div>

      {limitReached ? <LimitNotice feature="flashcards_generate" message={notice ?? QUOTA_MSG} /> : null}
      {errorMsg ? (
        <div className="rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{errorMsg}</div>
      ) : null}
      {!limitReached && notice ? <div className="text-xs text-zinc-500">{notice}</div> : null}

      <div className="space-y-3">
        <FlipCard
          backLabel="Svar"
          front={frontContent}
          back={backContent}
          flipped={flipped}
        />

        <div className="text-center text-xs text-zinc-500">
          {citationTitle ? (
            <span>
              Kilde:{" "}
              {citationUrl ? (
                <a
                  href={citationUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="underline underline-offset-2 hover:text-zinc-700"
                >
                  {citationTitle}
                </a>
              ) : citationFileId ? (
                <Link
                  href={`/traener/upload?fileId=${encodeURIComponent(citationFileId)}`}
                  className="underline underline-offset-2 hover:text-zinc-700"
                >
                  {citationTitle}
                </Link>
              ) : (
                <span>{citationTitle}</span>
              )}
              {citationDetail ? ` (${citationDetail})` : ""}
            </span>
          ) : (
            "\u00A0"
          )}
        </div>
      </div>

      <div className="flex items-center justify-between gap-3">
        <button
          type="button"
          onClick={prev}
          disabled={!canPrev || loading}
          className="rounded-full border border-zinc-300 bg-white px-4 py-2 text-sm font-semibold text-zinc-900 hover:bg-zinc-50 disabled:opacity-50"
        >
          Forrige
        </button>

        <button
          type="button"
          onClick={flip}
          disabled={!hasCards || loading}
          className="rounded-full border border-zinc-300 bg-white px-4 py-2 text-sm font-semibold text-zinc-900 hover:bg-zinc-50 disabled:opacity-50"
        >
          {flipped ? "Vis spørgsmål" : "Vis svar"}
        </button>

        <button
          type="button"
          onClick={next}
          disabled={!hasCards || loading}
          className="rounded-full border border-zinc-300 bg-white px-4 py-2 text-sm font-semibold text-zinc-900 hover:bg-zinc-50 disabled:opacity-50"
        >
          {isSessionFinished ? "Afslut" : "Næste"}
        </button>
      </div>
    </div>
  );
}
