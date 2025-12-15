/* eslint-disable @typescript-eslint/no-explicit-any */
"use client";
import { useEffect, useState } from "react";

type JobRow = { id: string; kind: string; status: string; created_at: string; remaining: number|null; set_id: string|null };

export default function DevJobs() {
  const [rows, setRows] = useState<JobRow[]>([]);
  const [err, setErr] = useState<string | null>(null);

  async function load() {
    setErr(null);
    try {
      const res = await fetch("/api/jobs");
      if (!res.ok) throw new Error(await res.text());
      const d = await res.json();
      setRows(d.jobs ?? []);
    } catch (e:any) {
      setErr(e.message || "Fejl");
    }
  }

  useEffect(() => { load(); }, []);

  return (
    <main className="p-6">
      <h1 className="text-2xl font-semibold mb-3">Dev: Jobs</h1>
      <button className="px-3 py-2 rounded bg-black text-white" onClick={load}>Opdater</button>
      {err && <div className="text-red-600 mt-2">{err}</div>}
      <div className="mt-4 grid gap-2">
        {rows.map(j => (
          <div key={j.id} className="border rounded p-3">
            <div className="font-mono text-sm">{j.id}</div>
            <div className="text-sm">{j.kind} · <span className="font-semibold">{j.status}</span></div>
            <div className="text-sm opacity-70">{new Date(j.created_at).toLocaleString()}</div>
            <div className="text-sm mt-1">remaining: <b>{j.remaining ?? "—"}</b></div>
            <div className="text-sm">payload.set_id: <b>{j.set_id ?? "—"}</b></div>
          </div>
        ))}
        {rows.length === 0 && <div className="opacity-60">Ingen jobs endnu.</div>}
      </div>
    </main>
  );
}



