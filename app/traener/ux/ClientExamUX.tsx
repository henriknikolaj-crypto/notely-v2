"use client";

import { useState } from "react";

type EvalDetails = {
  score: number;
  feedback: string;
  details?: {
    tokens?: number;
    keywords?: string[];
    found?: string[];
    missing?: string[];
  };
};

type Props = {
  ownerId: string;
  evalRes: EvalDetails | null;
  answer: string;
  activeDemoTitle: string;
};

export default function ClientExamUX({
  ownerId,
  evalRes,
  answer,
  activeDemoTitle,
}: Props) {
  const [saving, setSaving] = useState(false);
  const [saveMsg, setSaveMsg] = useState<string | null>(null);

  // Kun tillad "Gem i noter" når vi har en evaluering, ikke gemmer, og der faktisk er et svar
  const canSave = Boolean(evalRes && !saving && answer.trim().length > 0);

  async function saveToNotes() {
    if (!canSave || !evalRes) return;

    setSaving(true);
    setSaveMsg(null);

    try {
      const body = {
        title: `${evalRes.score}/10 – ${activeDemoTitle}`,
        content: answer || "(tomt svar)",
        source_title: "Træner",
        source_url: "/traener/ux",
      };

      const res = await fetch("/api/notes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });

      if (!res.ok) throw new Error(`POST /api/notes ${res.status}`);
      setSaveMsg("Gemt i noter ✅");
    } catch (e: any) {
      setSaveMsg(`Kunne ikke gemme noter: ${e?.message ?? String(e)}`);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div style={{ padding: 24, border: "1px dashed #bbb" }}>
      <h1>Client-UI OK</h1>
      <p>Hydration kører. Her kan den rigtige ClientExamUX indsættes senere.</p>

      <hr style={{ margin: "16px 0" }} />

      <div style={{ fontSize: 12, opacity: 0.7 }}>
        <div>
          <b>ownerId:</b> {ownerId || "(ukendt)"}
        </div>
        <div>
          <b>demo:</b> {activeDemoTitle}
        </div>
        <div>
          <b>answer:</b> {answer ? answer.slice(0, 60) : "(tomt)"}
        </div>
        <div>
          <b>evalRes:</b> {evalRes ? `${evalRes.score}/10` : "(ingen endnu)"}
        </div>
      </div>

      <div style={{ marginTop: 12, display: "flex", gap: 8 }}>
        <button onClick={saveToNotes} disabled={!canSave} style={{ padding: "6px 12px" }}>
          {saving ? "Gemmer…" : "Gem i noter"}
        </button>
        {saveMsg && <span style={{ opacity: 0.7 }}>{saveMsg}</span>}
      </div>
    </div>
  );
}
