// app/traener/ui/TrainingSidebarStats.tsx
"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import SidebarRecentMC from "../mc/SidebarRecentMC";
import SidebarQuotaBox from "./SidebarQuotaBox";

type Note = {
  id: string;
  title: string | null;
  note_type?: string | null;
  created_at?: string | null;
};

type Eval = {
  id: string;
  score: number | null;
  created_at?: string | null;
};

function trimTitle(title: string | null | undefined) {
  const base = (title || "Uden titel").trim();
  return base.length > 40 ? `${base.slice(0, 40)}…` : base;
}

// Langt format bruges på “Se alle”-siderne (ligger i andre filer)
function formatDT(iso: string | null | undefined) {
  if (!iso) return "";
  const d = new Date(iso);
  return d
    .toLocaleString("da-DK", {
      day: "2-digit",
      month: "short",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    })
    .replace(/\.$/, "");
}

// eslint/lint: hvis funktionen ikke bruges i denne fil endnu
void formatDT;

// Kort sidebar-format: 28.11.
function formatSidebarDate(iso: string | null | undefined) {
  if (!iso) return "";
  const d = new Date(iso);
  return d.toLocaleDateString("da-DK", {
    day: "2-digit",
    month: "2-digit",
  });
}

// Klassificér noter efter note_type (hvis sat) ellers titel-prefix
function classifyNote(note: Note): "resume" | "focus" | "trainer" | "other" {
  const nt = (note.note_type ?? "").toLowerCase();
  const t = (note.title ?? "").toLowerCase().trim();

  // Foretræk eksplicit note_type
  if (nt === "resume") return "resume";
  if (nt === "focus") return "focus";
  if (nt === "feedback" || nt === "trainer" || nt === "trainer_feedback")
    return "trainer";

  // Fallback til titel
  if (t.startsWith("resumé") || t.startsWith("resum")) return "resume";
  if (t.startsWith("fokus-noter") || t.startsWith("fokusnoter")) return "focus";
  if (t.startsWith("feedback") || t.includes("træner")) return "trainer";

  return "other";
}

