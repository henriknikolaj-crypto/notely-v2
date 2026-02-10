// app/traener/flashcards/FlashcardsClient.tsx
"use client";

import * as React from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
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

const DEMO_CARDS: Flashcard[] = [
  {
    id: "demo-1",
    front: "Hvad kendetegner en realistisk novelle?",
    back:
      "Hverdagsnært miljø, nøgternt sprog og konflikter, der udspringer af relationer og sociale vilkår. Personerne er ofte almindelige og komplekse.",
    citation: { title: "Demo", detail: "Eksempel" },
  },
  {
    id: "demo-2",
    front: "Hvad er en synsvinkel i en tekst?",
    back:
      "Synsvinklen er den position, teksten fortælles fra. Den styrer, hvad læseren får adgang til, og hvor tæt vi kommer på personers tanker og følelser.",
    citation: { title: "Demo", detail: "Eksempel" },
  },
  {
    id: "demo-3",
    front: "Nævn to typiske temaer i realistiske noveller.",
    back: "Identitet, sociale forskelle, moral/dilemmaer, relationer og ensomhed.",
    citation: { title: "Demo", detail: "Eksempel" },
  },
];

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

function normalizeCard(raw: any): Flashcard | null {
  const id = String(raw?.id ?? "").trim();
  const front = String(raw?.front ?? "").trim();
  const back = String(raw?.back ?? "").trim();
  if (!id || !front || !back) return null;

  const cit =
    raw?.citation ?? {
      file_id: raw?.citation_file_id ?? null,
      title: raw?.citation_title ?? null,
      url: raw?.citation_url ?? null,
    };

  return { id, front, back, citation: cit ?? null };
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

  const [cards, setCards] = React.useState<Flashcard[]>([]);
  const [i, setI] = React.useState(0);
  const [showBack, setShowBack] = React.useState(false);

  const [loading, setLoading] = React.useState(false);
  const [notice, setNotice] = React.useState<string | null>(null);
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

  const dispatchQuotaChanged = React.useCallback(() => {
    try {
      window.dispatchEvent(new Event("notely-quota-changed"));
      window.dispatchEvent(new Event("flashcards:changed"));
    } catch {
      // ignore
    }
  }, []);

  const precheckQuota = React.useCallback(async () => {
    try {
      const res = await fetch("/api/quota/current", { method: "GET" });
      if (!res.ok) return;

      const json = await readJsonSafe(res);
      if (!json?.ok) return;

      const { used, limit } = pickFlashcardsQuota(json);
      if (typeof limit === "number" && limit > 0) {
        const remaining = Math.max(0, limit - used);
        if (remaining <= 0) {
          setLimitReached(true);
          setNotice(QUOTA_MSG);
        } else {
          setLimitReached(false);
          setNotice(null);
        }
      }
    } catch {
      // ignore
    }
  }, []);

  // ✅ Vis limit med det samme ved load + når quota ændrer sig
  React.useEffect(() => {
    void precheckQuota();

    const onQuota = () => void precheckQuota();
    window.addEventListener("notely-quota-changed", onQuota);
    return () => window.removeEventListener("notely-quota-changed", onQuota);
  }, [precheckQuota]);

  const generate = React.useCallback(async () => {
    if (limitReached) return;

    setLoading(true);
    setNotice(null);

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

      if (res.status === 402 || res.status === 429) {
        setLimitReached(true);
        setNotice(String(data?.error ?? QUOTA_MSG));
        dispatchQuotaChanged();
        return;
      }

      const rawCards = Array.isArray(data?.cards) ? data.cards : [];
      const next = rawCards.map(normalizeCard).filter(Boolean) as Flashcard[];

      if (res.ok && data?.ok && next.length > 0) {
        setLimitReached(false);
        setCards(next);
        setI(0);
        setShowBack(false);
        if (data?.warning) setNotice(String(data.warning));
        dispatchQuotaChanged();
        return;
      }

      setLimitReached(false);
      setCards(DEMO_CARDS);
      setI(0);
      setShowBack(false);
      setNotice(String(data?.warning ?? data?.error ?? "Kunne ikke generere kort – bruger demo-kort i stedet."));
      dispatchQuotaChanged();
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error("flashcards generate error:", err);
      setCards(DEMO_CARDS);
      setI(0);
      setShowBack(false);
      setNotice("Kunne ikke generere kort – bruger demo-kort i stedet.");
      dispatchQuotaChanged();
    } finally {
      setLoading(false);
    }
  }, [effectiveScopeFolderIds, dispatchQuotaChanged, limitReached]);

  function prev() {
    if (!canPrev) return;
    setI((x) => Math.max(0, x - 1));
    setShowBack(false);
  }

  function next() {
    if (!canNext) return;
    setI((x) => Math.min(cards.length - 1, x + 1));
    setShowBack(false);
  }

  function flip() {
    if (!hasCards) return;
    setShowBack((x) => !x);
  }

  const hasScope = effectiveScopeFolderIds.length > 0;

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

      {/* ✅ ens “grå boks” ved limit */}
      {limitReached ? <LimitNotice feature="flashcards_generate" message={notice ?? QUOTA_MSG} /> : null}
      {!limitReached && notice ? <div className="text-xs text-zinc-500">{notice}</div> : null}

      <div className="rounded-2xl border border-zinc-200 bg-white p-5 shadow-sm">
        <div className="text-sm font-semibold text-zinc-900">{showBack ? "Svar" : "Spørgsmål"}</div>

        <div className="mt-3 min-h-[120px] text-[15px] leading-6 text-zinc-900">
          {card ? (showBack ? card.back : card.front) : "Vælg mappe(r) i venstre side og tryk “Generér 10 kort”."}
        </div>

        <div className="mt-4 text-xs text-zinc-500">
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
          {showBack ? "Vis spørgsmål" : "Vis svar"}
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
