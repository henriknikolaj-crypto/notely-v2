"use client";
import React, { useEffect, useState } from "react";
import ResetDefaultsButton from "./ResetDefaultsButton";

type CoreKeys = "alpha" | "beta" | "m_lang" | "m_domain";
type Weights = {
  alpha: number;
  beta: number;
  m_lang: number;
  m_domain: number;
  updated_at?: string | null;
  source?: string | null;
};

const DEFAULTS: Weights = {
  alpha: 0.35,
  beta: 0.20,
  m_lang: 0.15,
  m_domain: 0.20,
};

export default function AdminTuningPage() {
  const [w, setW] = useState<Weights>(DEFAULTS);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  // indlæs aktuelle værdier
  useEffect(() => {
    (async () => {
      try {
        const res = await fetch("/api/retrieval-config", { cache: "no-store" });
        const data = await res.json();
        setW({
          alpha: Number(data?.alpha ?? DEFAULTS.alpha),
          beta: Number(data?.beta ?? DEFAULTS.beta),
          m_lang: Number(data?.m_lang ?? DEFAULTS.m_lang),
          m_domain: Number(data?.m_domain ?? DEFAULTS.m_domain),
          updated_at: data?.updated_at ?? null,
          source: data?.source ?? "default",
        });
      } catch {
        // fallback til defaults
        setW(DEFAULTS);
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  function setVal(key: CoreKeys, val: number) {
    const clamped = Math.max(0, Math.min(1, Number.isFinite(val) ? val : 0));
    setW(prev => ({ ...prev, [key]: clamped }));
  }

  async function save() {
    setSaving(true);
    setMsg(null);
    try {
      const body = {
        alpha: w.alpha,
        beta: w.beta,
        m_lang: w.m_lang,
        m_domain: w.m_domain,
      };
      const res = await fetch("/api/retrieval-config", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error ?? "Gemning fejlede");
      setW(prev => ({
        ...prev,
        updated_at: data?.updated_at ?? new Date().toISOString(),
        source: "db",
      }));
      setMsg("Gemt ");
      setTimeout(() => setMsg(null), 1500);
    } catch (e: any) {
      alert(e?.message ?? "Uventet fejl ved gem");
    } finally {
      setSaving(false);
    }
  }

  function Row(props: {
    label: string;
    value: number;
    onChange: (v: number) => void;
  }) {
    const { label, value, onChange } = props;
    return (
      <div style={{ display: "grid", gridTemplateColumns: "160px 1fr 80px", gap: 8, alignItems: "center" }}>
        <div style={{ opacity: 0.9 }}>{label}</div>
        <input
          type="range"
          min={0}
          max={1}
          step={0.01}
          value={Number.isFinite(value) ? value : 0}
          onChange={(e) => onChange(parseFloat(e.target.value))}
        />
        <input
          type="number"
          min={0}
          max={1}
          step={0.01}
          value={Number.isFinite(value) ? value : 0}
          onChange={(e) => onChange(parseFloat(e.target.value))}
          style={{ width: 80, border: "1px solid #cbd5e1", padding: "4px 6px", borderRadius: 6 }}
        />
      </div>
    );
  }

  return (
    <main className="mx-auto max-w-3xl px-4 py-6" style={{ fontFamily: "ui-sans-serif, system-ui", lineHeight: 1.4 }}>
      <h1 style={{ fontSize: 28, fontWeight: 800, marginBottom: 16 }}>Retrieval Tuning</h1>
      <p style={{ fontSize: 13, opacity: 0.8, marginBottom: 16 }}>
        Personlige vægte for ranking og kontekstvalg. (Gemmes pr. bruger)
      </p>

      {loading ? (
        <div>Indlæser</div>
      ) : (
        <div style={{ display: "grid", gap: 12 }}>
          <Row label="α (alpha)" value={w.alpha} onChange={(v) => setVal("alpha", v)} />
          <Row label="β (beta)" value={w.beta} onChange={(v) => setVal("beta", v)} />
          <Row label="m_lang (sprog)" value={w.m_lang} onChange={(v) => setVal("m_lang", v)} />
          <Row label="m_domain (kilde/domæne)" value={w.m_domain} onChange={(v) => setVal("m_domain", v)} />

          <div style={{ display: "flex", gap: 8, alignItems: "center", marginTop: 8 }}>
            <button
              onClick={save}
              disabled={saving}
              style={{ border: "1px solid #cbd5e1", padding: "6px 10px", borderRadius: 6, opacity: saving ? 0.6 : 1 }}
            >
              {saving ? "Gemmer" : "Gem"}
            </button>

            <ResetDefaultsButton />
            {msg && <span style={{ marginLeft: 8, opacity: 0.8 }}>{msg}</span>}
          </div>

          <div style={{ fontSize: 12, opacity: 0.7, marginTop: 8 }}>
            Sidst gemt:{" "}
            {w.updated_at ? new Date(w.updated_at).toLocaleString() : ""}
            {"  "}
            Indlæst fra: {w.source === "db" ? "database" : "defaults"}
          </div>
        </div>
      )}
    </main>
  );
}