export default function TrainingSidebarStats({
  latestNotes,
  latestEvals,
  notesCount,
  evalCount,
  resumeCount,
  focusCount,
}: {
  latestNotes: Note[];
  latestEvals: Eval[];
  /** Antal Træner-noter (feedback) i alt */
  notesCount?: number;
  /** Antal Træner-evalueringer i alt */
  evalCount?: number;
  /** Antal resumé-noter i alt */
  resumeCount?: number;
  /** Antal fokus-noter i alt */
  focusCount?: number;
}) {
  const pathname = usePathname() || "";
  const sp = useSearchParams();

  const notes = latestNotes ?? [];
  const evals = latestEvals ?? [];

  // Del noter op i typer – brug fuld liste til totaler
  const allResumeNotes = notes.filter((n) => classifyNote(n) === "resume");
  const allFocusNotes = notes.filter((n) => classifyNote(n) === "focus");
  const allTrainerNotes = notes.filter((n) => classifyNote(n) === "trainer");

  const resumeNotes = allResumeNotes.slice(0, 3);
  const focusNotes = allFocusNotes.slice(0, 3);
  const trainerNotes = allTrainerNotes.slice(0, 3);

  const recentEvals = evals.slice(0, 3);

  // Totaler
  const totalTrainerNotes =
    typeof notesCount === "number"
      ? notesCount
      : allTrainerNotes.length || notes.length;

  const totalResume =
    typeof resumeCount === "number" ? resumeCount : allResumeNotes.length;

  const totalFocus =
    typeof focusCount === "number" ? focusCount : allFocusNotes.length;

  const totalEvals =
    typeof evalCount === "number" ? evalCount : evals.length;

  const scopeFromUrl = sp?.get("scope") || undefined;

  // Link til Træner-evalueringer (beholder alle nuværende query params)
  const evalHistoryHref = (() => {
    if (!sp) return "/traener/evalueringer/historik";
    const params = new URLSearchParams(sp.toString());
    const qs = params.toString();
    return qs
      ? `/traener/evalueringer/historik?${qs}`
      : "/traener/evalueringer/historik";
  })();

  // "Se alle" for Træner-noter – sender træner-scope videre som tscope
  const notesFeedbackHref = (() => {
    const params = new URLSearchParams();
    if (scopeFromUrl) params.set("tscope", scopeFromUrl);
    params.set("scope", "feedback");
    const qs = params.toString();
    return qs ? `/notes?${qs}` : "/notes";
  })();

  // MC-historik med scope videre
  const mcHistoryHref = (() => {
    if (!sp) return "/traener/mc/historik";
    const params = new URLSearchParams(sp.toString());
    const qs = params.toString();
    return qs ? `/traener/mc/historik?${qs}` : "/traener/mc/historik";
  })();

  // --- Hoved-Træner-siden (/traener) ---
  const isTrainerMain = pathname === "/traener" || pathname === "/traener/";

  if (isTrainerMain) {
    const mainNotes =
      trainerNotes.length > 0 ? trainerNotes : notes.slice(0, 3);

    return (
      <div className="mt-4 space-y-5 px-2 text-[12px]">
        {/* SENESTE NOTER (TRÆNER) */}
        <div>
          <div className="mb-1 flex items-center justify-between">
            <div className="font-semibold text-zinc-800">Seneste noter</div>
            <Link
              href={notesFeedbackHref}
              className="text-[11px] text-zinc-500 hover:text-zinc-700"
            >
              Se alle
            </Link>
          </div>

          {mainNotes.length === 0 ? (
            <div className="text-[11px] text-zinc-400">Ingen noter endnu.</div>
          ) : (
            <ul className="space-y-1">
              {mainNotes.map((n) => (
                <li key={n.id} className="text-zinc-700">
                  <div className="truncate">{trimTitle(n.title)}</div>
                  <div className="text-[10px] text-zinc-500">
                    {formatSidebarDate(n.created_at)}
                  </div>
                </li>
              ))}
            </ul>
          )}

          <div className="mt-1 text-[10px] text-zinc-400">
            I alt {totalTrainerNotes} noter
          </div>
        </div>

        {/* SENESTE EVALUERINGER */}
        <div>
          <div className="mb-1 flex items-center justify-between">
            <div className="font-semibold text-zinc-800">
              Seneste evalueringer
            </div>
            <Link
              href={evalHistoryHref}
              className="text-[11px] text-zinc-500 hover:text-zinc-700"
            >
              Se alle
            </Link>
          </div>

          {recentEvals.length === 0 ? (
            <div className="text-[11px] text-zinc-400">
              Ingen evalueringer endnu.
            </div>
          ) : (
            <ul className="space-y-1">
              {recentEvals.map((e) => (
                <li
                  key={e.id}
                  className="flex items-center justify-between text-zinc-700"
                >
                  <span>score {e.score ?? 0}</span>
                  <span className="text-[10px] text-zinc-500">
                    {formatSidebarDate(e.created_at)}
                  </span>
                </li>
              ))}
            </ul>
          )}

          <div className="mt-1 text-[10px] text-zinc-400">
            I alt {totalEvals} evalueringer
          </div>
        </div>

        {/* MÅNEDLIGT FORBRUG */}
        <SidebarQuotaBox />
      </div>
    );
  }

  // --- NOTER-fanen (/traener/noter) → Resuméer + fokus-noter ---
  if (pathname.startsWith("/traener/noter")) {
    const notesResumeHref = (() => {
      const params = new URLSearchParams();
      params.set("scope", "resume");
      if (scopeFromUrl) params.set("tscope", scopeFromUrl);
      const qs = params.toString();
      return qs ? `/notes?${qs}` : "/notes";
    })();

    const notesFocusHref = (() => {
      const params = new URLSearchParams();
      params.set("scope", "focus");
      if (scopeFromUrl) params.set("tscope", scopeFromUrl);
      const qs = params.toString();
      return qs ? `/notes?${qs}` : "/notes";
    })();

    return (
      <div className="mt-4 space-y-5 px-2 text-[12px]">
        {/* SENESTE RESUMÉER */}
        <div>
          <div className="mb-1 flex items-center justify-between">
            <div className="font-semibold text-zinc-800">
              Seneste resuméer
            </div>
            <Link
              href={notesResumeHref}
              className="text-[11px] text-zinc-500 hover:text-zinc-700"
            >
              Se alle
            </Link>
          </div>

          {resumeNotes.length === 0 ? (
            <div className="text-[11px] text-zinc-400">
              Ingen resuméer endnu.
            </div>
          ) : (
            <ul className="space-y-1">
              {resumeNotes.map((n) => (
                <li key={n.id} className="text-zinc-700">
                  <div className="truncate">{trimTitle(n.title)}</div>
                  <div className="text-[10px] text-zinc-500">
                    {formatSidebarDate(n.created_at)}
                  </div>
                </li>
              ))}
            </ul>
          )}

          <div className="mt-1 text-[10px] text-zinc-400">
            I alt {totalResume} resuméer
          </div>
        </div>

        {/* SENESTE FOKUS-NOTER */}
        <div>
          <div className="mb-1 flex items-center justify-between">
            <div className="font-semibold text-zinc-800">
              Seneste fokus-noter
            </div>
            <Link
              href={notesFocusHref}
              className="text-[11px] text-zinc-500 hover:text-zinc-700"
            >
              Se alle
            </Link>
          </div>

          {focusNotes.length === 0 ? (
            <div className="text-[11px] text-zinc-400">
              Ingen fokus-noter endnu.
            </div>
          ) : (
            <ul className="space-y-1">
              {focusNotes.map((n) => (
                <li key={n.id} className="text-zinc-700">
                  <div className="truncate">{trimTitle(n.title)}</div>
                  <div className="text-[10px] text-zinc-500">
                    {formatSidebarDate(n.created_at)}
                  </div>
                </li>
              ))}
            </ul>
          )}

          <div className="mt-1 text-[10px] text-zinc-400">
            I alt {totalFocus} fokus-noter
          </div>
        </div>

        {/* MÅNEDLIGT FORBRUG */}
        <SidebarQuotaBox />
      </div>
    );
  }

  // --- MULTIPLE CHOICE-fanen ---
  if (pathname.startsWith("/traener/mc")) {
    return (
      <div className="mt-4 space-y-4 px-2 text-[12px]">
        <div>
          <div className="mb-1 flex items-center justify-between">
            <div className="font-semibold text-zinc-800">Seneste MC</div>
            <Link
              href={mcHistoryHref}
              className="text-[11px] text-zinc-500 hover:text-zinc-700"
            >
              Se alle
            </Link>
          </div>
          <SidebarRecentMC />
        </div>

        <SidebarQuotaBox />
      </div>
    );
  }

  // --- FLASHCARDS-fanen ---
  if (pathname.startsWith("/traener/flashcards")) {
    return (
      <div className="mt-4 space-y-4 px-2 text-[12px]">
        <div>
          <div className="mb-1 font-semibold text-zinc-800">Flashcards</div>
          <p className="text-zinc-600">
            Her kommer et overblik over dine kortbunker, repetition og dagens
            flashcard-mål.
          </p>
        </div>

        <SidebarQuotaBox />
      </div>
    );
  }

  // --- SIMULATOR-fanen ---
  if (pathname.startsWith("/traener/simulator")) {
    return (
      <div className="mt-4 space-y-4 px-2 text-[12px]">
        <div>
          <div className="mb-1 font-semibold text-zinc-800">Simulator</div>
          <p className="text-zinc-600">
            Her vil du senere kunne se planlagte og gennemførte
            eksamenssimulationer samt dit historiske niveau.
          </p>
        </div>

        <SidebarQuotaBox />
      </div>
    );
  }

  // Andre /traener-stier → ingen ekstra boks
  return null;
}
