"use client";

import { useEffect, useMemo, useState } from "react";

/** --- Typer --- */
type EvalRes = {
  score: number;
  feedback: string;
  details?: {
    tokens?: number;
    keywordScore?: number;
    found?: string[];
    missing?: string[];
  };
};

type Demo = {
  title: string;
  prompt: string;
  keywords: string[];
};

type Props = {
  ownerId?: string;
  evalRes?: EvalRes | null;
  answer?: string;
  activeDemoTitle?: string;
  demos?: Demo[];
};

/** --- Demo-data (kan udvides senere) --- */
const DEFAULT_DEMOS: Demo[] = [
  {
    title: "Fotosyntese (biologi – 8./9. kl.)",
    prompt: "Forklar kort hvad fotosyntese er.",
    keywords: ["lys", "co2", "vand", "glukose", "ilt", "klorofyl", "energi"],
  },
];

/** localStorage key til seneste evalueringer */
const LS_RECENT = "trainer:recent-v1";

function parseKeywords(input: string | string[] | null | undefined): string[] {
  if (Array.isArray(input)) {
    return input
      .flatMap((x) => String(x).split(","))
      .map((s) => s.trim().toLowerCase())
      .filter(Boolean);
  }
  if (typeof input === "string") {
    return input
      .split(",")
      .map((s) => s.trim().toLowerCase())
      .filter(Boolean);
  }
  return [];
}

type RecentItem = {
  when: string; // ISO
  title: string;
  score: number;
  answerPreview: string;
};

