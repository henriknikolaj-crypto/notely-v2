export type MathRenderedBlockKind = "rule" | "method" | "concept" | "example" | "pitfall";

export type MathRenderedNoteFormula = {
  title: string;
  formulaLatex: string;
  sourceLabel?: string;
  explanation?: string;
};

export type MathRenderedNoteBlock = {
  id: string;
  title: string;
  kind: MathRenderedBlockKind;
  topicGroup?: string;
  sourceLabel?: string;
  explanation?: string;
  formulaLatex?: string;
  notationLatex?: string;
  usageText?: string;
  meaningText?: string;
  warningText?: string;
  exampleText?: string;
  exampleLatex?: string;
  steps?: string[];
};

export type MathRenderedNote = {
  kind: "math_focus_note";
  title: string;
  fileName: string;
  folderName?: string | null;
  intro: {
    title?: string;
    paragraphs: string[];
  };
  overview: Array<{
    topic: string;
    summary: string;
  }>;
  keyFormulas: MathRenderedNoteFormula[];
  blocks: MathRenderedNoteBlock[];
};

type MathRenderedNoteMetadataContainer = {
  note_renderer?: string;
  math_rendered_note?: unknown;
  mathRenderedNote?: unknown;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function readStringArray(value: unknown) {
  if (!Array.isArray(value)) return [];
  return value.filter(isNonEmptyString).map((item) => item.trim());
}

function readFormula(value: unknown): MathRenderedNoteFormula | null {
  if (!isRecord(value)) return null;
  if (!isNonEmptyString(value.title) || !isNonEmptyString(value.formulaLatex)) return null;
  return {
    title: value.title.trim(),
    formulaLatex: value.formulaLatex.trim(),
    sourceLabel: isNonEmptyString(value.sourceLabel) ? value.sourceLabel.trim() : undefined,
    explanation: isNonEmptyString(value.explanation) ? value.explanation.trim() : undefined,
  };
}

function isValidBlockKind(value: unknown): value is MathRenderedBlockKind {
  return value === "rule" || value === "method" || value === "concept" || value === "example" || value === "pitfall";
}

function readBlock(value: unknown): MathRenderedNoteBlock | null {
  if (!isRecord(value)) return null;
  if (!isNonEmptyString(value.id) || !isNonEmptyString(value.title) || !isValidBlockKind(value.kind)) return null;
  return {
    id: value.id.trim(),
    title: value.title.trim(),
    kind: value.kind,
    topicGroup: isNonEmptyString(value.topicGroup) ? value.topicGroup.trim() : undefined,
    sourceLabel: isNonEmptyString(value.sourceLabel) ? value.sourceLabel.trim() : undefined,
    explanation: isNonEmptyString(value.explanation) ? value.explanation.trim() : undefined,
    formulaLatex: isNonEmptyString(value.formulaLatex) ? value.formulaLatex.trim() : undefined,
    notationLatex: isNonEmptyString(value.notationLatex) ? value.notationLatex.trim() : undefined,
    usageText: isNonEmptyString(value.usageText) ? value.usageText.trim() : undefined,
    meaningText: isNonEmptyString(value.meaningText) ? value.meaningText.trim() : undefined,
    warningText: isNonEmptyString(value.warningText) ? value.warningText.trim() : undefined,
    exampleText: isNonEmptyString(value.exampleText) ? value.exampleText.trim() : undefined,
    exampleLatex: isNonEmptyString(value.exampleLatex) ? value.exampleLatex.trim() : undefined,
    steps: readStringArray(value.steps),
  };
}

export function isMathRenderedNote(value: unknown): value is MathRenderedNote {
  if (!isRecord(value)) return false;
  if (value.kind !== "math_focus_note") return false;
  if (!isNonEmptyString(value.title) || !isNonEmptyString(value.fileName)) return false;
  if (!isRecord(value.intro) || !Array.isArray(value.intro.paragraphs)) return false;
  if (!Array.isArray(value.overview) || !Array.isArray(value.keyFormulas) || !Array.isArray(value.blocks)) return false;
  return true;
}

export function buildMathRenderedNoteMetadata(note: MathRenderedNote) {
  return {
    note_renderer: "math_structured_focus",
    mathRenderedNote: note,
  };
}

export function readMathRenderedNoteFromMetadata(metadata: unknown): MathRenderedNote | null {
  const direct = isMathRenderedNote(metadata) ? metadata : null;
  if (direct) return direct;

  if (!isRecord(metadata)) return null;
  const container = metadata as MathRenderedNoteMetadataContainer;
  const rawNote = container.math_rendered_note ?? container.mathRenderedNote;
  if (!isMathRenderedNote(rawNote)) return null;

  const intro = isRecord(rawNote.intro)
    ? {
        title: isNonEmptyString(rawNote.intro.title) ? rawNote.intro.title.trim() : undefined,
        paragraphs: readStringArray(rawNote.intro.paragraphs),
      }
    : { paragraphs: [] };
  const overview = Array.isArray(rawNote.overview)
    ? rawNote.overview
        .filter(isRecord)
        .map((item) => ({
          topic: isNonEmptyString(item.topic) ? item.topic.trim() : "",
          summary: isNonEmptyString(item.summary) ? item.summary.trim() : "",
        }))
        .filter((item) => item.topic && item.summary)
    : [];
  const keyFormulas = Array.isArray(rawNote.keyFormulas)
    ? rawNote.keyFormulas.map(readFormula).filter((item): item is MathRenderedNoteFormula => Boolean(item))
    : [];
  const blocks = Array.isArray(rawNote.blocks)
    ? rawNote.blocks.map(readBlock).filter((item): item is MathRenderedNoteBlock => Boolean(item))
    : [];

  if (!intro.paragraphs.length && !overview.length && !keyFormulas.length && !blocks.length) return null;

  return {
    kind: "math_focus_note",
    title: rawNote.title.trim(),
    fileName: rawNote.fileName.trim(),
    folderName: isNonEmptyString(rawNote.folderName) ? rawNote.folderName.trim() : rawNote.folderName === null ? null : undefined,
    intro,
    overview,
    keyFormulas,
    blocks,
  };
}
