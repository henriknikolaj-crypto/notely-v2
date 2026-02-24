"use client";

import Link from "next/link";
import type { CSSProperties } from "react";
import { useEffect, useMemo, useState } from "react";

const SOURCE_TYPES = "trainer,simulator,oral";

const COPY = {
  backToOverview: "← Tilbage til Overblik",
  pageTitleFallback: "Mappe",
  subtitle: "Her får du et roligt overblik over, hvad der løfter dine næste svar mest.",
  repeatedTitle: "Det her går igen i dine svar",
  readTitle: "Læs dette før næste træning",
  nextStepTitle: "Næste skridt",
  writingTipsTitle: "Når du skriver",
  sourceLabel: "Kilder: trainer, simulator, oral",
  chartEmpty: "Der er for få vurderinger til at vise en udviklingskurve endnu.",
  chartHint: "Kurven viser de seneste vurderinger med score.",
} as const;

type OverviewItem = {
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

type FolderStats = {
  attempts_total: number;
  avg_last5: number | null;
  last_trained_at: string | null;
};

type ScorePoint = {
  id: string;
  score: number;
  created_at: string;
};

function asRecord(v: unknown): Record<string, unknown> | null {
  if (!v || typeof v !== "object" || Array.isArray(v)) return null;
  return v as Record<string, unknown>;
}

function asText(v: unknown): string {
  return String(v ?? "").trim();
}

function asWeakPointRawList(v: unknown): unknown[] {
  return Array.isArray(v) ? v : [];
}

function clampStyle(lines: number): CSSProperties {
  return {
    display: "-webkit-box",
    WebkitLineClamp: lines,
    WebkitBoxOrient: "vertical",
    overflow: "hidden",
  };
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

function focusText(item: FolderStats): string {
  if (item.attempts_total === 0) return "Ikke startet endnu";
  const avg = item.avg_last5;
  if (avg === null) return "Ikke startet endnu";
  if (avg < 40) return "Fokus: grundforståelse";
  if (avg < 60) return "Fokus: struktur og begreber";
  if (avg < 75) return "Fokus: tekstnær dokumentation";
  return "Fokus: finpudsning";
}

function focusBadgeClass(item: FolderStats): string {
  if (item.attempts_total === 0 || item.avg_last5 === null) {
    return "bg-zinc-100 text-zinc-700 border-zinc-200";
  }
  if (item.avg_last5 < 40) return "bg-red-50 text-red-700 border-red-200";
  if (item.avg_last5 < 60) return "bg-amber-50 text-amber-700 border-amber-200";
  if (item.avg_last5 < 75) return "bg-yellow-50 text-yellow-700 border-yellow-200";
  return "bg-emerald-50 text-emerald-700 border-emerald-200";
}

function nextExerciseText(item: FolderStats): string {
  if (item.attempts_total === 0) return "Start med 1 kort træning (10-15 min)";
  const avg = item.avg_last5;
  if (avg === null || avg < 50) {
    return "Lav 1 træning med fokus på disposition + nøglebegreber";
  }
  if (avg < 70) return "Lav 1 træning med fokus på tekstbelæg/citater";
  return "Lav 1 træning og fokuser på præcision + konklusion";
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
  return [];
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
    ? obj.tags.map((tag) => asText(tag)).filter(Boolean).slice(0, 5)
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
  return out;
}

function parseReadingRefs(raw: unknown): ReadingRefItem[] | null {
  if (!Array.isArray(raw)) return null;
  return raw.map((r) => normalizeReadingRef(r)).filter((r): r is ReadingRefItem => !!r);
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

  return Array.from(acc.values()).sort(
    (a, b) => b.count - a.count || a.label.localeCompare(b.label, "da"),
  );
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

  return Array.from(acc.values()).sort((a, b) => b.count - a.count);
}

function deriveTrendDelta(sessions: SessionRow[]): number | null {
  const scores = sessions
    .map((s) => s.score)
    .filter((n): n is number => typeof n === "number" && Number.isFinite(n));
  if (scores.length < 2) return null;
  return Math.round(scores[0] - scores[scores.length - 1]);
}

function buildScorePoints(sessions: SessionRow[], limit = 20): ScorePoint[] {
  return sessions
    .filter(
      (s): s is SessionRow & { score: number; created_at: string } =>
        typeof s.score === "number" && Number.isFinite(s.score) && typeof s.created_at === "string",
    )
    .slice(0, limit)
    .reverse()
    .map((s) => ({
      id: s.id,
      score: Math.max(0, Math.min(100, s.score)),
      created_at: s.created_at,
    }));
}

function deriveStatsFromSessions(sessions: SessionRow[]): FolderStats {
  const nonNullScores = sessions
    .map((s) => s.score)
    .filter((n): n is number => typeof n === "number" && Number.isFinite(n))
    .slice(0, 5);
  const avg_last5 =
    nonNullScores.length > 0
      ? nonNullScores.reduce((sum, n) => sum + n, 0) / nonNullScores.length
      : null;

  return {
    attempts_total: sessions.length,
    avg_last5,
    last_trained_at: sessions[0]?.created_at ?? null,
  };
}

function FolderProgressChart({ points }: { points: ScorePoint[] }) {
  if (points.length < 2) {
    return (
      <div className="rounded-lg border border-dashed border-zinc-300 bg-zinc-50 px-3 py-4 text-xs text-zinc-600">
        {COPY.chartEmpty}
      </div>
    );
  }

  const width = 720;
  const height = 220;
  const padX = 30;
  const padY = 22;
  const innerW = width - padX * 2;
  const innerH = height - padY * 2;
  const min = Math.min(...points.map((p) => p.score));
  const max = Math.max(...points.map((p) => p.score));
  const range = Math.max(1, max - min);

  const toX = (index: number) =>
    points.length === 1 ? padX : padX + (index / (points.length - 1)) * innerW;
  const toY = (score: number) => padY + (1 - (score - min) / range) * innerH;

  const polyline = points.map((p, i) => `${toX(i)},${toY(p.score)}`).join(" ");

  return (
    <div className="rounded-lg border border-zinc-200 bg-white p-3">
      <svg viewBox={`0 0 ${width} ${height}`} className="h-52 w-full min-w-0" role="img" aria-label="Score over tid">
        <line x1={padX} y1={height - padY} x2={width - padX} y2={height - padY} stroke="#d4d4d8" />
        <line x1={padX} y1={padY} x2={padX} y2={height - padY} stroke="#d4d4d8" />
        <polyline fill="none" stroke="#18181b" strokeWidth="2.5" points={polyline} />
        {points.map((p, i) => (
          <g key={p.id}>
            <circle cx={toX(i)} cy={toY(p.score)} r="3.5" fill="#18181b">
              <title>{`${formatDate(p.created_at)}: ${Math.round(p.score)}`}</title>
            </circle>
          </g>
        ))}
        <text x={padX} y={padY - 6} fontSize="11" fill="#71717a">
          {Math.round(max)}
        </text>
        <text x={padX} y={height - padY + 14} fontSize="11" fill="#71717a">
          {Math.round(min)}
        </text>
      </svg>
      <p className="mt-2 text-xs text-zinc-500">{COPY.chartHint}</p>
    </div>
  );
}

type MappeIndsigtClientProps = {
  folderId: string;
};

export default function MappeIndsigtClient({ folderId }: MappeIndsigtClientProps) {
  const [overviewItem, setOverviewItem] = useState<OverviewItem | null>(null);
  const [sessions, setSessions] = useState<SessionRow[]>([]);
  const [weakPoints, setWeakPoints] = useState<WeakPointItem[]>([]);
  const [readingRefs, setReadingRefs] = useState<ReadingRefItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [weakPointsExpanded, setWeakPointsExpanded] = useState(false);
  const [readHereExpanded, setReadHereExpanded] = useState(false);

  useEffect(() => {
    let active = true;

    async function run() {
      setLoading(true);
      setError(null);

      try {
        const [overviewRes, sessionsRes] = await Promise.all([
          fetch(`/api/exam-sessions?mode=overview&source_types=${SOURCE_TYPES}`, {
            method: "GET",
            cache: "no-store",
          }),
          fetch(
            `/api/exam-sessions?source_types=${SOURCE_TYPES}&include_meta=1&folder_id=${encodeURIComponent(folderId)}&limit=50`,
            {
              method: "GET",
              cache: "no-store",
            },
          ),
        ]);

        const overviewPayload = (await overviewRes.json().catch(() => ({}))) as OverviewResponse;
        const sessionPayload = (await sessionsRes.json().catch(() => ({}))) as SessionsResponse;

        if (!overviewRes.ok) {
          throw new Error(overviewPayload?.error || "Kunne ikke hente mappeoverblik.");
        }
        if (!sessionsRes.ok) {
          throw new Error(sessionPayload?.error || "Kunne ikke hente mappedetaljer.");
        }

        if (!active) return;

        const overviewItems = Array.isArray(overviewPayload.items) ? overviewPayload.items : [];
        const match = overviewItems.find((item) => item.folder_id === folderId) ?? null;
        setOverviewItem(match);

        const loadedSessions = Array.isArray(sessionPayload.sessions) ? sessionPayload.sessions : [];
        setSessions(loadedSessions);

        const repeatErrorsFromApi = parseRepeatErrors(sessionPayload.repeat_errors);
        const readingRefsFromApi = parseReadingRefs(sessionPayload.reading_refs);

        setWeakPoints(repeatErrorsFromApi ?? deriveRepeatedWeakPoints(loadedSessions));
        setReadingRefs(readingRefsFromApi ?? deriveReadingRefsFromSessions(loadedSessions));
      } catch (err: any) {
        if (!active) return;
        setOverviewItem(null);
        setSessions([]);
        setWeakPoints([]);
        setReadingRefs([]);
        setError(err?.message || "Ukendt fejl");
      } finally {
        if (active) setLoading(false);
      }
    }

    void run();
    return () => {
      active = false;
    };
  }, [folderId]);

  const fallbackStats = useMemo(() => deriveStatsFromSessions(sessions), [sessions]);
  const stats = useMemo<FolderStats>(() => {
    if (overviewItem) {
      return {
        attempts_total: overviewItem.attempts_total,
        avg_last5: overviewItem.avg_last5,
        last_trained_at: overviewItem.last_trained_at,
      };
    }
    return fallbackStats;
  }, [overviewItem, fallbackStats]);

  const title = overviewItem?.folder_title || COPY.pageTitleFallback;
  const trendDelta = useMemo(() => deriveTrendDelta(sessions), [sessions]);
  const scorePoints = useMemo(() => buildScorePoints(sessions, 20), [sessions]);
  const recent3 = useMemo(() => sessions.slice(0, 3), [sessions]);
  const focus = useMemo(() => focusText(stats), [stats]);
  const nextStep = useMemo(() => nextExerciseText(stats), [stats]);
  const visibleWeakPoints = weakPointsExpanded ? weakPoints : weakPoints.slice(0, 3);
  const readHereSuggestions = useMemo(() => readingRefs.slice(0, 3), [readingRefs]);

  return (
    <main className="mx-auto max-w-7xl p-6">
      <Link href="/traener/overblik" className="text-sm text-zinc-600 hover:text-zinc-900">
        {COPY.backToOverview}
      </Link>

      <section className="mt-3 rounded-2xl border border-neutral-200 bg-white p-5 shadow-sm min-w-0">
        <h1 className="text-2xl font-semibold break-words">{title}</h1>
        <p className="mt-1 text-sm text-zinc-600">{COPY.subtitle}</p>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <span
            className={`inline-flex rounded-full border px-2 py-1 text-[11px] font-medium ${focusBadgeClass(stats)}`}
          >
            {focus}
          </span>
        </div>

        <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-3">
          <div className="rounded-xl border border-neutral-200 p-3 text-center">
            <div className="text-lg font-semibold tracking-tight">
              {stats.avg_last5 == null ? "-" : Math.round(stats.avg_last5)}
            </div>
            <div className="mt-1 text-[10px] uppercase tracking-wider text-black/50">Snit (seneste 5)</div>
          </div>
          <div className="rounded-xl border border-neutral-200 p-3 text-center">
            <div className="text-lg font-semibold tracking-tight">{stats.attempts_total}</div>
            <div className="mt-1 text-[10px] uppercase tracking-wider text-black/50">Forsøg</div>
          </div>
          <div className="rounded-xl border border-neutral-200 p-3 text-center">
            <div className="text-sm font-semibold tracking-tight">{sinceLabel(stats.last_trained_at)}</div>
            <div className="mt-1 text-[10px] uppercase tracking-wider text-black/50">Sidst trænet</div>
          </div>
        </div>

        <div className="mt-4 flex flex-wrap gap-2">
          <Link
            href={`/traener?scope=${encodeURIComponent(folderId)}`}
            className="inline-flex items-center justify-center rounded-full border border-neutral-300 px-4 py-2 text-sm font-medium text-black hover:bg-neutral-50"
          >
            Start træning
          </Link>
          <Link
            href="/traener/overblik"
            className="inline-flex items-center justify-center rounded-full border border-neutral-200 px-4 py-2 text-sm text-zinc-700 hover:bg-neutral-50"
          >
            Tilbage til overblik
          </Link>
        </div>
      </section>

      {loading ? <p className="mt-6 text-sm text-zinc-600">Henter mappeindsigt...</p> : null}

      {!loading && error ? (
        <div className="mt-6 rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">
          Fejl ved hentning af mappeindsigt: {error}
        </div>
      ) : null}

      {!loading && !error ? (
        <div className="mt-6 grid grid-cols-1 gap-6 lg:grid-cols-3 min-w-0">
          <div className="space-y-4 min-w-0 lg:col-span-2">
            <section className="rounded-2xl border border-neutral-200 bg-white p-4 shadow-sm min-w-0">
              <h2 className="text-base font-semibold">Udvikling</h2>
              <div className="mt-2 text-xs text-zinc-500">{COPY.sourceLabel}</div>
              <div className="mt-3 text-sm font-medium">
                Trend:{" "}
                {trendDelta == null
                  ? "—"
                  : trendDelta > 0
                    ? `↑ +${trendDelta}`
                    : trendDelta < 0
                      ? `↓ ${trendDelta}`
                      : "→ 0"}
              </div>
              <div className="mt-3 min-w-0">
                <FolderProgressChart points={scorePoints} />
              </div>
              <div className="mt-3">
                <div className="mb-1 text-[11px] uppercase tracking-wider text-black/50">Seneste 3 vurderinger</div>
                {recent3.length === 0 ? (
                  <p className="text-sm text-zinc-600">Ingen vurderinger endnu.</p>
                ) : (
                  <ul className="space-y-2">
                    {recent3.map((s) => (
                      <li
                        key={s.id}
                        className="flex min-w-0 items-center justify-between rounded border border-neutral-200 bg-neutral-50 px-3 py-2 text-sm"
                      >
                        <span className="text-zinc-700">{formatDate(s.created_at)}</span>
                        <span className="font-medium">{s.score == null ? "—" : Math.round(s.score)}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </section>

            <section className="rounded-2xl border border-neutral-200 bg-white p-4 shadow-sm min-w-0">
              <h2 className="text-base font-semibold">{COPY.repeatedTitle}</h2>
              <div className="mt-3">
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
                            <p className="mt-1 text-xs text-zinc-600 break-words whitespace-normal">{wp.action}</p>
                          ) : null}
                        </li>
                      ))}
                    </ul>
                    {weakPoints.length > 3 ? (
                      <button
                        type="button"
                        onClick={() => setWeakPointsExpanded((prev) => !prev)}
                        className="mt-2 text-xs text-zinc-600 underline"
                      >
                        {weakPointsExpanded ? "Vis færre" : "Vis alle"}
                      </button>
                    ) : null}
                  </>
                ) : (
                  <div className="text-sm text-zinc-600">
                    <p>Ingen strukturerede fejlmønstre endnu.</p>
                    <p className="text-xs">
                      (kommer automatisk, når vurderinger gemmer mere detaljeret feedback)
                    </p>
                  </div>
                )}
              </div>
            </section>

            <section className="rounded-2xl border border-neutral-200 bg-white p-4 shadow-sm min-w-0">
              <button
                type="button"
                onClick={() => setReadHereExpanded((prev) => !prev)}
                className="text-sm font-medium text-zinc-800 underline"
              >
                {readHereExpanded
                  ? `Skjul læseforslag (${readHereSuggestions.length})`
                  : `Vis læseforslag (${readHereSuggestions.length})`}
              </button>
              {readHereExpanded ? (
                <div className="mt-3 min-w-0">
                  <h2 className="text-base font-semibold">{COPY.readTitle}</h2>
                  {readHereSuggestions.length ? (
                    <ul className="mt-3 space-y-2">
                      {readHereSuggestions.map((ref) => (
                        <li
                          key={ref.chunk_id}
                          className="w-full rounded border border-neutral-200 bg-neutral-50 px-3 py-2 min-w-0"
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
                            {ref.practice_prompt || "Brug dette til at træne tekstbelæg/citater."}
                          </p>
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p className="mt-3 text-sm text-zinc-600">
                      Ingen teksthenvisninger endnu – kommer efter flere vurderinger med kilder.
                    </p>
                  )}
                </div>
              ) : null}
            </section>

            <section className="rounded-2xl border border-neutral-200 bg-white p-4 shadow-sm min-w-0">
              <h2 className="text-base font-semibold">{COPY.nextStepTitle}</h2>
              <p className="mt-2 text-sm leading-relaxed text-zinc-700 break-words whitespace-normal">
                {nextStep}
              </p>
              <p className="mt-2 text-sm text-zinc-600 break-words whitespace-normal">
                Hold én tydelig prioritet i næste svar, så forbedringen bliver målbar.
              </p>
              <div className="mt-3">
                <Link
                  href={`/traener?scope=${encodeURIComponent(folderId)}`}
                  className="inline-flex items-center justify-center rounded-full border border-neutral-300 px-4 py-2 text-sm font-medium text-black hover:bg-neutral-50"
                >
                  Start målrettet træning
                </Link>
              </div>
            </section>
          </div>

          <aside className="space-y-4 min-w-0 lg:sticky lg:top-6 lg:self-start">
            <section className="rounded-2xl border border-neutral-200 bg-white p-4 shadow-sm min-w-0">
              <h2 className="text-base font-semibold">Fokus nu</h2>
              <div className="mt-2">
                <span
                  className={`inline-flex rounded-full border px-2 py-1 text-[11px] font-medium ${focusBadgeClass(stats)}`}
                >
                  {focus}
                </span>
              </div>
              <p className="mt-2 text-sm leading-relaxed text-zinc-700 break-words whitespace-normal">
                Vælg dette fokus i de næste 1-2 svar, så du løfter både klarhed og faglig præcision.
              </p>
            </section>

            <section className="rounded-2xl border border-neutral-200 bg-white p-4 shadow-sm min-w-0">
              <h2 className="text-base font-semibold">Hurtige handlinger</h2>
              <div className="mt-3 flex flex-col gap-2">
                <Link
                  href={`/traener?scope=${encodeURIComponent(folderId)}`}
                  className="inline-flex items-center justify-center rounded-full border border-neutral-300 px-4 py-2 text-sm font-medium text-black hover:bg-neutral-50"
                >
                  Start træning
                </Link>
                <Link
                  href={`/traener/simulator?scope=${encodeURIComponent(folderId)}`}
                  className="inline-flex items-center justify-center rounded-full border border-neutral-200 px-4 py-2 text-sm text-zinc-700 hover:bg-neutral-50"
                >
                  Generér nyt spørgsmål
                </Link>
                <Link
                  href="/traener/overblik"
                  className="inline-flex items-center justify-center rounded-full border border-neutral-200 px-4 py-2 text-sm text-zinc-700 hover:bg-neutral-50"
                >
                  Tilbage til overblik
                </Link>
              </div>
            </section>

            <section className="rounded-2xl border border-neutral-200 bg-white p-4 shadow-sm min-w-0">
              <h2 className="text-base font-semibold">{COPY.writingTipsTitle}</h2>
              <ul className="mt-3 list-disc space-y-1 pl-5 text-sm text-zinc-700">
                <li>Vælg ét konkret tekststed til hver hovedpointe.</li>
                <li>Forklar kort hvorfor dit belæg understøtter din påstand.</li>
                <li>Slut af med en kort delkonklusion, før du går videre.</li>
              </ul>
            </section>
          </aside>
        </div>
      ) : null}
    </main>
  );
}
