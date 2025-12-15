/* eslint-disable @typescript-eslint/no-explicit-any */
"use client";
import { useEffect, useState } from "react";

type Item = { source_type: "file" | "note"; source_id: string };
type StudySet = { id: string; name: string; last_used_at: string | null };

export default function MaterialPickerDialog({
  open, onClose, onStartEvaluate,
}: {
  open: boolean;
  onClose: () => void;
  onStartEvaluate: (args: { set_id?: string; items?: Item[] }) => void;
}) {
  const [sets, setSets] = useState<StudySet[]>([]);
  const [picked, setPicked] = useState<Item[]>([]);
  const [newSetName, setNewSetName] = useState("");

  useEffect(() => {
    if (!open) return;
    fetch("/api/study-sets").then(r => r.json()).then(d => setSets(d.sets ?? [])).catch(()=>{});
  }, [open]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 bg-black/20 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl p-4 w-full max-w-2xl">
        <h2 className="text-xl mb-3">Vælg materiale</h2>

        {/* C) Vælg eksisterende sæt (senest brugte først) */}
        <div className="mb-4">
          <div className="font-semibold mb-1">C) Vælg eksisterende sæt</div>
          <div className="flex flex-col gap-2 max-h-60 overflow-auto border p-2 rounded">
            {sets.map(s => (
              <button key={s.id} className="text-left px-3 py-2 rounded border hover:bg-neutral-50"
                onClick={() => onStartEvaluate({ set_id: s.id })}>
                <div className="font-medium">{s.name}</div>
                <div className="text-sm opacity-60">
                  {s.last_used_at ? `Senest brugt: ${new Date(s.last_used_at).toLocaleString()}` : "Ikke brugt endnu"}
                </div>
              </button>
            ))}
            {sets.length === 0 && <div className="text-sm opacity-60">Ingen sæt endnu.</div>}
          </div>
        </div>

        {/* B) Gem et nyt sæt ud fra (tom) liste — MVP */}
        <div className="mb-4">
          <div className="font-semibold mb-1">B) Gem som nyt sæt (MVP tomt)</div>
          <div className="flex gap-2">
            <input className="border px-2 py-1 rounded w-full" placeholder="Navn på sæt"
                   value={newSetName} onChange={e => setNewSetName(e.target.value)} />
            <button className="px-3 py-2 rounded bg-neutral-200"
              onClick={async () => {
                if (!newSetName.trim()) return;
                const res = await fetch("/api/study-sets", {
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({ name: newSetName, items: picked })
                });
                if (res.ok) {
                  const d = await res.json();
                  setSets([d.set, ...sets]);
                  setNewSetName("");
                }
              }}>Gem</button>
          </div>
        </div>

        <div className="flex justify-end gap-2">
          <button className="px-3 py-2 rounded" onClick={onClose}>Luk</button>
        </div>
      </div>
    </div>
  );
}


