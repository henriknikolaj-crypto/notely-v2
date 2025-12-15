"use client";

import { useState } from "react";

type MCOption = {
  id: string;
  text: string;
  isCorrect: boolean;
};

type MCQuestion = {
  id: string;
  question: string;
  options: MCOption[];
  explanation?: string;
};

const DEMO_QUESTIONS: MCQuestion[] = [
  {
    id: "q1",
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
  },
  {
    id: "q2",
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
  },
  {
    id: "q3",
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
  },
];

export default function ClientMC() {
  const [index, setIndex] = useState(0);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [checked, setChecked] = useState(false);

  const question = DEMO_QUESTIONS[index];
  const correctOption = question.options.find((o) => o.isCorrect) || null;

  const isCorrect =
    checked && selectedId
      ? question.options.find((o) => o.id === selectedId)?.isCorrect ?? false
      : false;

  function handleSelect(optionId: string) {
    if (checked) return; // lås svar efter tjek
    setSelectedId(optionId);
  }

  function handleCheck() {
    if (!selectedId) return;
    setChecked(true);
  }

  function handleNext() {
    const nextIndex = (index + 1) % DEMO_QUESTIONS.length;
    setIndex(nextIndex);
    setSelectedId(null);
    setChecked(false);
  }

  return (
    <div className="space-y-6">
      <header className="flex flex-col gap-2 sm:flex-row sm:items-baseline sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">
            Multiple Choice
          </h1>
          <p className="text-sm text-neutral-500">
            Demo-version – senere kommer spørgsmålene fra dit eget pensum.
          </p>
        </div>
        <div className="text-xs text-neutral-500">
          Spørgsmål {index + 1} af {DEMO_QUESTIONS.length}
        </div>
      </header>

      <section className="rounded-2xl border border-neutral-200 bg-white p-5 shadow-sm">
        <div className="mb-4 text-lg font-semibold text-neutral-900">
          {question.question}
        </div>

        <div className="space-y-2">
          {question.options.map((opt) => {
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
                    ? "border-neutral-200 bg-white hover:border-neutral-400"
                    : "",
                  isActive && !checked
                    ? "border-neutral-900 bg-neutral-900 text-white"
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
                  <span className="ml-3 text-xs font-semibold">
                    Korrekt svar
                  </span>
                )}
                {showWrong && (
                  <span className="ml-3 text-xs font-semibold">
                    Forkert svar
                  </span>
                )}
              </button>
            );
          })}
        </div>

        <div className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="text-xs text-neutral-500">
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

          <div className="flex gap-2">
            <button
              type="button"
              onClick={handleCheck}
              disabled={!selectedId || checked}
              className="rounded-full border border-neutral-900 px-4 py-2 text-sm font-medium disabled:opacity-40"
            >
              Tjek svar
            </button>
            <button
              type="button"
              onClick={handleNext}
              disabled={!checked}
              className="rounded-full bg-neutral-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-40"
            >
              Næste spørgsmål
            </button>
          </div>
        </div>

        {checked && question.explanation && (
          <div className="mt-4 rounded-xl bg-neutral-50 p-3 text-xs text-neutral-700">
            {question.explanation}
          </div>
        )}
      </section>
    </div>
  );
}
