"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";

type Phase = "idle" | "recording" | "paused" | "submitting" | "done" | "error";
type Segment = { start: number; end: number; text: string };

type SubmitOk = {
  ok: true;
  sessionId: string;
  grade: number;
  score: number;
  feedback: string;
  transcriptText: string;
  segments: Segment[];
};

type SubmitErr = { ok: false; error: string };

const SIDEBAR_EVENT = "notely:sidebar-examinfo-refresh"; // <- COPY fra ClientWrittenExam
const SOURCE_TYPE = "mundtlig_simulator"; // matcher recent-exam-rounds listen

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
  // @ts-expect-error
  if (typeof MediaRecorder === "undefined") return "";
  // @ts-expect-error
  const ok = (t: string) => MediaRecorder.isTypeSupported?.(t);
  return preferred.find(ok) ?? "";
}

export default function ClientOralExam() {
  const router = useRouter();

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

  useEffect(() => {
    return () => {
      try {
        if (tickRef.current) window.clearInterval(tickRef.current);
        streamRef.current?.getTracks().forEach((t) => t.stop());
      } catch {}
    };
  }, []);

  function startTick() {
    if (tickRef.current) window.clearInterval(tickRef.current);
    const start = Date.now();
    const base = elapsedMs;
    tickRef.current = window.setInterval(() => {
      setElapsedMs(base + (Date.now() - start));
    }, 250);
  }
  function stopTick() {
    if (tickRef.current) window.clearInterval(tickRef.current);
    tickRef.current = null;
  }

  async function ensureMic() {
    if (streamRef.current) return streamRef.current;
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    streamRef.current = stream;
    return stream;
  }

  async function startRecording() {
    setError(null);
    setResult(null);

    try {
      const stream = await ensureMic();
      chunksRef.current = [];

      const mr = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);

      mr.ondataavailable = (e) => {
        if (e.data && e.data.size > 0) chunksRef.current.push(e.data);
      };

      mr.onstart = () => {
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
        setError("Kunne ikke optage lyd (MediaRecorder fejl).");
        stopTick();
      };

      recorderRef.current = mr;
      mr.start();
    } catch (e: any) {
      setPhase("error");
      setError(e?.name === "NotAllowedError" ? "Mikrofon-adgang blev afvist." : "Kunne ikke starte optagelse.");
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
      if (!mr) return reject(new Error("No recorder"));

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
    setError(null);
    setPhase("submitting");

    try {
      const blob = await stopRecording();
      const ext = blob.type.includes("ogg") ? "ogg" : "webm";
      const file = new File([blob], `oral-${Date.now()}.${ext}`, { type: blob.type || `audio/${ext}` });

      const fd = new FormData();
      fd.append("audio", file);
      fd.append("question", question || "");
      fd.append("notes", notes || "");
      fd.append("source_type", SOURCE_TYPE);

      const res = await fetch("/api/oral/submit", { method: "POST", body: fd });
      const json = (await res.json().catch(() => null)) as SubmitOk | SubmitErr | null;

      if (!res.ok || !json || json.ok === false) {
        throw new Error((json as any)?.error || "Submit fejlede");
      }

      setResult(json);
      setPhase("done");

      window.dispatchEvent(new Event(SIDEBAR_EVENT));
      router.refresh();
    } catch (e: any) {
      setPhase("error");
      setError(e?.message || "Submit fejlede");
    }
  }

  function reset() {
    setError(null);
    setPhase("idle");
    setElapsedMs(0);
    setResult(null);
    setNotes("");
  }

  return (
    <div className="mx-auto flex max-w-6xl gap-6 px-4 py-6 md:px-6">
      <main className="min-w-0 flex-1 space-y-4">
        <div className="rounded-2xl border border-zinc-200 bg-white p-4 shadow-sm">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <div className="text-sm font-semibold text-zinc-800">Mundtlig eksamen</div>
              <div className="text-xs text-zinc-500">Ingen live-afskrift. Afskrift vises efter “Stop & Aflever”.</div>
            </div>

            <div className="flex items-center gap-2">
              {phase === "idle" && (
                <button
                  className="rounded-xl border border-zinc-200 bg-white px-3 py-2 text-sm shadow-sm hover:bg-zinc-50"
                  onClick={startRecording}
                >
                  Start
                </button>
              )}

              {phase === "recording" && (
                <>
                  <button
                    className="rounded-xl border border-zinc-200 bg-white px-3 py-2 text-sm shadow-sm hover:bg-zinc-50"
                    onClick={pauseRecording}
                  >
                    Pause
                  </button>
                  <button
                    className="rounded-xl bg-zinc-900 px-3 py-2 text-sm text-white shadow-sm hover:bg-zinc-800"
                    onClick={stopAndSubmit}
                  >
                    Stop &amp; Aflever
                  </button>
                </>
              )}

              {phase === "paused" && (
                <>
                  <button
                    className="rounded-xl border border-zinc-200 bg-white px-3 py-2 text-sm shadow-sm hover:bg-zinc-50"
                    onClick={resumeRecording}
                  >
                    Fortsæt
                  </button>
                  <button
                    className="rounded-xl bg-zinc-900 px-3 py-2 text-sm text-white shadow-sm hover:bg-zinc-800"
                    onClick={stopAndSubmit}
                  >
                    Stop &amp; Aflever
                  </button>
                </>
              )}

              {(phase === "done" || phase === "error") && (
                <button
                  className="rounded-xl border border-zinc-200 bg-white px-3 py-2 text-sm shadow-sm hover:bg-zinc-50"
                  onClick={reset}
                >
                  Ny mundtlig
                </button>
              )}
            </div>
          </div>
        </div>

        <div className="rounded-2xl border border-zinc-200 bg-white p-4 shadow-sm">
          <div className="text-sm font-semibold text-zinc-800">Spørgsmål</div>
          <textarea
            className="mt-2 w-full rounded-xl border border-zinc-200 bg-white p-3 text-sm outline-none focus:ring-2 focus:ring-zinc-200"
            rows={4}
            placeholder="Indsæt eller skriv spørgsmålet…"
            value={question}
            onChange={(e) => setQuestion(e.target.value)}
            disabled={phase === "submitting"}
          />
        </div>

        {(phase === "recording" || phase === "paused") && (
          <div className="rounded-2xl border border-zinc-200 bg-white p-4 shadow-sm">
            <div className="text-sm font-semibold text-zinc-800">Stikord (valgfrit)</div>
            <textarea
              className="mt-2 w-full rounded-xl border border-zinc-200 bg-white p-3 text-sm outline-none focus:ring-2 focus:ring-zinc-200"
              rows={3}
              placeholder="Skriv stikord undervejs…"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
            />
          </div>
        )}

        {error && (
          <div className="rounded-2xl border border-red-200 bg-white p-4 text-sm text-red-700 shadow-sm">{error}</div>
        )}

        {result && (
          <>
            <div className="rounded-2xl border border-zinc-200 bg-white p-4 shadow-sm">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <div className="text-sm font-semibold text-zinc-800">Resultat</div>
                  <div className="text-xs text-zinc-500">Karakter + feedback (afskrift nedenfor)</div>
                </div>
                <div className="rounded-xl border border-zinc-200 px-3 py-2 text-sm">
                  <span className="text-zinc-500">Karakter:</span>{" "}
                  <span className="font-semibold text-zinc-900">{result.grade}</span>
                </div>
              </div>

              <div className="mt-3 whitespace-pre-wrap rounded-xl border border-zinc-200 bg-white p-3 text-sm text-zinc-800">
                {result.feedback}
              </div>
            </div>

            <details className="rounded-2xl border border-zinc-200 bg-white p-4 shadow-sm">
              <summary className="cursor-pointer text-sm font-semibold text-zinc-800">Afskrift (tidsstempler)</summary>
              <div className="mt-3 space-y-2">
                {result.segments?.length ? (
                  result.segments.map((s, i) => (
                    <div key={i} className="rounded-xl border border-zinc-200 bg-white p-3 text-sm">
                      <div className="text-xs text-zinc-500">
                        {formatClock(s.start * 1000)} – {formatClock(s.end * 1000)}
                      </div>
                      <div className="mt-1 text-zinc-800">{s.text}</div>
                    </div>
                  ))
                ) : (
                  <div className="text-sm text-zinc-700">{result.transcriptText}</div>
                )}
              </div>
            </details>
          </>
        )}
      </main>

      <aside className="hidden w-64 shrink-0 md:block">
        <div className="sticky top-6 space-y-3">
          <div className="rounded-2xl border border-zinc-200 bg-white p-4 shadow-sm">
            <div className="text-xs font-semibold text-zinc-500">Tid</div>
            <div className="mt-1 text-3xl font-semibold text-zinc-900">{formatClock(elapsedMs)}</div>
            <div className="mt-2 text-xs text-zinc-500">
              Status: <span className="font-semibold text-zinc-800">{phase}</span>
            </div>
          </div>
        </div>
      </aside>
    </div>
  );
}