/** --- Komponent --- */
export default function ClientExamUX(props: Props) {
  const demos = (props.demos && props.demos.length > 0 ? props.demos : DEFAULT_DEMOS) as Demo[];

  const ownerId = props.ownerId ?? "";
  const initialDemoTitle = props.activeDemoTitle?.trim() || demos[0]?.title || "Demo";

  const [demoTitle, setDemoTitle] = useState<string>(initialDemoTitle);

  const demo = useMemo(() => {
    return demos.find((d) => d.title === demoTitle) ?? demos[0];
  }, [demos, demoTitle]);

  const [prompt, setPrompt] = useState<string>(demo?.prompt ?? "");
  const [answer, setAnswer] = useState<string>(props.answer ?? "");
  const [keywordsStr, setKeywordsStr] = useState<string>((demo?.keywords ?? []).join(", "));

  const [evalRes, setEvalRes] = useState<EvalRes | null>(props.evalRes ?? null);
  const [evaluating, setEvaluating] = useState(false);
  const [evalError, setEvalError] = useState<string | null>(null);

  const [saving, setSaving] = useState(false);
  const [saveMsg, setSaveMsg] = useState<string | null>(null);
  const [showPreview, setShowPreview] = useState(false);

  const [recent, setRecent] = useState<RecentItem[]>([]);

  // Sync når demo skiftes
  useEffect(() => {
    if (!demo) return;
    setPrompt(demo.prompt);
    setKeywordsStr(demo.keywords.join(", "));
    setEvalRes(null);
    setEvalError(null);
    setSaveMsg(null);
  }, [demo]);

  // Load seneste evalueringer
  useEffect(() => {
    try {
      const raw = localStorage.getItem(LS_RECENT);
      if (raw) setRecent(JSON.parse(raw));
    } catch {
      /* ignore */
    }
  }, []);

  function pushRecent(item: RecentItem) {
    try {
      setRecent((prev) => {
        const next = [item, ...prev].slice(0, 5);
        localStorage.setItem(LS_RECENT, JSON.stringify(next));
        return next;
      });
    } catch {
      /* ignore */
    }
  }

  async function onEvaluate() {
    setEvaluating(true);
    setEvalError(null);
    setSaveMsg(null);

    try {
      const body = {
        prompt,
        answer,
        keywords: parseKeywords(keywordsStr),
      };

      const res = await fetch("/api/evaluate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });

      if (!res.ok) throw new Error(`HTTP ${res.status}`);

      const data: any = await res.json();

      // støt både {score,feedback} og {ok:true,result:{...}}-former
      const normalized: EvalRes = data?.result?.score != null
        ? data.result
        : data;

      if (typeof normalized?.score !== "number" || typeof normalized?.feedback !== "string") {
        throw new Error("Uventet svarformat fra /api/evaluate");
      }

      setEvalRes(normalized);

      pushRecent({
        when: new Date().toISOString(),
        title: demo?.title ?? "Demo",
        score: normalized.score ?? 0,
        answerPreview: (answer || "").slice(0, 80),
      });
    } catch (e: any) {
      setEvalError(e?.message ?? "Ukendt fejl");
    } finally {
      setEvaluating(false);
    }
  }

  const canEvaluate = answer.trim().length > 0 && !evaluating;

  const noteMarkdown = useMemo(() => {
    if (!evalRes) return "";
    const found = evalRes.details?.found?.join(", ") || "-";
    const missing = evalRes.details?.missing?.join(", ") || "-";

    return [
      `### ${demo?.title ?? "Demo"}`,
      `**Score:** ${evalRes.score}/10`,
      ``,
      `**Feedback:** ${evalRes.feedback}`,
      ``,
      `**Fundet:** ${found}`,
      `**Mangler:** ${missing}`,
      ``,
      `**Opgave:** ${prompt}`,
      ``,
      `**Dit svar:**`,
      answer || "(tomt)",
    ].join("\n");
  }, [evalRes, demo?.title, prompt, answer]);

  const canSave = Boolean(evalRes && !saving);

  async function saveToNotes() {
    if (!canSave || !evalRes) return;

    setSaving(true);
    setSaveMsg(null);

    try {
      const body = {
        title: `${demo?.title ?? "Demo"} – score ${evalRes.score}/10`,
        content: noteMarkdown,
        source_title: "Træner",
        source_url: "/traener/ux",
        note_type: "trainer_feedback",
      };

      const res = await fetch("/api/notes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });

      if (!res.ok) throw new Error(`POST /api/notes ${res.status}`);

      setSaveMsg("Gemt i noter ✅");
    } catch (e: any) {
      setSaveMsg(`Kunne ikke gemme noter: ${e?.message ?? e}`);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div style={{ padding: 24, border: "1px dashed #bbb" }}>
      <h1>Client-UI OK</h1>
      <p>Hydration kører. Her kan den rigtige ClientExamUX-UI indsættes senere.</p>

      <div style={{ fontSize: 12, opacity: 0.7, marginBottom: 8 }}>
        <div>
          <b>ownerId:</b> {ownerId || "(ukendt)"}
        </div>
      </div>

      {/* Demo-vælger */}
      <label style={{ display: "block", fontWeight: 600, marginTop: 12 }}>
        Demo-opgave
      </label>
      <select
        value={demoTitle}
        onChange={(e) => setDemoTitle(e.target.value)}
        style={{ width: 380 }}
      >
        {demos.map((d) => (
          <option key={d.title} value={d.title}>
            {d.title}
          </option>
        ))}
      </select>

      {/* Prompt */}
      <label style={{ display: "block", fontWeight: 600, marginTop: 12 }}>
        Opgave
      </label>
      <input
        value={prompt}
        onChange={(e) => setPrompt(e.target.value)}
        style={{ width: 520 }}
        placeholder="Skriv opgaven her…"
      />

      {/* Answer */}
      <label style={{ display: "block", fontWeight: 600, marginTop: 12 }}>
        Skriv dit svar
      </label>
      <input
        value={answer}
        onChange={(e) => setAnswer(e.target.value)}
        style={{ width: 520 }}
        placeholder="Kort svar…"
      />

      {/* Keywords */}
      <label style={{ display: "block", fontWeight: 600, marginTop: 12 }}>
        Keywords (komma-separeret)
      </label>
      <input
        value={keywordsStr}
        onChange={(e) => setKeywordsStr(e.target.value)}
        style={{ width: 520 }}
        placeholder="lys, co2, vand, glukose, ilt, klorofyl, energi"
      />

      {/* Actions */}
      <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
        <button
          onClick={onEvaluate}
          disabled={!canEvaluate}
          style={{ padding: "6px 12px" }}
        >
          {evaluating ? "Evaluerer…" : "Evaluer svar"}
        </button>

        <button
          onClick={saveToNotes}
          disabled={!canSave}
          style={{ padding: "6px 12px" }}
        >
          {saving ? "Gemmer…" : "Gem i noter"}
        </button>

        {saveMsg && <span style={{ opacity: 0.7 }}>{saveMsg}</span>}
      </div>

      {/* Eval fejl */}
      {evalError && (
        <p style={{ color: "crimson", marginTop: 8 }}>Fejl: {evalError}</p>
      )}

      {/* Resultat */}
      {evalRes && (
        <div style={{ marginTop: 12 }}>
          <div>
            <b>Score:</b> {evalRes.score}/10
          </div>
          <div>
            <b>Feedback:</b> {evalRes.feedback}
          </div>
          <div>
            <b>Fundet:</b> {evalRes.details?.found?.join(", ") || "-"}
          </div>
          <div>
            <b>Mangler:</b> {evalRes.details?.missing?.join(", ") || "-"}
          </div>
        </div>
      )}

      {/* Note-preview */}
      {evalRes && (
        <div style={{ marginTop: 10 }}>
          <button
            onClick={() => setShowPreview((s) => !s)}
            style={{ padding: "4px 10px" }}
          >
            {showPreview ? "Skjul forhåndsvisning" : "Vis forhåndsvisning"}
          </button>

          {showPreview && (
            <pre
              style={{
                marginTop: 8,
                padding: 10,
                background: "#f7f7f7",
                border: "1px solid #e5e5e5",
                whiteSpace: "pre-wrap",
              }}
            >
              {noteMarkdown}
            </pre>
          )}
        </div>
      )}

      {/* Seneste evalueringer (localStorage) */}
      {!!recent.length && (
        <div style={{ marginTop: 20 }}>
          <h3 style={{ margin: 0, fontSize: 16 }}>Seneste evalueringer</h3>
          <ul style={{ marginTop: 6 }}>
            {recent.map((r, i) => (
              <li key={`${r.when}-${i}`}>
                {new Date(r.when).toLocaleString("da-DK")} — <b>{r.title}</b> — score {r.score}/10 —{" "}
                <span style={{ opacity: 0.7 }}>{r.answerPreview}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
