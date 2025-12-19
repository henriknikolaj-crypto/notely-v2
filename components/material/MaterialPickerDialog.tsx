// components/material/MaterialPickerDialog.tsx
"use client";

import { useEffect, useState } from "react";

type Item = { source_type: "file" | "note"; source_id: string };
type StudySet = { id: string; name: string; last_used_at: string | null };

export default function MaterialPickerDialog({
  open,
  onClose,
  onStartEvaluate,
}: {
  open: boolean;
  onClose: () => void;
  onStartEvaluate: (args: { set_id?: string; items?: Item[] }) => void;
}) {
  const [sets, setSets] = useState<StudySet[]>([]);
  const [picked, setPicked] = useState<Item[]>([]);
  const [newSetName, setNewSetName] = useState("");

  // lint: MVP – picked/setPicked er allerede klar til “vælg materiale”-UI senere
  void setPicked;

  useEffect(() => {
    if (!open) return;

    fetch("/api/study-sets")
      .then((r) => r.json())
      .then((d) => setSets(d.sets ?? []))
      .catch(() => {});
  }, [open]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 flex items-center justify-center bg-black/20 p-4">
      <div className="w-full max-w-2xl rounded-2xl bg-white p-4">
        <h2 className="mb-3 text-xl">Vælg materiale</h2>

        {/* C) Vælg eksisterende sæt (senest brugte først) */}
        <div className="mb-4">
          <div className="mb-1 font-semibold">C) Vælg eksisterende sæt</div>
          <div className="flex max-h-60 flex-col gap-2 overflow-auto rounded border p-2">
            {sets.map((s) => (
              <button
                key={s.id}
                className="rounded border px-3 py-2 text-left hover:bg-neutral-50"
                onClick={() => onStartEvaluate({ set_id: s.id })}
                type="button"
              >
                <div className="font-medium">{s.name}</div>
                <div className="text-sm opacity-60">
                  {s.last_used_at
                    ? `Senest brugt: ${new Date(s.last_used_at).toLocaleString(
                        "da-DK"
                      )}`
                    : "Ikke brugt endnu"}
                </div>
              </button>
            ))}
            {sets.length === 0 && (
              <div className="text-sm opacity-60">Ingen sæt endnu.</div>
            )}
          </div>
        </div>

        {/* B) Gem et nyt sæt ud fra (tom) liste — MVP */}
        <div className="mb-4">
          <div className="mb-1 font-semibold">B) Gem som nyt sæt (MVP tomt)</div>
          <div className="flex gap-2">
            <input
              className="w-full rounded border px-2 py-1"
              placeholder="Navn på sæt"
              value={newSetName}
              onChange={(e) => setNewSetName(e.target.value)}
            />
            <button
              className="rounded bg-neutral-200 px-3 py-2"
              type="button"
              onClick={async () => {
                if (!newSetName.trim()) return;

                const res = await fetch("/api/study-sets", {
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({ name: newSetName, items: picked }),
                });

                if (res.ok) {
                  const d = await res.json().catch(() => null);
                  if (d?.set) setSets([d.set, ...sets]);
                  setNewSetName("");
                }
              }}
            >
              Gem
            </button>
          </div>
        </div>

        <div className="flex justify-end gap-2">
          <button className="rounded px-3 py-2" onClick={onClose} type="button">
            Luk
          </button>
        </div>
      </div>
    </div>
  );
}
