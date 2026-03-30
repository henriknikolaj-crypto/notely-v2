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

const QUOTA_MSG = "Du har nået din grænse for Flashcards denne måned.";

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

export default function FlashcardsClient({ scopeFolderIds }: Props) {
  const sp = useSearchParams();
  const urlScopeIds = React.useMemo(() => getScopeFromUrl(sp), [sp]);

  const effectiveScopeFolderIds = React.useMemo(
    () => buildScopeFolderIds(scopeFolderIds, urlScopeIds),
    [scopeFolderIds, urlScopeIds],
  );
  const scopeKey = React.useMemo(() => JSON.stringify(effectiveScopeFolderIds), [effectiveScopeFolderIds]);

  const [cards, setCards] = React.useState<Flashcard[]>([]);
  const [i, setI] = React.useState(0);
  const [flipped, setFlipped] = React.useState(false);

  const [loading, setLoading] = React.useState(false);
  const [notice, setNotice] = React.useState<string | null>(null);
  const [errorMsg, setErrorMsg] = React.useState<string | null>(null);
  const [limitReached, setLimitReached] = React.useState(false);

  const [quota, setQuota] = React.useState<Quota>(null);
  void quota;

  const hasCards = cards.length > 0;
  const card = hasCards ? cards[i] : null;

  const canPrev = hasCards && i > 0;
  const canNext = hasCards && i < cards.length - 1;

  const pageLabel = hasCards ? `Kort ${i + 1} / ${cards.length}` : "Ingen kort endnu.";

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
    setFlipped(false);
    setErrorMsg(null);
  }, [scopeKey]);

  const dispatchQuotaChanged = React.useCallback(() => {
    try {
      window.dispatchEvent(new Event("notely-quota-changed"));
      window.dispatchEvent(new Event("flashcards:changed"));
    } catch {
      // ignore
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

  const generate = React.useCallback(async () => {
    if (limitReached) return;
    if (effectiveScopeFolderIds.length === 0) {
      setErrorMsg("Vælg eller skift mappe her, før du genererer flashcards.");
      return;
    }

    const quotaBlocked = await precheckQuota(true);
    if (quotaBlocked) return;

    setLoading(true);
    setNotice(null);
    setErrorMsg(null);

    try {
      const res = await fetch("/api/flashcards/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          scopeFolderIds: effectiveScopeFolderIds,
          count: 10,
          difficulty: "medium",
          maxContextChunks: 14,
        }),
      });

      const data = await readJsonSafe(res);

      if (data?.quota) setQuota(data.quota as Quota);
      else if (data?.limits) setQuota(data.limits as Quota);

      if (!res.ok) {
        const msg = String(data?.error ?? data?.message ?? "Uventet fejl fra serveren.");
        if (res.status === 402 || res.status === 429) {
          setLimitReached(true);
          setNotice(msg || QUOTA_MSG);
          setErrorMsg(null);
          dispatchQuotaChanged();
          void precheckQuota(true);
          return;
        }
        setErrorMsg(`Fejl (${res.status}): ${msg}`);
        return;
      }

      const rawCards: any[] = Array.isArray(data?.cards)
        ? data.cards
        : Array.isArray(data?.flashcards)
          ? data.flashcards
          : Array.isArray(data?.items)
            ? data.items
            : [];

      const next = rawCards.map(normalizeCard).filter(Boolean) as Flashcard[];

      if (res.ok && data?.ok && next.length > 0) {
        setLimitReached(false);
        setCards(next);
        setI(0);
        setFlipped(false);
        if (data?.warning) setNotice(String(data.warning));
        dispatchQuotaChanged();
        return;
      }

      if (rawCards.length > 0 && next.length === 0) {
        console.warn("Flashcards: kunne ikke normalisere cards. Eksempel raw:", rawCards[0]);
        setErrorMsg("Kort blev genereret, men kunne ikke læses (format-mismatch). Se console.warn for eksempel.");
        return;
      }

      setErrorMsg(String(data?.warning ?? data?.error ?? "Kunne ikke generere kort fra API-svaret."));
    } catch (err) {
      console.error("flashcards generate error:", err);
      setErrorMsg("Fejl (netværk): Kunne ikke generere kort.");
    } finally {
      setLoading(false);
    }
  }, [effectiveScopeFolderIds, dispatchQuotaChanged, limitReached, precheckQuota]);

  function prev() {
    if (!canPrev) return;
    setI((x) => Math.max(0, x - 1));
  }

  function next() {
    if (!canNext) return;
    setI((x) => Math.min(cards.length - 1, x + 1));
  }

  function flip() {
    if (!hasCards) return;
    setFlipped((x) => !x);
  }

  const hasScope = effectiveScopeFolderIds.length > 0;

  // VIGTIGT: front/back er canonical (API sender dem). Brug || (ikke ??) så "" ikke blokerer fallback.
  const frontText = card ? (card.question?.trim() || card.front || "") : "";
  const backText = card ? (card.answer?.trim() || card.back || "") : "";

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <div className="text-sm text-zinc-600">
          <span className="font-medium text-zinc-900">{pageLabel}</span>
        </div>

        <button
          type="button"
          onClick={generate}
          disabled={loading || !hasScope || limitReached}
          className="rounded-full border border-zinc-300 bg-white px-4 py-2 text-sm font-semibold text-zinc-900 hover:bg-zinc-50 disabled:opacity-50"
        >
          {loading ? "Genererer…" : "Generér 10 kort"}
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
          front={frontText || "Vælg eller skift mappe her, og tryk derefter “Generér 10 kort”."}
          back={backText}
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
          disabled={!canNext || loading}
          className="rounded-full border border-zinc-300 bg-white px-4 py-2 text-sm font-semibold text-zinc-900 hover:bg-zinc-50 disabled:opacity-50"
        >
          Næste
        </button>
      </div>
    </div>
  );
}
