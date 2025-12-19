// app/traener/mc/ClientMC.tsx
"use client";

import { useCallback, useEffect, useState } from "react";

type MCOption = {
  id: string;
  text: string;
  isCorrect: boolean;
};

type MCQuestion = {
  id: string;
  question: string;
  options: MCOption[];
  explanation?: string | null;
  source: "api" | "fallback";
};

type GenerateMcResponse = {
  questionId: string;
  question: string;
  options: MCOption[];
  explanation: string | null;
  // citations er også med i API'et, men vi bruger dem ikke her endnu
};

// Fallback-spørgsmål hvis API'et ikke svarer
const FALLBACK_QUESTIONS: MCQuestion[] = [
  {
    id: "local-q1",
    question: "Hvad er hovedformålet med Notely?",
    options: [
      {
        id: "q1a",
        text: "At være en nordisk studieassistent, der hjælper dig med at forstå dit eget pensum",
        isCorrect: true,
      },
      {
        id: "q1b",
        text: "At erstatte alle lærebøger, så du aldrig behøver at læse igen",
        isCorrect: false,
      },
      {
        id: "q1c",
        text: "At være et generelt AI-chatværktøj uden fokus på studier",
        isCorrect: false,
      },
      {
        id: "q1d",
        text: "Kun at lave flashede marketing-tekster til sociale medier",
        isCorrect: false,
      },
    ],
    explanation:
      "Notely er tænkt som en studieassistent/eksamenstræner, der arbejder ud fra dit eget pensum – ikke som en erstatning for alt andet.",
    source: "fallback",
  },
  {
    id: "local-q2",
    question:
      "Hvad er en god tommelfingerregel for Multiple Choice-spørgsmål i Notely?",
    options: [
      {
        id: "q2a",
        text: "Kun ét korrekt svar, tydeligt adskilt fra distraktorerne",
        isCorrect: true,
      },
      {
        id: "q2b",
        text: "Flere svar, der alle er lige korrekte",
        isCorrect: false,
      },
      {
        id: "q2c",
        text: "Svarmuligheder, der er så uklare som muligt",
        isCorrect: false,
      },
      {
        id: "q2d",
        text: "Altid mindst 8 svarmuligheder",
        isCorrect: false,
      },
    ],
    explanation:
      "MC-spørgsmål bliver stærkest, når der er én klar korrekt mulighed og nogle plausible distraktorer.",
    source: "fallback",
  },
  {
    id: "local-q3",
    question:
      "Hvordan skal MC-delen på sigt fungere i Notely ift. dit pensum?",
    options: [
      {
        id: "q3a",
        text: "Spørgsmålene skal genereres ud fra dine egne noter og filer",
        isCorrect: true,
      },
      {
        id: "q3b",
        text: "Spørgsmålene skal være helt tilfældige uden relation til pensum",
        isCorrect: false,
      },
      {
        id: "q3c",
        text: "Spørgsmålene skal kun handle om Notelys funktioner",
        isCorrect: false,
      },
      {
        id: "q3d",
        text: "Spørgsmålene skal kun komme fra en global amerikansk syllabus",
        isCorrect: false,
      },
    ],
    explanation:
      "Planen er, at MC-spørgsmål på sigt skal trækkes fra dit eget materiale (doc_chunks/quiz-tabeller), så træningen matcher dit fag.",
    source: "fallback",
  },
];

type Props = {
  // bruges til API'et og til exam_sessions – kommer fra venstre kolonne
  scopeFolderIds?: string[];
};

