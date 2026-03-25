"use client";

import { useEffect, useMemo, useState } from "react";

/** --- Typer --- */
type EvalRes = {
  score: number;
  feedback: string;
  details?: {
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

const DEFAULT_DEMOS: Demo[] = [
  {
    title: "Kildekritik (historie)",
    prompt: "Forklar, hvordan man vurderer, om en kilde er troværdig. Brug mindst to konkrete kriterier.",
    keywords: ["afsender", "formål", "tendens", "målgruppe", "kontekst", "tid", "samtid"],
  },
];

const LS_RECENT = "trainer:recent-v1";

type RecentItem = {
  when: string;
  title: string;
  score: number;
  answerPreview: string;
};

function evaluateDemoAnswer(answer: string, demo: Demo): EvalRes {
  const lower = answer.toLowerCase();
  const found = demo.keywords.filter((keyword) => lower.includes(keyword.toLowerCase()));
  const missing = demo.keywords.filter((keyword) => !lower.includes(keyword.toLowerCase()));
  const coverage = demo.keywords.length > 0 ? found.length / demo.keywords.length : 0;
  const score = Math.max(2, Math.min(10, Math.round(coverage * 10)));

  let feedback = "Du har fat i emnet, men svaret kan blive mere præcist og mere eksamensklart.";
  if (coverage >= 0.75) {
    feedback = "Stabilt demosvar. Du bruger flere relevante kriterier og viser, hvordan de kan bruges i en vurdering.";
  } else if (coverage >= 0.45) {
    feedback = "Fornuftigt udgangspunkt. Gør svaret stærkere ved at nævne flere konkrete kildekritiske kriterier.";
  }

  if (answer.trim().length < 80) {
    feedback += " Skriv gerne lidt mere sammenhængende, så forklaringen virker mere sikker.";
  }

  return {
    score,
    feedback,
    details: { found, missing },
  };
}

export default function ClientExamUX(props: Props) {
  const demos = (props.demos && props.demos.length > 0 ? props.demos : DEFAULT_DEMOS) as Demo[];

  const initialDemoTitle = props.activeDemoTitle?.trim() || demos[0]?.title || "Demo";

  const [demoTitle] = useState<string>(initialDemoTitle);

  const demo = useMemo(() => {
    return demos.find((d) => d.title === demoTitle) ?? demos[0];
  }, [demos, demoTitle]);

  const [prompt, setPrompt] = useState<string>(demo?.prompt ?? "");
  const [answer, setAnswer] = useState<string>(props.answer ?? "");

  const [evalRes, setEvalRes] = useState<EvalRes | null>(props.evalRes ?? null);
  const [evaluating, setEvaluating] = useState(false);
  const [evalError, setEvalError] = useState<string | null>(null);

  const [recent, setRecent] = useState<RecentItem[]>([]);

  useEffect(() => {
    if (!demo) return;
    setPrompt(demo.prompt);
    setEvalRes(null);
    setEvalError(null);
  }, [demo]);

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

    try {
      const normalized = evaluateDemoAnswer(answer, demo ?? demos[0]);

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

  return (
    <div style={{ padding: 24, border: "1px dashed #bbb" }}>
      <div style={{ marginBottom: 12, fontSize: 12, fontWeight: 600, color: "#075985" }}>
        Demo-materiale: denne øvelse bruger ikke dine egne filer.
      </div>
      <h1 style={{ margin: 0, fontSize: 24 }}>Prøv Træner med et demo-spørgsmål</h1>
      <p style={{ marginTop: 8, marginBottom: 0, color: "#52525b" }}>
        Svar kort og fagligt, og se hvordan Notely giver hurtig feedback.
      </p>

      <div style={{ fontSize: 12, opacity: 0.7, marginTop: 12 }}>
        <div>
          <b>Demo:</b> {demo?.title ?? "Demo"}
        </div>
      </div>

      <label style={{ display: "block", fontWeight: 600, marginTop: 12 }}>
        Opgave
      </label>
      <input
        value={prompt}
        onChange={(e) => setPrompt(e.target.value)}
        style={{ width: 520 }}
        placeholder="Demo-opgaven vises her"
      />

      <label style={{ display: "block", fontWeight: 600, marginTop: 12 }}>
        Skriv dit svar
      </label>
      <input
        value={answer}
        onChange={(e) => setAnswer(e.target.value)}
        style={{ width: 520 }}
        placeholder="Skriv 4-6 faglige sætninger…"
      />

      <p style={{ marginTop: 10, fontSize: 12, color: "#52525b" }}>
        Demoen leder efter centrale begreber som: {(demo?.keywords ?? []).join(", ")}.
      </p>

      <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
        <button
          onClick={onEvaluate}
          disabled={!canEvaluate}
          style={{ padding: "6px 12px" }}
        >
          {evaluating ? "Evaluerer…" : "Evaluer svar"}
        </button>
      </div>

      {evalError && (
        <p style={{ color: "crimson", marginTop: 8 }}>Fejl: {evalError}</p>
      )}

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

      {!!recent.length && (
        <div style={{ marginTop: 20 }}>
          <h3 style={{ margin: 0, fontSize: 16 }}>Seneste demo-forsøg</h3>
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
