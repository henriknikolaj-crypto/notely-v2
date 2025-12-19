// lib/notes-scope.ts

export type NoteCard = {
  id: string;
  title: string | null;
  createdAt: string | null;
  updatedAt?: string | null;
  sourceTitle: string | null;
  sourceUrl: string | null;
  snippet?: string | null;
};

export type NoteKind = "resume" | "focus" | "evaluation" | "other";

export function classifyNote(
  note: Pick<NoteCard, "title" | "sourceTitle" | "sourceUrl">
): NoteKind {
  const title = (note.title ?? "").toLowerCase();
  const srcTitle = (note.sourceTitle ?? "").toLowerCase();
  const srcUrl = (note.sourceUrl ?? "").toLowerCase();

  const fromTrainerNotes = srcUrl.includes("/traener/noter");
  void fromTrainerNotes; // reserveret til senere (mere præcis scope-detektion)

  const fromTrainerMain =
    srcUrl === "/traener" || srcUrl === "/traener/ux" || srcUrl === "/traener";

  const isResume =
    title.startsWith("resumé") ||
    title.startsWith("resume") ||
    title.startsWith("resumé –") ||
    title.startsWith("resume –") ||
    title.startsWith("resumé af");

  const isFocusOrGolden =
    title.startsWith("fokus-noter") ||
    title.startsWith("fokus –") ||
    title.startsWith("golden notes") ||
    title.includes("fokus-noter");

  const isFeedbackTitle = title.startsWith("feedback:");
  const hasScorePrefix = /^\d+\/10\s*–/.test(title);

  const isTrainerSource =
    srcTitle.includes("træner") ||
    srcTitle.includes("traener") ||
    fromTrainerMain;

  const isEvaluation =
    !isResume &&
    !isFocusOrGolden &&
    (isTrainerSource || isFeedbackTitle || hasScorePrefix);

  if (isResume) return "resume";
  if (isFocusOrGolden) return "focus";
  if (isEvaluation) return "evaluation";
  return "other";
}

export function filterNotesByScope<T extends NoteCard>(
  notes: T[],
  scopeRaw?: string | null
): T[] {
  const scope = (scopeRaw ?? "").toLowerCase().trim();
  if (!scope) return notes;

  return notes.filter((n) => {
    const kind = classifyNote(n);

    if (scope.startsWith("resum")) return kind === "resume";
    if (scope.includes("fokus") || scope.includes("focus")) return kind === "focus";
    if (scope.startsWith("eval")) return kind === "evaluation";
    return true;
  });
}
