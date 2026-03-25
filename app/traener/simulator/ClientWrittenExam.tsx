// app/traener/simulator/ClientWrittenExam.tsx
"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";

type ApiQuestion = { id: string; prompt: string };

type Question = {
  cid: string; // ✅ unik client-id (keys + answers)
  sourceId: string; // valgfri id fra API
  prompt: string;
};

type SubmitOverall = {
  grade: string; // "-3" | "00" | "02" | "4" | "7" | "10" | "12"
  summary: string;
  strengths: string[];
  improvements: string[];
};

type Props = {
  scopeFolderIds: string[];
  activeFolderId: string | null;
  trainingAreaSlotId?: string;
  isPro?: boolean;
};

type FocusMode = "normal" | "weakest";
type PlanStatus = "unknown" | "pro" | "nonpro";

function cx(...xs: Array<string | false | null | undefined>) {
  return xs.filter(Boolean).join(" ");
}

function pad2(n: number) {
  return n < 10 ? `0${n}` : `${n}`;
}

function formatMMSS(ms: number) {
  const s = Math.max(0, Math.floor(ms / 1000));
  const m = Math.floor(s / 60);
  const ss = s % 60;
  return `${m}:${pad2(ss)}`;
}

function clamp(n: number, min: number, max: number) {
  return Math.max(min, Math.min(max, n));
}

function makeCid() {
  try {
    return crypto.randomUUID();
  } catch {
    return `cid_${Date.now()}_${Math.random().toString(16).slice(2)}`;
  }
}

function pickQuestions(payload: any): ApiQuestion[] {
  const arr = payload?.questions ?? payload?.result?.questions ?? payload?.data?.questions;
  if (!Array.isArray(arr)) return [];
  const out: ApiQuestion[] = [];
  for (let i = 0; i < arr.length; i++) {
    const q = arr[i] ?? {};
    const id = String(q.id ?? `q${i + 1}`).trim();
    const prompt = String(q.prompt ?? q.question ?? "").trim();
    if (!prompt) continue;
    out.push({ id, prompt });
  }
  return out;
}

function ProgressRing({
  progress,
  size = 40,
  stroke = 4,
}: {
  progress: number; // 0..1
  size?: number;
  stroke?: number;
}) {
  const p = clamp(progress, 0, 1);
  const c = size / 2;
  const r = (size - stroke) / 2;
  const circ = 2 * Math.PI * r;
  const dashOffset = circ * (1 - p);

  return (
    <svg
      width={size}
      height={size}
      viewBox={`0 0 ${size} ${size}`}
      className="block"
      aria-hidden="true"
      shapeRendering="geometricPrecision"
    >
      <circle
        cx={c}
        cy={c}
        r={r}
        fill="none"
        stroke="rgb(228 228 231)" // zinc-200-ish
        strokeWidth={stroke}
        strokeLinecap="round"
        vectorEffect="non-scaling-stroke"
      />
      <circle
        cx={c}
        cy={c}
        r={r}
        fill="none"
        stroke="rgb(113 113 122)" // zinc-500-ish (grå)
        strokeWidth={stroke}
        strokeLinecap="round"
        strokeDasharray={circ}
        strokeDashoffset={dashOffset}
        transform={`rotate(-90 ${c} ${c})`}
        vectorEffect="non-scaling-stroke"
      />
    </svg>
  );
}

