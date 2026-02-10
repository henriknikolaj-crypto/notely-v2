"use client";

import { useEffect, useMemo, useRef, useState } from "react";

type Phase = "idle" | "recording" | "paused" | "submitting" | "done" | "error";
type Grade = "-3" | "00" | "02" | "4" | "7" | "10" | "12";
type Segment = { start: number; end: number; text: string };

type SubmitOk = {
  ok: true;
  sessionId: string;
  grade: Grade;
  score: number;
  feedback: string;
  transcriptText: string;
  segments: Segment[];
};

type SubmitErr = { ok: false; error: string };

type Props = {
  scopeFolderIds: string[];
  activeFolderId: string | null;
};

function formatClock(ms: number) {
  const s = Math.max(0, Math.floor(ms / 1000));
  const mm = String(Math.floor(s / 60)).padStart(2, "0");
  const ss = String(s % 60).padStart(2, "0");
  return `${mm}:${ss}`;
}

function pickMimeType() {
  const preferred = [
    "audio/webm;codecs=opus",
    "audio/webm",
    "audio/ogg;codecs=opus",
    "audio/ogg",
  ];
  if (typeof MediaRecorder === "undefined") return "";
  return preferred.find((type) => MediaRecorder.isTypeSupported?.(type)) ?? "";
}

