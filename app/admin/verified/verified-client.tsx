"use client";
import { useMemo, useState } from "react";

type Row = { domain: string; weight: number | null; language?: string | null; note?: string | null };

export default function VerifiedClient({ initialItems }: { initialItems: Row[] }) {
  const [items, setItems] = useState<Row[]>(initialItems);
  const [filter, setFilter] = useState("");
  const [saving, setSaving] = useState(false);

  const shown = useMemo(
    () => items.filter(i => i.domain.toLowerCase().includes(filter.toLowerCase())),
    [items, filter]
  );

  async function refresh() {
    setSaving(true);
    try {
      const res = await fetch("/api/sources/verified", { cache: "no-store" });
      const data = await res.json();
      if (res.ok) setItems(data.items ?? []);
      else alert(data?.error ?? data?.detail ?? JSON.stringify(data) ?? "Kunne ikke hente verified sources");
    } finally {
      setSaving(false);
    }
  }

  function parseWeightFromInput(s: string): number {
    const x = Number((s ?? "").replace(",", "."));
    return isFinite(x) ? x : 0;
  }

  async function save(row: Row) {
    setSaving(true);
    try {
      const res = await fetch("/api/sources/verified/save", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          domain: row.domain,
          weight: row.weight,        // server normaliserer 0..100
          language: row.language ?? null,
          note: row.note ?? null,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        alert(data?.error ?? data?.detail ?? JSON.stringify(data) ?? "Gem fejlede");
        return;
      }
    } finally {
      setSaving(false);
    }
  }

  async function remove(domain: string) {
    if (!confirm(`Slet ${domain}?`)) return;
    setSaving(true);
    try {
      const res = await fetch("/api/sources/verified/delete", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ domain }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        alert(data?.error ?? data?.detail ?? JSON.stringify(data) ?? "Slet fejlede");
        return;
      }
      setItems(prev => prev.filter(x => x.domain !== domain));
    } finally {
      setSaving(false);
    }
  }

  function setField(domain: string, key: keyof Row, value: any) {
    setItems(prev => prev.map(r => (r.domain === domain ? { ...r, [key]: value } : r)));
  }

  // default vægt som "procent" 0..100 (serveren forventer int)
  const [newRow, setNewRow] = useState<Row>({ domain: "", weight: 90, language: null, note: null });

  async function addNew() {
    if (!newRow.domain) { alert("Domæne mangler"); return; }
    await save(newRow);
    setNewRow({ domain: "", weight: 90, language: null, note: null });
    await refresh();
  }

  return (
    <section className="mx-auto max-w-6xl px-4 py-8">
      <h1 className="text-2xl font-bold mb-4">Verified sources</h1>

      <div className="flex gap-3 items-center mb-4">
        <input
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          placeholder="Filter domæne"
          className="border rounded px-2 py-1"
        />
        <button onClick={refresh} disabled={saving} className="border rounded px-3 py-1">
          {saving ? "Arbejder" : "Opdatér"}
        </button>
      </div>

      {/* Tilføj ny */}
      <div className="mb-4 border rounded p-3 bg-white">
        <div className="font-medium mb-2">Tilføj ny kilde</div>
        <div className="grid grid-cols-12 gap-2 items-center">
          <input className="col-span-4 border rounded px-2 py-1" placeholder="domæne"
                 value={newRow.domain} onChange={e => setNewRow({ ...newRow, domain: e.target.value })}/>
          <input className="col-span-2 border rounded px-2 py-1" placeholder="vægt (0100)" inputMode="decimal"
                 value={String(newRow.weight ?? "")}
                 onChange={e => setNewRow({ ...newRow, weight: parseWeightFromInput(e.target.value) })}/>
          <input className="col-span-2 border rounded px-2 py-1" placeholder="language"
                 value={newRow.language ?? ""} onChange={e => setNewRow({ ...newRow, language: e.target.value || null })}/>
          <input className="col-span-3 border rounded px-2 py-1" placeholder="note"
                 value={newRow.note ?? ""} onChange={e => setNewRow({ ...newRow, note: e.target.value || null })}/>
          <button className="col-span-1 border rounded px-2 py-1" onClick={addNew} disabled={saving}>Tilføj</button>
        </div>
      </div>

      {shown.length === 0 ? (
        <p className="opacity-70">Ingen rækker.</p>
      ) : (
        <table className="w-full border-collapse text-sm bg-white">
          <thead>
            <tr className="bg-neutral-100">
              <th className="text-left p-2 border">Domæne</th>
              <th className="text-left p-2 border">Vægt</th>
              <th className="text-left p-2 border">Sprog</th>
              <th className="text-left p-2 border">Note</th>
              <th className="text-left p-2 border">Handling</th>
            </tr>
          </thead>
          <tbody>
            {shown.map((r) => (
              <tr key={r.domain}>
                <td className="p-2 border font-mono">{r.domain}</td>
                <td className="p-2 border">
                  <input inputMode="decimal" className="border rounded px-2 py-1 w-28"
                         value={String(r.weight ?? "")}
                         onChange={e => setField(r.domain, "weight", parseWeightFromInput(e.target.value))}/>
                </td>
                <td className="p-2 border">
                  <input className="border rounded px-2 py-1 w-28"
                         value={r.language ?? ""} onChange={e => setField(r.domain, "language", e.target.value || null)}/>
                </td>
                <td className="p-2 border">
                  <input className="border rounded px-2 py-1 w-full"
                         value={r.note ?? ""} onChange={e => setField(r.domain, "note", e.target.value || null)}/>
                </td>
                <td className="p-2 border">
                  <div className="flex gap-2">
                    <button className="border rounded px-2 py-1" onClick={() => save(r)} disabled={saving}>Gem</button>
                    <button className="border rounded px-2 py-1" onClick={() => remove(r.domain)} disabled={saving}>Slet</button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}