export default function ClientMC({ scopeFolderIds }: Props) {
  // Aktuelt spørgsmål (fra API eller fallback)
  const [currentQuestion, setCurrentQuestion] = useState<MCQuestion | null>(
    null,
  );

  // bruges kun til fallback-rotation (UI). beholdes for at kunne “rulle videre”
  const [, setFallbackIndex] = useState(0);

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [checked, setChecked] = useState(false);

  // Session-statistik (kun i UI)
  const [questionNumber, setQuestionNumber] = useState(1);
  const [attemptCount, setAttemptCount] = useState(0);
  const [correctCount, setCorrectCount] = useState(0);

  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  const [loadingNext, setLoadingNext] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);

  // --- Hjælper: hent nyt spørgsmål (API + fallback) ---
  const fetchNextQuestion = useCallback(
    async (mode: "initial" | "next") => {
      setLoadingNext(true);
      setLoadError(null);

      try {
        const res = await fetch("/api/generate-mc-question", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            scopeFolderIds: scopeFolderIds ?? [],
            difficulty: "medium" as const,
            maxContextChunks: 8,
          }),
        });

        if (!res.ok) {
          throw new Error(`Bad status: ${res.status}`);
        }

        const data = (await res.json()) as GenerateMcResponse;

        const apiQuestion: MCQuestion = {
          id: data.questionId,
          question: data.question,
          options: data.options,
          explanation: data.explanation,
          source: "api",
        };

        setCurrentQuestion(apiQuestion);
      } catch (err) {
        console.error("generate-mc-question error:", err);
        setLoadError(
          "Kunne ikke hente nyt spørgsmål – bruger demo-spørgsmål i stedet.",
        );

        // vælg næste fallback-spørgsmål
        setFallbackIndex((prev) => {
          const next =
            (prev + (mode === "next" ? 1 : 0)) % FALLBACK_QUESTIONS.length;
          setCurrentQuestion(FALLBACK_QUESTIONS[next]);
          return next;
        });
      } finally {
        setLoadingNext(false);
        setSelectedId(null);
        setChecked(false);
        setSaveError(null);

        if (mode === "next") {
          setQuestionNumber((prev) => prev + 1);
        } else {
          setQuestionNumber(1);
        }
      }
    },
    [scopeFolderIds],
  );

  // Hent første spørgsmål når komponenten mountes
  useEffect(() => {
    void fetchNextQuestion("initial");
  }, [fetchNextQuestion]);

  // --- UI-helpers ---
  const correctOption =
    currentQuestion?.options.find((o) => o.isCorrect) || null;

  const isCorrect =
    checked && selectedId && currentQuestion
      ? (currentQuestion.options.find((o) => o.id === selectedId)?.isCorrect ??
        false)
      : false;

  function handleSelect(optionId: string) {
    if (checked) return;
    setSelectedId(optionId);
  }

  async function handleCheck() {
    if (!selectedId || checked || !currentQuestion) return;

    const selectedOption = currentQuestion.options.find(
      (o) => o.id === selectedId,
    );
    if (!selectedOption) return;

    const correct = !!selectedOption.isCorrect;

    setChecked(true);
    setSaving(true);
    setSaveError(null);

    // UI-statistik
    setAttemptCount((prev) => prev + 1);
    if (correct) {
      setCorrectCount((prev) => prev + 1);
    }

    try {
      const res = await fetch("/api/mc-submit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          questionId: currentQuestion.id,
          question: currentQuestion.question,
          selectedOptionId: selectedOption.id,
          selectedOptionText: selectedOption.text,
          isCorrect: correct,
          scopeFolderIds,
          explanation: currentQuestion.explanation ?? null,
        }),
      });

      if (!res.ok) {
        throw new Error(`mc-submit bad status: ${res.status}`);
      }

      // 🔔 Fortæl sidebar'en at der er kommet et nyt MC-forsøg
      if (typeof window !== "undefined") {
        window.dispatchEvent(new Event("notely:mc-updated"));
      }
    } catch (err) {
      console.error("mc-submit fetch error:", err);
      setSaveError("Kunne ikke gemme resultatet (lokal fejl).");
    } finally {
      setSaving(false);
    }
  }

  async function handleNext() {
    if (!checked || loadingNext) return;
    await fetchNextQuestion("next");
  }

  // Første load
  if (!currentQuestion) {
    return (
      <div className="space-y-2 text-xs text-zinc-600">
        <div>Henter første spørgsmål …</div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* statuslinje */}
      <div className="flex items-center justify-between text-xs text-zinc-600">
        <span>
          Spørgsmål #{questionNumber}
          {currentQuestion.source === "fallback" && (
            <span className="ml-2 italic text-zinc-400">(demo)</span>
          )}
        </span>
        <span>
          Rigtige i denne session:{" "}
          <span className="font-medium">
            {correctCount}/{attemptCount}
          </span>
        </span>
      </div>

      <div className="text-sm font-medium text-zinc-900">
        {currentQuestion.question}
      </div>

      <div className="space-y-2">
        {currentQuestion.options.map((opt) => {
          const isActive = selectedId === opt.id;
          const showCorrect = checked && opt.isCorrect;
          const showWrong = checked && isActive && !opt.isCorrect;

          return (
            <button
              key={opt.id}
              type="button"
              onClick={() => handleSelect(opt.id)}
              className={[
                "flex w-full items-center justify-between rounded-xl border px-3 py-2 text-left text-sm transition",
                !checked && !isActive
                  ? "border-zinc-200 bg-white hover:border-zinc-400"
                  : "",
                isActive && !checked
                  ? "border-zinc-900 bg-zinc-900 text-white"
                  : "",
                showCorrect
                  ? "border-emerald-500 bg-emerald-50 text-emerald-900"
                  : "",
                showWrong ? "border-red-500 bg-red-50 text-red-900" : "",
              ]
                .filter(Boolean)
                .join(" ")}
            >
              <span>{opt.text}</span>
              {showCorrect && (
                <span className="ml-3 text-xs font-semibold">Korrekt svar</span>
              )}
              {showWrong && (
                <span className="ml-3 text-xs font-semibold">Forkert svar</span>
              )}
            </button>
          );
        })}
      </div>

      <div className="flex flex-col gap-3 border-t border-zinc-100 pt-3 text-xs text-zinc-600 sm:flex-row sm:items-center sm:justify-between">
        <div>
          {checked && correctOption ? (
            isCorrect ? (
              <>Flot – du svarede rigtigt.</>
            ) : (
              <>
                Korrekt svar:{" "}
                <span className="font-medium">{correctOption.text}</span>
              </>
            )
          ) : (
            <>Vælg et svar og tryk “Tjek svar”.</>
          )}
        </div>

        <div className="flex items-center gap-3">
          {saving && (
            <span className="text-[11px] text-zinc-500">Gemmer resultat …</span>
          )}
          {saveError && !saving && (
            <span className="text-[11px] text-red-600">{saveError}</span>
          )}
          {loadError && !loadingNext && (
            <span className="text-[11px] text-zinc-500">{loadError}</span>
          )}

          <div className="flex gap-2">
            <button
              type="button"
              onClick={handleCheck}
              disabled={!selectedId || checked}
              className="rounded-full border border-zinc-900 px-4 py-1.5 text-xs font-medium disabled:opacity-40"
            >
              Tjek svar
            </button>
            <button
              type="button"
              onClick={handleNext}
              disabled={!checked || loadingNext}
              className="rounded-full bg-zinc-900 px-4 py-1.5 text-xs font-medium text-white disabled:opacity-40"
            >
              {loadingNext ? "Henter…" : "Næste spørgsmål"}
            </button>
          </div>
        </div>
      </div>

      {checked && currentQuestion.explanation && (
        <div className="rounded-xl bg-zinc-50 p-3 text-xs text-zinc-700">
          {currentQuestion.explanation}
        </div>
      )}
    </div>
  );
}
