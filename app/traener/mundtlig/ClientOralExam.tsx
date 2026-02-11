"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { MicStatusIcon } from "./MicStatusIcon";

type Grade = "-3" | "00" | "02" | "4" | "7" | "10" | "12";
type Segment = { start: number; end: number; text: string };
type MicState = "idle" | "thinking" | "speaking" | "listening" | "evaluating";
type Phase = "idle" | "thinking" | "speaking" | "listening" | "evaluating" | "done";

type Turn = {
  questionText: string;
  transcriptText: string;
  notes?: string;
  kind?: "followup" | "new";
  threadId?: string | null;
  followupCount?: number;
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

type NextQuestionOk = {
  ok: true;
  kind: "followup" | "new";
  threadId: string;
  followupCount: number;
  questionText: string;
  audioBase64: string;
  mime: string;
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
  const [threadId, setThreadId] = useState<string | null>(null);
  const [followupCount, setFollowupCount] = useState(0);
  const [turns, setTurns] = useState<Turn[]>([]);
  const [submitted, setSubmitted] = useState<SubmitResult | null>(null);

  const currentQuestionRef = useRef<string>("");
  const currentQuestionKindRef = useRef<"followup" | "new">("new");
  const currentThreadIdRef = useRef<string | null>(null);
  const currentFollowupCountRef = useRef(0);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const audioUrlRef = useRef<string | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const chunksRef = useRef<BlobPart[]>([]);
  const vadContextRef = useRef<AudioContext | null>(null);
  const vadFrameRef = useRef<number | null>(null);
  const vadHasSpeechRef = useRef(false);
  const vadSilenceFromRef = useRef<number | null>(null);
  const vadStartedAtRef = useRef(0);
  const stopRequestedRef = useRef(false);
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
    currentThreadIdRef.current = threadId;
  }, [threadId]);

  useEffect(() => {
    currentFollowupCountRef.current = followupCount;
  }, [followupCount]);

  useEffect(() => {
    if (remainingMs > 0) return;
    if (busyRef.current) return;
    if (phase === "listening") {
      void onStopAndAflever();
      return;
    }
    if (turns.length > 0 && phase !== "evaluating" && phase !== "thinking" && phase !== "speaking") setPhase("done");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [remainingMs, phase, turns.length]);

  useEffect(() => {
    return () => {
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
      if (vadFrameRef.current != null) {
        cancelAnimationFrame(vadFrameRef.current);
        vadFrameRef.current = null;
      }
      try {
        void vadContextRef.current?.close();
      } catch {
        // ignore
      }
      vadContextRef.current = null;
      recorderRef.current = null;
      chunksRef.current = [];
      streamRef.current?.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
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

  function cleanupVad() {
    if (vadFrameRef.current != null) {
      cancelAnimationFrame(vadFrameRef.current);
      vadFrameRef.current = null;
    }
    try {
      void vadContextRef.current?.close();
    } catch {
      // ignore
    }
    vadContextRef.current = null;
    vadHasSpeechRef.current = false;
    vadSilenceFromRef.current = null;
    vadStartedAtRef.current = 0;
  }

  function cleanupRecording() {
    try {
      cleanupVad();
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
    setPhase("listening");
    startVadMonitor(stream);
  }

  function startVadMonitor(stream: MediaStream) {
    cleanupVad();
    const Ctx = (window.AudioContext || (window as any).webkitAudioContext) as typeof AudioContext | undefined;
    if (!Ctx) return;

    const ctx = new Ctx();
    vadContextRef.current = ctx;
    const source = ctx.createMediaStreamSource(stream);
    const analyser = ctx.createAnalyser();
    analyser.fftSize = 2048;
    analyser.smoothingTimeConstant = 0.85;
    source.connect(analyser);

    const data = new Float32Array(analyser.fftSize);
    const threshold = 0.018;
    const silenceMs = 1400;
    const maxRecordingMs = 90_000;
    vadStartedAtRef.current = performance.now();
    vadHasSpeechRef.current = false;
    vadSilenceFromRef.current = null;

    const tick = () => {
      if (!recorderRef.current || recorderRef.current.state !== "recording") return;

      analyser.getFloatTimeDomainData(data);
      let sum = 0;
      for (let i = 0; i < data.length; i++) sum += data[i] * data[i];
      const rms = Math.sqrt(sum / data.length);
      const nowPerf = performance.now();

      if (rms >= threshold) {
        vadHasSpeechRef.current = true;
        vadSilenceFromRef.current = null;
      } else if (vadHasSpeechRef.current) {
        if (vadSilenceFromRef.current == null) vadSilenceFromRef.current = nowPerf;
        if (nowPerf - (vadSilenceFromRef.current ?? nowPerf) >= silenceMs && !stopRequestedRef.current) {
          stopRequestedRef.current = true;
          void onStopAndAflever();
          return;
        }
      }

      if (nowPerf - vadStartedAtRef.current >= maxRecordingMs && !stopRequestedRef.current) {
        stopRequestedRef.current = true;
        void onStopAndAflever();
        return;
      }

      vadFrameRef.current = requestAnimationFrame(tick);
    };

    vadFrameRef.current = requestAnimationFrame(tick);
  }

  function stopRecorder(): Promise<Blob> {
    return new Promise((resolve, reject) => {
      const mr = recorderRef.current;
      if (!mr) {
        reject(new Error("Ingen aktiv optagelse."));
        return;
      }
      cleanupVad();
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
      if (t.transcriptText) out.push({ role: "user", text: t.transcriptText });
    }
    return out.slice(-10);
  }

  async function fetchAndPlayQuestion(nextTurnIndex: number, lastAnswerText?: string) {
    setPhase("thinking");
    const res = await fetch("/api/oral/next-question", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        scopeFolderIds: effectiveScopeFolderIds,
        folderId: activeFolderId ?? null,
        history: historyForApi(),
        turnIndex: nextTurnIndex,
        remainingSeconds: Math.max(0, Math.floor(remainingMs / 1000)),
        threadId: currentThreadIdRef.current,
        followupCount: currentFollowupCountRef.current,
        lastAnswerText: (lastAnswerText ?? "").trim() || undefined,
      }),
    });

    const json = (await res.json().catch(() => null)) as NextQuestionOk | { ok: false; error?: string } | null;

    if (!res.ok || !json || json.ok !== true) {
      throw new Error(String((json as any)?.error ?? "Kunne ikke hente næste spørgsmål."));
    }

    currentQuestionKindRef.current = json.kind;
    currentThreadIdRef.current = json.threadId;
    currentFollowupCountRef.current = json.followupCount;
    setThreadId(json.threadId);
    setFollowupCount(json.followupCount);
    currentQuestionRef.current = json.questionText;
    const blob = b64ToBlob(json.audioBase64, json.mime || "audio/mpeg");
    cleanupPlayback();
    const url = URL.createObjectURL(blob);
    audioUrlRef.current = url;
    const audio = new Audio(url);
    audioRef.current = audio;
    setPhase("speaking");

    await new Promise<void>((resolve, reject) => {
      audio.onended = () => resolve();
      audio.onerror = () => reject(new Error("Kunne ikke afspille spørgsmålslyd."));
      const p = audio.play();
      if (p && typeof p.then === "function") {
        p.catch(() => reject(new Error("Autoplay blev blokeret af browseren.")));
      }
    });
  }

  async function startTurn(nextTurnIndex: number, lastAnswerText?: string) {
    setError(null);
    setSubmitted(null);
    await fetchAndPlayQuestion(nextTurnIndex, lastAnswerText);
    setTurnIndex(nextTurnIndex);
    stopRequestedRef.current = false;
    await startRecorder();
  }

  async function onStart() {
    if (phase !== "idle") return;
    if (busyRef.current) return;
    if (
      typeof navigator === "undefined" ||
      !navigator.mediaDevices?.getUserMedia ||
      typeof MediaRecorder === "undefined"
    ) {
      setError("Din browser understøtter ikke mikrofon-optagelse.");
      return;
    }

    const sid = makeSessionId();
    const t0 = Date.now();
    setSessionId(sid);
    setTurns([]);
    setSubmitted(null);
    setStartedAt(t0);
    setEndAt(t0 + durationMs);
    setNow(t0);
    setTurnIndex(0);
    setThreadId(null);
    setFollowupCount(0);
    currentThreadIdRef.current = null;
    currentFollowupCountRef.current = 0;
    setError(null);
    busyRef.current = true;
    try {
      await startTurn(0);
    } catch (e: any) {
      setPhase("idle");
      setError(e?.message ?? "Kunne ikke starte mundtlig eksamen.");
      cleanupPlayback();
      cleanupRecording();
    } finally {
      busyRef.current = false;
    }
  }

  async function onStopAndAflever() {
    if (phase !== "listening") return;
    if (busyRef.current) return;
    busyRef.current = true;
    stopRequestedRef.current = true;
    setPhase("evaluating");
    setError(null);

    try {
      const audioBlob = await stopRecorder();
      if (!audioBlob.size) throw new Error("Der blev ikke optaget lyd.");

      const ext = audioBlob.type.includes("ogg") ? "ogg" : "webm";
      const file = new File([audioBlob], `oral-${Date.now()}.${ext}`, {
        type: audioBlob.type || `audio/${ext}`,
      });

      const fd = new FormData();
      fd.append("audio", file);
      fd.append("question", currentQuestionRef.current || "");
      fd.append("durationMin", String(durationMin));
      if (startedAt) fd.append("startedAt", String(startedAt));
      fd.append("endedAt", String(Date.now()));
      fd.append("scopeFolderIds", JSON.stringify(effectiveScopeFolderIds));
      if (activeFolderId) fd.append("folderId", activeFolderId);
      fd.append("notes", notes);
      fd.append("sessionId", sessionId ?? "");
      fd.append("turnIndex", String(turnIndex));

      const res = await fetch("/api/oral/submit", { method: "POST", body: fd });
      const json = (await res.json().catch(() => null)) as
        | { ok: true; result: SubmitResult }
        | { ok: false; error?: string }
        | null;

      if (!res.ok || !json || json.ok !== true) {
        throw new Error(String((json as any)?.error ?? "Aflevering fejlede."));
      }

      setSubmitted(json.result);
      const transcriptText = json.result.transcript.text;
      setTurns((prev) => [
        ...prev,
        {
          questionText: currentQuestionRef.current,
          transcriptText,
          notes: notes || "",
          kind: currentQuestionKindRef.current,
          threadId: currentThreadIdRef.current,
          followupCount: currentFollowupCountRef.current,
        },
      ]);

      window.dispatchEvent(new Event("notely:exam-updated"));
      window.dispatchEvent(new Event("notely:simulator-updated"));

      if (Date.now() < (endAt ?? 0)) {
        await startTurn(turnIndex + 1, transcriptText);
      } else {
        setPhase("done");
      }
    } catch (e: any) {
      setPhase("done");
      setError(e?.message ?? "Aflevering fejlede.");
    } finally {
      stopRequestedRef.current = false;
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
    setThreadId(null);
    setFollowupCount(0);
    currentThreadIdRef.current = null;
    currentFollowupCountRef.current = 0;
    setTurns([]);
    setSubmitted(null);
    currentQuestionRef.current = "";
    currentQuestionKindRef.current = "new";
    stopRequestedRef.current = false;
    busyRef.current = false;
  }

  const micState: MicState =
    phase === "thinking"
      ? "thinking"
      : phase === "speaking"
        ? "speaking"
        : phase === "listening"
          ? "listening"
          : phase === "evaluating"
            ? "evaluating"
            : "idle";

  const tabBtn = (active: boolean) =>
    cx(
      "px-3 py-2 text-sm border border-zinc-200",
      active ? "bg-zinc-100 text-zinc-900" : "bg-white text-zinc-900 hover:bg-zinc-50",
    );

  return (
    <section className="space-y-4">
      <div className="sticky top-4 z-10 space-y-17">
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

              {(phase === "thinking" || phase === "speaking" || phase === "evaluating") && (
                <button
                  type="button"
                  disabled
                  className="rounded-xl border border-zinc-200 bg-white px-4 py-2 text-sm text-zinc-500"
                >
                  Behandler...
                </button>
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

        <div className="grid grid-cols-1 items-start gap-6 md:grid-cols-[1fr_340px]">
          <div className="flex min-h-[220px] items-center justify-center pl-8">
            <button
              type="button"
              onClick={() => {
                if (phase === "listening") void onStopAndAflever();
              }}
              disabled={phase !== "listening"}
              className={cx("rounded-xl", phase === "listening" ? "cursor-pointer" : "cursor-default")}
              aria-label={phase === "listening" ? "Stop optagelse" : "Mikrofonstatus"}
              title={phase === "listening" ? "Klik for at stoppe optagelse" : undefined}
            >
              <MicStatusIcon state={micState} className="h-[190px] w-[150px] text-black" />
            </button>
          </div>

          {/* ✅ EN BOKS: textarea har nu selv border+shadow (ingen ydre boks, ingen label) */}
          <div className="h-[400px] w-full md:w-[340px] md:justify-self-start">
  <textarea
    value={notes}
    onChange={(e) => setNotes(e.target.value)}
    placeholder="Noter"
    className="h-full w-full md:ml-12 md:w-[290px] resize-none rounded-2xl border border-zinc-200 bg-white p-4 text-sm shadow-sm outline-none placeholder:text-zinc-400 focus:border-zinc-500"
  />
</div>
        </div>
      </div>

      {error && (
        <section className="rounded-2xl border border-red-200 bg-white p-4 text-sm text-red-700 shadow-sm">
          {error}
        </section>
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
                {typeof submitted.score === "number" ? (
                  <span className="ml-2 text-zinc-500">({Math.round(submitted.score)}%)</span>
                ) : null}
              </div>
            </div>

            <div className="mt-3 whitespace-pre-wrap rounded-xl border border-zinc-200 bg-white p-3 text-sm text-zinc-800">
              {submitted.summary}
              {submitted.strengths.length > 0 ? `\n\nStyrker:\n- ${submitted.strengths.join("\n- ")}` : ""}
              {submitted.improvements.length > 0 ? `\n\nForbedringer:\n- ${submitted.improvements.join("\n- ")}` : ""}
            </div>
          </section>

          <details className="rounded-2xl border border-zinc-200 bg-white p-4 shadow-sm">
            <summary className="cursor-pointer text-sm font-semibold text-zinc-800">Vis afskrift</summary>
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
