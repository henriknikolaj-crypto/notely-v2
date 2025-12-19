"use client";
import { useEffect, useState } from "react";

type Cfg = { alpha:number; beta:number; m_lang:number; m_domain:number };

export default function RetrievalTuningPanel() {
  const [cfg, setCfg] = useState<Cfg | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/retrieval-config")
      .then(r => r.ok ? r.json() : Promise.reject(new Error("GET failed")))
      .then(d => setCfg({ alpha:d.alpha, beta:d.beta, m_lang:d.m_lang, m_domain:d.m_domain }))
      .catch(e => setError(e?.message ?? "Load error"));
  }, []);

  async function save(partial: Partial<Cfg>) {
    if (!cfg) return;
    setSaving(true);
    setError(null);
    const next = { ...cfg, ...partial };
    setCfg(next); // optimistisk UI
    try {
      const res = await fetch("/api/retrieval-config", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          alpha: next.alpha,
          beta: next.beta,
          mLang: next.m_lang,
          mDomain: next.m_domain,
        }),
      });
      if (!res.ok) throw new Error("POST failed");
    } catch (e) {
      setError((e as any)?.message ?? "Save error");
    } finally {
      setSaving(false);
    }
  }

  if (error) return <div style={{color:"#b91c1c"}}>Fejl: {error}</div>;
  if (!cfg) return <div>Henter…</div>;

  const Row = ({label, keyName}:{label:string; keyName:keyof Cfg}) => (
    <label style={{display:"grid", gap:4}}>
      <span>{label}: {cfg[keyName].toFixed(2)}</span>
      <input
        type="range" min={0} max={1} step={0.01}
        value={cfg[keyName]}
        onChange={e => save({ [keyName]: Number(e.target.value) } as Partial<Cfg>)}
        disabled={saving}
      />
    </label>
  );

  return (
    <div style={{maxWidth:480, display:"grid", gap:14}}>
      <Row label="α (similarity)" keyName="alpha" />
      <Row label="β (academy)" keyName="beta" />
      <Row label="m_lang (DA boost)" keyName="m_lang" />
      <Row label="m_domain (.dk boost)" keyName="m_domain" />
      <div style={{fontSize:12, opacity:.7}}>
        {saving ? "Gemmer…" : "Ændringer gemmes automatisk"}
      </div>
    </div>
  );
}


