import {
  MathCandidatePiece,
  collapseMathWhitespace,
  normalizeMathKey,
} from "@/lib/notes/mathCandidatePieces";

export type MathFilteredPiece = MathCandidatePiece & {
  filterScore: number;
};

export type MathRejectedMathPiece = MathCandidatePiece & {
  rejectionReason: string;
};

const PURE_NUMBER_SEQUENCE_RE =
  /^\s*[-+]?\d+(?:[.,]\d+)?(?:\s*(?:\/|,|;|\||\s)\s*[-+]?\d+(?:[.,]\d+)?){2,}\s*$/;
const SYMBOL_SEQUENCE_RE = /^[+\-±=≈<>≤≥/\\^_*().,\s]+$/;
const STANDALONE_RESULT_RE = /^(?:[a-z]\s*)?[≈=]\s*[-+]?\d+(?:[.,]\d+)?$|^x\s*[≈=]\s*[-+]?\d+(?:[.,]\d+)?$/i;
const SPLIT_WORD_RE = /(?:\b[A-Za-zÆØÅæøå]\s+){4,}\b[A-Za-zÆØÅæøå]\b/;
const TASK_FRAGMENT_RE =
  /^(?:bestem|beregn|indsæt|indsaet|ønsker|onsker|løs|loes|vis|forklar|punkterne|løsningerne|loesningerne|bestemme|beregne)$/i;
const MIXED_SLASH_FRAGMENT_RE =
  /^(?=.{4,80}$)(?:[A-Za-zÆØÅæøå0-9≈=^.,]+\s*\/\s*){1,}[A-Za-zÆØÅæøå0-9≈=^.,]+$/;
const LOOSE_SYMBOL_WORD_RE =
  /^(?=.{4,90}$)(?:[a-zæøå]\s*)?[=≈<>]\s*[-+]?\d+(?:[.,]\d+)?|^(?:\d+[a-zæøå]?|[a-zæøå]\d+)(?:\s*[+\-]\s*(?:\d+[a-zæøå]?|[a-zæøå]\d+)){1,}$/i;
const LOW_VALUE_TITLE_FRAGMENT_RE =
  /^(?:punkterne|løsningerne|loesningerne|ønsker|onsker|bestemme|beregne|facit|svar|grafen|aksen|x-aksen|y-aksen)$/i;

function countLetters(value: string) {
  return (value.match(/[A-Za-zÆØÅæøå]/g) ?? []).length;
}

function countDigits(value: string) {
  return (value.match(/\d/g) ?? []).length;
}

function looksLikeHalfSentence(value: string) {
  const text = collapseMathWhitespace(value);
  if (text.length < 22) return false;
  if (/^[a-zæøå]/.test(text) && !/[.!?:]$/.test(text) && !/\b(?:er|har|kan|skal|bruges|betyder|giver|findes)\b/i.test(text)) {
    return true;
  }
  return /(?:,|og|at|som|hvor|når)\s*$/i.test(text);
}

function rejectionReason(piece: MathCandidatePiece, seen: Set<string>) {
  const text = collapseMathWhitespace(piece.text);
  const key = normalizeMathKey(text);
  const letters = countLetters(text);
  const digits = countDigits(text);
  const stableFormulaLike =
    piece.kind === "formula" &&
    /[=≈≤≥<>]/.test(text) &&
    /[A-Za-zÆØÅæøå]/.test(text) &&
    !/[.!?]$/.test(text);

  if (!text || text.length < 4) return "empty_or_too_short";
  if (seen.has(key)) return "duplicate";
  if (PURE_NUMBER_SEQUENCE_RE.test(text)) return "pure_number_sequence";
  if (SYMBOL_SEQUENCE_RE.test(text)) return "symbol_sequence";
  if (STANDALONE_RESULT_RE.test(text)) return "standalone_numeric_result";
  if (SPLIT_WORD_RE.test(text)) return "split_words";
  if (TASK_FRAGMENT_RE.test(text)) return "task_or_ocr_fragment";
  if (LOW_VALUE_TITLE_FRAGMENT_RE.test(key)) return "low_value_title_fragment";
  if (LOOSE_SYMBOL_WORD_RE.test(text) && letters <= 4) return "loose_symbol_fragment";
  if (/\d+(?:[.,]\d+)?\s*\/\s*\d+(?:[.,]\d+)?\s*\/\s*\d+(?:[.,]\d+)?/.test(text)) return "number_sequence_fragment";
  if (/(?:ønsker|onsker)\s*\/\s*bestemme|punkterne\s*\/\s*(?:løsningerne|loesningerne)/i.test(text)) return "ocr_slash_fragment";
  if (MIXED_SLASH_FRAGMENT_RE.test(text) && (digits >= 2 || text.split("/").some((part) => part.trim().length <= 3))) {
    return "slash_fragment";
  }
  if (letters === 0 && digits > 0) return "numbers_without_concept";
  if (letters <= 6 && digits >= 3 && !/\b(?:cm|m|kr|grad|procent|%)\b/i.test(text) && piece.kind !== "formula") {
    return "numeric_fragment_without_concept";
  }
  if (digits >= 6 && letters <= 8 && piece.kind !== "formula") return "axis_or_table_ticks";
  if (letters <= 3 && digits <= 2 && piece.kind !== "formula") return "too_little_language";
  if (stableFormulaLike) return null;
  if (looksLikeHalfSentence(text)) return "half_sentence";
  return null;
}

function scoreFilteredPiece(piece: MathCandidatePiece) {
  let score = piece.score;
  const text = piece.text;
  if (piece.kind === "heading") score += 2;
  if (piece.kind === "formula") score += 1;
  if (/\b(?:monotoni|optimering|afstand|løsningsformel|loesningsformel|diskriminant|cirkel|gaffelforskrift|tangent|toppunkt)\b/i.test(text)) {
    score += 3;
  }
  if ((text.match(/\d/g) ?? []).length >= 4 && piece.kind !== "formula") score -= 2;
  return score;
}

export function filterMathCandidatePieces(pieces: MathCandidatePiece[], limit = 100) {
  const seen = new Set<string>();
  const filteredPieces: MathFilteredPiece[] = [];
  const rejectedPieces: MathRejectedMathPiece[] = [];

  for (const piece of pieces) {
    const key = normalizeMathKey(piece.text);
    const reason = rejectionReason(piece, seen);
    if (reason) {
      rejectedPieces.push({ ...piece, rejectionReason: reason });
      continue;
    }
    seen.add(key);
    filteredPieces.push({ ...piece, filterScore: scoreFilteredPiece(piece) });
  }

  return {
    filteredPieces: filteredPieces
      .sort((a, b) => b.filterScore - a.filterScore || (a.sourcePage ?? 9999) - (b.sourcePage ?? 9999))
      .slice(0, limit),
    rejectedPieces,
  };
}
