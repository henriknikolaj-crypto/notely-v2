"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { MicStatusIcon } from "./MicStatusIcon";

type Grade = "-3" | "00" | "02" | "4" | "7" | "10" | "12";
type Segment = { start: number; end: number; text: string };
type MicState = "idle" | "thinking" | "speaking" | "listening" | "evaluating" | "paused";
type Phase = "idle" | "thinking" | "speaking" | "listening" | "evaluating" | "paused" | "done";

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

type SubmitTurnOk = { ok: true; transcript: { text: string; segments: Segment[] } };
type SubmitFinalOk = { ok: true; result: SubmitResult };
type SubmitErr = { ok: false; error?: string };
type SubmitResp = SubmitTurnOk | SubmitFinalOk | SubmitErr;
type TurnRecoveryMode = "insufficient_retry" | "insufficient_advance" | "transcription_error";
type TurnRecovery = {
  mode: TurnRecoveryMode;
  message: string;
};

type Props = {
  scopeFolderIds: string[];
  activeFolderId: string | null;
  isPro?: boolean;
};
type PlanStatus = "unknown" | "pro" | "nonpro";
type DurationOption = 10 | 20 | 30;

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

function getMediaRecorderCtor() {
  if (typeof window === "undefined") return null;
  return (window as any).MediaRecorder ?? (window as any).webkitMediaRecorder ?? null;
}

type MicStartIssue = {
  reason:
    | "no_window"
    | "secure_context_false"
    | "no_media_devices"
    | "no_getUserMedia"
    | "no_recorder_ctor"
    | "permission_denied"
    | "no_input_device"
    | "device_unavailable"
    | "recorder_start_failed"
    | "get_user_media_failed";
  message: string;
};

function attachMicIssue(issue: MicStartIssue, cause?: unknown) {
  const error = new Error(issue.message);
  (error as any).micIssue = issue;
  (error as any).cause = cause;
  return error;
}

function getMicIssueFromError(error: any): MicStartIssue | null {
  return (error as any)?.micIssue ?? null;
}

function detectMicSupportIssue(): MicStartIssue | null {
  if (typeof window === "undefined") {
    return { reason: "no_window", message: "Mikrofonen kan først startes i browseren." };
  }
  if (!window.isSecureContext) {
    return { reason: "secure_context_false", message: "Mikrofonen kræver en sikker forbindelse (https)." };
  }
  if (typeof navigator === "undefined" || !navigator.mediaDevices) {
    return { reason: "no_media_devices", message: "Din browser understøtter ikke mikrofon-optagelse." };
  }
  if (!navigator.mediaDevices.getUserMedia) {
    return { reason: "no_getUserMedia", message: "Din browser understøtter ikke mikrofon-optagelse." };
  }
  if (!getMediaRecorderCtor()) {
    return { reason: "no_recorder_ctor", message: "Din browser understøtter ikke mikrofon-optagelse." };
  }
  return null;
}

function pickMimeType() {
  const preferred = ["audio/webm;codecs=opus", "audio/webm", "audio/ogg;codecs=opus", "audio/ogg"];
  const MediaRecorderCtor = getMediaRecorderCtor();
  if (!MediaRecorderCtor) return "";
  if (typeof MediaRecorderCtor.isTypeSupported !== "function") return "";
  return preferred.find((type) => MediaRecorderCtor.isTypeSupported(type)) ?? "";
}

function b64ToBlob(base64: string, mime: string) {
  const binary = atob(base64);
  const len = binary.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) bytes[i] = binary.charCodeAt(i);
  return new Blob([bytes], { type: mime });
}

const ORAL_DEV_LOG = process.env.NODE_ENV !== "production";
const MIN_AUDIO_BYTES = 1024;
const MIN_TRANSCRIPT_CHARS = 24;
const MIN_TRANSCRIPT_WORDS = 5;

function oralDevLog(event: string, details?: Record<string, unknown>) {
  if (!ORAL_DEV_LOG) return;
  if (details && Object.keys(details).length > 0) {
    console.log("[oral-dev]", event, details);
    return;
  }
  console.log("[oral-dev]", event);
}

function countWords(text: string) {
  return text
    .trim()
    .split(/\s+/)
    .filter(Boolean).length;
}

function isInsufficientTranscript(text: string) {
  const normalized = text.trim();
  if (!normalized) return true;
  if (normalized.length < MIN_TRANSCRIPT_CHARS) return true;
  if (countWords(normalized) < MIN_TRANSCRIPT_WORDS) return true;
  return false;
}

