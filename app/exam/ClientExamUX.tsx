"use client";

import { useState } from "react";
import Link from "next/link";
import { FeedbackPanel } from "./ui/FeedbackPanel";

type FolderRow = { id: string; name: string };
type NoteRow = { id: string; title: string | null; updated_at: string | null };
type RecentSessionRow = { id: string; when: string; score: number | null };

type Citation = {
  title: string;
  url?: string;
  badge?: string;
  relation?: string; // hvorfor er denne kilde relevant ift. svaret/eksamen
};

export default function ClientExamUX(props: {
  ownerId: string;
  folderId: string;
  folderName: string;
  folders: FolderRow[];
  recentNotes: NoteRow[];
  recentSessions: RecentSessionRow[];
  initialQuestion: string;
  initialAnswer: string;
  initialScore: number | null;
  initialFeedback: string;
}) {
  const {
    folderId,
    folderName,
    folders,
    recentNotes,
    recentSessions,
    initialQuestion,
    initialAnswer,
    initialScore,
    initialFeedback,
  } = props;

  // === STATE ===
  const [question, setQuestion] = useState<string>(initialQuestion);
  const [answer, setAnswer] = useState<string>(initialAnswer);
  const [score, setScore] = useState<number | null>(initialScore);
  const [feedback, setFeedback] = useState<string>(initialFeedback);

  const [citations, setCitations] = useState<Citation[]>([]);

  // checkbox for "eksamen mode" (baggrundslitteratur og kildehenvisninger)
  const [withBackground, setWithBackground] = useState<boolean>(false);

  // akademisk kildekvalitet er altid slået til bag kulissen
  const preferAcademicSources = true;

  // UI-status
  const [loadingGen, setLoadingGen] = useState(false);
  const [loadingEval, setLoadingEval] = useState(false);
  const [savingNote, setSavingNote] = useState(false);

  const [errorMsg, setErrorMsg] = useState<string>("");
  const [noteMsg, setNoteMsg] = useState<string>("");

  // === HELPERS ===

  async function handleSaveNote() {
    try {
      setSavingNote(true);
      setNoteMsg("");
      setErrorMsg("");

      const shortTitleBase = question.trim().replace(/\s+/g, " ");
      const shortTitle =
        "Feedback: " +
        (shortTitleBase.length > 60
          ? shortTitleBase.slice(0, 57) + "…"
          : shortTitleBase);

      // Byg note-indholdet inkl. relationer til kilder
      let contentBlock = `Spørgsmål:\n${question}\n\nDin besvarelse:\n${answer}\n\nFeedback:\n${feedback}\n`;

      if (citations.length > 0) {
        contentBlock += "\nKilder brugt i evalueringen:\n";
        for (const c of citations) {
          const badgeTxt = c.badge ? ` (${c.badge})` : "";
          contentBlock += `- ${c.title}${badgeTxt}\n`;
          if (c.url) {
            contentBlock += `  ${c.url}\n`;
          }
          if (c.relation) {
            contentBlock += `  Relevans til eksamen: ${c.relation}\n`;
          }
        }
      }

      const res = await fetch("/api/notes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: shortTitle,
          content: contentBlock,
          source_title: folderName || "Eksamensøvelse",
          source_url: "/exam?folder_id=" + folderId,
        }),
      });

      if (!res.ok) {
        const t = await res.text();
        throw new Error(`notes POST fejl: ${res.status} ${t}`);
      }

      setNoteMsg("Gemt i noter ✅");
    } catch (err: any) {
      console.error("Fejl ved gem som note:", err);
      setErrorMsg("Kunne ikke gemme noten.");
    } finally {
      setSavingNote(false);
    }
  }

  async function handleGenerateQuestion() {
    try {
      setLoadingGen(true);
      setErrorMsg("");
      setNoteMsg("");

      const res = await fetch("/api/generate-question", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          folder_id: folderId,
          preferAcademicSources, // altid sand internt
        }),
      });

      if (!res.ok) {
        const t = await res.text();
        throw new Error(`generate-question fejl: ${res.status} ${t}`);
      }

      const data = await res.json();

      if (data?.question) {
        setQuestion(data.question);

        // ryd session når vi starter på et nyt spørgsmål
        setAnswer("");
        setScore(null);
        setFeedback("");
        setCitations([]);
        setNoteMsg("");
      } else {
        setErrorMsg("Fik ikke noget spørgsmål tilbage fra serveren.");
      }
    } catch (err: any) {
      console.error("Fejl ved generér spørgsmål:", err);
      setErrorMsg("Kunne ikke generere nyt spørgsmål.");
    } finally {
      setLoadingGen(false);
    }
  }

  async function handleEvaluate() {
    try {
      setLoadingEval(true);
      setErrorMsg("");
      setNoteMsg("");

      const res = await fetch("/api/evaluate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          folder_id: folderId,
          question,
          answer,
          includeBackground: withBackground, // brugerens valg = vis kilder til eksamen
          preferAcademicSources,            // vores faste kvalitetsfilter
        }),
      });

      if (!res.ok) {
        const t = await res.text();
        throw new Error(`evaluate fejl: ${res.status} ${t}`);
      }

      const data = await res.json();

      // { score, feedback, citations? }
      if (typeof data.score === "number") {
        setScore(data.score);
      }
      if (typeof data.feedback === "string") {
        setFeedback(data.feedback);
      }

      // Hvis eleven vil have baggrund + kilder, så mapper vi citations med relation
      if (withBackground && Array.isArray(data.citations)) {
        setCitations(
          data.citations.map((c: any) => ({
            title: c.title ?? "Ukendt kilde",
            url: c.url ?? "",
            badge: c.badge ?? "",
            relation:
              c.relation ??
              c.explainer ??
              "", // fallback hvis backend kalder det noget andet, fx "explainer"
          }))
        );
      } else {
        setCitations([]);
      }
    } catch (err: any) {
      console.error("Fejl ved evaluering:", err);
      setErrorMsg("Kunne ikke evaluere svaret.");
    } finally {
      setLoadingEval(false);
    }
  }

  // === UI ===

  return (
    <div className="grid gap-6 grid-cols-[260px_1fr]">
      {/* VENSTRE SIDEBAR */}
      <aside className="space-y-4">
        {/* Mapper */}
        <section className="rounded-xl border border-neutral-200 bg-white p-4 shadow-sm">
          <div className="text-sm font-semibold mb-2 flex items-center justify-between">
            <span>Mapper ({folders.length} stk)</span>
          </div>

          <ul className="text-sm border-t border-neutral-200 pt-2">
            {folders.map((f) => {
              const active = f.id === folderId;
              return (
                <li key={f.id} className="mb-1 last:mb-0">
                  <Link
                    href={`/exam?folder_id=${f.id}`}
                    className={
                      "block rounded px-2 py-1 hover:bg-black/5 " +
                      (active
                        ? "font-medium text-black bg-black/5"
                        : "text-black/70")
                    }
                  >
                    {f.name}
                  </Link>
                </li>
              );
            })}
          </ul>
        </section>

        {/* Seneste vurderinger */}
        <section className="rounded-xl border border-neutral-200 bg-white p-4 shadow-sm">
          <div className="text-sm font-semibold mb-2">
            Seneste vurderinger (5)
          </div>
          {!recentSessions.length ? (
            <div className="text-[13px] text-black/60">
              Ingen evalueringer endnu for denne mappe.
            </div>
          ) : (
            <ul className="divide-y divide-neutral-200 text-sm">
              {recentSessions.map((s) => (
                <li
                  key={s.id}
                  className="flex items-center justify-between py-2"
                >
                  <div className="text-[13px] leading-tight text-black/80">
                    <div>{s.when}</div>
                  </div>
                  <div className="text-[13px] font-semibold tabular-nums">
                    {s.score ?? "—"}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>

        {/* Seneste noter */}
        <section className="rounded-xl border border-neutral-200 bg-white p-4 shadow-sm">
          <div className="text-sm font-semibold mb-2">Seneste noter</div>
          {!recentNotes.length ? (
            <div className="text-[13px] text-black/60">
              Ingen noter endnu.
            </div>
          ) : (
            <ul className="divide-y divide-neutral-200 text-sm">
              {recentNotes.map((n) => (
                <li key={n.id} className="py-2 leading-tight">
                  <div className="font-medium text-[13px] text-black/90">
                    {n.title || "Note uden titel"}
                  </div>
                  {n.updated_at ? (
                    <div className="text-[11px] text-black/50">
                      {new Date(n.updated_at).toLocaleString("da-DK", {
                        day: "2-digit",
                        month: "short",
                        year: "numeric",
                        hour: "2-digit",
                        minute: "2-digit",
                      })}
                    </div>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
        </section>

        {/* Admin: opret ny mappe (placeholder) */}
        <section className="rounded-xl border border-neutral-200 bg-white p-4 shadow-sm">
          <div className="text-sm font-semibold mb-2">
            Mapper (administration)
          </div>
          <div className="text-[12px] text-black/60 mb-2">
            Opret ny mappe (ikke aktiv endnu)
          </div>
          <div className="flex items-center gap-2">
            <input
              className="flex-1 rounded border border-neutral-300 bg-white px-2 py-1 text-[13px] leading-tight text-black"
              placeholder="Mappe-navn"
              disabled
            />
            <button
              className="rounded border border-neutral-300 bg-white px-2 py-1 text-[12px] leading-tight text-black/70"
              disabled
            >
              Opret
            </button>
          </div>
        </section>
      </aside>

      {/* HØJRE KOLONNE */}
      <section className="space-y-6">
        {/* Header */}
        <header className="flex items-start justify-between flex-wrap gap-2">
          <div>
            <h1 className="text-xl font-semibold leading-tight">
              {folderName}
            </h1>
            <p className="text-[13px] text-black/60">
              Lav en målrettet øvelse for at løfte niveauet i dette emne.
            </p>
          </div>

          <div className="text-right text-[13px]">
            <Link
              href="/overblik"
              className="text-black/60 hover:text-black underline"
            >
              ← Tilbage til Overblik
            </Link>
          </div>
        </header>

        {/* Spørgsmål / øvelse */}
        <div className="rounded-xl border border-neutral-200 bg-white p-4 shadow-sm space-y-3">
          <div className="flex items-start justify-between flex-wrap gap-2">
            <div className="text-sm font-semibold">Spørgsmål / øvelse</div>

            <button
              onClick={handleGenerateQuestion}
              disabled={loadingGen}
              className="rounded border border-neutral-300 bg-white px-2 py-1 text-[12px] leading-tight text-black/80 hover:bg-black/5 disabled:opacity-50"
            >
              {loadingGen ? "Genererer…" : "Generér nyt spørgsmål"}
            </button>
          </div>

          <textarea
            className="w-full rounded border border-neutral-300 bg-white p-2 text-[14px] leading-snug text-black"
            rows={3}
            value={question}
            onChange={(e) => setQuestion(e.target.value)}
          />

          <p className="text-[11px] text-black/40">
            Du kan rette spørgsmålet, hvis du vil træne noget mere specifikt.
          </p>
        </div>

        {/* Dit svar */}
        <div className="rounded-xl border border-neutral-200 bg-white p-4 shadow-sm space-y-3">
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div className="text-sm font-semibold flex flex-col gap-2">
              <div className="flex items-center gap-3">
                <span>Dit svar</span>
                <span className="text-[12px] text-black/50 flex items-center gap-1">
                  <span className="font-semibold text-black">
                    {typeof score === "number" ? score : "—"}
                  </span>
                  <span className="text-black/50">/ 100</span>
                </span>
              </div>

              <label className="flex items-start gap-2 text-[12px] text-black/70 leading-snug">
                <input
                  type="checkbox"
                  className="accent-black mt-[2px]"
                  checked={withBackground}
                  onChange={(e) => setWithBackground(e.target.checked)}
                />
                <span>
                  Inkludér baggrundslitteratur og kildehenvisninger i
                  evalueringen (avanceret / til eksamen)
                </span>
              </label>
            </div>

            <button
              onClick={handleEvaluate}
              disabled={loadingEval}
              className="h-[32px] rounded border border-neutral-300 bg-white px-2 py-1 text-[12px] leading-tight text-black/80 hover:bg-black/5 disabled:opacity-50 self-start"
            >
              {loadingEval ? "Evaluerer…" : "Evaluer svar"}
            </button>
          </div>

          <textarea
            className="w-full rounded border border-neutral-300 bg-white p-2 text-[14px] leading-snug text-black min-h-[160px]"
            value={answer}
            onChange={(e) => setAnswer(e.target.value)}
            placeholder="Skriv dit svar her…"
          />
        </div>

        {/* Feedback + kilder + gem note */}
        <FeedbackPanel
          feedback={feedback}
          citations={citations}
          withBackground={withBackground} // afgør om kildesektionen vises
          savingNote={savingNote}
          noteMsg={noteMsg}
          errorMsg={errorMsg}
          onSaveNote={handleSaveNote}
        />
      </section>
    </div>
  );
}
