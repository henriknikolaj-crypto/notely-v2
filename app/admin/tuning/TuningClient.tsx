"use client";

import { useEffect, useState } from "react";

type Weights = {
  alpha: number;
  beta: number;
  m_lang: number;
  m_domain: number;
};

type SaveOpts = {
  reset?: boolean;
};

const DEFAULTS: Weights = {
  alpha: 0.35,
  beta: 0.20,
  m_lang: 0.15,
  m_domain: 0.20,
};

export default function TuningPage() {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [updatedAt, setUpdatedAt] = useState<string | null>(null);
  const [vals, setVals] = useState<Weights>(DEFAULTS);

  useEffect(() => {
    let isMounted = true;
    (async () => {
      try {
        const res = await fetch("/api/retrieval-config", { cache: "no-store" });
        if (!res.ok) throw new Error(`GET failed: ${res.status}`);
        const data = await res.json();
        if (!isMounted) return;

        setVals({
          alpha: Number(data.alpha ?? DEFAULTS.alpha),
          beta: Number(data.beta ?? DEFAULTS.beta),
          m_lang: Number(data.m_lang ?? DEFAULTS.m_lang),
          m_domain: Number(data.m_domain ?? DEFAULTS.m_domain),
        });

        setUpdatedAt(data.updated_at ?? null);
        setStatus(data.source === "db" ? "Indlæst fra database" : "Bruger defaults");
      } catch (e: any) {
        setStatus(`Kunne ikke hente konfiguration: ${e.message ?? e}`);
        setVals(DEFAULTS);
      } finally {
        if (isMounted) setLoading(false);
      }
    })();

    return () => {
      isMounted = false;
    };
  }, []);

  async function save(next?: Partial<Weights>, opts: SaveOpts = {}) {
    const reset = !!opts.reset;

    setSaving(true);
    setStatus(null);

    try {
      const payload = reset ? { reset: true } : { ...vals, ...(next ?? {}) };

      const res = await fetch("/api/retrieval-config", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      if (!res.ok) throw new Error(`POST failed: ${res.status}`);

      const data = await res.json();

      setVals({
        alpha: Number(data.alpha),
        beta: Number(data.beta),
        m_lang: Number(data.m_lang),
        m_domain: Number(data.m_domain),
      });

      setUpdatedAt(data.updated_at ?? null);
      setStatus("Gemt ✔");
    } catch (e: any) {
      setStatus(`Fejl ved gem: ${e.message ?? e}`);
    } finally {
      setSaving(false);
    }
  }

  function SliderRow(props: { label: string; value: number; onChange: (v: number) => void }) {
    return (
      <div className="mb-6">
        <div className="flex items-center justify-between mb-2">
          <label className="font-medium">{props.label}</label>
          <span className="tabular-nums">{props.value.toFixed(2)}</span>
        </div>
        <input
          type="range"
          min={0}
          max={1}
          step={0.01}
          value={props.value}
          onChange={(e) => props.onChange(parseFloat(e.target.value))}
          className="w-full"
        />
      </div>
    );
  }

  return (
    <main className="max-w-xl mx-auto p-6">
      <h1 className="text-2xl font-semibold mb-1">Retrieval Tuning</h1>
      <p className="text-sm text-gray-600 mb-6">
        Personlige vægte for ranking og kontekstvalg. (Gemmes pr. bruger)
      </p>

      {loading ? (
        <p>Henter…</p>
      ) : (
        <>
          <div className="rounded-2xl shadow p-5 bg-white border">
            <SliderRow label="α (alpha)" value={vals.alpha} onChange={(v) => setVals((s) => ({ ...s, alpha: v }))} />
            <SliderRow label="β (beta)" value={vals.beta} onChange={(v) => setVals((s) => ({ ...s, beta: v }))} />
            <SliderRow
              label="m_lang (sprog)"
              value={vals.m_lang}
              onChange={(v) => setVals((s) => ({ ...s, m_lang: v }))}
            />
            <SliderRow
              label="m_domain (kilde/domæne)"
              value={vals.m_domain}
              onChange={(v) => setVals((s) => ({ ...s, m_domain: v }))}
            />

            <div className="flex items-center gap-3 mt-2">
              <button
                onClick={() => save()}
                disabled={saving}
                className="px-4 py-2 rounded-xl border bg-black text-white disabled:opacity-50"
                title="Gemmer vægte til din profil"
              >
                {saving ? "Gemmer…" : "Gem"}
              </button>

              <button
                onClick={() => save(DEFAULTS, { reset: true })}
                disabled={saving}
                className="px-4 py-2 rounded-xl border"
                title="(Midlt.) overskriv med defaults; næste iteration sletter vi rækken"
              >
                Nulstil til defaults
              </button>
            </div>
          </div>

          <div className="mt-3 text-sm text-gray-600">
            {updatedAt && <p>Sidst gemt: {new Date(updatedAt).toLocaleString("da-DK")}</p>}
            {status && <p>{status}</p>}
          </div>
        </>
      )}
    </main>
  );
}
