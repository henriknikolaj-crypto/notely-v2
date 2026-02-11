"use client";

import { useEffect, useMemo, useRef, useState } from "react";

type Grade = "-3" | "00" | "02" | "4" | "7" | "10" | "12";
type Segment = { start: number; end: number; text: string };
type Phase = "idle" | "speaking" | "recording" | "processing" | "done";

type Turn = {
  questionText: string;
  answerTranscript: {
    text: string;
    segments: Segment[];
  };
};

type SubmitResult = {
  grade: Grade;
  score?: number;
  summary: string;
  strengths: string[];
  improvements: string[];
  transcript: {
    text: string;
    segments: Segment[];
  };
};

type Props = {
  scopeFolderIds: string[];
  activeFolderId: string | null;
};

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

function makeSessionId() {
  try {
    return crypto.randomUUID();
  } catch {
    return `oral_${Date.now()}_${Math.random().toString(16).slice(2)}`;
  }
}

function pickMimeType() {
  const preferred = ["audio/webm;codecs=opus", "audio/webm", "audio/ogg;codecs=opus", "audio/ogg"];
  if (typeof MediaRecorder === "undefined") return "";
  return preferred.find((type) => MediaRecorder.isTypeSupported?.(type)) ?? "";
}

function b64ToBlob(base64: string, mime: string) {
  const binary = atob(base64);
  const len = binary.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) bytes[i] = binary.charCodeAt(i);
  return new Blob([bytes], { type: mime });
}

function ProgressRing({
  progress,
  size = 40,
  stroke = 4,
}: {
  progress: number;
  size?: number;
  stroke?: number;
}) {
  const p = clamp(progress, 0, 1);
  const c = size / 2;
  const r = (size - stroke) / 2;
  const circ = 2 * Math.PI * r;
  const dashOffset = circ * (1 - p);

  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="block" aria-hidden="true">
      <circle cx={c} cy={c} r={r} fill="none" stroke="rgb(228 228 231)" strokeWidth={stroke} strokeLinecap="round" />
      <circle
        cx={c}
        cy={c}
        r={r}
        fill="none"
        stroke="rgb(113 113 122)"
        strokeWidth={stroke}
        strokeLinecap="round"
        strokeDasharray={circ}
        strokeDashoffset={dashOffset}
        transform={`rotate(-90 ${c} ${c})`}
      />
    </svg>
  );
}

