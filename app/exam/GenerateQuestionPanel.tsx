/* eslint-disable @typescript-eslint/no-explicit-any */
"use client";

import { useState } from "react";

export default function GenerateQuestionPanel() {
  const [question, setQuestion] = useState<string | null>(null);
  const [answer, setAnswer] = useState("");
  const [feedback, setFeedback] = useState("");
  const [score, setScore] = useState<number | null>(null);

  async function generateQuestion(includeBackground: boolean) {
    try {
      const res = await fetch("/api/generate-question", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ includeBackground }),
      });
      const data = await res.json();
      setQuestion(data.question || "Fejl: ingen data fra API");
      setFeedback("");
      setScore(null);
    } catch (err) {
      setQuestion("Fejl ved forespørgsel");
    }
  }

  async function evaluateAnswer() {
    if (!question) return;
    try {
      const res = await fetch("/api/evaluate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ question, answer }),
      });
      const data = await res.json();
      setFeedback(data.feedback || "Ingen feedback modtaget");
      setScore(data.score ?? null);
    } catch {
      setFeedback("Fejl ved evaluering");
    }
  }

  return (
    <div>
      <h2 className="text-lg font-bold mb-2">Eksamensspørgsmål</h2>
      {question ? (
        <>
          <p>{question}</p>
          <textarea
            value={answer}
            onChange={(e) => setAnswer(e.target.value)}
            className="w-full h-24 border mt-2"
            placeholder="Skriv dit svar her..."
          />
          <button
            onClick={evaluateAnswer}
            className="mt-2 px-4 py-1 border bg-gray-100 hover:bg-gray-200"
          >
            Evaluer mit svar
          </button>
          {feedback && (
            <div className="mt-4 border-t pt-2">
              <p><b>Feedback:</b> {feedback}</p>
              {score !== null && <p><b>Score:</b> {score}/100</p>}
            </div>
          )}
        </>
      ) : (
        <button
          onClick={() => generateQuestion(false)}
          className="px-4 py-1 border bg-gray-100 hover:bg-gray-200"
        >
          Generér nyt spørgsmål
        </button>
      )}
    </div>
  );
}

