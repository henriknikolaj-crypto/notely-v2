"use client";

import type { CSSProperties } from "react";
import { useEffect, useMemo, useState } from "react";
import Link from "next/link";

type OverviewItem = {
  folderId?: string;
  folderName?: string;
  attemptsWritten?: number;
  lastTrainedAt?: string | null;
  avgLast5?: number | null;

  folder_id: string | null;
  folder_title: string;
  attempts_total: number;
  avg_last5: number | null;
  last_trained_at: string | null;
};

type OverviewResponse = {
  items?: OverviewItem[];
  error?: string;
};

type SessionRow = {
  id: string;
  score: number | null;
  created_at: string | null;
  folder_id: string | null;
  source_type: string | null;
  metadata?: unknown;
  feedback_structured?: unknown;
  meta?: unknown;
  evaluation_meta?: unknown;
  feedback_meta?: unknown;
};

type SessionsResponse = {
  ok?: boolean;
  sessions?: SessionRow[];
  repeat_errors?: unknown;
  reading_refs?: unknown;
  error?: string;
};

type WeakPointItem = {
  key: string;
  label: string;
  action: string | null;
  count: number;
};

type DetailState = {
  loading: boolean;
  error: string | null;
  sessions: SessionRow[];
  trendDelta: number | null;
  weakPoints: WeakPointItem[];
  readingRefs: ReadingRefItem[];
};

type ReadingRefItem = {
  chunk_id: string;
  title: string | null;
  url: string | null;
  snippet: string | null;
  why: string | null;
  practice_prompt: string | null;
  count: number;
  tags: string[];
};

function clampStyle(lines: number): CSSProperties {
  return {
    display: "-webkit-box",
    WebkitLineClamp: lines,
    WebkitBoxOrient: "vertical",
    overflow: "hidden",
  };
}

function scoreToColor(score: number | null): string {
  if (score === null) return "#d4d4d8";
  if (score >= 75) return "#10b981";
  if (score >= 50) return "#f59e0b";
  return "#ef4444";
}

function daysSince(iso: string | null): number | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return Math.max(0, Math.floor((Date.now() - d.getTime()) / 86_400_000));
}

function sinceLabel(iso: string | null): string {
  const d = daysSince(iso);
  if (d === null) return "Aldrig";
  if (d === 0) return "I dag";
  if (d === 1) return "For 1 dag siden";
  return `For ${d} dage siden`;
}

function focusText(item: OverviewItem): string {
  if (item.attempts_total === 0) return "Ikke startet endnu";
  const avg = item.avg_last5;
  if (avg === null) return "Ikke startet endnu";
  if (avg < 40) return "Fokus: grundforståelse";
  if (avg < 60) return "Fokus: struktur og begreber";
  if (avg < 75) return "Fokus: tekstnær dokumentation";
  return "Fokus: finpudsning";
}

function nextExerciseText(item: OverviewItem): string {
  if (item.attempts_total === 0) return "Start med 1 kort træning (10-15 min)";
  const avg = item.avg_last5;
  if (avg === null || avg < 50) {
    return "Lav 1 træning med fokus på disposition + nøglebegreber";
  }
  if (avg < 70) return "Lav 1 træning med fokus på tekstbelæg/citater";
  return "Lav 1 træning og fokuser på præcision + konklusion";
}

function focusBadgeClass(item: OverviewItem): string {
  if (item.attempts_total === 0 || item.avg_last5 === null) {
    return "bg-zinc-100 text-zinc-700 border-zinc-200";
  }
  if (item.avg_last5 < 40) return "bg-red-50 text-red-700 border-red-200";
  if (item.avg_last5 < 60) return "bg-amber-50 text-amber-700 border-amber-200";
  if (item.avg_last5 < 75) return "bg-yellow-50 text-yellow-700 border-yellow-200";
  return "bg-emerald-50 text-emerald-700 border-emerald-200";
}

function asRecord(v: unknown): Record<string, unknown> | null {
  if (!v || typeof v !== "object" || Array.isArray(v)) return null;
  return v as Record<string, unknown>;
}

function asWeakPointRawList(v: unknown): unknown[] {
  return Array.isArray(v) ? v : [];
}