export default function ClientWrittenExam({ scopeFolderIds, activeFolderId, trainingAreaSlotId }: Props) {
  const [hydrated, setHydrated] = useState(false);
  const [planStatus, setPlanStatus] = useState<PlanStatus>("unknown");
  const requiresPro = planStatus === "nonpro";
  const isCheckingPro = planStatus === "unknown";
  const effectiveScopeFolderIds = useMemo(() => {
    const ids = new Set<string>();
    for (const id of scopeFolderIds ?? []) {
      const s = String(id ?? "").trim();
      if (s) ids.add(s);
    }
    if (activeFolderId) ids.add(String(activeFolderId));
    return Array.from(ids);
  }, [scopeFolderIds, activeFolderId]);
  const hasScope = effectiveScopeFolderIds.length > 0;

  const [durationMin, setDurationMin] = useState<20 | 40 | 60>(20);
  const [focusMode, setFocusMode] = useState<FocusMode>("normal");
  const durationMs = durationMin * 60 * 1000;
  const hasSelectedFolder = !!activeFolderId || effectiveScopeFolderIds.length === 1;
  const effectiveFocusMode: FocusMode = hasSelectedFolder ? focusMode : "normal";

  const [phase, setPhase] = useState<"idle" | "loading" | "running" | "submitting" | "done">("idle");
  const [questions, setQuestions] = useState<Question[]>([]);
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);

  // Result (kun overall vises)
  const [overall, setOverall] = useState<SubmitOverall | null>(null);

  // Timer
  const [now, setNow] = useState<number>(() => Date.now());
  const [startedAt, setStartedAt] = useState<number | null>(null);
  const [endAt, setEndAt] = useState<number | null>(null);

  // start timer først når spørgsmål er sat + renderet
  const pendingStartRef = useRef<number | null>(null);

  // prefetch 5 i baggrunden
  const [prefetchState, setPrefetchState] = useState<"idle" | "loading" | "ready">("idle");
  const [prefetched, setPrefetched] = useState<Question[]>([]);
  const prefetchAbortRef = useRef<AbortController | null>(null);
  const [trainingAreaSlotEl, setTrainingAreaSlotEl] = useState<HTMLElement | null>(null);

  // auto submit når tid er slut (kun én gang)
  const autoSubmitRef = useRef(false);

  useEffect(() => {
    setHydrated(true);
  }, []);

  useEffect(() => {
    let active = true;

    void (async () => {
      try {
        const res = await fetch(`/api/quota/current?ts=${Date.now()}`, { method: "GET", cache: "no-store" });
        const json = await res.json().catch(() => null);
        if (!active) return;
        const plan = String((json as any)?.plan ?? "").trim().toLowerCase();
        setPlanStatus(plan === "pro" ? "pro" : "nonpro");
      } catch {
        if (!active) return;
      }
    })();

    return () => {
      active = false;
    };
  }, []);

  const remainingMs = useMemo(() => {
    if ((phase !== "running" && phase !== "submitting" && phase !== "done") || !endAt) return durationMs;
    return Math.max(0, endAt - now);
  }, [phase, endAt, now, durationMs]);

  const elapsedProgress = useMemo(() => {
    if ((phase !== "running" && phase !== "submitting" && phase !== "done") || !startedAt) return 0;
    const elapsed = now - startedAt;
    return clamp(elapsed / durationMs, 0, 1);
  }, [phase, startedAt, now, durationMs]);

  useEffect(() => {
    if (requiresPro || isCheckingPro) return;
    if (phase !== "running" && phase !== "submitting") return;
    if (!endAt) return;
    const id = window.setInterval(() => setNow(Date.now()), 250);
    return () => window.clearInterval(id);
  }, [requiresPro, isCheckingPro, phase, endAt]);

  // Start timer efter spørgsmål er renderet
  useEffect(() => {
    if (phase !== "loading") return;
    if (!pendingStartRef.current) return;
    if (questions.length === 0) return;

    requestAnimationFrame(() => {
      const t = Date.now();
      setStartedAt(t);
      setEndAt(t + durationMs);
      setPhase("running");
      pendingStartRef.current = null;
      autoSubmitRef.current = false;
    });
  }, [phase, questions.length, durationMs]);

  // Start prefetch når vi er i gang
  useEffect(() => {
    if (phase !== "running") return;
    void ensurePrefetchReady();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase]);

  useEffect(() => {
    if (!trainingAreaSlotId || typeof document === "undefined") {
      setTrainingAreaSlotEl(null);
      return;
    }
    setTrainingAreaSlotEl(document.getElementById(trainingAreaSlotId));
  }, [trainingAreaSlotId]);

  // Auto-submit når tiden løber ud (hvis mindst 1 svar)
  useEffect(() => {
    if (phase !== "running") return;
    if (remainingMs > 0) return;
    if (autoSubmitRef.current) return;

    const answeredCount = questions.reduce(
      (acc, q) => acc + (String(answers[q.cid] ?? "").trim().length > 0 ? 1 : 0),
      0,
    );

    autoSubmitRef.current = true;

    if (answeredCount === 0) {
      setPhase("done");
      return;
    }

    void onSubmit(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase, remainingMs]);

  function currentAvoidPrompts(extra?: Question[]) {
    const base = questions.map((q) => q.prompt);
    const ex = (extra ?? []).map((q) => q.prompt);
    return [...base, ...ex].slice(0, 60);
  }

  async function generate(count: number, opts?: { signal?: AbortSignal; avoidPrompts?: string[] }): Promise<Question[]> {
    if (requiresPro || isCheckingPro) return [];
    const avoidPrompts = opts?.avoidPrompts ?? currentAvoidPrompts();

    const res = await fetch("/api/exam/generate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      signal: opts?.signal,
      body: JSON.stringify({
        count,
        scopeFolderIds: effectiveScopeFolderIds,
        folderId: activeFolderId ?? null,
        focusMode: effectiveFocusMode,
        avoidQuestions: avoidPrompts,
      }),
    });

    const json = await res.json().catch(() => ({}));
    if (!res.ok || json?.ok === false) {
      throw new Error(String(json?.error ?? `HTTP ${res.status}`));
    }

    const apiQs = pickQuestions(json);
    if (!apiQs.length) throw new Error("Ingen spørgsmål fra API.");

    // ✅ unik cid pr spørgsmål (forhindrer “answers hopper”)
    return apiQs.map((q) => ({
      cid: makeCid(),
      sourceId: q.id,
      prompt: q.prompt,
    }));
  }

  function resetAll() {
    prefetchAbortRef.current?.abort();
    prefetchAbortRef.current = null;

    setPhase("idle");
    setQuestions([]);
    setAnswers({});
    setError(null);
    setOverall(null);

    setStartedAt(null);
    setEndAt(null);
    setNow(Date.now());

    pendingStartRef.current = null;

    setPrefetchState("idle");
    setPrefetched([]);
    autoSubmitRef.current = false;
  }

  async function onStart() {
    if (phase !== "idle") return;
    if (requiresPro || isCheckingPro) return;
    if (!hasScope) {
      setError("Vælg en mappe før du starter eksamen.");
      return;
    }

    prefetchAbortRef.current?.abort();
    prefetchAbortRef.current = null;

    setError(null);
    setOverall(null);

    setPhase("loading");
    setQuestions([]);
    setAnswers({});

    setStartedAt(null);
    setEndAt(null);
    setNow(Date.now());

    setPrefetchState("idle");
    setPrefetched([]);
    autoSubmitRef.current = false;

    try {
      const qs = await generate(10);

      // de-dupe på prompt
      const seen = new Set<string>();
      const cleaned = qs.filter((q) => {
        const k = q.prompt.trim().toLowerCase();
        if (seen.has(k)) return false;
        seen.add(k);
        return true;
      });

      setQuestions(cleaned);

      // timer først efter render
      pendingStartRef.current = Date.now();
    } catch (e: any) {
      setPhase("idle");
      setError(e?.message ?? "Kunne ikke starte eksamen.");
    }
  }

  async function ensurePrefetchReady() {
    if (requiresPro || isCheckingPro) return;
    if (phase !== "running") return;
    if (prefetchState === "loading" || prefetchState === "ready") return;

    setPrefetchState("loading");
    setPrefetched([]);

    prefetchAbortRef.current?.abort();
    const ac = new AbortController();
    prefetchAbortRef.current = ac;

    try {
      const more = await generate(5, {
        signal: ac.signal,
        avoidPrompts: currentAvoidPrompts(),
      });

      const existingPrompts = new Set(questions.map((q) => q.prompt.trim().toLowerCase()));
      const cleaned = more.filter((q) => !existingPrompts.has(q.prompt.trim().toLowerCase()));

      setPrefetched(cleaned);
      setPrefetchState("ready");
    } catch {
      setPrefetchState("idle");
      setPrefetched([]);
    } finally {
      if (prefetchAbortRef.current === ac) prefetchAbortRef.current = null;
    }
  }

  async function onAddMore() {
    if (requiresPro || isCheckingPro) return;
    if (phase !== "running") return;

    // hvis ikke klar endnu: prøv at hente (best effort)
    if (prefetchState !== "ready") {
      setError(null);
      await ensurePrefetchReady();
      return;
    }

    setError(null);

    const more = prefetched;
    if (!more.length) {
      setPrefetchState("idle");
      await ensurePrefetchReady();
      return;
    }

    // append + ryd buffer + start næste prefetch
    setQuestions((prev) => {
      const existing = new Set(prev.map((q) => q.prompt.trim().toLowerCase()));
      const cleaned = more.filter((q) => !existing.has(q.prompt.trim().toLowerCase()));
      return cleaned.length ? [...prev, ...cleaned] : prev;
    });

    setPrefetchState("idle");
    setPrefetched([]);
    void ensurePrefetchReady();
  }

  function setAnswer(cid: string, v: string) {
    setAnswers((prev) => ({ ...prev, [cid]: v }));
  }

  async function onSubmit(isAuto = false) {
    if (requiresPro || isCheckingPro) return;
    if (phase !== "running") return;

    const answeredCount = questions.reduce(
      (acc, q) => acc + (String(answers[q.cid] ?? "").trim().length > 0 ? 1 : 0),
      0,
    );

    if (!isAuto && answeredCount === 0) {
      setError("Skriv mindst ét svar før du afleverer.");
      return;
    }

    setError(null);
    setPhase("submitting");

    const ended = Date.now();
    setEndAt(ended);
    setNow(ended);

    try {
      const res = await fetch("/api/exam/submit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          mode: "written",
          includeBackground: true, // ✅ skjult i UI, men aktivt i backend
          durationMin,
          startedAt,
          endedAt: ended,

          scopeFolderIds: effectiveScopeFolderIds,
          folderId: activeFolderId ?? null,

          // ✅ send cid som id så answers matcher 1:1
          questions: questions.map((q) => ({ id: q.cid, prompt: q.prompt })),
          answers,
        }),
      });

      const json = await res.json().catch(() => ({}));
      if (!res.ok || json?.ok === false) {
        throw new Error(String(json?.error ?? `HTTP ${res.status}`));
      }

      const o = json?.result?.overall;
      if (!o?.grade || !o?.summary) throw new Error("Uventet svarformat fra /api/exam/submit");

      setOverall({
        grade: String(o.grade),
        summary: String(o.summary ?? ""),
        strengths: Array.isArray(o.strengths) ? o.strengths.map(String) : [],
        improvements: Array.isArray(o.improvements) ? o.improvements.map(String) : [],
      });

      // ✅ trigger sidebar refresh (Seneste runder) uden hard refresh
      if (typeof window !== "undefined") {
        window.dispatchEvent(new Event("notely:simulator-updated"));
        window.dispatchEvent(new Event("notely:exam-updated"));
      }

      setPhase("done");
    } catch (e: any) {
      setPhase("running");
      setError(e?.message ?? "Kunne ikke aflevere.");
    }
  }

  const controlsLocked = requiresPro || isCheckingPro;
  const canStart = phase === "idle";
  const isLoading = phase === "loading";
  const isRunning = phase === "running";
  const isSubmitting = phase === "submitting";
  const isDone = phase === "done";

  const tabBtn = (active: boolean) =>
    cx(
      "px-3 py-2 text-sm border border-zinc-200",
      active ? "bg-zinc-100 text-zinc-900" : "bg-white text-zinc-900 hover:bg-zinc-50",
    );

  const actionBtn =
    "rounded-xl border border-zinc-200 bg-zinc-100 px-4 py-2 text-sm font-medium text-zinc-900 hover:bg-zinc-200";

  const disabledBtn = "rounded-xl border border-zinc-200 bg-white px-4 py-2 text-sm text-zinc-500";

  const addMoreText =
    prefetchState === "ready" ? "Tilføj 5 flere" : prefetchState === "loading" ? "Forbereder 5…" : "Tilføj 5 flere";

  const addMoreDisabled = prefetchState !== "ready";
  useEffect(() => {
    if (!controlsLocked) return;
    setError(null);
  }, [controlsLocked]);
  const trainingAreaControls =
    phase === "idle" ? (
      <>
        <div className="mt-2 flex items-center justify-end">
          {effectiveFocusMode === "weakest" ? (
            <span className="rounded-full border border-zinc-300 px-2 py-[1px] text-[10px] font-medium text-zinc-700">
              Målrettet
            </span>
          ) : null}
        </div>
        <label className="mt-2 flex items-start gap-2 text-xs text-zinc-700">
          <input
            type="checkbox"
            checked={effectiveFocusMode === "weakest"}
            onChange={(e) => setFocusMode(e.target.checked ? "weakest" : "normal")}
            disabled={!hasSelectedFolder}
            className="mt-[2px] h-4 w-4 rounded border-zinc-300 accent-black disabled:cursor-not-allowed disabled:opacity-50"
          />
          <span>
            <span className="block">Træn på mine svage punkter</span>
            <span className="text-zinc-500">Bruger seneste vurderinger i valgt mappe.</span>
          </span>
        </label>
      </>
    ) : null;

  return (
    <section className="space-y-4">
      {trainingAreaSlotEl && trainingAreaControls ? createPortal(trainingAreaControls, trainingAreaSlotEl) : null}

      {/* Sticky timer + actions */}
      <div className="sticky top-4 z-10">
        <section className="rounded-2xl border border-zinc-200 bg-white p-4 shadow-sm">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-3">
              <div className="shrink-0">
                <ProgressRing progress={isRunning || isSubmitting || isDone ? elapsedProgress : 0} />
              </div>

              <div>
                <div className="text-xs text-zinc-600">Tid tilbage</div>
                <div className="text-lg font-semibold text-zinc-900">
                  {isRunning || isSubmitting || isDone ? formatMMSS(remainingMs) : `${durationMin}:00`}
                </div>
              </div>
            </div>

            <div className="flex items-center gap-2">

              {/* Varighed (kun før start) */}
              {phase === "idle" && (
                <div className="mr-2 inline-flex overflow-hidden rounded-xl bg-white">
                  {[20, 40, 60].map((m) => {
                    const active = durationMin === m;
                    return (
                      <button
                        key={m}
                        type="button"
                        onClick={() => setDurationMin(m as 20 | 40 | 60)}
                        disabled={controlsLocked}
                        className={cx(
                          tabBtn(active),
                          m !== 20 && "border-l-0",
                          m === 20 && "rounded-l-xl",
                          m === 60 && "rounded-r-xl",
                          controlsLocked && "cursor-not-allowed text-zinc-500",
                        )}
                      >
                        {m} min
                      </button>
                    );
                  })}
                </div>
              )}

              {canStart && (
                <button
                  type="button"
                  onClick={onStart}
                  disabled={controlsLocked || !hasScope}
                  className={`${actionBtn} disabled:cursor-not-allowed disabled:bg-white disabled:text-zinc-500`}
                >
                  Start
                </button>
              )}

              {isLoading && (
                <button type="button" disabled className={disabledBtn}>
                  Genererer…
                </button>
              )}

              {isRunning && (
                <button type="button" onClick={() => onSubmit(false)} className={actionBtn}>
                  Aflever
                </button>
              )}

              {isSubmitting && (
                <button type="button" disabled className={disabledBtn}>
                  Afgiver…
                </button>
              )}

              {isDone && (
                <button type="button" onClick={resetAll} className={actionBtn}>
                  Prøv igen
                </button>
              )}
            </div>
          </div>

          {isCheckingPro ? (
              <div className="mt-3 rounded-xl border border-zinc-200 bg-white px-3 py-2">
                <p className="text-sm text-zinc-600">Tjekker abonnement...</p>
              </div>
            ) : hydrated && requiresPro ? (
              <div className="mt-3 rounded-xl border border-zinc-200 bg-white px-3 py-2">
                <p className="text-sm font-medium text-zinc-800">Kræver Pro</p>
                <p className="mt-0.5 text-sm text-zinc-600">Opgradér for at starte eksamen.</p>
              </div>
            ) : error ? (
              <p className="mt-3 text-sm text-red-600">Fejl: {error}</p>
            ) : !hasScope ? (
              <p className="mt-3 text-sm text-zinc-600">Vælg en mappe ovenfor før du starter eksamen.</p>
            ) : null}
        </section>
      </div>

      {/* Spørgsmål */}
      {questions.length === 0 && phase !== "loading" && (
        <section className="rounded-2xl border border-zinc-200 bg-white p-4 text-sm text-zinc-600 shadow-sm">
          Tryk <span className="font-medium">Start</span> for at få dit første opgavesæt.
        </section>
      )}

      {questions.map((q, idx) => (
        <section key={q.cid} className="rounded-2xl border border-zinc-200 bg-white p-4 shadow-sm">
          <div className="text-xs font-semibold text-zinc-600">Spørgsmål {idx + 1}</div>
          <div className="mt-1 text-sm font-semibold text-zinc-900">{q.prompt}</div>

          <label className="mt-4 block text-sm font-medium text-zinc-900">Dit svar</label>
          <textarea
            value={answers[q.cid] ?? ""}
            onChange={(e) => setAnswer(q.cid, e.target.value)}
            placeholder="Skriv dit svar her…"
            className="mt-2 min-h-[160px] w-full rounded-xl border border-zinc-300 bg-white px-3 py-2 text-sm outline-none focus:border-zinc-500"
          />
        </section>
      ))}

      {/* “Tilføj 5 flere” under sidste spørgsmål */}
      {isRunning && questions.length > 0 && remainingMs > 0 && (
        <div className="flex justify-end">
          <button
            type="button"
            onClick={onAddMore}
            disabled={addMoreDisabled}
            className={cx(
              "rounded-xl border border-zinc-200 px-4 py-2 text-sm text-zinc-900",
              addMoreDisabled ? "bg-white opacity-60" : "bg-white hover:bg-zinc-50",
            )}
          >
            {addMoreText}
          </button>
        </div>
      )}

      {/* Resultat: KUN overall */}
      {overall && (
        <section className="rounded-2xl border border-zinc-200 bg-white p-4 shadow-sm">
          <div className="flex items-start justify-between gap-4">
            <div>
              <div className="text-xs font-semibold text-zinc-600">Samlet karakter</div>
              <div className="mt-1 text-2xl font-semibold text-zinc-900">{overall.grade}</div>
            </div>
          </div>

          <div className="mt-3 whitespace-pre-wrap text-sm text-zinc-700">{overall.summary}</div>

          {(overall.strengths?.length ?? 0) > 0 && (
            <div className="mt-4">
              <div className="text-xs font-semibold text-zinc-600">Styrker</div>
              <ul className="mt-2 list-disc pl-5 text-sm text-zinc-700">
                {overall.strengths.slice(0, 6).map((s, i) => (
                  <li key={`s-${i}`}>{s}</li>
                ))}
              </ul>
            </div>
          )}

          {(overall.improvements?.length ?? 0) > 0 && (
            <div className="mt-4">
              <div className="text-xs font-semibold text-zinc-600">Forbedringer</div>
              <ul className="mt-2 list-disc pl-5 text-sm text-zinc-700">
                {overall.improvements.slice(0, 6).map((s, i) => (
                  <li key={`i-${i}`}>{s}</li>
                ))}
              </ul>
            </div>
          )}
        </section>
      )}
    </section>
  );
}