export default function ClientOralExam({ scopeFolderIds, activeFolderId }: Props) {
  const [durationMin, setDurationMin] = useState<20 | 40 | 60>(20);
  const durationMs = durationMin * 60 * 1000;

  const [phase, setPhase] = useState<Phase>("idle");
  const [error, setError] = useState<string | null>(null);
  const [notes, setNotes] = useState("");

  const [now, setNow] = useState<number>(() => Date.now());
  const [startedAt, setStartedAt] = useState<number | null>(null);
  const [endAt, setEndAt] = useState<number | null>(null);

  const [sessionId, setSessionId] = useState<string | null>(null);
  const [turnIndex, setTurnIndex] = useState(0);
  const [turns, setTurns] = useState<Turn[]>([]);
  const [submitted, setSubmitted] = useState<SubmitResult | null>(null);

  const currentQuestionRef = useRef<string>("");
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const audioUrlRef = useRef<string | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const chunksRef = useRef<BlobPart[]>([]);
  const mimeType = useMemo(() => pickMimeType(), []);
  const busyRef = useRef(false);

  const remainingMs = useMemo(() => {
    if (!endAt) return durationMs;
    return Math.max(0, endAt - now);
  }, [durationMs, endAt, now]);

  const elapsedProgress = useMemo(() => {
    if (!startedAt) return 0;
    const elapsed = now - startedAt;
    return clamp(elapsed / durationMs, 0, 1);
  }, [durationMs, now, startedAt]);

  const effectiveScopeFolderIds = useMemo(() => {
    const ids = new Set<string>();
    for (const id of scopeFolderIds ?? []) {
      const s = String(id ?? "").trim();
      if (s) ids.add(s);
    }
    if (activeFolderId) ids.add(String(activeFolderId));
    return Array.from(ids);
  }, [scopeFolderIds, activeFolderId]);

  useEffect(() => {
    if (!startedAt || !endAt) return;
    const id = window.setInterval(() => setNow(Date.now()), 250);
    return () => window.clearInterval(id);
  }, [startedAt, endAt]);

  useEffect(() => {
    if (remainingMs > 0) return;
    if (busyRef.current) return;
    if (submitted) return;
    if (phase === "recording") {
      void onStopTurn(true);
      return;
    }
    if (turns.length > 0) {
      void onSubmitExam();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [remainingMs, phase, turns.length, submitted]);

  useEffect(() => {
    return () => {
      cleanupPlayback();
      cleanupRecording();
    };
  }, []);

  function cleanupPlayback() {
    try {
      if (audioRef.current) {
        audioRef.current.pause();
        audioRef.current.onended = null;
        audioRef.current.onerror = null;
      }
      audioRef.current = null;
      if (audioUrlRef.current) URL.revokeObjectURL(audioUrlRef.current);
      audioUrlRef.current = null;
    } catch {
      // ignore
    }
  }

  function cleanupRecording() {
    try {
      recorderRef.current = null;
      chunksRef.current = [];
      streamRef.current?.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    } catch {
      // ignore
    }
  }

  async function ensureMicStream() {
    if (streamRef.current) return streamRef.current;
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    streamRef.current = stream;
    return stream;
  }

  async function startRecorder() {
    const stream = await ensureMicStream();
    chunksRef.current = [];
    const mr = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
    mr.ondataavailable = (e) => {
      if (e.data && e.data.size > 0) chunksRef.current.push(e.data);
    };
    recorderRef.current = mr;
    mr.start();
    setPhase("recording");
  }

  function stopRecorder(): Promise<Blob> {
    return new Promise((resolve, reject) => {
      const mr = recorderRef.current;
      if (!mr) {
        reject(new Error("Ingen aktiv optagelse."));
        return;
      }
      mr.onstop = () => {
        try {
          const blob = new Blob(chunksRef.current, { type: mr.mimeType || "audio/webm" });
          recorderRef.current = null;
          streamRef.current?.getTracks().forEach((t) => t.stop());
          streamRef.current = null;
          chunksRef.current = [];
          resolve(blob);
        } catch (e) {
          reject(e);
        }
      };
      try {
        mr.stop();
      } catch (e) {
        reject(e);
      }
    });
  }

  function historyForApi() {
    const out: Array<{ role: "assistant" | "user"; text: string }> = [];
    for (const t of turns) {
      if (t.questionText) out.push({ role: "assistant", text: t.questionText });
      if (t.answerTranscript.text) out.push({ role: "user", text: t.answerTranscript.text });
    }
    return out.slice(-10);
  }

  async function fetchAndPlayQuestion(session: string, nextTurnIndex: number) {
    setPhase("processing");
    const res = await fetch("/api/oral/next-question", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        scopeFolderIds: effectiveScopeFolderIds,
        folderId: activeFolderId ?? null,
        history: historyForApi(),
        turnIndex: nextTurnIndex,
      }),
    });
    const json = (await res.json().catch(() => null)) as
      | {
          ok: true;
          questionText: string;
          audioBase64: string;
          mime: string;
        }
      | { ok: false; error?: string }
      | null;
    if (!res.ok || !json || json.ok !== true) {
      throw new Error(String((json as any)?.error ?? "Kunne ikke hente næste spørgsmål."));
    }

    const okJson = json;
    currentQuestionRef.current = okJson.questionText;
    const blob = b64ToBlob(okJson.audioBase64, okJson.mime || "audio/mpeg");
    cleanupPlayback();
    const url = URL.createObjectURL(blob);
    audioUrlRef.current = url;
    const audio = new Audio(url);
    audioRef.current = audio;

    setSessionId(session);
    setTurnIndex(nextTurnIndex);
    setPhase("speaking");

    await new Promise<void>((resolve, reject) => {
      audio.onended = () => resolve();
      audio.onerror = () => reject(new Error("Kunne ikke afspille spørgsmålslyd."));
      const p = audio.play();
      if (p && typeof p.then === "function") p.catch(() => reject(new Error("Autoplay blev blokeret af browseren.")));
    });
  }

  async function startTurn(nextTurnIndex: number) {
    if (!sessionId) return;
    setError(null);
    await fetchAndPlayQuestion(sessionId, nextTurnIndex);
    await startRecorder();
  }

  async function onStart() {
    if (phase !== "idle") return;
    if (typeof navigator === "undefined" || !navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === "undefined") {
      setError("Din browser understøtter ikke mikrofon-optagelse.");
      return;
    }
    const t0 = Date.now();
    const sid = makeSessionId();
    setSessionId(sid);
    setTurns([]);
    setSubmitted(null);
    setStartedAt(t0);
    setEndAt(t0 + durationMs);
    setNow(t0);
    setTurnIndex(0);
    setError(null);
    try {
      await startTurn(0);
    } catch (e: any) {
      setPhase("idle");
      setError(e?.message ?? "Kunne ikke starte mundtlig eksamen.");
      cleanupPlayback();
      cleanupRecording();
    }
  }

  async function transcribeTurn(audioBlob: Blob) {
    const ext = audioBlob.type.includes("ogg") ? "ogg" : "webm";
    const file = new File([audioBlob], `oral-${Date.now()}.${ext}`, {
      type: audioBlob.type || `audio/${ext}`,
    });
    const fd = new FormData();
    fd.append("audio", file);
    fd.append("language", "da");
    const res = await fetch("/api/oral/transcribe-turn", { method: "POST", body: fd });
    const json = (await res.json().catch(() => null)) as
      | { ok: true; transcript: { text: string; segments: Segment[] } }
      | { ok: false; error?: string }
      | null;
    if (!res.ok || !json || json.ok !== true) {
      throw new Error(String((json as any)?.error ?? "Transskription fejlede."));
    }
    return json.transcript;
  }

  async function onStopTurn(autoSubmitAfter = false) {
    if (phase !== "recording") return;
    if (busyRef.current) return;
    busyRef.current = true;
    setPhase("processing");
    setError(null);
    try {
      const audioBlob = await stopRecorder();
      if (!audioBlob.size) throw new Error("Der blev ikke optaget lyd.");

      const transcript = await transcribeTurn(audioBlob);
      const nextTurns = [
        ...turns,
        {
          questionText: currentQuestionRef.current,
          answerTranscript: transcript,
        },
      ] as Turn[];
      setTurns(nextTurns);
      setPhase("done");

      if (autoSubmitAfter || remainingMs <= 0) {
        await submitExam(nextTurns);
      }
    } catch (e: any) {
      setPhase("done");
      setError(e?.message ?? "Kunne ikke stoppe turn.");
    } finally {
      busyRef.current = false;
    }
  }

  async function submitExam(turnsToSubmit: Turn[]) {
    if (!startedAt) throw new Error("Mangler starttidspunkt.");
    if (!turnsToSubmit.length) throw new Error("Ingen turns at aflevere.");
    setPhase("processing");
    const res = await fetch("/api/oral/submit", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        durationMin,
        startedAt,
        endedAt: Date.now(),
        folderId: activeFolderId ?? null,
        scopeFolderIds: effectiveScopeFolderIds,
        notes: notes || null,
        turns: turnsToSubmit,
      }),
    });
    const json = (await res.json().catch(() => null)) as
      | { ok: true; result: SubmitResult }
      | { ok: false; error?: string }
      | null;
    if (!res.ok || !json || json.ok !== true) {
      throw new Error(String((json as any)?.error ?? "Aflevering fejlede."));
    }
    setSubmitted(json.result);
    setPhase("done");

    window.dispatchEvent(new Event("notely:exam-updated"));
    window.dispatchEvent(new Event("notely:simulator-updated"));
  }

  async function onSubmitExam() {
    if (!turns.length) return;
    if (busyRef.current) return;
    busyRef.current = true;
    setError(null);
    try {
      await submitExam(turns);
    } catch (e: any) {
      setPhase("done");
      setError(e?.message ?? "Kunne ikke aflevere eksamen.");
    } finally {
      busyRef.current = false;
    }
  }

  async function onNext() {
    if (phase !== "done" || submitted) return;
    if (remainingMs <= 0) {
      await onSubmitExam();
      return;
    }
    if (!sessionId) return;
    if (busyRef.current) return;
    busyRef.current = true;
    try {
      await startTurn(turnIndex + 1);
    } catch (e: any) {
      setPhase("done");
      setError(e?.message ?? "Kunne ikke hente næste spørgsmål.");
    } finally {
      busyRef.current = false;
    }
  }

  function onReset() {
    cleanupPlayback();
    cleanupRecording();
    setPhase("idle");
    setError(null);
    setNotes("");
    setNow(Date.now());
    setStartedAt(null);
    setEndAt(null);
    setSessionId(null);
    setTurnIndex(0);
    setTurns([]);
    setSubmitted(null);
    currentQuestionRef.current = "";
  }

  const micBgClass =
    phase === "speaking"
      ? "bg-red-500"
      : phase === "recording"
        ? "bg-emerald-500"
        : phase === "processing"
          ? "bg-zinc-300"
          : "bg-[#fffef9]";

  const tabBtn = (active: boolean) =>
    cx(
      "px-3 py-2 text-sm border border-zinc-200",
      active ? "bg-zinc-100 text-zinc-900" : "bg-white text-zinc-900 hover:bg-zinc-50",
    );

  const canShowTurnActions = phase === "done" && !submitted && turns.length > 0;

  return (
    <section className="space-y-4">
      <div className="sticky top-4 z-10 space-y-3">
        <section className="rounded-2xl border border-zinc-200 bg-white p-4 shadow-sm">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-3">
              <div className="shrink-0">
                <ProgressRing progress={startedAt ? elapsedProgress : 0} />
              </div>
              <div>
                <div className="text-xs text-zinc-600">Tid tilbage</div>
                <div className="text-lg font-semibold text-zinc-900">{formatMMSS(remainingMs)}</div>
              </div>
            </div>

            <div className="flex items-center gap-2">
              {phase === "idle" && (
                <div className="mr-2 inline-flex overflow-hidden rounded-xl bg-white">
                  {[20, 40, 60].map((m) => (
                    <button
                      key={m}
                      type="button"
                      onClick={() => setDurationMin(m as 20 | 40 | 60)}
                      className={cx(
                        tabBtn(durationMin === m),
                        m !== 20 && "border-l-0",
                        m === 20 && "rounded-l-xl",
                        m === 60 && "rounded-r-xl",
                      )}
                    >
                      {m} min
                    </button>
                  ))}
                </div>
              )}

              {phase === "idle" && (
                <button
                  type="button"
                  onClick={onStart}
                  className="rounded-xl border border-zinc-200 bg-zinc-100 px-4 py-2 text-sm font-medium text-zinc-900 hover:bg-zinc-200"
                >
                  Start
                </button>
              )}

              {phase === "recording" && (
                <button
                  type="button"
                  onClick={() => void onStopTurn(false)}
                  className="rounded-xl border border-zinc-200 bg-zinc-100 px-4 py-2 text-sm font-medium text-zinc-900 hover:bg-zinc-200"
                >
                  Stop
                </button>
              )}

              {phase === "processing" && (
                <button
                  type="button"
                  disabled
                  className="rounded-xl border border-zinc-200 bg-white px-4 py-2 text-sm text-zinc-500"
                >
                  Behandler...
                </button>
              )}

              {canShowTurnActions && (
                <>
                  <button
                    type="button"
                    onClick={() => void onNext()}
                    className="rounded-xl border border-zinc-200 bg-zinc-100 px-4 py-2 text-sm font-medium text-zinc-900 hover:bg-zinc-200"
                  >
                    Næste
                  </button>
                  <button
                    type="button"
                    onClick={() => void onSubmitExam()}
                    className="rounded-xl border border-zinc-200 bg-zinc-100 px-4 py-2 text-sm font-medium text-zinc-900 hover:bg-zinc-200"
                  >
                    Aflever
                  </button>
                </>
              )}

              {(phase === "done" || phase === "idle") && (
                <button
                  type="button"
                  onClick={onReset}
                  className="rounded-xl border border-zinc-200 bg-white px-4 py-2 text-sm text-zinc-900 hover:bg-zinc-50"
                >
                  Nulstil
                </button>
              )}
            </div>
          </div>
        </section>

        <section className="rounded-2xl border border-zinc-200 bg-white p-4 shadow-sm">
          <div className="grid grid-cols-[minmax(180px,1fr)_minmax(220px,1fr)] gap-4">
            <div className="flex min-h-[180px] items-end justify-end p-2">
              <div
                className={cx(
                  "flex h-28 w-28 items-center justify-center rounded-full border border-zinc-900 transition-colors",
                  micBgClass,
                )}
                aria-label="Mikrofonstatus"
              >
                <svg width="48" height="48" viewBox="0 0 24 24" fill="none" aria-hidden>
                  <rect x="8" y="3" width="8" height="12" rx="4" stroke="currentColor" strokeWidth="1.8" />
                  <path d="M6 11.5V12a6 6 0 0 0 12 0v-.5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
                  <path d="M12 18v3" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
                  <path d="M9 21h6" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
                </svg>
              </div>
            </div>

            <div>
              <label className="text-xs font-semibold text-zinc-700">Noter</label>
              <textarea
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="Noter"
                rows={4}
                className="mt-2 w-full rounded-xl border border-zinc-300 bg-white px-3 py-2 text-sm outline-none focus:border-zinc-500"
              />
            </div>
          </div>
        </section>
      </div>

      {error && (
        <section className="rounded-2xl border border-red-200 bg-white p-4 text-sm text-red-700 shadow-sm">{error}</section>
      )}

      {submitted && (
        <>
          <section className="rounded-2xl border border-zinc-200 bg-white p-4 shadow-sm">
            <div className="flex items-start justify-between gap-3">
              <div>
                <div className="text-sm font-semibold text-zinc-800">Resultat</div>
                <div className="text-xs text-zinc-500">Karakter og feedback</div>
              </div>
              <div className="rounded-xl border border-zinc-200 px-3 py-2 text-sm text-zinc-900">
                Karakter: <span className="font-semibold">{submitted.grade}</span>
                {typeof submitted.score === "number" ? <span className="ml-2 text-zinc-500">({Math.round(submitted.score)}%)</span> : null}
              </div>
            </div>

            <div className="mt-3 whitespace-pre-wrap rounded-xl border border-zinc-200 bg-white p-3 text-sm text-zinc-800">
              {submitted.summary}
              {submitted.strengths.length > 0 ? `\n\nStyrker:\n- ${submitted.strengths.join("\n- ")}` : ""}
              {submitted.improvements.length > 0 ? `\n\nForbedringer:\n- ${submitted.improvements.join("\n- ")}` : ""}
            </div>
          </section>

          <details className="rounded-2xl border border-zinc-200 bg-white p-4 shadow-sm">
            <summary className="cursor-pointer text-sm font-semibold text-zinc-800">Afskrift</summary>
            <div className="mt-3 space-y-2">
              {submitted.transcript.segments.length > 0 ? (
                submitted.transcript.segments.map((segment, i) => (
                  <div key={`${segment.start}-${i}`} className="rounded-xl border border-zinc-200 bg-white p-3 text-sm">
                    <div className="text-xs text-zinc-500">
                      {formatMMSS(segment.start * 1000)} - {formatMMSS(segment.end * 1000)}
                    </div>
                    <div className="mt-1 text-zinc-800">{segment.text}</div>
                  </div>
                ))
              ) : (
                <div className="rounded-xl border border-zinc-200 bg-white p-3 text-sm text-zinc-800">
                  {submitted.transcript.text}
                </div>
              )}
            </div>
          </details>
        </>
      )}
    </section>
  );
}