function toWeakPointSeed(raw: unknown): { key: string; label: string; action: string | null } | null {
  if (typeof raw === "string") {
    const label = raw.trim();
    if (!label) return null;
    return { key: label.toLowerCase(), label, action: null };
  }

  const obj = asRecord(raw);
  if (!obj) return null;

  const keyRaw = String(obj.key ?? "").trim();
  const labelRaw = String(obj.label ?? obj.text ?? obj.key ?? "").trim();
  const actionRaw = String(obj.action ?? "").trim();

  const label = labelRaw || keyRaw;
  if (!label) return null;

  return {
    key: (keyRaw || label).toLowerCase(),
    label,
    action: actionRaw || null,
  };
}

function getWeakPointListFromSession(session: SessionRow): unknown[] {
  const metadata = asRecord(session.metadata);
  const structured = asRecord(session.feedback_structured);
  const meta = asRecord(session.meta);
  const evaluationMeta = asRecord(session.evaluation_meta);
  const feedbackMeta = asRecord(session.feedback_meta);

  const candidates = [
    metadata?.weak_points,
    structured?.weak_points,
    meta?.weak_points,
    evaluationMeta?.weak_points,
    feedbackMeta?.weak_points,
  ];

  for (const candidate of candidates) {
    const list = asWeakPointRawList(candidate);
    if (list.length > 0) return list;
  }

  // Oral sessions may only have structured improvements. Use them only as a last-resort fallback.
  if (session.source_type === "oral") {
    const result = asRecord(meta?.result);
    const overall = asRecord(result?.overall);
    const improvements = asWeakPointRawList(overall?.improvements);
    if (improvements.length > 0) return improvements;
  }

  return [];
}

function asText(v: unknown): string {
  return String(v ?? "").trim();
}

function normalizeReadingRef(raw: unknown): ReadingRefItem | null {
  const obj = asRecord(raw);
  if (!obj) return null;

  const chunkId = asText(obj.chunk_id ?? obj.chunkId);
  const title = asText(obj.title) || null;
  if (!chunkId && !title) return null;

  const url = asText(obj.url) || null;
  const snippet = asText(obj.snippet ?? obj.excerpt) || null;
  const why = asText(obj.why) || null;
  const practicePrompt = asText(obj.practice_prompt) || null;
  const countRaw = Number(obj.count);
  const count = Number.isFinite(countRaw) && countRaw > 0 ? Math.floor(countRaw) : 1;
  const tags = Array.isArray(obj.tags)
    ? obj.tags.map((t) => asText(t)).filter(Boolean).slice(0, 5)
    : [];

  return {
    chunk_id: chunkId || `title:${(title ?? "").toLowerCase()}`,
    title,
    url,
    snippet,
    why,
    practice_prompt: practicePrompt,
    count,
    tags,
  };
}

function deriveReadingRefsFromSessions(sessions: SessionRow[]): ReadingRefItem[] {
  const acc = new Map<string, ReadingRefItem>();

  for (const session of sessions) {
    const metadata = asRecord(session.metadata);
    const meta = asRecord(session.meta);
    const refsRaw: unknown[] = Array.isArray(metadata?.read_here)
      ? (metadata.read_here as unknown[])
      : Array.isArray(meta?.read_here)
        ? (meta.read_here as unknown[])
        : Array.isArray(metadata?.reading_refs ?? metadata?.readingRefs)
      ? ((metadata?.reading_refs ?? metadata?.readingRefs) as unknown[])
      : Array.isArray(metadata?.citations)
        ? (metadata.citations as unknown[])
        : Array.isArray(meta?.citations)
          ? (meta.citations as unknown[])
          : [];

    for (const raw of refsRaw) {
      const normalized = normalizeReadingRef(raw);
      if (!normalized) continue;
      const existing = acc.get(normalized.chunk_id);
      if (existing) {
        existing.count += 1;
        if (!existing.snippet && normalized.snippet) existing.snippet = normalized.snippet;
      } else {
        acc.set(normalized.chunk_id, normalized);
      }
    }
  }

  return Array.from(acc.values())
    .sort((a, b) => b.count - a.count)
    .slice(0, 3);
}

