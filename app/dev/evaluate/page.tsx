 
"use client";
import { useState } from "react";
import MaterialPickerDialog from "@/components/material/MaterialPickerDialog";

export default function DevEvaluate() {
  const [open, setOpen] = useState(false);
  const [last, setLast] = useState<any>(null);

  async function startEval(args: { set_id?: string; items?: any[] }) {
    setOpen(false);
    const res = await fetch("/api/evaluate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      // I DEV bruger backend v/ shared-secret; her kører vi via session (uden secret)
      body: JSON.stringify({ mode: "light", ...args }),
    });
    const data = await res.json();
    setLast(data);
  }

  return (
    <main className="p-6 space-y-4">
      <h1 className="text-2xl font-semibold">Dev: Evaluate</h1>
      <button className="px-4 py-2 rounded bg-black text-white" onClick={() => setOpen(true)}>
        Vælg materiale…
      </button>

      <MaterialPickerDialog open={open} onClose={() => setOpen(false)} onStartEvaluate={startEval} />

      {last && (
        <pre className="mt-4 p-3 bg-neutral-100 rounded">{JSON.stringify(last, null, 2)}</pre>
      )}
      <p className="opacity-60 text-sm">Tip: gå til <a className="underline" href="/dev/jobs">/dev/jobs</a> for at se remaining + set_id.</p>
    </main>
  );
}



