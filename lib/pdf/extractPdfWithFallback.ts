import "server-only";

import { createRequire } from "node:module";
import OpenAI from "openai";
import { PDFDocument } from "pdf-lib";

export type ExtractionMethod = "text" | "ocr" | "mixed";
export type ExtractionQuality = "high" | "medium" | "low";
export type PageType = "text" | "scan" | "table_heavy" | "formula_heavy" | "mixed";
export type PdfDocumentClass = "text_layer_pdf" | "image_only_pdf" | "mixed_pdf";
export type PdfExtractionRoute = "text_fast_path" | "ocr_first_path";
export type FormulaExtractionOrigin = "text_layer" | "ocr" | "vision";
export type PdfExtractionTimings = {
  pdf_open_ms: number;
  render_ms: number;
  ocr_ms: number;
  total_ms: number;
  ocr_page_count: number;
};

type OcrAttemptMode = "pdf_primary";
type OcrPageOutcome = "not_attempted" | "succeeded" | "degraded" | "failed";

export type OcrPageAttempt = {
  attempt: number;
  mode: OcrAttemptMode;
  duration_ms: number;
  timeout_ms: number;
  timed_out: boolean;
  text_char_count: number;
  error_code: string | null;
  render_scale: number | null;
};

export type OcrPageResult = {
  page: number;
  retry_used: boolean;
  retry_succeeded: boolean;
  final_outcome: OcrPageOutcome;
  attempts: OcrPageAttempt[];
};

export type PageClassificationSignals = {
  lineCount: number;
  nonEmptyLineCount: number;
  digitRatio: number;
  symbolRatio: number;
  formulaLineRatio: number;
  tableLikeLineRatio: number;
  numericTokenRatio: number;
  shortLineRatio: number;
  usedOcrFallback: boolean;
};

export type ExtractedPageFormulaCandidate = {
  rawFormula: string;
  normalizedFormula: string;
  latexFormula?: string;
  surroundingText: string;
  origin: FormulaExtractionOrigin;
  confidence: number;
};

export type PageExtractionMeta = {
  page_type: PageType;
  ocr_decision: OcrDecision;
  table_blocks: number;
  formula_blocks: number;
  structured_preview: string;
  signals: PageClassificationSignals;
  weak_text_for_math: boolean;
  heading_candidates: string[];
  math_formula_candidates: ExtractedPageFormulaCandidate[];
};

type PageClassificationCore = Pick<PageExtractionMeta, "page_type" | "signals">;

export type ExtractedPdfPage = {
  pageNumber: number;
  text: string;
  extractionMethod: "text" | "ocr";
  extractionQuality: ExtractionQuality;
  textCharCount: number;
  wordCount: number;
  alphaNumRatio: number;
  brokenTokenRatio: number;
  extractionMeta: PageExtractionMeta;
};

export type ExtractedPdfDocument = {
  pageCount: number;
  ocrPages: number;
  extractionMethod: ExtractionMethod;
  extractionQuality: ExtractionQuality;
  pages: ExtractedPdfPage[];
  ocrTexts: Array<{ page: number; text: string; engine: string }>;
  extractionMeta: {
    document_class: PdfDocumentClass;
    extraction_route: PdfExtractionRoute;
    page_count: number;
    ocr_pages: number;
    dominant_page_type: PageType | null;
    page_type_counts: Record<PageType, number>;
    total_pages: number;
    pages_with_good_text: number;
    ocr_candidate_pages: number;
    ocr_attempted_pages: number;
    ocr_succeeded_pages: number;
    ocr_retried_pages: number;
    ocr_failed_pages: number;
    early_exit_triggered: boolean;
    failure_reason: OcrFailureReason;
    pages: Array<{
      page: number;
      page_type: PageType;
      ocr_decision: OcrDecision;
      extraction_method: "text" | "ocr";
      extraction_quality: ExtractionQuality;
      text_char_count: number;
      word_count: number;
      table_blocks: number;
      formula_blocks: number;
      structured_preview: string;
      signals: PageClassificationSignals;
      ocr_retry_used: boolean;
      ocr_retry_succeeded: boolean;
      ocr_final_outcome: OcrPageOutcome;
      ocr_attempts: OcrPageAttempt[];
    }>;
    total_table_blocks: number;
    total_formula_blocks: number;
    timings: PdfExtractionTimings;
  };
  timings: PdfExtractionTimings;
};

export type PdfExtractionProgress = {
  stage: "ocr_started" | "ocr_finished";
  totalPages: number;
  ocrCandidatePages: number;
  scanLikeDocument: boolean;
  documentClass: PdfDocumentClass;
  ocrStrategy: "ocr_first" | "ocr_fallback";
};

type ExtractOpts = {
  fileName?: string;
  fileSizeBytes?: number;
  maxPages?: number;
  allowOcr?: boolean;
  ocrStrategy?: "auto" | "ocr_first";
  onProgress?: (event: PdfExtractionProgress) => void | Promise<void>;
};

type TextAnalysis = {
  normalizedText: string;
  charCount: number;
  wordCount: number;
  alphaNumRatio: number;
  brokenTokenRatio: number;
  looksUsable: boolean;
  quality: ExtractionQuality;
  score: number;
};

type PositionedTextItem = {
  str: string;
  x: number;
  y: number;
  width: number;
};

type PdfPageSource = {
  rawText: string;
  lines: string[];
};

type OcrDecision = "text_ok" | "low_text_candidate" | "scan_like_candidate" | "hopeless_candidate";

type OcrFailureReason =
  | "insufficient_readable_text"
  | "ocr_timeout"
  | "unreadable_scan_pdf"
  | "scan_heavy_pdf_rejected"
  | null;

type OcrDiagnostics = {
  totalPages: number;
  pagesWithGoodText: number;
  ocrCandidatePages: number;
  ocrAttemptedPages: number;
  ocrSucceededPages: number;
  ocrRetriedPages: number;
  ocrFailedPages: number;
  earlyExitTriggered: boolean;
  failureReason: OcrFailureReason;
  ocrPageResults: OcrPageResult[];
};

const OCR_ENGINE = "openai_pdf_ocr";
const VISION_ENGINE = "openai_pdf_math_vision";
const OCR_MODEL = (process.env.OPENAI_MODEL_OCR ?? process.env.OPENAI_MODEL ?? "gpt-4o-mini").trim();
const SCAN_HEAVY_PREFLIGHT_PAGE_COUNT = 8;
const SCAN_HEAVY_OCR_SAMPLE_PAGE_COUNT = 3;
const SCAN_HEAVY_PREFLIGHT_MIN_BYTES = 10 * 1024 * 1024;
const OCR_FALLBACK_BATCH_SIZE = 2;
const OCR_FIRST_BATCH_SIZE = 3;
const OCR_TIMEOUT_MS = (() => {
  const value = Number(process.env.OPENAI_OCR_TIMEOUT_MS ?? 10_000);
  return Number.isFinite(value) && value > 0 ? value : 10_000;
})();
const require = createRequire(import.meta.url);

function nowMs() {
  return Date.now();
}

function elapsedMs(startedAt: number) {
  return Math.max(0, nowMs() - startedAt);
}