function parseRepeatErrors(raw: unknown): WeakPointItem[] | null {
  if (!Array.isArray(raw)) return null;
  const out: WeakPointItem[] = [];
  for (const item of raw) {
    const obj = asRecord(item);
    if (!obj) continue;
    const key = asText(obj.key).toLowerCase();
    const label = asText(obj.label);
    if (!key || !label) continue;
    const action = asText(obj.action) || null;
    const n = Number(obj.count);
    const count = Number.isFinite(n) && n > 0 ? Math.floor(n) : 1;
    out.push({ key, label, action, count });
  }
  return out.slice(0, 3);
}

function parseReadingRefs(raw: unknown): ReadingRefItem[] | null {
  if (!Array.isArray(raw)) return null;
  const out = raw
    .map((r) => normalizeReadingRef(r))
    .filter((r): r is ReadingRefItem => !!r)
    .slice(0, 3);
  return out;
}

function deriveRepeatedWeakPoints(sessions: SessionRow[]): WeakPointItem[] {
  const acc = new Map<string, WeakPointItem>();

  for (const session of sessions) {
    const rawPoints = getWeakPointListFromSession(session);
    for (const raw of rawPoints) {
      const parsed = toWeakPointSeed(raw);
      if (!parsed) continue;

      const existing = acc.get(parsed.key);
      if (existing) {
        existing.count += 1;
        if (!existing.action && parsed.action) {
          existing.action = parsed.action;
        }
      } else {
        acc.set(parsed.key, {
          key: parsed.key,
          label: parsed.label,
          action: parsed.action,
          count: 1,
        });
      }
    }
  }

  return Array.from(acc.values())
    .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label, "da"))
    .slice(0, 3);
}

function deriveTrendDelta(sessions: SessionRow[]): number | null {
  const scores = sessions
    .map((s) => s.score)
    .filter((n): n is number => typeof n === "number" && Number.isFinite(n));

  if (scores.length < 2) return null;

  const newest = scores[0];
  const oldest = scores[scores.length - 1];
  return Math.round(newest - oldest);
}

function formatDate(iso: string | null): string {
  if (!iso) return "Ukendt dato";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "Ukendt dato";
  return d.toLocaleDateString("da-DK", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  });
}

function cardKey(folderId: string | null): string {
  return folderId ?? "__all__";
}

// 🔧 Filtrér legacy/null "Uden mappe"-rækker væk og dedupliker pr. folder_id
function sanitizeOverviewItems(raw: OverviewItem[]): OverviewItem[] {
  const out: OverviewItem[] = [];
  const seen = new Set<string>();

  for (const item of raw) {
    const folderIdRaw =
      (typeof item?.folder_id === "string" ? item.folder_id : null) ??
      (typeof item?.folderId === "string" ? item.folderId : null);
    const folderId = (folderIdRaw ?? "").trim();
    if (!folderId) continue; // skjul NULL/orphan => ingen "Uden mappe"-kort

    if (seen.has(folderId)) continue;
    seen.add(folderId);

    const folderName =
      (typeof item.folderName === "string" && item.folderName.trim()
        ? item.folderName.trim()
        : typeof item.folder_title === "string" && item.folder_title.trim()
          ? item.folder_title.trim()
          : folderId);
    const attempts =
      typeof item.attempts_total === "number"
        ? item.attempts_total
        : typeof item.attemptsWritten === "number"
          ? item.attemptsWritten
          : 0;
    const avg =
      typeof item.avg_last5 === "number" || item.avg_last5 === null
        ? item.avg_last5
        : typeof item.avgLast5 === "number" || item.avgLast5 === null
          ? item.avgLast5
          : null;
    const lastTrained =
      typeof item.last_trained_at === "string" || item.last_trained_at === null
        ? item.last_trained_at
        : typeof item.lastTrainedAt === "string" || item.lastTrainedAt === null
          ? item.lastTrainedAt
          : null;

    out.push({
      folder_id: folderId,
      folder_title: folderName,
      attempts_total: attempts,
      avg_last5: avg,
      last_trained_at: lastTrained,
    });
  }

  return out;
}

