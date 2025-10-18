"use client";

type HistoryItem = { id: string; created_at: string; score: number | null; question: string; meta?: { citations?: { title: string; url: string }[] } };
import { useEffect, useMemo, useState } from "react";
import Button from "@/app/_ui/Button";
import Input from "@/app/_ui/Input";

export default function HistoryClient() {
  const [q, setQ] = useState("");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [scoreMin, setScoreMin] = useState(0);
  const [scoreMax, setScoreMax] = useState(100);
  const [limit, setLimit] = useState(10);
  const [offset, setOffset] = useState(0);

  const [items, setItems] = useState<HistoryItem[]>([]);
  const [loading, setLoading] = useState(false);

  const csvHref = useMemo(() => {
    const p = new URLSearchParams({ q, score_min: String(scoreMin), score_max: String(scoreMax) });
    if (dateFrom) p.set("date_from", dateFrom);
    if (dateTo) p.set("date_to", dateTo);
    p.set("format", "csv");
    return `/api/exam-sessions?${p.toString()}`;
  }, [q, scoreMin, scoreMax, dateFrom, dateTo]);

  async function fetchPage(nextOffset = 0) {
    setLoading(true);
    try {
      const p = new URLSearchParams({
        q,
        limit: String(limit),
        offset: String(nextOffset),
        score_min: String(scoreMin),
        score_max: String(scoreMax),
      });
      if (dateFrom) p.set("date_from", dateFrom);
      if (dateTo) p.set("date_to", dateTo);
      const r = await fetch(`/api/exam-sessions?${p.toString()}`);
      const j = await r.json();
      setItems((j.items ?? []) as HistoryItem[]);
      setOffset(nextOffset);
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => { fetchPage(0); }, []);

  return (
    <div className="space-y-4">
      <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-3 p-4 rounded-2xl bg-white shadow-sm">
        <Input placeholder="Søg i tekst" value={q} onChange={(e: React.ChangeEvent<HTMLInputElement>) => setQ(e.target.value)} />
        <Input type="date" value={dateFrom} onChange={(e: React.ChangeEvent<HTMLInputElement>) => setDateFrom(e.target.value)} />
        <Input type="date" value={dateTo} onChange={(e: React.ChangeEvent<HTMLInputElement>) => setDateTo(e.target.value)} />
        <div className="flex gap-2">
          <Input type="number" min={0} max={100} value={scoreMin} onChange={(e: React.ChangeEvent<HTMLInputElement>) => setScoreMin(Number(e.target.value))} />
          <Input type="number" min={0} max={100} value={scoreMax} onChange={(e: React.ChangeEvent<HTMLInputElement>) => setScoreMax(Number(e.target.value))} />
        </div>
        <div className="flex gap-2 col-span-full">
          <Button onClick={() => fetchPage(0)} disabled={loading}>{loading ? "Henter" : "Anvend filtre"}</Button>
          <a className="px-3 py-2 rounded-xl border" href={csvHref}>Download CSV</a>
        </div>
      </div>

      <div className="rounded-2xl bg-white shadow-sm overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-gray-50">
            <tr>
              <th className="text-left p-3">Dato</th>
              <th className="text-left p-3">Score</th>
              <th className="text-left p-3">Spørgsmål</th>
              <th className="text-left p-3">Kilder</th>
            </tr>
          </thead>
          <tbody>
            {items.map((it) => {
              const cites = it.meta?.citations as { title: string; url: string }[] | undefined;
              return (
                <tr key={it.id} className="border-t">
                  <td className="p-3 whitespace-nowrap">{new Date(it.created_at).toLocaleString()}</td>
                  <td className="p-3">{it.score ?? ""}</td>
                  <td className="p-3 max-w-[30ch] truncate" title={it.question}>{it.question}</td>
                  <td className="p-3">
                    <div className="flex gap-1 flex-wrap">
                      {cites?.slice(0,3).map((c, i) => (
                        <a key={i} href={c.url} target="_blank" rel="noreferrer" className="px-2 py-1 rounded-full border">{c.title}</a>
                      ))}
                    </div>
                  </td>
                </tr>
              );
            })}
            {items.length === 0 && (
              <tr><td className="p-6 text-center opacity-60" colSpan={4}>Ingen resultater.</td></tr>
            )}
          </tbody>
        </table>
      </div>

      <div className="flex items-center gap-2">
        <Button onClick={() => fetchPage(Math.max(0, offset - limit))} disabled={loading || offset === 0}>Forrige</Button>
        <Button onClick={() => fetchPage(offset + limit)} disabled={loading}>Næste</Button>
        <span className="opacity-70 text-sm">Offset: {offset}</span>
      </div>
    </div>
  );
}