export default function ClientOralExam({ scopeFolderIds, activeFolderId }: Props) {
  const [phase, setPhase] = useState<Phase>("idle");
  const [error, setError] = useState<string | null>(null);

  const [question, setQuestion] = useState("");
  const [notes, setNotes] = useState("");
  const [elapsedMs, setElapsedMs] = useState(0);
  const [result, setResult] = useState<SubmitOk | null>(null);

  const mimeType = useMemo(() => pickMimeType(), []);

  const recorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const chunksRef = useRef<BlobPart[]>([]);
  const tickRef = useRef<number | null>(null);
  const tickStartedAtRef = useRef<number | null>(null);

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
    return () => {
      try {
        if (tickRef.current) window.clearInterval(tickRef.current);
        streamRef.current?.getTracks().forEach((t) => t.stop());
      } catch {
        // ignore
      }
    };
  }, []);

  function startTick() {
    if (tickRef.current) window.clearInterval(tickRef.current);
    tickStartedAtRef.current = Date.now();
    tickRef.current = window.setInterval(() => {
      const t0 = tickStartedAtRef.current;
      if (!t0) return;
      setElapsedMs((prev) => prev + (Date.now() - t0));
      tickStartedAtRef.current = Date.now();
    }, 250);
  }

  function stopTick() {
    if (tickRef.current) window.clearInterval(tickRef.current);
    tickRef.current = null;
    tickStartedAtRef.current = null;
  }

  async function ensureMic() {
    if (streamRef.current) return streamRef.current;
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    streamRef.current = stream;
    return stream;
  }

  async function startRecording() {
    if (phase !== "idle" && phase !== "done" && phase !== "error") return;
    setError(null);
    setResult(null);

    if (typeof navigator === "undefined" || !navigator.mediaDevices?.getUserMedia) {
      setPhase("error");
      setError("Din browser understøtter ikke mikrofon-optagelse.");
      return;
    }

    if (typeof MediaRecorder === "undefined") {
      setPhase("error");
      setError("Din browser understøtter ikke lydoptagelse endnu.");
      return;
    }

    try {
      const stream = await ensureMic();
      chunksRef.current = [];

      const mr = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);

      mr.ondataavailable = (e) => {
        if (e.data && e.data.size > 0) chunksRef.current.push(e.data);
      };

      mr.onstart = () => {
        setElapsedMs(0);
        setPhase("recording");
        startTick();
      };

      mr.onpause = () => {
        setPhase("paused");
        stopTick();
      };

      mr.onresume = () => {
        setPhase("recording");
        startTick();
      };

      mr.onerror = () => {
        setPhase("error");
        stopTick();
        setError("Optagelsen fejlede. Prøv igen.");
      };

      recorderRef.current = mr;
      mr.start();
    } catch (e: any) {
      setPhase("error");
      if (e?.name === "NotAllowedError" || e?.name === "SecurityError") {
        setError("Mikrofon-adgang blev afvist. Tillad mikrofon i browseren og prøv igen.");
      } else if (e?.name === "NotFoundError") {
        setError("Ingen mikrofon fundet. Tilslut en mikrofon og prøv igen.");
      } else {
        setError("Kunne ikke starte optagelse.");
      }
    }
  }

  function pauseRecording() {
    const mr = recorderRef.current;
    if (!mr || mr.state !== "recording") return;
    mr.pause();
  }

  function resumeRecording() {
    const mr = recorderRef.current;
    if (!mr || mr.state !== "paused") return;
    mr.resume();
  }

  function stopRecording(): Promise<Blob> {
    return new Promise((resolve, reject) => {
      const mr = recorderRef.current;
      if (!mr) {
        reject(new Error("Ingen aktiv optagelse."));
        return;
      }

      mr.onstop = () => {
        try {
          stopTick();
          const blob = new Blob(chunksRef.current, { type: mr.mimeType || "audio/webm" });
          streamRef.current?.getTracks().forEach((t) => t.stop());
          streamRef.current = null;
          recorderRef.current = null;
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

  async function stopAndSubmit() {
    if (phase !== "recording" && phase !== "paused") return;

    setError(null);
    setPhase("submitting");

    try {
      const blob = await stopRecording();
      if (!blob.size) throw new Error("Der blev ikke optaget lyd.");

      const ext = blob.type.includes("ogg") ? "ogg" : "webm";
      const file = new File([blob], `oral-${Date.now()}.${ext}`, {
        type: blob.type || `audio/${ext}`,
      });

      const fd = new FormData();
      fd.append("audio", file);
      fd.append("question", question);
      fd.append("notes", notes);
      fd.append("source_type", "mundtlig_simulator");
      fd.append("scopeFolderIds", JSON.stringify(effectiveScopeFolderIds));
      if (activeFolderId) fd.append("folderId", activeFolderId);

      const res = await fetch("/api/oral/submit", {
        method: "POST",
        body: fd,
      });
      const json = (await res.json().catch(() => null)) as SubmitOk | SubmitErr | null;

      if (!res.ok || !json || json.ok === false) {
        throw new Error((json as SubmitErr | null)?.error || "Aflevering fejlede.");
      }

      setResult(json);
      setPhase("done");

      window.dispatchEvent(new Event("notely:simulator-updated"));
      window.dispatchEvent(new Event("notely:exam-updated"));
    } catch (e: any) {
      setPhase("error");
      setError(e?.message || "Aflevering fejlede.");
    }
  }

  function reset() {
    setPhase("idle");
    setError(null);
    setElapsedMs(0);
    setResult(null);
    setNotes("");
  }

  const showNotes = phase === "recording" || phase === "paused";
  const busy = phase === "submitting";

  return (
    <section className="space-y-4">
      <div className="sticky top-4 z-10">
        <section className="rounded-2xl border border-zinc-200 bg-white p-4 shadow-sm">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <div className="text-xs text-zinc-600">Tid</div>
              <div className="text-lg font-semibold text-zinc-900">{formatClock(elapsedMs)}</div>
            </div>

            <div className="flex items-center gap-2">
              {phase === "idle" && (
                <button
                  type="button"
                  onClick={startRecording}
                  className="rounded-xl border border-zinc-200 bg-zinc-100 px-4 py-2 text-sm font-medium text-zinc-900 hover:bg-zinc-200"
                >
                  Start
                </button>
              )}

              {phase === "recording" && (
                <>
                  <button
                    type="button"
                    onClick={pauseRecording}
                    className="rounded-xl border border-zinc-200 bg-white px-4 py-2 text-sm text-zinc-900 hover:bg-zinc-50"
                  >
                    Pause
                  </button>
                  <button
                    type="button"
                    onClick={stopAndSubmit}
                    className="rounded-xl border border-zinc-200 bg-zinc-100 px-4 py-2 text-sm font-medium text-zinc-900 hover:bg-zinc-200"
                  >
                    Stop &amp; Aflever
                  </button>
                </>
              )}

              {phase === "paused" && (
                <>
                  <button
                    type="button"
                    onClick={resumeRecording}
                    className="rounded-xl border border-zinc-200 bg-white px-4 py-2 text-sm text-zinc-900 hover:bg-zinc-50"
                  >
                    Fortsæt
                  </button>
                  <button
                    type="button"
                    onClick={stopAndSubmit}
                    className="rounded-xl border border-zinc-200 bg-zinc-100 px-4 py-2 text-sm font-medium text-zinc-900 hover:bg-zinc-200"
                  >
                    Stop &amp; Aflever
                  </button>
                </>
              )}

              {phase === "submitting" && (
                <button
                  type="button"
                  disabled
                  className="rounded-xl border border-zinc-200 bg-white px-4 py-2 text-sm text-zinc-500"
                >
                  Afgiver...
                </button>
              )}

              {(phase === "done" || phase === "error") && (
                <button
                  type="button"
                  onClick={reset}
                  className="rounded-xl border border-zinc-200 bg-zinc-100 px-4 py-2 text-sm font-medium text-zinc-900 hover:bg-zinc-200"
                >
                  Ny mundtlig
                </button>
              )}
            </div>
          </div>

          <p className="mt-2 text-xs text-zinc-500">
            Ingen live-afskrift under optagelse. Afskrift vises først efter aflevering.
          </p>
        </section>
      </div>

      <section className="rounded-2xl border border-zinc-200 bg-white p-4 shadow-sm">
        <div className="text-sm font-semibold text-zinc-800">Spørgsmål</div>
        <textarea
          className="mt-2 w-full rounded-xl border border-zinc-300 bg-white px-3 py-2 text-sm outline-none focus:border-zinc-500"
          rows={4}
          placeholder="Indsæt eller skriv spørgsmålet..."
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
          disabled={busy}
        />
      </section>

      {showNotes && (
        <section className="rounded-2xl border border-zinc-200 bg-white p-4 shadow-sm">
          <div className="text-sm font-semibold text-zinc-800">Stikord (valgfrit)</div>
          <textarea
            className="mt-2 w-full rounded-xl border border-zinc-300 bg-white px-3 py-2 text-sm outline-none focus:border-zinc-500"
            rows={4}
            placeholder="Skriv stikord undervejs..."
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            disabled={busy}
          />
        </section>
      )}

      {error && (
        <section className="rounded-2xl border border-red-200 bg-white p-4 text-sm text-red-700 shadow-sm">
          {error}
        </section>
      )}

      {result && (
        <>
          <section className="rounded-2xl border border-zinc-200 bg-white p-4 shadow-sm">
            <div className="flex items-start justify-between gap-3">
              <div>
                <div className="text-sm font-semibold text-zinc-800">Resultat</div>
                <div className="text-xs text-zinc-500">Karakter, score og feedback</div>
              </div>
              <div className="rounded-xl border border-zinc-200 px-3 py-2 text-sm text-zinc-900">
                Karakter: <span className="font-semibold">{result.grade}</span>
                <span className="ml-2 text-zinc-500">({Math.round(result.score)}%)</span>
              </div>
            </div>

            <div className="mt-3 whitespace-pre-wrap rounded-xl border border-zinc-200 bg-white p-3 text-sm text-zinc-800">
              {result.feedback}
            </div>
          </section>

          <details className="rounded-2xl border border-zinc-200 bg-white p-4 shadow-sm">
            <summary className="cursor-pointer text-sm font-semibold text-zinc-800">
              Vis afskrift med tidsstempler
            </summary>

            <div className="mt-3 space-y-2">
              {result.segments.length > 0 ? (
                result.segments.map((segment, i) => (
                  <div key={`${segment.start}-${i}`} className="rounded-xl border border-zinc-200 bg-white p-3 text-sm">
                    <div className="text-xs text-zinc-500">
                      {formatClock(segment.start * 1000)} - {formatClock(segment.end * 1000)}
                    </div>
                    <div className="mt-1 text-zinc-800">{segment.text}</div>
                  </div>
                ))
              ) : (
                <div className="rounded-xl border border-zinc-200 bg-white p-3 text-sm text-zinc-800">
                  {result.transcriptText}
                </div>
              )}
            </div>
          </details>
        </>
      )}
    </section>
  );
}
