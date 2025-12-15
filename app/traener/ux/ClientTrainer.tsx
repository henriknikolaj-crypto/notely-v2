// app/traener/ux/ClientTrainer.tsx
"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

type Folder = { id: string; name: string };

type Props = {
  // Nyt setup (fra /traener/page.tsx)
  ownerId?: string; // gemt til senere brug
  activeFolderId?: string | null;
  folders?: Folder[];
  scopeFolderIds?: string[]; // mapper, der er valgt som scope

  // Eksisterende/ældre props (beholdt for kompatibilitet)
  folderId?: string | null;
  folderName?: string | null;
  noteId?: string | null;
  selectedNoteTitle?: string | null;
};

type EvalResult = {
  feedback: string;
  score: number | null;
  sources?: string[];
};

export default function ClientTrainer({
  ownerId, // pt. ikke brugt, men fin at have til senere
  activeFolderId,
  folders,
  scopeFolderIds,
  folderId,
  folderName,
  noteId,
  selectedNoteTitle,
}: Props) {
  const router = useRouter();

  // 1) brug explicit folderId hvis givet
  // 2) ellers activeFolderId fra layout
  // 3) ellers null
  const effectiveFolderId = folderId ?? activeFolderId ?? null;

  const effectiveFolderName =
    folderName ??
    (effectiveFolderId
      ? folders?.find((f) => f.id === effectiveFolderId)?.name ?? null
      : null);

  // Navne på scope-mapper (til label)
  const scopeNames =
    scopeFolderIds && folders
      ? folders
          .filter((f) => scopeFolderIds.includes(f.id))
          .map((f) => f.name)
      : [];

  const [question, setQuestion] = useState("");
  const [answer, setAnswer] = useState("");
  const [includeBackground, setIncludeBackground] = useState(true);

  const [evalResult, setEvalResult] = useState<EvalResult | null>(null);

  const [loadingQuestion, setLoadingQuestion] = useState(false);
  const [loadingEval, setLoadingEval] = useState(false);
  const [savingNote, setSavingNote] = useState(false);

  const [noteSavedMsg, setNoteSavedMsg] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const clearMessages = () => {
    setErrorMsg(null);
    setNoteSavedMsg(null);
  };

  // Label for hvad der trænes på
  const scopeLabel = (() => {
    if (noteId) {
      return selectedNoteTitle
        ? `Udvalgt materiale: ${selectedNoteTitle}`
        : "Udvalgt materiale i mappen";
    }

    if (scopeNames.length > 1) {
      const preview =
        scopeNames.length <= 3
          ? scopeNames.join(", ")
          : `${scopeNames.slice(0, 3).join(", ")} m.fl.`;
      return `Flere mapper: ${preview}`;
    }

    if (scopeNames.length === 1) {
      return `Hele mappen: ${scopeNames[0]}`;
    }

    if (effectiveFolderName) return `Hele mappen: ${effectiveFolderName}`;

    return "Vælg en mappe eller et materiale i venstre side.";
  })();

  // 1) Generer nyt spørgsmål
  const handleGenerateQuestion = async () => {
    clearMessages();
    setLoadingQuestion(true);

    try {
      const res = await fetch("/api/generate-question", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          folder_id: effectiveFolderId ?? null,
          folderName: effectiveFolderName ?? null,
          note_id: noteId ?? null,
          scopeFolderIds: scopeFolderIds ?? [],
        }),
      });

      if (!res.ok) throw new Error("Kunne ikke generere spørgsmål");

      const data = await res.json().catch(() => null);
      const q =
        data?.question ||
        data?.prompt ||
        "Formulér et kort eksamensspørgsmål inden for dette emne.";

      setQuestion(q);
      setAnswer("");
      setEvalResult(null);
    } catch (err: any) {
      setErrorMsg(err?.message || "Fejl ved generering af spørgsmål.");
    } finally {
      setLoadingQuestion(false);
    }
  };

  // 2) Evaluer svar
  const handleEvaluate = async () => {
    clearMessages();

    if (!question || !answer.trim()) {
      setErrorMsg("Udfyld både spørgsmål og svar før du evaluerer.");
      return;
    }

    setLoadingEval(true);

    try {
      const res = await fetch("/api/evaluate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          prompt: question,
          question,
          answer,
          includeBackground,
          folder_id: effectiveFolderId ?? null,
          note_id: noteId ?? null,
          scopeFolderIds: scopeFolderIds ?? [],
        }),
      });

      const data = await res.json().catch(() => null);
      if (!res.ok || !data) {
        const msg = (data as any)?.error || "Kunne ikke evaluere svaret";
        throw new Error(msg);
      }

      const score =
        typeof data.score === "number"
          ? data.score
          : typeof data.grade === "number"
          ? data.grade
          : null;

      const sources: string[] =
        data.sources && Array.isArray(data.sources)
          ? data.sources
          : data.citations && Array.isArray(data.citations)
          ? data.citations
          : [];

      setEvalResult({
        feedback: data.feedback ?? data.evaluation ?? "",
        score,
        sources,
      });

      // 🔄 Opdatér serverkomponenterne (seneste noter / evalueringer)
      router.refresh();
    } catch (err: any) {
      setErrorMsg(err?.message || "Fejl ved evaluering.");
    } finally {
      setLoadingEval(false);
    }
  };

  // 3) Gem som note
  const handleSaveNote = async () => {
    clearMessages();

    if (!question && !answer && !evalResult?.feedback) {
      setErrorMsg("Der er intet at gemme som note endnu.");
      return;
    }

    setSavingNote(true);

    try {
      const baseTitle = effectiveFolderName
        ? `${effectiveFolderName} – træner`
        : "Træner";

      const title =
        noteId && selectedNoteTitle
          ? `${baseTitle}: ${selectedNoteTitle}`
          : `${baseTitle}: ${
              question
                ? question.replace(/\s+/g, " ").slice(0, 80)
                : "Øvelse"
            }`;

      const contentLines = [
        question ? `**Spørgsmål**\n${question}` : "",
        answer ? `\n\n**Svar**\n${answer}` : "",
        evalResult?.score != null
          ? `\n\n**Score**: ${evalResult.score}/100`
          : "",
        evalResult?.feedback
          ? `\n\n**Feedback**\n${evalResult.feedback}`
          : "",
        evalResult?.sources && evalResult.sources.length
          ? `\n\n**Kilder**\n${evalResult.sources
              .map((s: string) => `- ${s}`)
              .join("\n")}`
          : "",
      ].filter(Boolean);

      const content = contentLines.join("");

      // TODO: ryd op i note_type senere (pt. hårdkodet)
      const res = await fetch("/api/notes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title,
          content,
          source_title: "Træner",
          source_url: "/traener",
          folder_id: effectiveFolderId ?? null,
          note_type: "trainer_feedback",
        }),
      });

      const data = await res.json().catch(() => null);
      if (!res.ok || !data) {
        const msg = (data as any)?.error || "Kunne ikke gemme note";
        throw new Error(msg);
      }

      setNoteSavedMsg("Note gemt.");
      // 🔄 Opdatér “Seneste noter” i venstre kolonne
      router.refresh();
    } catch (err: any) {
      setErrorMsg(err?.message || "Fejl ved gem som note.");
    } finally {
      setSavingNote(false);
    }
  };

  return (
    <div className="space-y-4">
      {/* Valgt emne / scope */}
      <section className="rounded-2xl border border-zinc-200 bg-white p-4 shadow-sm">
        <h2 className="mb-1 text-base font-semibold">Valgt emne</h2>
        <p className="text-xs text-zinc-600">
          Træn på hele mapper eller udvalgte noter/materialer fra venstre side.
        </p>
        <p className="mt-1 text-xs text-zinc-500">{scopeLabel}</p>
      </section>

      {/* Spørgsmål */}
      <section className="space-y-2 rounded-2xl border border-zinc-200 bg-white p-4 shadow-sm">
        <div className="flex items-center justify-between gap-3">
          <h3 className="text-sm font-semibold">Spørgsmål / øvelse</h3>
          <button
            type="button"
            onClick={handleGenerateQuestion}
            disabled={loadingQuestion}
            className="rounded-lg border border-zinc-200 bg-zinc-100 px-3 py-1 text-xs text-zinc-700 hover:bg-zinc-200 disabled:opacity-50"
          >
            {loadingQuestion ? "Genererer..." : "Generér nyt spørgsmål"}
          </button>
        </div>
        <textarea
          className="mt-1 w-full min-h-[96px] rounded-xl border border-zinc-200 px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-zinc-900/5"
          value={question}
          onChange={(e) => {
            clearMessages();
            setQuestion(e.target.value);
          }}
          placeholder="Skriv eller redigér spørgsmålet her..."
        />
        <p className="text-[10px] text-zinc-500">
          Du kan tilpasse spørgsmålet til det stof, du vil træne.
        </p>
      </section>

      {/* Dit svar */}
      <section className="space-y-2 rounded-2xl border border-zinc-200 bg-white p-4 shadow-sm">
        <div className="flex items-center justify-between gap-3">
          <h3 className="text-sm font-semibold">Dit svar / 100</h3>
          <button
            type="button"
            onClick={handleEvaluate}
            disabled={loadingEval}
            className="rounded-lg border border-zinc-200 bg-zinc-100 px-3 py-1 text-xs text-zinc-700 hover:bg-zinc-200 disabled:opacity-50"
          >
            {loadingEval ? "Evaluerer..." : "Evaluer svar"}
          </button>
        </div>

        <label className="flex items-center gap-2 text-[10px] text-zinc-600">
          <input
            type="checkbox"
            checked={includeBackground}
            onChange={(e) => setIncludeBackground(e.target.checked)}
            className="h-3.5 w-3.5 rounded border-zinc-300 accent-zinc-600"
          />
          Inkludér baggrundslitteratur og kildehenvisninger i evalueringen
          (avanceret / til eksamen).
        </label>

        <textarea
          className="mt-1 w-full min-h-[140px] rounded-xl border border-zinc-200 px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-zinc-900/5"
          value={answer}
          onChange={(e) => {
            clearMessages();
            setAnswer(e.target.value);
          }}
          placeholder="Skriv dit svar her..."
        />
      </section>

      {/* Feedback + kilder + gem som note */}
      <section className="space-y-2 rounded-2xl border border-zinc-200 bg-white p-4 shadow-sm">
        <div className="flex items-center justify-between gap-3">
          <h3 className="text-sm font-semibold">Feedback</h3>
          <button
            type="button"
            onClick={handleSaveNote}
            disabled={savingNote}
            className="rounded-lg border border-zinc-300 bg-white px-3 py-1 text-xs hover:bg-zinc-50 disabled:opacity-60"
          >
            {savingNote ? "Gemmer..." : "Gem som note"}
          </button>
        </div>

        <div className="text-xs text-zinc-600">
          {evalResult ? (
            <>
              <div className="font-medium">
                Score: {evalResult.score ?? 0}/100
              </div>
              <p className="mt-1 whitespace-pre-wrap">
                {evalResult.feedback}
              </p>

              {evalResult.sources && evalResult.sources.length > 0 && (
                <div className="mt-2 text-[10px] text-zinc-500">
                  <div className="font-semibold text-zinc-600">
                    Baggrundslitteratur / kilder
                  </div>
                  <ul className="mt-1 list-disc space-y-0.5 pl-4">
                    {evalResult.sources.map((src, i) => (
                      <li key={i} className="break-all">
                        {src}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </>
          ) : (
            <p>
              Ingen feedback endnu. Skriv dit svar og tryk &quot;Evaluer
              svar&quot;.
            </p>
          )}
        </div>
      </section>

      {/* Statusbeskeder */}
      {noteSavedMsg && (
        <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs text-emerald-700">
          {noteSavedMsg}
        </div>
      )}
      {errorMsg && (
        <div className="rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
          {errorMsg}
        </div>
      )}
    </div>
  );
}