export default function OverblikClient() {
  const [items, setItems] = useState<OverviewItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expanded] = useState<Record<string, boolean>>({});
  const [readHereExpanded, setReadHereExpanded] = useState<Record<string, boolean>>({});
  const [weakPointsExpanded, setWeakPointsExpanded] = useState<Record<string, boolean>>({});
  const [details, setDetails] = useState<Record<string, DetailState>>({});

  useEffect(() => {
    let active = true;

    async function run() {
      setLoading(true);
      setError(null);

      try {
        const res = await fetch("/api/exam-sessions?mode=overview&source_types=trainer,simulator,oral", {
          method: "GET",
          cache: "no-store",
        });
        const payload = (await res.json().catch(() => ({}))) as OverviewResponse;

        if (res.status === 401) {
          throw new Error("Login mangler i denne browser. Overblik kan ikke hentes uden en gyldig session.");
        }

        if (!res.ok) {
          throw new Error(payload?.error || "Kunne ikke hente overblik.");
        }

        if (active) {
          const rawItems = Array.isArray(payload.items) ? payload.items : [];
          setItems(sanitizeOverviewItems(rawItems));
        }
      } catch (err: any) {
        if (active) {
          setItems([]);
          setError(err?.message || "Ukendt fejl");
        }
      } finally {
        if (active) setLoading(false);
      }
    }

    void run();
    return () => {
      active = false;
    };
  }, []);

  const hasItems = useMemo(() => items.length > 0, [items]);

  return (
    <main className="space-y-6">
      <header className="mb-6 border-b border-zinc-200 pb-3">
        <h1 className="text-lg font-semibold text-zinc-900">Overblik</h1>
        <p className="mt-1 text-sm text-zinc-600">
          Dine mapper med seneste aktivitet og scoreudvikling.
        </p>
      </header>

      {loading ? <p className="text-sm text-zinc-600">Henter overblik...</p> : null}

      {!loading && error ? (
        <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">
          Fejl ved hentning af overblik: {error}
        </div>
      ) : null}

      {!loading && !error && !hasItems ? (
        <p className="text-sm text-zinc-600">Ingen træningsforsøg endnu.</p>
      ) : null}

      {!loading && !error && hasItems ? (
        <div className="grid items-start gap-6 sm:grid-cols-2">
          {items.map((card) => {
            const pct = Math.max(0, Math.min(100, card.avg_last5 ?? 0));
            const color = scoreToColor(card.avg_last5);
            const key = cardKey(card.folder_id);
            const isOpen = !!expanded[key];
            const detail = details[key];
            const recent3 = (detail?.sessions ?? []).slice(0, 3);
            const focus = focusText(card);
            const nextExercise = nextExerciseText(card);
            const readHereSuggestions = detail?.readingRefs ?? [];
            const isReadHereOpen = !!readHereExpanded[key];
            const isWeakPointsOpen = !!weakPointsExpanded[key];
            const weakPoints = detail?.weakPoints ?? [];
            const visibleWeakPoints = isWeakPointsOpen ? weakPoints : weakPoints.slice(0, 2);

            return (
              <section
                key={card.folder_id as string}
                className="rounded-2xl border border-neutral-200 bg-white p-5 shadow-sm"
              >
                <div className="flex items-start justify-between gap-2">
                  <h2 className="text-lg font-semibold leading-tight">{card.folder_title}</h2>
                  <span className="whitespace-nowrap text-[11px] text-black/40">
                    {card.attempts_total} forsøg
                  </span>
                </div>

                <div className="mt-2">
                  <span
                    className={`inline-flex rounded-full border px-2 py-1 text-[11px] font-medium ${focusBadgeClass(card)}`}
                  >
                    {focus}
                  </span>
                </div>

                <div className="mt-4 grid grid-cols-3 gap-3 text-sm">
                  <div className="rounded-xl border border-neutral-200 p-3 text-center">
                    <div className="text-lg font-semibold tracking-tight">
                      {card.avg_last5 == null ? "-" : Math.round(card.avg_last5)}
                    </div>
                    <div className="mt-1 text-[10px] uppercase tracking-wider text-black/50">
                      Snit (seneste 5)
                    </div>
                  </div>

                  <div className="rounded-xl border border-neutral-200 p-3 text-center">
                    <div className="text-lg font-semibold tracking-tight">{card.attempts_total}</div>
                    <div className="mt-1 text-[10px] uppercase tracking-wider text-black/50">
                      Forsøg
                    </div>
                  </div>

                  <div className="rounded-xl border border-neutral-200 p-3 text-center">
                    <div className="text-sm font-semibold tracking-tight">
                      {sinceLabel(card.last_trained_at)}
                    </div>
                    <div className="mt-1 text-[10px] uppercase tracking-wider text-black/50">
                      Sidst trænet
                    </div>
                  </div>
                </div>

                <div className="mb-4 mt-4">
                  <div className="h-2 w-full overflow-hidden rounded bg-neutral-200">
                    <div
                      className="h-2 rounded"
                      style={{
                        width: `${pct}%`,
                        backgroundColor: color,
                        transition: "width .25s ease",
                      }}
                    />
                  </div>
                </div>

                <div className="flex flex-wrap items-center gap-3">
                  {card.folder_id ? (
                    <Link
                      href={`/traener/mappe/${encodeURIComponent(card.folder_id)}`}
                      className="inline-flex items-center justify-center rounded-full border border-neutral-300 px-4 py-2 text-sm font-medium text-black hover:bg-neutral-50"
                    >
                      Se detaljer
                    </Link>
                  ) : (
                    <span className="inline-flex items-center justify-center rounded-full border border-neutral-200 px-4 py-2 text-sm font-medium text-zinc-400">
                      Ingen mappe
                    </span>
                  )}
                </div>

                {isOpen ? (
                  <div className="mt-4 rounded-xl border border-neutral-200 bg-neutral-50 p-4 max-h-[620px] overflow-y-auto pr-2">
                    {detail?.loading ? (
                      <p className="text-sm text-zinc-600">Henter detaljer...</p>
                    ) : null}

                    {!detail?.loading && detail?.error ? (
                      <p className="text-sm text-red-700">Kunne ikke hente detaljer: {detail.error}</p>
                    ) : null}

                    {!detail?.loading && !detail?.error ? (
                      <div className="space-y-4 text-sm min-w-0">
                        <div className="rounded-lg border border-neutral-200 bg-white px-3 py-2 min-w-0">
                          <div className="mb-1 text-[11px] uppercase tracking-wider text-black/50">Trend</div>
                          <div className="font-medium">
                            {detail?.trendDelta == null
                              ? "—"
                              : detail.trendDelta > 0
                                ? `↑ +${detail.trendDelta}`
                                : detail.trendDelta < 0
                                  ? `↓ ${detail.trendDelta}`
                                  : "→ 0"}
                          </div>
                          <div className="mt-3 mb-1 text-[11px] uppercase tracking-wider text-black/50">
                            Seneste 3 vurderinger
                          </div>
                          {recent3.length === 0 ? (
                            <p className="text-zinc-600">Ingen vurderinger endnu.</p>
                          ) : (
                            <ul className="space-y-1">
                              {recent3.map((s) => (
                                <li
                                  key={s.id}
                                  className="flex min-w-0 items-center justify-between rounded border border-neutral-200 bg-neutral-50 px-3 py-2"
                                >
                                  <span className="text-zinc-700">{formatDate(s.created_at)}</span>
                                  <span className="font-medium">{s.score == null ? "—" : Math.round(s.score)}</span>
                                </li>
                              ))}
                            </ul>
                          )}
                        </div>

                        <div className="rounded-lg border border-neutral-200 bg-white px-3 py-2 min-w-0">
                          <div className="mb-1 text-[11px] uppercase tracking-wider text-black/50">Fokus nu</div>
                          <p className="font-medium break-words whitespace-normal">{focus}</p>
                        </div>

                        <div className="rounded-lg border border-neutral-200 bg-white px-3 py-2 min-w-0">
                          <div className="mb-1 text-[11px] uppercase tracking-wider text-black/50">Næste øvelse</div>
                          <p className="text-zinc-800 break-words whitespace-normal">{nextExercise}</p>
                        </div>

                        <div className="rounded-lg border border-dashed border-neutral-300 bg-white px-3 py-2 min-w-0">
                          <div className="mb-1 text-[11px] uppercase tracking-wider text-black/50">
                            Fejl der går igen
                          </div>
                          {weakPoints.length ? (
                            <>
                              <ul className="space-y-2">
                                {visibleWeakPoints.map((wp) => (
                                  <li
                                    key={wp.key}
                                    className="w-full rounded border border-neutral-200 bg-neutral-50 px-3 py-2 min-w-0"
                                  >
                                    <p className="font-medium text-zinc-800 break-words whitespace-normal">
                                      {wp.label} ({wp.count} gange)
                                    </p>
                                    {wp.action ? (
                                      <p className="mt-1 text-xs text-zinc-600 break-words whitespace-normal">
                                        {wp.action}
                                      </p>
                                    ) : null}
                                  </li>
                                ))}
                              </ul>
                              {weakPoints.length > 2 ? (
                                <button
                                  type="button"
                                  className="mt-2 text-xs text-zinc-600 underline"
                                  onClick={() =>
                                    setWeakPointsExpanded((prev) => ({ ...prev, [key]: !isWeakPointsOpen }))
                                  }
                                >
                                  {isWeakPointsOpen ? "Vis færre" : "Vis alle"}
                                </button>
                              ) : null}
                            </>
                          ) : (
                            <div className="text-zinc-600">
                              <p>Ingen strukturerede fejlmønstre endnu</p>
                              <p className="text-xs">
                                (kommer automatisk, når vurderinger gemmer mere detaljeret feedback)
                              </p>
                            </div>
                          )}
                        </div>

                        <div className="rounded-lg border border-neutral-200 bg-white px-3 py-2 min-w-0">
                          <button
                            type="button"
                            className="text-xs text-zinc-600 underline"
                            onClick={() =>
                              setReadHereExpanded((prev) => ({ ...prev, [key]: !isReadHereOpen }))
                            }
                          >
                            {isReadHereOpen
                              ? `Skjul læs-op-forslag (${readHereSuggestions.length})`
                              : `Vis læs-op-forslag (${readHereSuggestions.length})`}
                          </button>

                          {isReadHereOpen ? (
                            <div className="mt-2 min-w-0">
                              <div className="mb-1 text-[11px] uppercase tracking-wider text-black/50">
                                Læs op her ({readHereSuggestions.length})
                              </div>
                              {readHereSuggestions.length ? (
                                <ul className="space-y-2">
                                  {readHereSuggestions.map((ref) => (
                                    <li
                                      key={ref.chunk_id}
                                      className="w-full rounded border border-zinc-200 bg-zinc-50 px-3 py-2 min-w-0"
                                    >
                                      <div className="flex min-w-0 items-center justify-between gap-2">
                                        <p className="text-sm font-medium text-zinc-800 break-words whitespace-normal">
                                          {ref.title || "Kilde"}
                                        </p>
                                        {ref.count > 1 ? (
                                          <span className="shrink-0 rounded border border-zinc-300 px-2 py-[1px] text-[11px] text-zinc-600">
                                            {ref.count}x
                                          </span>
                                        ) : null}
                                      </div>
                                      {ref.snippet ? (
                                        <p className="mt-1 text-xs text-zinc-600 break-words whitespace-normal" style={clampStyle(3)}>
                                          {ref.snippet}
                                        </p>
                                      ) : null}
                                      {ref.why ? (
                                        <p className="mt-1 text-[11px] text-zinc-500 break-words whitespace-normal" style={clampStyle(2)}>
                                          {ref.why}
                                        </p>
                                      ) : null}
                                      <p className="mt-1 text-[11px] text-zinc-500 break-words whitespace-normal" style={clampStyle(2)}>
                                        {ref.practice_prompt || "Brug dette til at træne tekstbelæg/citater"}
                                      </p>
                                    </li>
                                  ))}
                                </ul>
                              ) : (
                                <p className="text-zinc-600">
                                  Ingen teksthenvisninger endnu – kommer efter flere vurderinger med kilder.
                                </p>
                              )}
                            </div>
                          ) : null}
                        </div>
                      </div>
                    ) : null}
                  </div>
                ) : null}
              </section>
            );
          })}
        </div>
      ) : null}
    </main>
  );
}