function parseTranscriptBlocks(text: string) {
  const normalized = text.trim();
  if (!normalized) return [];
  const matches = Array.from(normalized.matchAll(/(Spørgsmål|Svar):\s*([\s\S]*?)(?=(?:Spørgsmål|Svar):|$)/g));
  if (!matches.length) {
    return [{ label: "Udskrift", text: normalized }];
  }
  return matches
    .map((match) => ({
      label: match[1],
      text: match[2].trim(),
    }))
    .filter((block) => block.text);
}

function groupTranscriptTurns(blocks: Array<{ label: string; text: string }>) {
  if (!blocks.length) return [];
  if (blocks.length === 1 && blocks[0]?.label === "Udskrift") {
    return [{ question: "", answer: "", fallback: blocks[0].text }];
  }

  const turns: Array<{ question: string; answer: string; fallback?: string }> = [];
  let current: { question: string; answer: string } = { question: "", answer: "" };

  for (const block of blocks) {
    if (block.label === "Spørgsmål") {
      if (current.question || current.answer) {
        turns.push({ ...current });
      }
      current = { question: block.text, answer: "" };
      continue;
    }

    if (block.label === "Svar") {
      if (!current.question && current.answer) {
        turns.push({ ...current });
        current = { question: "", answer: block.text };
      } else {
        current.answer = block.text;
      }
    }
  }

  if (current.question || current.answer) {
    turns.push({ ...current });
  }

  return turns.filter((turn) => turn.question || turn.answer);
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

export default function ClientOralExam({ scopeFolderIds, activeFolderId, isPro = false }: Props) {
  const [hydrated, setHydrated] = useState(false);
  const [planStatus, setPlanStatus] = useState<PlanStatus>(isPro ? "pro" : "unknown");
  const [durationMin, setDurationMin] = useState<DurationOption>(20);
  const durationMs = durationMin * 60 * 1000;

  const [phase, setPhase] = useState<Phase>("idle");
  const [error, setError] = useState<string | null>(null);
  const [notes, setNotes] = useState("");

  const [now, setNow] = useState<number>(() => Date.now());
  const [startedAt, setStartedAt] = useState<number | null>(null);
  const [endAt, setEndAt] = useState<number | null>(null);

  const [sessionId, setSessionId] = useState<string | null>(null);
  const [turnIndex, setTurnIndex] = useState(0);
  const [attemptCount, setAttemptCount] = useState(0);
  const [threadId, setThreadId] = useState<string | null>(null);
  const [followupCount, setFollowupCount] = useState(0);
  const [turns, setTurns] = useState<Turn[]>([]);
  const [submitted, setSubmitted] = useState<SubmitResult | null>(null);
  const [turnRecovery, setTurnRecovery] = useState<TurnRecovery | null>(null);

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
  const vadLastSpeechAtRef = useRef<number | null>(null); // ✅ ny: robust “sidst tale” tracking
  const stopRequestedRef = useRef(false);
  const stopAndSubmitRef = useRef<(() => void) | null>(null);
  const mimeType = useMemo(() => pickMimeType(), []);
  const busyRef = useRef(false);
  const vadSpeechLoggedRef = useRef(false);
  const vadSilenceLoggedRef = useRef(false);

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
  const hasScope = effectiveScopeFolderIds.length > 0;

  const requiresPro = planStatus === "nonpro";
  const isCheckingPro = planStatus === "unknown";
  const controlsLocked = requiresPro || isCheckingPro;
  const isOralRunning = phase !== "idle" && phase !== "done";

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
        if (plan === "pro") {
          setPlanStatus("pro");
          return;
        }
        if (plan === "basis" || plan === "freemium" || plan === "free" || plan === "nonpro") {
          setPlanStatus("nonpro");
          return;
        }
        setPlanStatus(isPro ? "pro" : "nonpro");
      } catch {
        if (!active) return;
        setPlanStatus(isPro ? "pro" : "nonpro");
      }
    })();

    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    if (planStatus !== "pro") return;
    if (!isOralRunning) return;
    if (!startedAt || !endAt) return;
    const id = window.setInterval(() => setNow(Date.now()), 250);
    return () => window.clearInterval(id);
  }, [planStatus, isOralRunning, startedAt, endAt]);

  useEffect(() => {
    currentThreadIdRef.current = threadId;
  }, [threadId]);

  useEffect(() => {
    currentFollowupCountRef.current = followupCount;
  }, [followupCount]);

  useEffect(() => {
    oralDevLog(`phase:${phase}`, { phase, turnIndex });
  }, [phase, turnIndex]);

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
    vadSpeechLoggedRef.current = false;
    vadSilenceLoggedRef.current = false;
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
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    streamRef.current = stream;
    return stream;
  } catch (error: any) {
    const name = String(error?.name ?? "").trim();
    const issue: MicStartIssue =
      name === "NotAllowedError" || name === "PermissionDeniedError"
        ? { reason: "permission_denied", message: "Mikrofontilladelse blev afvist. Tillad mikrofonadgang og prøv igen." }
        : name === "NotFoundError" || name === "DevicesNotFoundError"
          ? { reason: "no_input_device", message: "Der blev ikke fundet en mikrofon på denne enhed." }
          : name === "NotReadableError" || name === "TrackStartError"
            ? { reason: "device_unavailable", message: "Mikrofonen kunne ikke startes. Luk andre apps, der bruger mikrofonen, og prøv igen." }
            : !window.isSecureContext
              ? { reason: "secure_context_false", message: "Mikrofonen kræver en sikker forbindelse (https)." }
              : { reason: "get_user_media_failed", message: "Mikrofonen kunne ikke startes i denne browser." };
    oralDevLog("unsupported_reason", { reason: issue.reason, errorName: name || "unknown", errorMessage: String(error?.message ?? "") });
    throw attachMicIssue(issue, error);
  }
}

  async function startRecorder() {
    const stream = await ensureMicStream();
    chunksRef.current = [];
    const MediaRecorderCtor = getMediaRecorderCtor();
    if (!MediaRecorderCtor) {
      const issue: MicStartIssue = { reason: "no_recorder_ctor", message: "Din browser understøtter ikke mikrofon-optagelse." };
      oralDevLog("unsupported_reason", { reason: issue.reason });
      throw attachMicIssue(issue);
    }
    const mr = new MediaRecorderCtor(stream, mimeType ? { mimeType } : undefined);
    oralDevLog("media_recorder_created", { mimeType: mimeType || "browser-default" });

    mr.ondataavailable = (e: BlobEvent) => {
      if (e.data && e.data.size > 0) chunksRef.current.push(e.data);
    };

    recorderRef.current = mr;
    stopAndSubmitRef.current = () => {
      oralDevLog("recording_stop_requested_from_vad", { turnIndex });
      void stopAndHandleTurn();
    };

    // timeslice giver mere robuste chunks (mindre risiko for “corrupted/unsupported”)
    try {
      mr.start(250);
    } catch (firstError: any) {
      try {
        mr.start();
      } catch (secondError: any) {
        const issue: MicStartIssue = {
          reason: "recorder_start_failed",
          message: "Optagelse kunne ikke startes. Prøv igen.",
        };
        oralDevLog("unsupported_reason", {
          reason: issue.reason,
          firstError: String(firstError?.message ?? ""),
          secondError: String(secondError?.message ?? ""),
          mimeType: mimeType || "browser-default",
        });
        throw attachMicIssue(issue, secondError);
      }
    }
    oralDevLog("media_recorder_started", { state: mr.state, turnIndex });

    setPhase("listening");
    oralDevLog("listening_started", { turnIndex });
    startVadMonitor(stream);
  }

  function startVadMonitor(stream: MediaStream) {
  cleanupVad();

  const Ctx = (window.AudioContext || (window as any).webkitAudioContext) as typeof AudioContext | undefined;
  if (!Ctx) return;

  const ctx = new Ctx();
  vadContextRef.current = ctx;

  // Vigtigt: nogle browsere kan starte/sætte ctx i "suspended" efter første turn
  void ctx.resume().catch(() => {});

  const source = ctx.createMediaStreamSource(stream);
  const analyser = ctx.createAnalyser();
  analyser.fftSize = 2048;
  analyser.smoothingTimeConstant = 0.85;
  source.connect(analyser);

  const data = new Float32Array(analyser.fftSize);

  // Tuning (robust mod “står grøn”)
  const SILENCE_MS = 2000;      // hvor længe stilhed efter tale før vi afleverer
  const MIN_RECORD_MS = 1200;   // undgå for hurtige stops
  const MAX_RECORD_MS = 120_000; // hard cap
  const CALIBRATE_MS = 450;     // støj-kalibrering i starten
  const NO_SPEECH_FAILSAFE_MS = 12_000; // hvis vi aldrig registrerer tale

  let noiseSum = 0;
  let noiseN = 0;
  let speechThreshold = 0.012;

  vadStartedAtRef.current = performance.now();
  vadHasSpeechRef.current = false;
  vadSilenceFromRef.current = null;
  vadLastSpeechAtRef.current = null;
  vadSpeechLoggedRef.current = false;
  vadSilenceLoggedRef.current = false;

  const tick = () => {
    const mr = recorderRef.current;
    if (!mr || mr.state !== "recording") return;

    analyser.getFloatTimeDomainData(data);
    let sum = 0;
    for (let i = 0; i < data.length; i++) sum += data[i] * data[i];
    const rms = Math.sqrt(sum / data.length);

    const t = performance.now();
    const sinceStart = t - vadStartedAtRef.current;

    // 1) Kalibrér noise floor først
    if (sinceStart <= CALIBRATE_MS) {
      noiseSum += rms;
      noiseN += 1;
      const noiseAvg = noiseSum / Math.max(1, noiseN);
      speechThreshold = Math.max(0.008, noiseAvg * 3.0);
    }

    // 2) Brug en “weak” threshold til at tracke “sidst vi hørte tale”
    const weakThreshold = Math.max(0.006, speechThreshold * 0.7);

    if (rms >= speechThreshold) {
      if (!vadSpeechLoggedRef.current) {
        oralDevLog("speech_detected", {
          turnIndex,
          rms: Number(rms.toFixed(4)),
          threshold: Number(speechThreshold.toFixed(4)),
        });
        vadSpeechLoggedRef.current = true;
      }
      if (vadSilenceLoggedRef.current) {
        oralDevLog("silence_timer_reset", {
          turnIndex,
          rms: Number(rms.toFixed(4)),
        });
        vadSilenceLoggedRef.current = false;
      }
      vadHasSpeechRef.current = true;
      vadSilenceFromRef.current = null;
      vadLastSpeechAtRef.current = t;
    } else if (rms >= weakThreshold) {
      // stadig sandsynlig tale (bare lavt)
      if (!vadSpeechLoggedRef.current) {
        oralDevLog("speech_detected", {
          turnIndex,
          rms: Number(rms.toFixed(4)),
          threshold: Number(weakThreshold.toFixed(4)),
          weak: true,
        });
        vadSpeechLoggedRef.current = true;
      }
      if (vadSilenceLoggedRef.current) {
        oralDevLog("silence_timer_reset", {
          turnIndex,
          rms: Number(rms.toFixed(4)),
          weak: true,
        });
        vadSilenceLoggedRef.current = false;
      }
      vadLastSpeechAtRef.current = t;
    } else {
      // under threshold: stilhed
      if (vadHasSpeechRef.current) {
        if (vadSilenceFromRef.current == null) {
          vadSilenceFromRef.current = t;
          vadSilenceLoggedRef.current = true;
          oralDevLog("silence_timer_started", {
            turnIndex,
            rms: Number(rms.toFixed(4)),
            sinceStartMs: Math.round(sinceStart),
          });
        }
      }
    }

    // 3) Stop når der har været stilhed længe efter “sidst tale”
    const lastSpeechAt = vadLastSpeechAtRef.current;
    if (
      lastSpeechAt != null &&
      t - lastSpeechAt >= SILENCE_MS &&
      sinceStart >= MIN_RECORD_MS &&
      !stopRequestedRef.current
    ) {
      stopRequestedRef.current = true;
      oralDevLog("silence_timeout_fired", {
        turnIndex,
        silenceMs: Math.round(t - lastSpeechAt),
      });
      stopAndSubmitRef.current?.();
      return;
    }

    // 4) Hvis vi aldrig registrerer tale (pga. mic/threshold), fail-safe stop
    if (
      lastSpeechAt == null &&
      sinceStart >= NO_SPEECH_FAILSAFE_MS &&
      !stopRequestedRef.current
    ) {
      stopRequestedRef.current = true;
      oralDevLog("silence_timeout_fired", {
        turnIndex,
        reason: "no_speech_failsafe",
        sinceStartMs: Math.round(sinceStart),
      });
      void stopAndHandleTurn();
      return;
    }

    // 5) Hard cap
    if (sinceStart >= MAX_RECORD_MS && !stopRequestedRef.current) {
      stopRequestedRef.current = true;
      oralDevLog("silence_timeout_fired", {
        turnIndex,
        reason: "max_record_ms",
        sinceStartMs: Math.round(sinceStart),
      });
      void stopAndHandleTurn();
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
      oralDevLog("media_recorder_stop_requested", { state: mr.state, turnIndex });

      cleanupVad();

      mr.onstop = () => {
        try {
          const blob = new Blob(chunksRef.current, { type: mr.mimeType || "audio/webm" });
          oralDevLog("recording_stopped", {
            turnIndex,
            blobSize: blob.size,
            mimeType: mr.mimeType || "audio/webm",
          });
          recorderRef.current = null;
          stopAndSubmitRef.current = null;
          streamRef.current?.getTracks().forEach((t) => t.stop());
          streamRef.current = null;
          chunksRef.current = [];
          resolve(blob);
        } catch (e) {
          reject(e);
        }
      };

      try {
        // hjælper på “tom/corrupt” blob i nogle browsere
        try {
          mr.requestData?.();
        } catch {
          // ignore
        }
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
    oralDevLog("next_question_request_started", { nextTurnIndex });

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
    oralDevLog("next_question_request_done", {
      nextTurnIndex,
      kind: json.kind,
      followupCount: json.followupCount,
    });

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
    oralDevLog("question_playing", {
      nextTurnIndex,
      kind: json.kind,
      audioBytes: blob.size,
    });

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
    setTurnRecovery(null);
    setAttemptCount(0);
    await fetchAndPlayQuestion(nextTurnIndex, lastAnswerText);
    setTurnIndex(nextTurnIndex);
    stopRequestedRef.current = false;
    await startRecorder();
  }

  async function retryCurrentQuestion() {
    if (busyRef.current) return;
    if (controlsLocked) return;
    setError(null);
    setTurnRecovery(null);
    stopRequestedRef.current = false;
    oralDevLog("retry_current_question_started", { turnIndex, attemptCount });
    try {
      await startRecorder();
    } catch (e: any) {
      setPhase("paused");
      setError(e?.message ?? "Kunne ikke starte mikrofonen igen.");
      setTurnRecovery({
        mode: "transcription_error",
        message: "Jeg kunne ikke starte optagelsen igen. Prøv igen eller gå videre.",
      });
    }
  }

  async function goToNextQuestion(skipReason: "insufficient" | "transcription_error") {
    if (busyRef.current) return;
    if (controlsLocked) return;
    setError(null);
    setTurnRecovery(null);
    oralDevLog("go_to_next_question_requested", { turnIndex, skipReason });
    const stillTimeLeft = endAt != null ? Date.now() < endAt - 300 : true;
    if (!stillTimeLeft) {
      await finalizeWithoutAudio();
      return;
    }
    busyRef.current = true;
    setPhase("thinking");
    try {
      await startTurn(turnIndex + 1);
    } catch (e: any) {
      setPhase("paused");
      setError(e?.message ?? "Kunne ikke hente næste spørgsmål.");
      setTurnRecovery({
        mode: "transcription_error",
        message: "Jeg kunne ikke hente næste spørgsmål. Prøv igen eller gå videre.",
      });
    } finally {
      busyRef.current = false;
    }
  }

  async function onStart() {
    if (phase !== "idle") return;
    if (busyRef.current) return;
    if (controlsLocked) return;

    const MediaRecorderCtor = getMediaRecorderCtor();
    oralDevLog("recorder_support_check", {
      hasWindow: typeof window !== "undefined",
      hasMediaDevices: typeof navigator !== "undefined" ? !!navigator.mediaDevices : false,
      hasGetUserMedia: typeof navigator !== "undefined" ? !!navigator.mediaDevices?.getUserMedia : false,
      hasMediaRecorder: !!MediaRecorderCtor,
      isSecureContext: typeof window !== "undefined" ? window.isSecureContext : false,
      mimeChecks:
        MediaRecorderCtor && typeof MediaRecorderCtor.isTypeSupported === "function"
          ? {
              "audio/webm;codecs=opus": MediaRecorderCtor.isTypeSupported("audio/webm;codecs=opus"),
              "audio/webm": MediaRecorderCtor.isTypeSupported("audio/webm"),
              "audio/ogg;codecs=opus": MediaRecorderCtor.isTypeSupported("audio/ogg;codecs=opus"),
              "audio/ogg": MediaRecorderCtor.isTypeSupported("audio/ogg"),
            }
          : "browser-default",
    });

    const supportIssue = detectMicSupportIssue();
    if (supportIssue) {
      oralDevLog("unsupported_reason", { reason: supportIssue.reason });
      setError(supportIssue.message);
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
    setAttemptCount(0);

    setThreadId(null);
    setFollowupCount(0);
    currentThreadIdRef.current = null;
    currentFollowupCountRef.current = 0;

    setError(null);
    setTurnRecovery(null);

    busyRef.current = true;
    try {
      await startTurn(0);
    } catch (e: any) {
      setPhase("idle");
      const micIssue = getMicIssueFromError(e);
      setError(micIssue?.message ?? e?.message ?? "Kunne ikke starte mundtlig eksamen.");
      cleanupPlayback();
      cleanupRecording();
    } finally {
      busyRef.current = false;
    }
  }

  // Stop + håndtér tur: transcribe -> enten næste spørgsmål eller final evaluering
  async function stopAndHandleTurn(forceFinal?: boolean) {
    const mr = recorderRef.current;
    if (!mr || mr.state !== "recording") {
      oralDevLog("stop_and_handle_turn_skipped", {
        reason: "no_active_recorder",
        forceFinal: Boolean(forceFinal),
        phase,
      });
      return;
    }
    if (busyRef.current) {
      oralDevLog("stop_and_handle_turn_skipped", { reason: "busy", forceFinal: Boolean(forceFinal), phase });
      return;
    }
    if (controlsLocked) {
      oralDevLog("stop_and_handle_turn_skipped", { reason: "controls_locked", forceFinal: Boolean(forceFinal) });
      return;
    }

    busyRef.current = true;
    setError(null);

    const hardNow = Date.now();
    const timeIsUp = forceFinal || (endAt != null && hardNow >= endAt);
    oralDevLog("stop_and_handle_turn_started", {
      turnIndex,
      forceFinal: Boolean(forceFinal),
      timeIsUp,
      phase,
    });

    setPhase(timeIsUp ? "evaluating" : "thinking");

    try {
      const audioBlob = await stopRecorder();
      if (!audioBlob || audioBlob.size < MIN_AUDIO_BYTES) {
        oralDevLog("recording_rejected_too_small", {
          turnIndex,
          blobSize: audioBlob?.size ?? 0,
          minAudioBytes: MIN_AUDIO_BYTES,
        });
        throw new Error("Der blev ikke optaget nok lyd. Prøv igen.");
      }

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
      fd.append("final", timeIsUp ? "1" : "0");

      if (timeIsUp) {
        // send hele historikken til final evaluering
        fd.append(
          "turns",
          JSON.stringify([
            ...turns,
            {
              questionText: currentQuestionRef.current,
              transcriptText: "", // udfyldes server-side via transcribe af denne tur
              notes: notes || "",
              kind: currentQuestionKindRef.current,
              threadId: currentThreadIdRef.current,
              followupCount: currentFollowupCountRef.current,
            },
          ]),
        );
      }

      oralDevLog("transcribe_turn_request_started", {
        endpoint: "/api/oral/submit",
        turnIndex,
        final: timeIsUp,
        audioBytes: audioBlob.size,
      });
      const res = await fetch("/api/oral/submit", { method: "POST", body: fd });
      const json = (await res.json().catch(() => null)) as SubmitResp | null;
      oralDevLog("transcribe_turn_request_done", {
        turnIndex,
        final: timeIsUp,
        ok: res.ok && !!json && (json as any).ok === true,
        status: res.status,
      });

      if (!res.ok || !json || (json as any).ok !== true) {
        if (!timeIsUp) {
          const submitError =
            res.status === 422
              ? "Jeg kunne ikke udtrække afskrift fra lydfilen."
              : String((json as any)?.error ?? "Aflevering fejlede.");
          setPhase("paused");
          setError(submitError);
          setTurnRecovery({
            mode: "transcription_error",
            message: submitError,
          });
          return;
        }
        throw new Error(String((json as any)?.error ?? "Aflevering fejlede."));
      }

      if ("result" in json) {
        // FINAL: evaluering
        setPhase("done");
        setSubmitted(json.result);

        window.dispatchEvent(new Event("notely:exam-updated"));
        window.dispatchEvent(new Event("notely:simulator-updated"));
        return;
      }

      // TURN: kun transkript
      const transcriptText = String((json as SubmitTurnOk).transcript.text ?? "").trim();
      if (!timeIsUp && isInsufficientTranscript(transcriptText)) {
        const nextAttemptCount = attemptCount + 1;
        oralDevLog("turn_marked_insufficient", {
          turnIndex,
          attemptCount: nextAttemptCount,
          transcriptLength: transcriptText.length,
          transcriptWords: countWords(transcriptText),
        });
        setAttemptCount(nextAttemptCount);
        setPhase("paused");
        const shouldOfferAdvance = nextAttemptCount >= 2;
        const message = shouldOfferAdvance
          ? "Okay, skal vi gå videre til næste spørgsmål?"
          : "Dit svar blev for kort til at give en sikker afskrift. Prøv gerne igen.";
        setError(message);
        setTurnRecovery({
          mode: shouldOfferAdvance ? "insufficient_advance" : "insufficient_retry",
          message,
        });
        return;
      }

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
      setAttemptCount(0);
      setTurnRecovery(null);

      // Hvis der stadig er tid tilbage: næste spørgsmål automatisk
      const stillTimeLeft = endAt != null ? Date.now() < endAt - 300 : true;
      if (stillTimeLeft) {
        oralDevLog("next_question_request_started", {
          nextTurnIndex: turnIndex + 1,
          fromTranscriptLength: transcriptText.length,
          source: "post_submit",
        });
        await startTurn(turnIndex + 1, transcriptText);
        oralDevLog("next_question_request_done", {
          nextTurnIndex: turnIndex + 1,
          source: "post_submit",
        });
      } else {
        // tid er lige løbet ud mellem stop og næste turn -> final uden lyd
        await finalizeWithoutAudio();
      }
    } catch (e: any) {
      setPhase(timeIsUp ? "done" : "paused");
      setError(e?.message ?? "Aflevering fejlede.");
      if (!timeIsUp) {
        setTurnRecovery({
          mode: "transcription_error",
          message: e?.message ?? "Aflevering fejlede.",
        });
      }
    } finally {
      stopRequestedRef.current = false;
      busyRef.current = false;
    }
  }

  async function finalizeWithoutAudio() {
    if (busyRef.current) return;
    if (!startedAt) return;
    if (submitted) return;
    if (controlsLocked) return;

    busyRef.current = true;
    setPhase("evaluating");
    setError(null);

    try {
      const fd = new FormData();
      fd.append("final", "1");
      fd.append("question", "");
      fd.append("durationMin", String(durationMin));
      fd.append("startedAt", String(startedAt));
      fd.append("endedAt", String(Date.now()));
      fd.append("scopeFolderIds", JSON.stringify(effectiveScopeFolderIds));
      if (activeFolderId) fd.append("folderId", activeFolderId);
      fd.append("notes", notes);
      fd.append("sessionId", sessionId ?? "");
      fd.append("turnIndex", String(turnIndex));
      fd.append("turns", JSON.stringify(turns));

      const res = await fetch("/api/oral/submit", { method: "POST", body: fd });
      const json = (await res.json().catch(() => null)) as SubmitResp | null;

      if (!res.ok || !json || (json as any).ok !== true || !("result" in (json as any))) {
        throw new Error(String((json as any)?.error ?? "Kunne ikke afslutte evaluering."));
      }

      setSubmitted((json as SubmitFinalOk).result);
      setPhase("done");

      window.dispatchEvent(new Event("notely:exam-updated"));
      window.dispatchEvent(new Event("notely:simulator-updated"));
    } catch (e: any) {
      setPhase("done");
      setError(e?.message ?? "Kunne ikke afslutte evaluering.");
    } finally {
      busyRef.current = false;
    }
  }

  useEffect(() => {
    // Når tiden er slut: hvis vi stadig lytter, så stop + final; ellers finaliser uden lyd
    if (!endAt) return;
    if (remainingMs > 0) return;
    if (busyRef.current) return;

    const mr = recorderRef.current;
    if (mr && mr.state === "recording") {
      stopRequestedRef.current = true;
      void stopAndHandleTurn(true);
      return;
    }

    if (startedAt && !submitted) {
      void finalizeWithoutAudio();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [remainingMs, endAt]);

  useEffect(() => {
    if (!controlsLocked) return;
    cleanupPlayback();
    cleanupRecording();
    setPhase("idle");
    setStartedAt(null);
    setEndAt(null);
    setNow(Date.now());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [controlsLocked]);

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
    setAttemptCount(0);
    setThreadId(null);
    setFollowupCount(0);
    currentThreadIdRef.current = null;
    currentFollowupCountRef.current = 0;
    setTurns([]);
    setSubmitted(null);
    setTurnRecovery(null);
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
          : phase === "paused"
            ? "paused"
          : phase === "evaluating"
            ? "evaluating"
            : "idle";

  const tabBtn = (active: boolean) =>
    cx(
      "px-3 py-2 text-sm border border-zinc-200",
      active ? "bg-zinc-100 text-zinc-900" : "bg-white text-zinc-900 hover:bg-zinc-50",
    );
  const transcriptBlocks = submitted ? parseTranscriptBlocks(submitted.transcript.text) : [];
  const transcriptTurns = submitted ? groupTranscriptTurns(transcriptBlocks) : [];

  return (
    <section className="space-y-4">
      <section className="sticky top-4 z-20 rounded-2xl border border-zinc-200 bg-white/95 p-4 shadow-sm backdrop-blur">
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
                {[10, 20, 30].map((m) => (
                    <button
                      key={m}
                      type="button"
                      onClick={() => setDurationMin(m as DurationOption)}
                      disabled={controlsLocked}
                      className={cx(
                        tabBtn(durationMin === m),
                        m !== 20 && "border-l-0",
                        m === 10 && "rounded-l-xl",
                        m === 30 && "rounded-r-xl",
                        controlsLocked && "cursor-not-allowed text-zinc-500",
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
                disabled={controlsLocked || !hasScope}
                className="rounded-xl border border-zinc-200 bg-zinc-100 px-4 py-2 text-sm font-medium text-zinc-900 hover:bg-zinc-200 disabled:cursor-not-allowed disabled:bg-white disabled:text-zinc-500"
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

            {phase === "paused" && (
              <button
                type="button"
                disabled
                className="rounded-xl border border-zinc-200 bg-white px-4 py-2 text-sm text-zinc-500"
              >
                Afventer valg...
              </button>
            )}

            {(phase === "done" || phase === "idle") && (
              <button
                type="button"
                onClick={onReset}
                disabled={controlsLocked}
                className="rounded-xl border border-zinc-200 bg-white px-4 py-2 text-sm text-zinc-900 hover:bg-zinc-50 disabled:cursor-not-allowed disabled:text-zinc-500"
              >
                Nulstil
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
        ) : !hasScope ? (
          <div className="mt-3 rounded-xl border border-zinc-200 bg-white px-3 py-2">
            <p className="text-sm text-zinc-600">Vælg en mappe ovenfor før du starter eksamen.</p>
          </div>
        ) : null}
      </section>

      {submitted ? null : (
        <div className="grid grid-cols-1 items-start gap-6 md:grid-cols-[1fr_340px]">
          <div className="flex min-h-[220px] items-center justify-center md:pl-8">
            <button
              type="button"
              onClick={() => {
                if (controlsLocked) return;
                // Klik stopper kun hvis vi faktisk optager
                const mr = recorderRef.current;
                if (mr && mr.state === "recording" && !busyRef.current) {
                  stopRequestedRef.current = true;
                  void stopAndHandleTurn();
                }
              }}
              disabled={controlsLocked || !(recorderRef.current && recorderRef.current.state === "recording")}
              className={cx(
                "rounded-xl",
                recorderRef.current && recorderRef.current.state === "recording" ? "cursor-pointer" : "cursor-default",
              )}
              aria-label={recorderRef.current && recorderRef.current.state === "recording" ? "Stop optagelse" : "Mikrofonstatus"}
              title={recorderRef.current && recorderRef.current.state === "recording" ? "Klik for at stoppe optagelse" : undefined}
            >
              <MicStatusIcon state={micState} className="h-[190px] w-[150px] text-black" />
            </button>
          </div>

          <div className="w-full md:justify-self-start">
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Noter"
              className="min-h-[280px] w-full resize-none rounded-2xl border border-zinc-200 bg-white p-4 text-sm shadow-sm outline-none placeholder:text-zinc-400 focus:border-zinc-500 md:ml-12 md:w-[290px]"
            />
          </div>
        </div>
      )}

      {controlsLocked || turnRecovery ? null : error ? (
        <section className="rounded-2xl border border-zinc-200 bg-white p-4 text-sm text-zinc-700 shadow-sm">
          {error}
        </section>
      ) : null}

      {controlsLocked || !turnRecovery ? null : (
        <section className="rounded-2xl border border-zinc-200 bg-white p-4 shadow-sm">
          <div className="text-sm font-medium text-zinc-800">{turnRecovery.message}</div>
          <div className="mt-3 flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => void retryCurrentQuestion()}
              className="rounded-xl border border-zinc-200 bg-zinc-100 px-4 py-2 text-sm text-zinc-900 hover:bg-zinc-200"
            >
              Prøv igen
            </button>
            {turnRecovery.mode !== "insufficient_retry" ? (
              <button
                type="button"
                onClick={() => void goToNextQuestion(turnRecovery.mode === "transcription_error" ? "transcription_error" : "insufficient")}
                className="rounded-xl border border-zinc-200 bg-white px-4 py-2 text-sm text-zinc-900 hover:bg-zinc-50"
              >
                Gå videre
              </button>
            ) : null}
          </div>
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
            <div className="mt-4 space-y-3">
              {transcriptTurns.length > 0 ? transcriptTurns.map((turn, index) => (
                <div key={`turn-${index}`} className="rounded-xl border border-zinc-200 bg-zinc-50/70 p-4">
                  {turn.fallback ? (
                    <div className="whitespace-pre-wrap text-sm leading-7 text-zinc-800">{turn.fallback}</div>
                  ) : (
                    <div className="space-y-4">
                      {turn.question ? (
                        <div>
                          <div className="text-[10px] font-semibold uppercase tracking-[0.12em] text-zinc-400">
                            Spørgsmål
                          </div>
                          <div className="mt-1.5 whitespace-pre-wrap text-sm leading-7 text-zinc-800">{turn.question}</div>
                        </div>
                      ) : null}
                      {turn.answer ? (
                        <div>
                          <div className="text-[10px] font-semibold uppercase tracking-[0.12em] text-zinc-400">
                            Svar
                          </div>
                          <div className="mt-1.5 whitespace-pre-wrap text-sm leading-7 text-zinc-800">{turn.answer}</div>
                        </div>
                      ) : null}
                    </div>
                  )}
                </div>
              )) : (
                <div className="rounded-xl border border-zinc-200 bg-white p-4 text-sm leading-7 text-zinc-800">
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