function normalizePageText(input: string) {
  return String(input ?? "")
    .replace(/\u0000/g, " ")
    .replace(/\r/g, "\n")
    .replace(/\t/g, " ")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n[ \t]+/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function normalizeLinePreserveColumns(input: string) {
  return String(input ?? "").replace(/\u0000/g, " ").replace(/\t/g, " ").replace(/[ ]{4,}/g, "   ").trimEnd();
}

const MATH_FORMULA_SIGNAL_RE =
  /(?:[a-zA-Z]\s*\([^)]*\)\s*=|[a-zA-Z]\s*=\s*[-+]?[\d(]|[=≈<>≤≥]|\^|\\frac|\\sqrt|±|√|\b(?:sin|cos|tan)\s*\()/i;
const MATH_FORMULA_SNIPPET_RE =
  /(?:f\(x\)\s*=\s*a\s*x\^?2\s*\+\s*b\s*x\s*\+\s*c|a\s*x\^?2\s*\+\s*b\s*x\s*\+\s*c\s*=\s*0|x[_ ]?[Tt]\s*=\s*-?\s*b\s*\/\s*\(?2\s*·?\s*a\)?|y[_ ]?[Tt]\s*=\s*-?\s*d\s*\/\s*\(?4\s*·?\s*a\)?|d\s*=\s*b\^?2\s*[-+]\s*4\s*·?\s*a\s*·?\s*c|x\s*=\s*\(?-?b\s*[±+\-]\s*√?\s*d\)?\s*\/\s*\(?2\s*·?\s*a\)?|T\s*=\s*1\s*\/\s*2\s*·?\s*a\s*·?\s*b\s*·?\s*sin\(?C\)?|\|[A-Z]{2}\|\s*=\s*√?\([^.;:\n]{4,96}\)|\(x\s*-\s*a\)\^?2\s*\+\s*\(y\s*-\s*b\)\^?2\s*=\s*r\^?2|f['’]\(x\)\s*[<>]=?\s*0|f['’]\(x\)\s*=\s*0|O['’]\(x\)\s*=\s*0|O\(x,h\)\s*=\s*4xh\s*\+\s*x\^?2|O\(x\)\s*=\s*(?:x\^?2\s*\+\s*400\s*\/\s*x|400\s*\/\s*x\s*\+\s*x\^?2)|V\s*=\s*x\s*·?\s*x\s*·?\s*h(?:\s*=\s*100)?|x\^?2h\s*=\s*100|h\s*=\s*(?:V|100)\s*\/\s*x\^?2|c\^?2\s*=\s*a\^?2\s*\+\s*b\^?2\s*-\s*2\s*·?\s*a\s*·?\s*b\s*·?\s*cos\(?C\)?|a\s*\/\s*sin\(?A\)?\s*=\s*b\s*\/\s*sin\(?B\)?\s*=\s*c\s*\/\s*sin\(?C\)?)/gi;

function normalizeMathFormulaText(input: string) {
  return normalizePageText(input)
    .replace(/\\frac\s*\{([^{}]+)\}\s*\{([^{}]+)\}/gi, "($1) / ($2)")
    .replace(/\\sqrt\s*\{([^{}]+)\}/gi, "√($1)")
    .replace(/\\pm/gi, "±")
    .replace(/\\cdot/gi, "·")
    .replace(/\\ge/gi, "≥")
    .replace(/\\le/gi, "≤")
    .replace(/\\approx/gi, "≈")
    .replace(/\\ne/gi, "!=")
    .replace(/\s+(?:for|hvor|hvis|naar|når|til|saa|så|og|eller|medfører|medfoerer|giver|har|kan|bruges)\b.*$/i, "")
    .replace(/,\s*(?:for|hvor|hvis|naar|når|til|saa|så|og|eller)\b.*$/i, "")
    .replace(/,\s*[A-Za-z]\s*[<>]=?\s*.*$/i, "")
    .replace(/\s*·\s*/g, " · ")
    .replace(/[{}]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function formulaToLatex(input: string) {
  return normalizeMathFormulaText(input)
    .replace(/’/g, "'")
    .replace(/>=/g, "\\ge ")
    .replace(/<=/g, "\\le ")
    .replace(/≥/g, "\\ge ")
    .replace(/≤/g, "\\le ")
    .replace(/≈/g, "\\approx ")
    .replace(/!=/g, "\\ne ")
    .replace(/±/g, "\\pm ")
    .replace(/·/g, "\\cdot ")
    .replace(/\b([xy])([0-9])\b/g, "$1_$2")
    .replace(/\bsin\s*\(/gi, "\\sin(")
    .replace(/\bcos\s*\(/gi, "\\cos(")
    .replace(/\btan\s*\(/gi, "\\tan(")
    .replace(/√\s*\(([^()]+(?:\([^()]*\)[^()]*)*)\)/g, "\\sqrt{$1}")
    .replace(/√\s*([A-Za-z0-9_]+)/g, "\\sqrt{$1}")
    .replace(/\(([^()]+)\)\s*\/\s*\(([^()]+)\)/g, "\\frac{$1}{$2}")
    .replace(/\b([A-Za-z][A-Za-z0-9_']*|\d+)\s*\/\s*([A-Za-z][A-Za-z0-9_]*(?:\^\d+)?|\d+)\b/g, "\\frac{$1}{$2}")
    .trim();
}

function extractMathHeadingCandidates(text: string) {
  return Array.from(
    new Set(
      normalizePageText(text)
        .split(/\n+/)
        .map((line) => line.trim())
        .filter((line) => line.length >= 4 && line.length <= 90)
        .filter((line) => /[A-Za-zÆØÅæøå]/.test(line))
        .filter((line) => !/[.!?]$/.test(line))
        .filter((line) => !MATH_FORMULA_SIGNAL_RE.test(line))
        .slice(0, 4),
    ),
  );
}

function extractMathFormulaCandidatesFromText(args: {
  text: string;
  origin: FormulaExtractionOrigin;
  quality: ExtractionQuality;
  pageType: PageType;
}) {
  const normalized = normalizePageText(args.text);
  if (!normalized) return [];

  const lines = normalized.split(/\n+/).map((line) => line.trim()).filter(Boolean);
  const sentences = normalized.split(/(?<=[.!?])\s+/).map((line) => line.trim()).filter(Boolean);
  const contexts = [...lines, ...sentences, normalized];
  const baseConfidence =
    args.origin === "vision"
      ? 0.92
      : args.origin === "ocr"
        ? args.quality === "high"
          ? 0.8
          : args.quality === "medium"
            ? 0.72
            : 0.6
        : args.quality === "high"
          ? 0.88
          : args.quality === "medium"
            ? 0.8
            : 0.68;
  const pageBoost = args.pageType === "formula_heavy" || args.pageType === "mixed" ? 0.05 : 0;
  const seen = new Set<string>();
  const candidates: ExtractedPageFormulaCandidate[] = [];

  for (const context of contexts) {
    const compact = normalizePageText(context);
    const snippets = Array.from(compact.matchAll(MATH_FORMULA_SNIPPET_RE)).map((match) => match[0] ?? "");
    if (!snippets.length && MATH_FORMULA_SIGNAL_RE.test(compact) && compact.length <= 96) {
      snippets.push(compact);
    }

    for (const rawSnippet of snippets) {
      const normalizedFormula = normalizeMathFormulaText(rawSnippet);
      if (!normalizedFormula || normalizedFormula.length < 5 || normalizedFormula.length > 120) continue;
      const key = normalizedFormula.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      candidates.push({
        rawFormula: normalizedFormula,
        normalizedFormula,
        latexFormula: formulaToLatex(normalizedFormula),
        surroundingText: compact.slice(0, 220),
        origin: args.origin,
        confidence: Math.min(0.99, Number((baseConfidence + pageBoost).toFixed(2))),
      });
    }
  }

  return candidates;
}

function isWeakMathPage(args: {
  charCount: number;
  wordCount: number;
  pageType: PageType;
  signals: PageClassificationSignals;
  formulaBlocks: number;
}) {
  const lowText = args.charCount < 110 || args.wordCount < 18;
  const formulaDense =
    args.pageType === "formula_heavy" ||
    args.pageType === "mixed" ||
    args.formulaBlocks > 0 ||
    args.signals.formulaLineRatio >= 0.18 ||
    args.signals.symbolRatio >= 0.05;
  return args.charCount === 0 || (lowText && formulaDense);
}

function analyzeText(input: string): TextAnalysis {
  const normalizedText = normalizePageText(input);
  const charCount = normalizedText.length;
  const tokens = normalizedText ? normalizedText.split(/\s+/).filter(Boolean) : [];
  const wordCount = tokens.length;
  const alphaNumChars = Array.from(normalizedText).filter((ch) => /[\p{L}\p{N}]/u.test(ch)).length;
  const visibleChars = Array.from(normalizedText).filter((ch) => /\S/u.test(ch)).length;
  const alphaNumRatio = visibleChars > 0 ? alphaNumChars / visibleChars : 0;
  const shortOrBrokenTokens = tokens.filter((token) => {
    if (token.length <= 1) return true;
    const alphaNum = Array.from(token).filter((ch) => /[\p{L}\p{N}]/u.test(ch)).length;
    return alphaNum <= Math.max(1, Math.floor(token.length * 0.34));
  }).length;
  const brokenTokenRatio = wordCount > 0 ? shortOrBrokenTokens / wordCount : 1;

  const looksUsable =
    charCount >= 80 &&
    wordCount >= 15 &&
    alphaNumRatio >= 0.45 &&
    brokenTokenRatio <= 0.55;

  let quality: ExtractionQuality = "low";
  if (looksUsable && charCount >= 180 && alphaNumRatio >= 0.6 && brokenTokenRatio <= 0.35) {
    quality = "high";
  } else if (charCount >= 40 && wordCount >= 8 && alphaNumRatio >= 0.35 && brokenTokenRatio <= 0.7) {
    quality = "medium";
  }

  const score =
    charCount * 0.08 +
    wordCount * 1.2 +
    alphaNumRatio * 40 -
    brokenTokenRatio * 35 +
    (looksUsable ? 25 : 0) +
    (quality === "high" ? 15 : quality === "medium" ? 5 : 0);

  return {
    normalizedText,
    charCount,
    wordCount,
    alphaNumRatio,
    brokenTokenRatio,
    looksUsable,
    quality,
    score,
  };
}

function classifyLineKind(line: string) {
  const trimmed = line.trim();
  if (!trimmed) return "blank" as const;

  const tokens = trimmed.split(/\s+/).filter(Boolean);
  const visibleChars = Array.from(trimmed).filter((ch) => /\S/u.test(ch));
  const digitChars = visibleChars.filter((ch) => /\d/.test(ch)).length;
  const symbolChars = visibleChars.filter((ch) => /[=+\-/*^%()[\]{}<>~|\\±×÷∑∏√∞≈≠≤≥∆∂µπ]/u.test(ch)).length;
  const separatorCount = (trimmed.match(/[|;:]/g) ?? []).length;
  const numericTokens = tokens.filter((token) => /^[$€£¥]?\(?[\d.,%:/-]+\)?$/.test(token)).length;
  const multiSpaceColumns = (line.match(/ {3,}/g) ?? []).length;
  const digitRatio = visibleChars.length > 0 ? digitChars / visibleChars.length : 0;
  const symbolRatio = visibleChars.length > 0 ? symbolChars / visibleChars.length : 0;
  const numericTokenRatio = tokens.length > 0 ? numericTokens / tokens.length : 0;

  const formulaLike =
    symbolRatio >= 0.1 ||
    symbolChars >= 3 ||
    (/=/.test(trimmed) && /[+\-/*^]/.test(trimmed)) ||
    ((trimmed.match(/[()]/g) ?? []).length >= 2 && symbolChars >= 2);
  const tableLike =
    multiSpaceColumns >= 1 ||
    separatorCount >= 2 ||
    numericTokenRatio >= 0.35 ||
    (digitRatio >= 0.25 && tokens.length >= 4);

  if (tableLike && !formulaLike) return "table" as const;
  if (formulaLike && !tableLike) return "formula" as const;
  if (tableLike && formulaLike) return "table" as const;
  return "text" as const;
}

function structurePageText(args: { pageType: PageType; text: string; lines?: string[] }): {
  text: string;
  tableBlocks: number;
  formulaBlocks: number;
} {
  const sourceLines = (args.lines?.length ? args.lines : args.text.split(/\n/))
    .map((line) => normalizeLinePreserveColumns(line))
    .map((line) => line.replace(/[ ]{2,}$/g, ""))
    .filter((line, idx, arr) => !(line === "" && arr[idx - 1] === ""));

  const out: string[] = [];
  let i = 0;
  let tableBlocks = 0;
  let formulaBlocks = 0;

  const shouldPreferTable = args.pageType === "table_heavy";
  const shouldPreferFormula = args.pageType === "formula_heavy";
  const shouldTryMixed = args.pageType === "mixed";

  while (i < sourceLines.length) {
    const current = sourceLines[i] ?? "";
    const currentKind = classifyLineKind(current);

    if (!current.trim()) {
      if (out[out.length - 1] !== "") out.push("");
      i += 1;
      continue;
    }

    const startTableBlock =
      currentKind === "table" && (shouldPreferTable || shouldTryMixed || classifyLineKind(sourceLines[i + 1] ?? "") === "table");
    if (startTableBlock) {
      const block: string[] = [];
      while (i < sourceLines.length) {
        const line = sourceLines[i] ?? "";
        const kind = classifyLineKind(line);
        if (!line.trim()) break;
        if (kind !== "table" && block.length > 0) break;
        if (kind === "text" && block.length === 0 && !shouldPreferTable) break;
        block.push(line);
        i += 1;
      }
      out.push(block.join("\n"));
      out.push("");
      tableBlocks += 1;
      continue;
    }

    const startFormulaBlock =
      currentKind === "formula" &&
      (shouldPreferFormula || shouldTryMixed || classifyLineKind(sourceLines[i + 1] ?? "") === "formula");
    if (startFormulaBlock) {
      const block: string[] = [];
      while (i < sourceLines.length) {
        const line = sourceLines[i] ?? "";
        const kind = classifyLineKind(line);
        if (!line.trim()) break;
        const shortTextExplainer = kind === "text" && line.trim().length <= 90 && block.length > 0;
        if (kind !== "formula" && !shortTextExplainer && block.length > 0) break;
        if (kind === "text" && block.length === 0 && !shouldPreferFormula) break;
        block.push(line);
        i += 1;
      }
      out.push(block.join("\n"));
      out.push("");
      formulaBlocks += 1;
      continue;
    }

    out.push(current.trim());
    i += 1;
  }

  const structured = out.join("\n").replace(/\n{3,}/g, "\n\n").trim();
  return {
    text: structured,
    tableBlocks,
    formulaBlocks,
  };
}

function classifyPage(args: {
  text: string;
  extractionMethod: "text" | "ocr";
  quality: ExtractionQuality;
  charCount: number;
  wordCount: number;
  alphaNumRatio: number;
  brokenTokenRatio: number;
}): PageClassificationCore {
  const text = args.text;
  const lines = text.split(/\n/);
  const nonEmptyLines = lines.map((line) => line.trim()).filter(Boolean);
  const visibleChars = Array.from(text).filter((ch) => /\S/u.test(ch));
  const digitChars = visibleChars.filter((ch) => /\d/.test(ch)).length;
  const symbolChars = visibleChars.filter((ch) =>
    /[=+\-/*^%()[\]{}<>~|\\±×÷∑∏√∞≈≠≤≥∆∂µπ]/u.test(ch),
  ).length;
  const tokens = text.split(/\s+/).filter(Boolean);
  const numericTokens = tokens.filter((token) =>
    /^[$€£¥]?\d[\d.,%:/-]*$/.test(token) || /^\(?\d[\d.,%:/-]*\)?$/.test(token),
  ).length;
  const formulaLines = nonEmptyLines.filter((line) => {
    const formulaTokens = (line.match(/[=+\-/*^%()[\]{}<>±×÷∑∏√∞≈≠≤≥∆∂µπ]/gu) ?? []).length;
    const greek = (line.match(/[α-ωΑ-Ωµπ∆]/gu) ?? []).length;
    return formulaTokens + greek >= 3;
  }).length;
  const tableLikeLines = nonEmptyLines.filter((line) => {
    const parts = line.split(/\s+/).filter(Boolean);
    if (parts.length < 4) return false;
    const numericish = parts.filter((part) => /^[$€£¥]?\(?[\d.,%-/]+\)?$/.test(part)).length;
    const separatorCount = (line.match(/[|;:]/g) ?? []).length;
    return numericish >= 2 || (separatorCount >= 2 && parts.length >= 5);
  }).length;
  const shortLines = nonEmptyLines.filter((line) => line.length <= 24).length;

  const nonEmptyLineCount = nonEmptyLines.length;
  const lineCount = lines.length;
  const digitRatio = visibleChars.length > 0 ? digitChars / visibleChars.length : 0;
  const symbolRatio = visibleChars.length > 0 ? symbolChars / visibleChars.length : 0;
  const numericTokenRatio = tokens.length > 0 ? numericTokens / tokens.length : 0;
  const formulaLineRatio = nonEmptyLineCount > 0 ? formulaLines / nonEmptyLineCount : 0;
  const tableLikeLineRatio = nonEmptyLineCount > 0 ? tableLikeLines / nonEmptyLineCount : 0;
  const shortLineRatio = nonEmptyLineCount > 0 ? shortLines / nonEmptyLineCount : 0;

  const signals: PageClassificationSignals = {
    lineCount,
    nonEmptyLineCount,
    digitRatio,
    symbolRatio,
    formulaLineRatio,
    tableLikeLineRatio,
    numericTokenRatio,
    shortLineRatio,
    usedOcrFallback: args.extractionMethod === "ocr",
  };

  let pageType: PageType = "text";

  const scanLike =
    args.extractionMethod === "ocr" &&
    (args.quality === "low" || args.charCount < 120 || args.wordCount < 20 || args.brokenTokenRatio > 0.45);
  const formulaLike =
    symbolRatio >= 0.09 ||
    formulaLineRatio >= 0.35 ||
    (numericTokenRatio >= 0.18 && symbolRatio >= 0.05) ||
    (args.alphaNumRatio < 0.72 && symbolRatio >= 0.07);
  const tableLike =
    tableLikeLineRatio >= 0.3 ||
    (numericTokenRatio >= 0.3 && shortLineRatio >= 0.35) ||
    (digitRatio >= 0.28 && nonEmptyLineCount >= 4);

  if (scanLike && !tableLike && !formulaLike) {
    pageType = "scan";
  } else if (tableLike && formulaLike) {
    pageType = "mixed";
  } else if (tableLike) {
    pageType = "table_heavy";
  } else if (formulaLike) {
    pageType = "formula_heavy";
  } else if (
    scanLike &&
    ((tableLikeLineRatio > 0.12 && numericTokenRatio > 0.12) || (formulaLineRatio > 0.12 && symbolRatio > 0.04))
  ) {
    pageType = "mixed";
  }

  return {
    page_type: pageType,
    signals,
  };
}

function summarizeDocumentQuality(pages: ExtractedPdfPage[]): ExtractionQuality {
  if (!pages.length) return "low";
  const high = pages.filter((p) => p.extractionQuality === "high").length;
  const low = pages.filter((p) => p.extractionQuality === "low").length;
  if (high === pages.length) return "high";
  if (low > 0) return "low";
  return "medium";
}

function countPagesWithGoodText(pages: ExtractedPdfPage[]) {
  return pages.filter(
    (page) =>
      page.extractionQuality === "high" ||
      (page.extractionQuality === "medium" &&
        page.wordCount >= 12 &&
        page.alphaNumRatio >= 0.45 &&
        page.brokenTokenRatio <= 0.6),
  ).length;
}

function summarizeReadableText(pages: ExtractedPdfPage[]) {
  return pages.reduce(
    (acc, page) => {
      acc.totalChars += page.textCharCount;
      acc.totalWords += page.wordCount;
      return acc;
    },
    {
      totalChars: 0,
      totalWords: 0,
      pagesWithGoodText: countPagesWithGoodText(pages),
    },
  );
}

function classifyDocumentClass(args: {
  pageCount: number;
  pages: ExtractedPdfPage[];
  readable: ReturnType<typeof summarizeReadableText>;
  initialScanPages: number;
  ocrCandidatePages: number;
  hopelessCandidatePages: number;
}): PdfDocumentClass {
  const { pageCount, pages, readable, initialScanPages, ocrCandidatePages, hopelessCandidatePages } = args;
  if (pageCount <= 0) return "text_layer_pdf";

  const thinTextPages = pages.filter((page) => page.textCharCount < 30 || page.wordCount < 6).length;
  const candidateLikePages = ocrCandidatePages + hopelessCandidatePages;

  const clearlyTextLayer =
    readable.pagesWithGoodText >= Math.max(1, Math.ceil(pageCount * 0.4)) &&
    readable.totalWords >= Math.max(50, pageCount * 12) &&
    readable.totalChars >= Math.max(260, pageCount * 120) &&
    candidateLikePages <= Math.max(1, Math.ceil(pageCount * 0.4));
  if (clearlyTextLayer) return "text_layer_pdf";

  const clearlyImageOnly =
    readable.pagesWithGoodText === 0 &&
    readable.totalWords < Math.max(24, pageCount * 6) &&
    readable.totalChars < Math.max(140, pageCount * 28) &&
    (candidateLikePages >= Math.max(1, Math.ceil(pageCount * 0.8)) ||
      thinTextPages >= Math.max(1, Math.ceil(pageCount * 0.8)) ||
      initialScanPages >= Math.max(1, Math.ceil(pageCount * 0.6)));
  if (clearlyImageOnly) return "image_only_pdf";

  return "mixed_pdf";
}

function selectOcrCandidates(args: {
  pages: ExtractedPdfPage[];
  strategy: "ocr_first" | "ocr_fallback";
}) {
  const { pages, strategy } = args;
  if (strategy === "ocr_first") {
    return pages.filter((page) => page.extractionMeta.ocr_decision !== "text_ok");
  }
  return pages.filter(
    (page) =>
      page.extractionMeta.ocr_decision === "low_text_candidate" ||
      page.extractionMeta.ocr_decision === "scan_like_candidate",
  );
}

function classifyOcrDecision(page: ExtractedPdfPage): OcrDecision {
  if (
    page.extractionQuality === "high" ||
    (page.extractionQuality === "medium" &&
      page.wordCount >= 12 &&
      page.alphaNumRatio >= 0.45 &&
      page.brokenTokenRatio <= 0.6)
  ) {
    return "text_ok";
  }

  const scanLike = page.extractionMeta.page_type === "scan";
  const veryThinText = page.textCharCount < 18 || page.wordCount < 4;
  const weakText = page.textCharCount < 60 || page.wordCount < 12;
  const veryBroken = page.brokenTokenRatio >= 0.82 || page.alphaNumRatio <= 0.22;

  if (scanLike && veryThinText && veryBroken) {
    return "hopeless_candidate";
  }

  if (scanLike || page.extractionQuality === "low" || veryThinText) {
    return "scan_like_candidate";
  }

  if (weakText) {
    return "low_text_candidate";
  }

  return "low_text_candidate";
}

function shouldEarlyExitAfterOcr(args: {
  diagnostics: OcrDiagnostics;
  pages: ExtractedPdfPage[];
  scanLikeDocument: boolean;
  initialPagesWithGoodText: number;
  initialTotalChars: number;
  initialTotalWords: number;
}) {
  const { diagnostics, pages, scanLikeDocument, initialPagesWithGoodText, initialTotalChars, initialTotalWords } = args;
  if (!scanLikeDocument) return false;
  if (initialPagesWithGoodText > 0) return false;
  if (initialTotalChars >= 160 || initialTotalWords >= 32) return false;
  if (diagnostics.ocrAttemptedPages < Math.min(2, diagnostics.ocrCandidatePages)) return false;

  const current = summarizeReadableText(pages);
  const noUsefulRecovery =
    current.pagesWithGoodText === 0 &&
    current.totalChars < 180 &&
    current.totalWords < 36 &&
    diagnostics.ocrSucceededPages === 0;

  return noUsefulRecovery;
}

function shouldRejectScanHeavyPdfPreflight(args: { pages: ExtractedPdfPage[]; fileSizeBytes: number }) {
  const { pages, fileSizeBytes } = args;
  if (fileSizeBytes < SCAN_HEAVY_PREFLIGHT_MIN_BYTES) return false;

  const previewPages = pages.slice(0, Math.min(SCAN_HEAVY_PREFLIGHT_PAGE_COUNT, pages.length));
  if (previewPages.length < 3) return false;

  const previewReadable = summarizeReadableText(previewPages);
  const scanHeavyPreviewPages = previewPages.filter(
    (page) =>
      page.extractionMeta.ocr_decision === "scan_like_candidate" ||
      page.extractionMeta.ocr_decision === "hopeless_candidate",
  ).length;
  const hopelessPreviewPages = previewPages.filter((page) => page.extractionMeta.ocr_decision === "hopeless_candidate").length;

  return (
    previewReadable.pagesWithGoodText === 0 &&
    previewReadable.totalChars < 220 &&
    previewReadable.totalWords < 44 &&
    scanHeavyPreviewPages >= Math.max(2, Math.ceil(previewPages.length * 0.75)) &&
    hopelessPreviewPages >= Math.max(1, Math.floor(previewPages.length / 2))
  );
}

function pickRepresentativeOcrSamplePages(pages: ExtractedPdfPage[]) {
  const previewPages = pages.slice(0, Math.min(SCAN_HEAVY_PREFLIGHT_PAGE_COUNT, pages.length));
  const candidates = previewPages.filter(
    (page) =>
      page.extractionMeta.ocr_decision === "scan_like_candidate" ||
      page.extractionMeta.ocr_decision === "hopeless_candidate",
  );
  if (candidates.length <= SCAN_HEAVY_OCR_SAMPLE_PAGE_COUNT) return candidates;

  const selected: ExtractedPdfPage[] = [];
  const seen = new Set<number>();
  const indices = [0, Math.floor((candidates.length - 1) / 2), candidates.length - 1];
  for (const index of indices) {
    const page = candidates[index];
    if (!page || seen.has(page.pageNumber)) continue;
    selected.push(page);
    seen.add(page.pageNumber);
  }
  return selected;
}

function applyOcrTextToPage(page: ExtractedPdfPage, ocrText: string) {
  if (!ocrText) return { applied: false, readable: false };

  const originalAnalysis = analyzeText(page.text);
  const ocrStructured = structurePageText({
    pageType: page.extractionMeta.page_type,
    text: ocrText,
  });
  const ocrAnalysis = analyzeText(ocrStructured.text || ocrText);
  const ocrLooksReadable =
    ocrAnalysis.looksUsable ||
    (ocrAnalysis.quality !== "low" && ocrAnalysis.wordCount >= 12 && ocrAnalysis.alphaNumRatio >= 0.45);
  if (ocrAnalysis.score <= originalAnalysis.score && originalAnalysis.looksUsable) {
    return { applied: false, readable: false };
  }

  page.text = ocrAnalysis.normalizedText;
  page.extractionMethod = "ocr";
  page.extractionQuality = ocrAnalysis.quality;
  page.textCharCount = ocrAnalysis.charCount;
  page.wordCount = ocrAnalysis.wordCount;
  page.alphaNumRatio = ocrAnalysis.alphaNumRatio;
  page.brokenTokenRatio = ocrAnalysis.brokenTokenRatio;
  const ocrClassification = classifyPage({
    text: ocrAnalysis.normalizedText,
    extractionMethod: "ocr",
    quality: ocrAnalysis.quality,
    charCount: ocrAnalysis.charCount,
    wordCount: ocrAnalysis.wordCount,
    alphaNumRatio: ocrAnalysis.alphaNumRatio,
    brokenTokenRatio: ocrAnalysis.brokenTokenRatio,
  });
  page.extractionMeta = {
    ...ocrClassification,
    ocr_decision: classifyOcrDecision({
      ...page,
      extractionMeta: {
        ...page.extractionMeta,
        ...ocrClassification,
      },
    }),
    table_blocks: ocrStructured.tableBlocks,
    formula_blocks: ocrStructured.formulaBlocks,
    structured_preview: ocrAnalysis.normalizedText.slice(0, 220),
    weak_text_for_math: isWeakMathPage({
      charCount: ocrAnalysis.charCount,
      wordCount: ocrAnalysis.wordCount,
      pageType: ocrClassification.page_type,
      signals: ocrClassification.signals,
      formulaBlocks: ocrStructured.formulaBlocks,
    }),
    heading_candidates: extractMathHeadingCandidates(ocrAnalysis.normalizedText),
    math_formula_candidates: extractMathFormulaCandidatesFromText({
      text: ocrAnalysis.normalizedText,
      origin: "ocr",
      quality: ocrAnalysis.quality,
      pageType: ocrClassification.page_type,
    }),
  };

  return { applied: true, readable: ocrLooksReadable };
}

function selectMathVisionCandidates(pages: ExtractedPdfPage[]) {
  return pages.filter((page) => {
    const formulaDense =
      page.extractionMeta.page_type === "formula_heavy" ||
      page.extractionMeta.page_type === "mixed" ||
      page.extractionMeta.signals.formulaLineRatio >= 0.18 ||
      page.extractionMeta.signals.symbolRatio >= 0.05 ||
      page.extractionMeta.formula_blocks > 0;
    const weakText = page.extractionMeta.weak_text_for_math || page.textCharCount < 120 || page.wordCount < 18;
    const missingStructuredMath = (page.extractionMeta.math_formula_candidates?.length ?? 0) < 2;
    return formulaDense && weakText && missingStructuredMath;
  });
}

async function runScanHeavyOcrSample(args: {
  buf: Buffer;
  fileName: string;
  pages: ExtractedPdfPage[];
}) {
  const sampleStartedAt = nowMs();
  const samplePages = pickRepresentativeOcrSamplePages(args.pages);
  if (samplePages.length === 0) {
    return {
      elapsedMs: 0,
      attemptedPages: 0,
      succeededPages: 0,
      timeoutCount: 0,
      promising: false,
      ocrTexts: [] as Array<{ page: number; text: string; engine: string }>,
      pageResults: [] as OcrPageResult[],
      retriedPages: 0,
      failedPages: 0,
    };
  }

  let attemptedPages = 0;
  let succeededPages = 0;
  let timeoutCount = 0;
  const ocrTexts: Array<{ page: number; text: string; engine: string }> = [];
  const pageResults: OcrPageResult[] = [];
  let retriedPages = 0;
  let failedPages = 0;

  for (let index = 0; index < samplePages.length; index += 2) {
    const batch = samplePages.slice(index, index + 2);
    const results = await Promise.all(
      batch.map(async (page) => {
        const ocrRun = await runOcrWithRetryForPage({
          pdfBuffer: args.buf,
          fileName: args.fileName,
          pageNumber: page.pageNumber,
        });
        return { page, ...ocrRun };
      }),
    );

    for (const result of results) {
      attemptedPages += 1;
      timeoutCount += result.timeoutCount;
      if (result.retryUsed) retriedPages += 1;
      let finalOutcome: OcrPageOutcome = "failed";

      if (result.finalError && !result.ocrText) {
        console.warn(`[pdf/extract] OCR sample failed for page ${result.page.pageNumber}:`, result.finalError);
      }

      if (result.ocrText) {
        const applied = applyOcrTextToPage(result.page, result.ocrText);
        if (applied.applied && applied.readable) {
          succeededPages += 1;
          ocrTexts.push({ page: result.page.pageNumber, text: result.page.text, engine: OCR_ENGINE });
          finalOutcome = "succeeded";
        } else {
          finalOutcome = "degraded";
        }
      } else if (!result.finalError) {
        finalOutcome = "degraded";
      }

      if (finalOutcome === "failed") failedPages += 1;
      const pageResult: OcrPageResult = {
        page: result.page.pageNumber,
        retry_used: result.retryUsed,
        retry_succeeded: result.retrySucceeded,
        final_outcome: finalOutcome,
        attempts: result.attempts,
      };
      pageResults.push(pageResult);
      logOcrPageOutcome({
        fileName: args.fileName,
        pageNumber: result.page.pageNumber,
        retryUsed: result.retryUsed,
        retrySucceeded: result.retrySucceeded,
        finalOutcome,
        attempts: result.attempts,
      });
    }
  }

  const sampleReadable = summarizeReadableText(samplePages);
  const promising =
    sampleReadable.pagesWithGoodText >= 1 ||
    sampleReadable.totalChars >= 180 ||
    sampleReadable.totalWords >= 36 ||
    succeededPages >= 1;

  return {
    elapsedMs: elapsedMs(sampleStartedAt),
    attemptedPages,
    succeededPages,
    timeoutCount,
    promising,
    ocrTexts,
    pageResults,
    retriedPages,
    failedPages,
  };
}

function groupItemsIntoLines(items: PositionedTextItem[]) {
  const sorted = [...items].sort((a, b) => {
    if (Math.abs(b.y - a.y) > 2) return b.y - a.y;
    return a.x - b.x;
  });

  const lines: Array<{ y: number; items: PositionedTextItem[] }> = [];
  for (const item of sorted) {
    const existing = lines.find((line) => Math.abs(line.y - item.y) <= 3);
    if (existing) {
      existing.items.push(item);
      existing.y = (existing.y + item.y) / 2;
    } else {
      lines.push({ y: item.y, items: [item] });
    }
  }

  return lines
    .sort((a, b) => b.y - a.y)
    .map((line) => {
      const parts = [...line.items].sort((a, b) => a.x - b.x);
      let text = "";
      let prevEnd = 0;
      for (const part of parts) {
        const gap = text ? part.x - prevEnd : 0;
        if (text) {
          if (gap >= 24) text += "   ";
          else if (gap >= 8) text += " ";
        }
        text += part.str;
        prevEnd = part.x + Math.max(part.width, part.str.length * 4);
      }
      return normalizeLinePreserveColumns(text);
    });
}

async function extractPdfPagesViaPdfjs(
  buf: Buffer,
  maxPages: number,
): Promise<{ pageCount: number; pages: PdfPageSource[]; timings: Pick<PdfExtractionTimings, "pdf_open_ms" | "render_ms"> }> {
  const mod: any = await import("pdfjs-dist/legacy/build/pdf.js");
  const pdfjs: any = mod?.default ?? mod;
  if (!(globalThis as any).pdfjsWorker?.WorkerMessageHandler) {
    const workerMod: any = require("pdfjs-dist/legacy/build/pdf.worker.js");
    (globalThis as any).pdfjsWorker = workerMod?.default ?? workerMod;
  }

  const openStartedAt = nowMs();
  const loadingTask = pdfjs.getDocument({
    data: new Uint8Array(buf),
    disableWorker: true,
  });

  const pdf = await loadingTask.promise;
  const pdfOpenMs = elapsedMs(openStartedAt);
  const pageCount = Math.min(Number(pdf?.numPages ?? 0) || 0, maxPages);
  const pages: PdfPageSource[] = [];
  const renderStartedAt = nowMs();

  try {
    for (let pageNum = 1; pageNum <= pageCount; pageNum++) {
      const page = await pdf.getPage(pageNum);
      const tc = await page.getTextContent();
      const items: PositionedTextItem[] = (Array.isArray(tc?.items) ? tc.items : [])
        .map((it: any): PositionedTextItem => {
          const str = typeof it?.str === "string" ? it.str : "";
          const transform = Array.isArray(it?.transform) ? it.transform : [];
          return {
            str,
            x: Number(transform[4] ?? 0) || 0,
            y: Number(transform[5] ?? 0) || 0,
            width: Number(it?.width ?? 0) || 0,
          };
        })
        .filter((item: PositionedTextItem) => item.str.trim().length > 0);
      const lines = groupItemsIntoLines(items).filter((line) => line.length > 0);
      pages.push({
        rawText: normalizePageText(lines.join("\n")),
        lines,
      });
    }
  } finally {
    try {
      await pdf.cleanup?.();
      await pdf.destroy?.();
    } catch {}
  }

  return {
    pageCount,
    pages,
    timings: {
      pdf_open_ms: Math.max(0, pdfOpenMs),
      render_ms: elapsedMs(renderStartedAt),
    },
  };
}

function canRunOcr() {
  return Boolean((process.env.OPENAI_API_KEY ?? "").trim());
}

function getResponseText(response: any): string {
  const direct = typeof response?.output_text === "string" ? response.output_text.trim() : "";
  if (direct) return direct;

  const output = Array.isArray(response?.output) ? response.output : [];
  for (const item of output) {
    const content = Array.isArray(item?.content) ? item.content : [];
    for (const part of content) {
      const text = typeof part?.text === "string" ? part.text.trim() : "";
      if (text) return text;
    }
  }
  return "";
}

type MathVisionFormulaPayload = {
  rawFormula?: string;
  latexFormula?: string;
  surroundingText?: string;
  confidence?: number;
};

type MathVisionPagePayload = {
  pageNumber?: number;
  headings?: string[];
  explanations?: string[];
  formulas?: MathVisionFormulaPayload[];
};

function safeParseJsonObject(value: string): Record<string, unknown> | null {
  const trimmed = String(value ?? "").trim();
  if (!trimmed) return null;
  const normalized = trimmed
    .replace(/^```json\s*/i, "")
    .replace(/^```\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim();
  const match = normalized.match(/\{[\s\S]*\}/);
  if (!match) return null;
  try {
    const parsed = JSON.parse(match[0]);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

function normalizeMathVisionPayload(payload: Record<string, unknown> | null): MathVisionPagePayload | null {
  if (!payload) return null;
  const headings = Array.isArray(payload.headings) ? payload.headings.map((item) => normalizePageText(String(item ?? ""))).filter(Boolean) : [];
  const explanations = Array.isArray(payload.explanations)
    ? payload.explanations.map((item) => normalizePageText(String(item ?? ""))).filter(Boolean)
    : [];
  const formulas: MathVisionFormulaPayload[] = [];
  if (Array.isArray(payload.formulas)) {
    for (const item of payload.formulas) {
      const formula = item && typeof item === "object" ? (item as Record<string, unknown>) : null;
      const rawFormula = normalizeMathFormulaText(String(formula?.rawFormula ?? ""));
      if (!rawFormula) continue;
      formulas.push({
        rawFormula,
        latexFormula: normalizePageText(String(formula?.latexFormula ?? "")) || formulaToLatex(rawFormula),
        surroundingText: normalizePageText(String(formula?.surroundingText ?? "")),
        confidence: Number(formula?.confidence ?? 0.92) || 0.92,
      });
    }
  }

  if (!headings.length && !explanations.length && !formulas.length) return null;
  return {
    pageNumber: Number(payload.pageNumber ?? 0) || undefined,
    headings: headings.slice(0, 5),
    explanations: explanations.slice(0, 6),
    formulas: formulas.slice(0, 8),
  };
}

async function extractSinglePagePdf(buffer: Buffer, pageIndexZeroBased: number) {
  const source = await PDFDocument.load(buffer);
  const single = await PDFDocument.create();
  const [copiedPage] = await single.copyPages(source, [pageIndexZeroBased]);
  single.addPage(copiedPage);
  const bytes = await single.save();
  return Buffer.from(bytes);
}

async function runOpenAIOcrForPage(args: {
  fileName: string;
  pageNumber: number;
  timeoutMs: number;
  mode: OcrAttemptMode;
  pagePdfBuffer: Buffer;
}): Promise<string> {
  const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY, timeout: args.timeoutMs });
  const abortController = new AbortController();
  let timeoutHandle: ReturnType<typeof setTimeout> | null = null;
  const startedAt = nowMs();
  const content = [
    {
      type: "input_file",
      filename: `${args.fileName.replace(/\.pdf$/i, "")}-page-${args.pageNumber}.pdf`,
      file_data: `data:application/pdf;base64,${args.pagePdfBuffer.toString("base64")}`,
    },
    {
      type: "input_text",
      text:
        "Transcribe all readable text from this single PDF page. Return only plain text. " +
        "Keep line breaks when helpful. If no useful text is readable, return an empty string.",
    },
  ];

  console.info("[pdf/extract] OCR request started", {
    fileName: args.fileName,
    pageNumber: args.pageNumber,
    timeoutMs: args.timeoutMs,
    mode: args.mode,
  });
  try {
    const response: any = await Promise.race([
      (openai as any).responses.create(
        {
          model: OCR_MODEL,
          input: [
            {
              role: "user",
              content,
            },
          ],
        },
        { signal: abortController.signal },
      ),
      new Promise<never>((_, reject) => {
        timeoutHandle = setTimeout(() => {
          abortController.abort();
          const error: any = new Error(`OCR request timed out after ${args.timeoutMs}ms`);
          error.code = "OCR_REQUEST_TIMEOUT";
          error.fileName = args.fileName;
          error.pageNumber = args.pageNumber;
          error.timeoutMs = args.timeoutMs;
          error.mode = args.mode;
          console.warn("[pdf/extract] OCR request timed out", {
            fileName: args.fileName,
            pageNumber: args.pageNumber,
            timeoutMs: args.timeoutMs,
            mode: args.mode,
          });
          reject(error);
        }, args.timeoutMs);
      }),
    ]);

    console.info("[pdf/extract] OCR request finished", {
      fileName: args.fileName,
      pageNumber: args.pageNumber,
      mode: args.mode,
      durationMs: elapsedMs(startedAt),
    });

    return normalizePageText(getResponseText(response));
  } finally {
    if (timeoutHandle) clearTimeout(timeoutHandle);
  }
}

async function runOpenAIMathVisionForPage(args: {
  fileName: string;
  pageNumber: number;
  timeoutMs: number;
  pagePdfBuffer: Buffer;
}): Promise<MathVisionPagePayload | null> {
  const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY, timeout: args.timeoutMs });
  const abortController = new AbortController();
  let timeoutHandle: ReturnType<typeof setTimeout> | null = null;
  const content = [
    {
      type: "input_file",
      filename: `${args.fileName.replace(/\.pdf$/i, "")}-page-${args.pageNumber}.pdf`,
      file_data: `data:application/pdf;base64,${args.pagePdfBuffer.toString("base64")}`,
    },
    {
      type: "input_text",
      text:
        "Læs denne ene PDF-side som matematikside. Returnér kun JSON på formen " +
        '{"pageNumber":number,"headings":["..."],"formulas":[{"rawFormula":"...","latexFormula":"...","surroundingText":"...","confidence":0.0}],"explanations":["..."]}. ' +
        "Udtræk kun sikre overskrifter, korte forklaringer og rigtige formellinjer. Ingen ekstra tekst uden for JSON.",
    },
  ];

  try {
    const response: any = await Promise.race([
      (openai as any).responses.create(
        {
          model: OCR_MODEL,
          input: [
            {
              role: "user",
              content,
            },
          ],
        },
        { signal: abortController.signal },
      ),
      new Promise<never>((_, reject) => {
        timeoutHandle = setTimeout(() => {
          abortController.abort();
          const error: any = new Error(`Math vision request timed out after ${args.timeoutMs}ms`);
          error.code = "MATH_VISION_TIMEOUT";
          reject(error);
        }, args.timeoutMs);
      }),
    ]);

    return normalizeMathVisionPayload(safeParseJsonObject(getResponseText(response)));
  } finally {
    if (timeoutHandle) clearTimeout(timeoutHandle);
  }
}

function applyMathVisionPayloadToPage(page: ExtractedPdfPage, payload: MathVisionPagePayload | null) {
  if (!payload) return false;

  const incomingFormulas = (payload.formulas ?? [])
    .map((item) => ({
      rawFormula: normalizeMathFormulaText(item.rawFormula ?? ""),
      normalizedFormula: normalizeMathFormulaText(item.rawFormula ?? ""),
      latexFormula: normalizePageText(item.latexFormula ?? "") || formulaToLatex(item.rawFormula ?? ""),
      surroundingText: normalizePageText(item.surroundingText ?? ""),
      origin: "vision" as const,
      confidence: Math.min(0.99, Math.max(0.5, Number(item.confidence ?? 0.92))),
    }))
    .filter((item) => item.rawFormula);
  const existingByKey = new Map(
    (page.extractionMeta.math_formula_candidates ?? []).map((item) => [item.normalizedFormula.toLowerCase(), item]),
  );
  for (const formula of incomingFormulas) {
    existingByKey.set(formula.normalizedFormula.toLowerCase(), formula);
  }

  const mergedHeadings = Array.from(new Set([...(page.extractionMeta.heading_candidates ?? []), ...(payload.headings ?? [])])).slice(0, 6);
  const structuredVisionText = normalizePageText(
    [
      ...mergedHeadings,
      ...(incomingFormulas.map((item) => item.rawFormula)),
      ...((payload.explanations ?? []).slice(0, 6)),
    ].join("\n"),
  );

  if (structuredVisionText && (page.textCharCount < 120 || page.extractionMeta.math_formula_candidates.length === 0)) {
    const combinedText = normalizePageText([structuredVisionText, page.text].filter(Boolean).join("\n\n"));
    const analysis = analyzeText(combinedText);
    const structured = structurePageText({
      pageType: page.extractionMeta.page_type,
      text: analysis.normalizedText,
    });
    const structuredAnalysis = analyzeText(structured.text || analysis.normalizedText);
    const classification = classifyPage({
      text: structuredAnalysis.normalizedText,
      extractionMethod: "ocr",
      quality: structuredAnalysis.quality,
      charCount: structuredAnalysis.charCount,
      wordCount: structuredAnalysis.wordCount,
      alphaNumRatio: structuredAnalysis.alphaNumRatio,
      brokenTokenRatio: structuredAnalysis.brokenTokenRatio,
    });
    page.text = structuredAnalysis.normalizedText;
    page.extractionMethod = "ocr";
    page.extractionQuality = structuredAnalysis.quality;
    page.textCharCount = structuredAnalysis.charCount;
    page.wordCount = structuredAnalysis.wordCount;
    page.alphaNumRatio = structuredAnalysis.alphaNumRatio;
    page.brokenTokenRatio = structuredAnalysis.brokenTokenRatio;
    page.extractionMeta = {
      ...classification,
      ocr_decision: classifyOcrDecision({
        ...page,
        extractionMeta: {
          ...page.extractionMeta,
          ...classification,
        },
      }),
      table_blocks: structured.tableBlocks,
      formula_blocks: structured.formulaBlocks,
      structured_preview: structuredAnalysis.normalizedText.slice(0, 220),
      weak_text_for_math: isWeakMathPage({
        charCount: structuredAnalysis.charCount,
        wordCount: structuredAnalysis.wordCount,
        pageType: classification.page_type,
        signals: classification.signals,
        formulaBlocks: structured.formulaBlocks,
      }),
      heading_candidates: mergedHeadings,
      math_formula_candidates: Array.from(existingByKey.values()),
    };
    return true;
  }

  page.extractionMeta = {
    ...page.extractionMeta,
    weak_text_for_math:
      page.extractionMeta.weak_text_for_math ||
      isWeakMathPage({
        charCount: page.textCharCount,
        wordCount: page.wordCount,
        pageType: page.extractionMeta.page_type,
        signals: page.extractionMeta.signals,
        formulaBlocks: page.extractionMeta.formula_blocks,
      }),
    heading_candidates: mergedHeadings,
    math_formula_candidates: Array.from(existingByKey.values()),
  };
  return incomingFormulas.length > 0 || mergedHeadings.length > 0;
}

async function runSingleOcrAttempt(args: {
  fileName: string;
  pageNumber: number;
  attempt: number;
  mode: OcrAttemptMode;
  timeoutMs: number;
  pagePdfBuffer: Buffer;
}) {
  const startedAt = nowMs();
  try {
    const text = await runOpenAIOcrForPage({
      fileName: args.fileName,
      pageNumber: args.pageNumber,
      timeoutMs: args.timeoutMs,
      mode: args.mode,
      pagePdfBuffer: args.pagePdfBuffer,
    });
    return {
      text,
      error: null as unknown,
      attempt: {
        attempt: args.attempt,
        mode: args.mode,
        duration_ms: elapsedMs(startedAt),
        timeout_ms: args.timeoutMs,
        timed_out: false,
        text_char_count: text.length,
        error_code: null,
        render_scale: null,
      } satisfies OcrPageAttempt,
    };
  } catch (error) {
    const errorCode = String((error as any)?.code ?? "").trim() || null;
    return {
      text: "",
      error,
      attempt: {
        attempt: args.attempt,
        mode: args.mode,
        duration_ms: elapsedMs(startedAt),
        timeout_ms: args.timeoutMs,
        timed_out: errorCode === "OCR_REQUEST_TIMEOUT",
        text_char_count: 0,
        error_code: errorCode,
        render_scale: null,
      } satisfies OcrPageAttempt,
    };
  }
}

async function runOcrWithRetryForPage(args: {
  pdfBuffer: Buffer;
  fileName: string;
  pageNumber: number;
}) {
  const pagePdfBuffer = await extractSinglePagePdf(args.pdfBuffer, args.pageNumber - 1);
  const primaryAttempt = await runSingleOcrAttempt({
    fileName: args.fileName,
    pageNumber: args.pageNumber,
    attempt: 1,
    mode: "pdf_primary",
    timeoutMs: OCR_TIMEOUT_MS,
    pagePdfBuffer,
  });

  return {
    ocrText: primaryAttempt.text,
    finalError: primaryAttempt.error,
    retryUsed: false,
    retrySucceeded: false,
    timeoutCount: primaryAttempt.attempt.timed_out ? 1 : 0,
    attempts: [primaryAttempt.attempt],
  };
}

function logOcrPageOutcome(args: {
  fileName: string;
  pageNumber: number;
  retryUsed: boolean;
  retrySucceeded: boolean;
  finalOutcome: OcrPageOutcome;
  attempts: OcrPageAttempt[];
}) {
  console.info("[pdf/extract] OCR page outcome", {
    fileName: args.fileName,
    pageNumber: args.pageNumber,
    retryUsed: args.retryUsed,
    retrySucceeded: args.retrySucceeded,
    finalOutcome: args.finalOutcome,
    attempts: args.attempts,
  });
}

function summarizeDocumentMeta(args: {
  pages: ExtractedPdfPage[];
  diagnostics: OcrDiagnostics;
  documentClass: PdfDocumentClass;
  extractionRoute: PdfExtractionRoute;
  timings: PdfExtractionTimings;
}) {
  const { pages, diagnostics, documentClass, extractionRoute, timings } = args;
  const pageTypeCounts: Record<PageType, number> = {
    text: 0,
    scan: 0,
    table_heavy: 0,
    formula_heavy: 0,
    mixed: 0,
  };

  for (const page of pages) {
    pageTypeCounts[page.extractionMeta.page_type] += 1;
  }

  const totalTableBlocks = pages.reduce((sum, page) => sum + page.extractionMeta.table_blocks, 0);
  const totalFormulaBlocks = pages.reduce((sum, page) => sum + page.extractionMeta.formula_blocks, 0);

  const dominantPageType =
    (Object.entries(pageTypeCounts)
      .sort((a, b) => {
        if (b[1] !== a[1]) return b[1] - a[1];
        return a[0].localeCompare(b[0]);
      })
      .find(([, count]) => count > 0)?.[0] as PageType | undefined) ?? null;

  return {
    document_class: documentClass,
    extraction_route: extractionRoute,
    page_count: pages.length,
    ocr_pages: pages.filter((p) => p.extractionMethod === "ocr").length,
    dominant_page_type: dominantPageType,
    page_type_counts: pageTypeCounts,
    total_pages: diagnostics.totalPages,
    pages_with_good_text: diagnostics.pagesWithGoodText,
    ocr_candidate_pages: diagnostics.ocrCandidatePages,
    ocr_attempted_pages: diagnostics.ocrAttemptedPages,
    ocr_succeeded_pages: diagnostics.ocrSucceededPages,
    ocr_retried_pages: diagnostics.ocrRetriedPages,
    ocr_failed_pages: diagnostics.ocrFailedPages,
    early_exit_triggered: diagnostics.earlyExitTriggered,
    failure_reason: diagnostics.failureReason,
    pages: pages.map((page) => {
      const ocrResult = diagnostics.ocrPageResults.find((result) => result.page === page.pageNumber) ?? null;
      return {
        page: page.pageNumber,
        page_type: page.extractionMeta.page_type,
        ocr_decision: page.extractionMeta.ocr_decision,
        extraction_method: page.extractionMethod,
        extraction_quality: page.extractionQuality,
        text_char_count: page.textCharCount,
        word_count: page.wordCount,
        table_blocks: page.extractionMeta.table_blocks,
        formula_blocks: page.extractionMeta.formula_blocks,
        structured_preview: page.extractionMeta.structured_preview,
        signals: page.extractionMeta.signals,
        ocr_retry_used: ocrResult?.retry_used ?? false,
        ocr_retry_succeeded: ocrResult?.retry_succeeded ?? false,
        ocr_final_outcome: ocrResult?.final_outcome ?? "not_attempted",
        ocr_attempts: ocrResult?.attempts ?? [],
      };
    }),
    total_table_blocks: totalTableBlocks,
    total_formula_blocks: totalFormulaBlocks,
    timings,
  };
}

export async function extractPdfWithFallback(
  buf: Buffer,
  opts: ExtractOpts = {},
): Promise<ExtractedPdfDocument> {
  const extractionStartedAt = nowMs();
  const maxPages = Math.max(1, Math.min(opts.maxPages ?? 500, 2000));
  const allowOcr = opts.allowOcr !== false;
  const fileName = (opts.fileName ?? "document.pdf").trim() || "document.pdf";
  const fileSizeBytes = Math.max(0, Number(opts.fileSizeBytes ?? buf.length) || 0);
  const raw = await extractPdfPagesViaPdfjs(buf, maxPages);
  let ocrMs = 0;

  const pages: ExtractedPdfPage[] = raw.pages.map((pageSource, idx) => {
    const analysis = analyzeText(pageSource.rawText);
    const initialClassification = classifyPage({
      text: analysis.normalizedText,
      extractionMethod: "text",
      quality: analysis.quality,
      charCount: analysis.charCount,
      wordCount: analysis.wordCount,
      alphaNumRatio: analysis.alphaNumRatio,
      brokenTokenRatio: analysis.brokenTokenRatio,
    });
    const structured = structurePageText({
      pageType: initialClassification.page_type,
      text: analysis.normalizedText,
      lines: pageSource.lines,
    });
    const structuredAnalysis = analyzeText(structured.text || analysis.normalizedText);
    const structuredClassification = classifyPage({
      text: structuredAnalysis.normalizedText,
      extractionMethod: "text",
      quality: structuredAnalysis.quality,
      charCount: structuredAnalysis.charCount,
      wordCount: structuredAnalysis.wordCount,
      alphaNumRatio: structuredAnalysis.alphaNumRatio,
      brokenTokenRatio: structuredAnalysis.brokenTokenRatio,
    });
    return {
      pageNumber: idx + 1,
      text: structuredAnalysis.normalizedText,
      extractionMethod: "text",
      extractionQuality: structuredAnalysis.quality,
      textCharCount: structuredAnalysis.charCount,
      wordCount: structuredAnalysis.wordCount,
      alphaNumRatio: structuredAnalysis.alphaNumRatio,
      brokenTokenRatio: structuredAnalysis.brokenTokenRatio,
      extractionMeta: {
        ...structuredClassification,
        ocr_decision: "text_ok",
        table_blocks: structured.tableBlocks,
        formula_blocks: structured.formulaBlocks,
        structured_preview: structuredAnalysis.normalizedText.slice(0, 220),
        weak_text_for_math: isWeakMathPage({
          charCount: structuredAnalysis.charCount,
          wordCount: structuredAnalysis.wordCount,
          pageType: structuredClassification.page_type,
          signals: structuredClassification.signals,
          formulaBlocks: structured.formulaBlocks,
        }),
        heading_candidates: extractMathHeadingCandidates(structuredAnalysis.normalizedText),
        math_formula_candidates: extractMathFormulaCandidatesFromText({
          text: structuredAnalysis.normalizedText,
          origin: "text_layer",
          quality: structuredAnalysis.quality,
          pageType: structuredClassification.page_type,
        }),
      },
    };
  });

  const ocrTexts: Array<{ page: number; text: string; engine: string }> = [];
  for (const page of pages) {
    page.extractionMeta.ocr_decision = classifyOcrDecision(page);
  }

  const initialReadable = summarizeReadableText(pages);
  const initialScanPages = pages.filter((page) => page.extractionMeta.page_type === "scan").length;
  const hopelessCandidatePages = pages.filter((page) => page.extractionMeta.ocr_decision === "hopeless_candidate").length;
  const initialFallbackCandidates = selectOcrCandidates({ pages, strategy: "ocr_fallback" });
  const documentClass = classifyDocumentClass({
    pageCount: raw.pageCount,
    pages,
    readable: initialReadable,
    initialScanPages,
    ocrCandidatePages: initialFallbackCandidates.length,
    hopelessCandidatePages,
  });
  const ocrStrategy: "ocr_first" | "ocr_fallback" =
    allowOcr && (opts.ocrStrategy === "ocr_first" || documentClass !== "text_layer_pdf") ? "ocr_first" : "ocr_fallback";
  let ocrCandidates = selectOcrCandidates({ pages, strategy: ocrStrategy });
  if (ocrStrategy === "ocr_first" && ocrCandidates.length === 0 && raw.pageCount > 0 && initialReadable.pagesWithGoodText === 0) {
    ocrCandidates = [...pages];
  }
  let ocrCandidatePages = ocrCandidates.length;
  const scanLikeDocument =
    raw.pageCount > 0 &&
    (documentClass === "image_only_pdf" ||
      initialScanPages > 0 ||
      ocrCandidatePages + hopelessCandidatePages >= Math.max(1, Math.ceil(raw.pageCount / 2)));

  const diagnostics: OcrDiagnostics = {
    totalPages: raw.pageCount,
    pagesWithGoodText: initialReadable.pagesWithGoodText,
    ocrCandidatePages,
    ocrAttemptedPages: 0,
    ocrSucceededPages: 0,
    ocrRetriedPages: 0,
    ocrFailedPages: 0,
    earlyExitTriggered: false,
    failureReason:
      raw.pageCount > 0 &&
      scanLikeDocument &&
      ocrStrategy !== "ocr_first" &&
      ocrCandidatePages === 0 &&
      hopelessCandidatePages > 0 &&
      initialReadable.pagesWithGoodText === 0
        ? "unreadable_scan_pdf"
        : null,
    ocrPageResults: [],
  };
  let ocrTimeoutCount = 0;

  if (
    raw.pageCount > 0 &&
    scanLikeDocument &&
    ocrStrategy !== "ocr_first" &&
    diagnostics.pagesWithGoodText === 0 &&
    shouldRejectScanHeavyPdfPreflight({ pages, fileSizeBytes })
  ) {
    if (allowOcr && canRunOcr()) {
      const sample = await runScanHeavyOcrSample({
        buf,
        fileName,
        pages,
      });
      ocrMs += sample.elapsedMs;
      diagnostics.ocrAttemptedPages += sample.attemptedPages;
      diagnostics.ocrSucceededPages += sample.succeededPages;
      diagnostics.ocrRetriedPages += sample.retriedPages;
      diagnostics.ocrFailedPages += sample.failedPages;
      diagnostics.ocrPageResults.push(...sample.pageResults);
      ocrTexts.push(...sample.ocrTexts);
      diagnostics.pagesWithGoodText = countPagesWithGoodText(pages);
      ocrCandidates = selectOcrCandidates({ pages, strategy: ocrStrategy });
      ocrCandidatePages = ocrCandidates.length;
      diagnostics.ocrCandidatePages = ocrCandidatePages;

      if (!sample.promising) {
        diagnostics.earlyExitTriggered = true;
        diagnostics.failureReason =
          sample.timeoutCount >= sample.attemptedPages && sample.attemptedPages > 0
            ? "ocr_timeout"
            : "scan_heavy_pdf_rejected";
      }
    } else {
      diagnostics.earlyExitTriggered = true;
      diagnostics.failureReason = "scan_heavy_pdf_rejected";
    }
  }

  if (raw.pageCount > 0 && !diagnostics.failureReason && allowOcr && canRunOcr() && ocrCandidatePages > 0) {
    await opts.onProgress?.({
      stage: "ocr_started",
      totalPages: raw.pageCount,
      ocrCandidatePages,
      scanLikeDocument,
      documentClass,
      ocrStrategy,
    });

    const ocrBatchSize = ocrStrategy === "ocr_first" ? OCR_FIRST_BATCH_SIZE : OCR_FALLBACK_BATCH_SIZE;
    console.info("[pdf/extract] OCR batch config", {
      fileName,
      documentClass,
      ocrStrategy,
      ocrBatchSize,
    });
    const ocrStartedAt = nowMs();

    for (let index = 0; index < ocrCandidates.length; index += ocrBatchSize) {
      const batch = ocrCandidates.slice(index, index + ocrBatchSize);
      const results = await Promise.all(
        batch.map(async (page) => {
          const ocrRun = await runOcrWithRetryForPage({
            pdfBuffer: buf,
            fileName,
            pageNumber: page.pageNumber,
          });
          return { page, ...ocrRun };
        }),
      );

      for (const result of results) {
        const { page, ocrText, finalError } = result;
        diagnostics.ocrAttemptedPages += 1;
        ocrTimeoutCount += result.timeoutCount;
        if (result.retryUsed) diagnostics.ocrRetriedPages += 1;
        let finalOutcome: OcrPageOutcome = "failed";

        if (finalError && !ocrText) {
          console.warn(`[pdf/extract] OCR fallback failed for page ${page.pageNumber}:`, finalError);
        }

        if (ocrText) {
          const applied = applyOcrTextToPage(page, ocrText);
          if (applied.applied && applied.readable) {
            diagnostics.ocrSucceededPages += 1;
            ocrTexts.push({ page: page.pageNumber, text: page.text, engine: OCR_ENGINE });
            finalOutcome = "succeeded";
          } else {
            finalOutcome = "degraded";
          }
        } else if (!finalError) {
          finalOutcome = "degraded";
        }

        if (finalOutcome === "failed") {
          diagnostics.ocrFailedPages += 1;
        }
        const pageResult: OcrPageResult = {
          page: page.pageNumber,
          retry_used: result.retryUsed,
          retry_succeeded: result.retrySucceeded,
          final_outcome: finalOutcome,
          attempts: result.attempts,
        };
        diagnostics.ocrPageResults.push(pageResult);
        logOcrPageOutcome({
          fileName,
          pageNumber: page.pageNumber,
          retryUsed: result.retryUsed,
          retrySucceeded: result.retrySucceeded,
          finalOutcome,
          attempts: result.attempts,
        });
      }

      diagnostics.pagesWithGoodText = countPagesWithGoodText(pages);

      if (
        shouldEarlyExitAfterOcr({
          diagnostics,
          pages,
          scanLikeDocument,
          initialPagesWithGoodText: initialReadable.pagesWithGoodText,
          initialTotalChars: initialReadable.totalChars,
          initialTotalWords: initialReadable.totalWords,
        })
      ) {
        diagnostics.earlyExitTriggered = true;
        diagnostics.failureReason =
          ocrTimeoutCount >= diagnostics.ocrAttemptedPages && diagnostics.ocrAttemptedPages > 0
            ? "ocr_timeout"
            : "unreadable_scan_pdf";
        break;
      }
    }
    ocrMs += elapsedMs(ocrStartedAt);

    await opts.onProgress?.({
      stage: "ocr_finished",
      totalPages: raw.pageCount,
      ocrCandidatePages,
      scanLikeDocument,
      documentClass,
      ocrStrategy,
    });
  }

  if (raw.pageCount > 0 && !diagnostics.failureReason && allowOcr && canRunOcr()) {
    const visionCandidates = selectMathVisionCandidates(pages);
    if (visionCandidates.length > 0) {
      const visionStartedAt = nowMs();
      for (let index = 0; index < visionCandidates.length; index += 2) {
        const batch = visionCandidates.slice(index, index + 2);
        const results = await Promise.all(
          batch.map(async (page) => {
            try {
              const pagePdfBuffer = await extractSinglePagePdf(buf, page.pageNumber - 1);
              const payload = await runOpenAIMathVisionForPage({
                fileName,
                pageNumber: page.pageNumber,
                timeoutMs: OCR_TIMEOUT_MS,
                pagePdfBuffer,
              });
              return { page, payload, error: null as unknown };
            } catch (error) {
              return { page, payload: null, error };
            }
          }),
        );

        for (const result of results) {
          if (result.error) {
            console.warn(`[pdf/extract] Math vision enrichment failed for page ${result.page.pageNumber}:`, result.error);
            continue;
          }
          if (applyMathVisionPayloadToPage(result.page, result.payload)) {
            ocrTexts.push({ page: result.page.pageNumber, text: result.page.text, engine: VISION_ENGINE });
          }
        }
      }
      ocrMs += elapsedMs(visionStartedAt);
    }
  }

  const finalReadable = summarizeReadableText(pages);
  diagnostics.pagesWithGoodText = finalReadable.pagesWithGoodText;
  if (
    !diagnostics.failureReason &&
    scanLikeDocument &&
    diagnostics.pagesWithGoodText === 0 &&
    finalReadable.totalChars < 120 &&
    finalReadable.totalWords < 24
  ) {
    diagnostics.failureReason =
      ocrTimeoutCount > 0 && diagnostics.ocrSucceededPages === 0 ? "ocr_timeout" : "insufficient_readable_text";
  }

  const ocrPages = pages.filter((p) => p.extractionMethod === "ocr").length;
  const extractionMethod: ExtractionMethod =
    ocrPages === 0 ? "text" : ocrPages === pages.length ? "ocr" : "mixed";
  const extractionRoute: PdfExtractionRoute = ocrPages === 0 ? "text_fast_path" : "ocr_first_path";
  const timings: PdfExtractionTimings = {
    pdf_open_ms: raw.timings.pdf_open_ms,
    render_ms: raw.timings.render_ms,
    ocr_ms: ocrMs,
    total_ms: elapsedMs(extractionStartedAt),
    ocr_page_count: diagnostics.ocrAttemptedPages,
  };

  return {
    pageCount: raw.pageCount,
    ocrPages,
    extractionMethod,
    extractionQuality: summarizeDocumentQuality(pages),
    pages,
    ocrTexts,
    timings,
    extractionMeta: summarizeDocumentMeta({
      pages,
      diagnostics,
      documentClass,
      extractionRoute,
      timings,
    }),
  };
}
