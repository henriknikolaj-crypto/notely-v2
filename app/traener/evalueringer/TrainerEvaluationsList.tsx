"use client";

import { useState } from "react";

type SessionRow = {
  id: string;
  score: number | null;
  createdPretty: string;
  label: string;
};

type Props = {
  initialSessions: SessionRow[];
};

export default function TrainerEvaluationsList({ initialSessions }: Props) {
  const [sessions, setSessions] = useState<SessionRow[]>(initialSessions);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const handleDelete = async (id: string) => {
    setError(null);
    setBusyId(id);

    try {
      const res = await fetch(`/api/exam-sessions/${id}`, {
        method: "DELETE",
      });

      const data = await res.json().catch(() => null);

      if (!res.ok) {
        const msg = (data as any)?.error || "Kunne ikke slette evaluering.";
        throw new Error(msg);
      }

      // Fjern fra UI-listen
      setSessions((prev) => prev.filter((s) => s.id !== id));
    } catch (err: any) {
      setError(err?.message || "Fejl ved sletning.");
    } finally {
      setBusyId(null);
    }
  };

  if (sessions.length === 0) {
    return (
      <div className="mt-2 text-sm text-zinc-500">
        Du har ingen gemte evalueringer fra Træner.
      </div>
    );
  }

  return (
    <>
      {error && (
        <div className="mb-2 rounded-md bg-red-50 px-3 py-2 text-xs text-red-700">
          {error}
        </div>
      )}

      <ul className="space-y-2">
        {sessions.map((s) => (
          <li
            key={s.id}
            className="flex items-center justify-between gap-3 rounded-xl border border-zinc-200 bg-white px-3 py-2 text-sm"
          >
            <div className="min-w-0">
              <div className="font-medium text-zinc-900">
                {s.score != null
                  ? `Score: ${s.score}/100`
                  : "Score ikke registreret"}
              </div>
              {s.label && (
                <div className="truncate text-[11px] text-zinc-500">
                  {s.label}
                </div>
              )}
              {s.createdPretty && (
                <div className="text-[10px] text-zinc-400">
                  {s.createdPretty}
                </div>
              )}
            </div>

            <button
              type="button"
              onClick={() => handleDelete(s.id)}
              disabled={busyId === s.id}
              className="rounded-lg border border-red-200 px-2 py-1 text-[10px] text-red-600 hover:bg-red-50 disabled:opacity-60"
            >
              {busyId === s.id ? "Sletter..." : "Slet"}
            </button>
          </li>
        ))}
      </ul>

      <p className="mt-2 text-[10px] text-zinc-400">
        {sessions.length} evalueringer vist (maks. 50).
      </p>
    </>
  );
}
