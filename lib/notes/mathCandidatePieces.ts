export type MathSourceChunk = {
  id: string;
  content: string;
  pageFrom: number | null;
  createdAt: string | null;
  sourceOrigin?: "text_layer" | "ocr" | "vision";
  formulaCandidates?: Array<{
    rawFormula: string;
    normalizedFormula: string;
    latexFormula?: string;
    surroundingText?: string;
    origin: "text_layer" | "ocr" | "vision";
    confidence: number;
  }>;
};

export type MathCandidatePieceKind =
  | "heading"
  | "subheading"
  | "explanation"
  | "formula"
  | "example"
  | "figure_ref"
  | "page_ref"
  | "keyword";

export type MathCandidatePiece = {
  id: string;
  kind: MathCandidatePieceKind;
  text: string;
  sourceChunkId: string;
  sourcePage: number | null;
  sourceRef: string;
  score: number;
};

export type MathRawFormulaCandidate = {
  id: string;
  rawFormula: string;
  normalizedFormula: string;
  latexFormula?: string;
  surroundingText?: string;
  sourceChunkId: string;
  sourcePage: number | null;
  sourceRef: string;
  origin: "text_layer" | "ocr" | "vision";
  detectedFrom: "formula_candidate" | "line" | "sentence" | "chunk";
  confidence: number;
  contextText: string;
};

const FORMULA_SIGNAL_RE =
  /(?:[a-zA-Z]\s*\([^)]*\)\s*=|[a-zA-Z]\s*=\s*[-+]?[\d(]|[=≈<>≤≥]|\^|\\frac|\\sqrt|±|√|\b(?:sin|cos|tan)\s*\()/i;
const FORMULA_SNIPPET_RE =
  /(?:a\s*x\^?2\s*\+\s*b\s*x\s*\+\s*c\s*=\s*0|\bd\s*=\s*b\^?2\s*[-+]\s*4\s*·?\s*a\s*·?\s*c\b|\bx\s*=\s*\(?-?b\s*[±+\-]\s*√?\s*d\)?\s*\/\s*\(?2\s*·?\s*a\)?|\bT\s*=\s*1\s*\/\s*2\s*·?\s*a\s*·?\s*b\s*·?\s*sin\(?C\)?|\|[A-Z]{2}\|\s*=\s*√?\([^.;:\n]{4,90}\)|\([^)]+\)\^?2\s*\+\s*\([^)]+\)\^?2\s*=\s*[^.;:\n]{1,42}|\b[A-Za-z](?:['’]{1,2})?\([^)]{0,24}\)\s*(?:=|≈|≤|≥|<|>)\s*[^.;:\n]{1,78}|\b[A-Za-z]\s*=\s*[-+0-9A-Za-z^ ·*/()√'’]{2,56})/gi;
const FIGURE_SIGNAL_RE = /\b(?:figur|graf|akse|koordinatsystem|skitse|tabel)\b/i;
const EXAMPLE_SIGNAL_RE = /\b(?:eksempel|fx|f\.eks\.|lad os|hvis)\b/i;
const PAGE_REF_SIGNAL_RE = /\b(?:side|s\.)\s*\d+\b/i;
const KEYWORD_SIGNAL_RE =
  /\b(?:definition|sætning|saetning|regel|formel|metode|begreb|husk|bemærk|bemaerk|pas på|pas paa)\b/i;
const SENTENCE_SPLIT_RE = /(?<=[.!?])\s+/;

export function collapseMathWhitespace(value: string) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

export function normalizeMathKey(value: string) {
  return String(value ?? "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9æøå+\-^'=≈<>]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function splitMathSentences(value: string) {
  return collapseMathWhitespace(value)
    .split(SENTENCE_SPLIT_RE)
    .map((part) => part.trim())
    .filter(Boolean);
}

export function trimMathSentenceEnding(value: string) {
  return collapseMathWhitespace(value).replace(/[.;,:]\s*$/, "").trim();
}

export function normalizeMathFormulaAudit(value: string) {
  return trimMathSentenceEnding(value)
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

export function buildMathSourceRef(chunk: Pick<MathSourceChunk, "id" | "pageFrom">) {
  return chunk.pageFrom ? `Side ${chunk.pageFrom}` : `Uddrag ${chunk.id}`;
}

function extractFormulaSnippets(text: string) {
  const compact = collapseMathWhitespace(text);
  const snippets = Array.from(compact.matchAll(FORMULA_SNIPPET_RE))
    .map((match) => normalizeMathFormulaAudit(match[0] ?? ""))
    .filter((formula) => formula.length >= 5 && formula.length <= 96);

  if (!snippets.length && FORMULA_SIGNAL_RE.test(compact) && compact.length <= 96) {
    snippets.push(normalizeMathFormulaAudit(compact));
  }

  return Array.from(new Set(snippets.filter(Boolean)));
}

export function extractRawMathFormulaCandidates(chunks: MathSourceChunk[]) {
  const candidates: MathRawFormulaCandidate[] = [];
  const seen = new Set<string>();

  chunks.forEach((chunk, chunkIndex) => {
    const sourceRef = buildMathSourceRef(chunk);
    const rawContent = String(chunk.content ?? "");
    const chunkOrigin = chunk.sourceOrigin ?? "text_layer";
    const lines = rawContent
      .split(/\r?\n+/)
      .map((line) => collapseMathWhitespace(line))
      .filter(Boolean);
    const sentences = splitMathSentences(rawContent);
    const sources: Array<{ detectedFrom: MathRawFormulaCandidate["detectedFrom"]; contextText: string }> = [
      ...lines.map((contextText) => ({ detectedFrom: "line" as const, contextText })),
      ...sentences.map((contextText) => ({ detectedFrom: "sentence" as const, contextText })),
      { detectedFrom: "chunk" as const, contextText: rawContent },
    ];

    for (const formulaCandidate of chunk.formulaCandidates ?? []) {
      const normalizedFormula = normalizeMathFormulaAudit(formulaCandidate.normalizedFormula || formulaCandidate.rawFormula);
      const key = `${chunk.pageFrom ?? "none"}::${normalizeMathKey(normalizedFormula)}`;
      if (!normalizedFormula || seen.has(key)) continue;
      seen.add(key);
      candidates.push({
        id: `raw-formula-${chunkIndex + 1}-formula-candidate-${candidates.length + 1}`,
        rawFormula: formulaCandidate.rawFormula,
        normalizedFormula,
        latexFormula: formulaCandidate.latexFormula,
        surroundingText: formulaCandidate.surroundingText,
        sourceChunkId: chunk.id,
        sourcePage: chunk.pageFrom,
        sourceRef,
        origin: formulaCandidate.origin,
        detectedFrom: "formula_candidate",
        confidence: Math.max(0.5, Number(formulaCandidate.confidence ?? 0.72)),
        contextText: collapseMathWhitespace(formulaCandidate.surroundingText || rawContent),
      });
    }

    sources.forEach(({ detectedFrom, contextText }, sourceIndex) => {
      extractFormulaSnippets(contextText).forEach((formula, formulaIndex) => {
        const key = `${chunk.pageFrom ?? "none"}::${normalizeMathKey(formula)}`;
        if (!formula || seen.has(key)) return;
        seen.add(key);
        candidates.push({
          id: `raw-formula-${chunkIndex + 1}-${sourceIndex + 1}-${formulaIndex + 1}`,
          rawFormula: formula,
          normalizedFormula: normalizeMathFormulaAudit(formula),
          sourceChunkId: chunk.id,
          sourcePage: chunk.pageFrom,
          sourceRef,
          origin: chunkOrigin,
          detectedFrom,
          confidence:
            detectedFrom === "line"
              ? chunkOrigin === "vision"
                ? 0.9
                : chunkOrigin === "ocr"
                  ? 0.72
                  : 0.8
              : detectedFrom === "sentence"
                ? chunkOrigin === "vision"
                  ? 0.86
                  : chunkOrigin === "ocr"
                    ? 0.68
                    : 0.76
                : chunkOrigin === "vision"
                  ? 0.82
                  : chunkOrigin === "ocr"
                    ? 0.62
                    : 0.7,
          contextText: collapseMathWhitespace(contextText),
        });
      });
    });
  });

  return candidates.sort((a, b) => (a.sourcePage ?? 9999) - (b.sourcePage ?? 9999) || a.rawFormula.localeCompare(b.rawFormula));
}

function inferPieceKind(text: string, fromLine: boolean): MathCandidatePieceKind {
  if (PAGE_REF_SIGNAL_RE.test(text) && text.length <= 120) return "page_ref";
  if (FIGURE_SIGNAL_RE.test(text)) return "figure_ref";
  if (EXAMPLE_SIGNAL_RE.test(text)) return "example";
  if (FORMULA_SIGNAL_RE.test(text)) return "formula";
  if (KEYWORD_SIGNAL_RE.test(text) && text.length <= 170) return "keyword";

  const sentenceCount = (text.match(/[.!?]/g) ?? []).length;
  const looksLikeHeading =
    fromLine &&
    text.length <= 96 &&
    sentenceCount === 0 &&
    /[A-Za-zÆØÅæøå]/.test(text) &&
    !/^\s*(?:og|eller|men|som|der|det)\b/i.test(text);

  if (!looksLikeHeading) return "explanation";
  return text.length <= 52 ? "heading" : "subheading";
}

function scoreCandidate(text: string, kind: MathCandidatePieceKind) {
  let score = 1;
  if (kind === "heading") score += 2;
  if (kind === "subheading") score += 1;
  if (kind === "formula") score += 2;
  if (kind === "example") score += 1;
  if (kind === "keyword") score += 2;
  if (/\b(?:sætning|formel|ligning|funktion|graf|tangent|cirkel|diskriminant|optimering|monotoni|toppunkt)\b/i.test(text)) {
    score += 2;
  }
  if (text.length >= 35 && text.length <= 180) score += 1;
  return score;
}

function makeCandidate(args: {
  id: string;
  text: string;
  chunk: MathSourceChunk;
  kind: MathCandidatePieceKind;
}): MathCandidatePiece {
  return {
    id: args.id,
    kind: args.kind,
    text: args.text,
    sourceChunkId: args.chunk.id,
    sourcePage: args.chunk.pageFrom,
    sourceRef: buildMathSourceRef(args.chunk),
    score: scoreCandidate(args.text, args.kind),
  };
}

export function buildMathCandidatePieces(chunks: MathSourceChunk[], limit = 160): MathCandidatePiece[] {
  const pieces: MathCandidatePiece[] = [];

  chunks.forEach((chunk, chunkIndex) => {
    for (const formulaCandidate of chunk.formulaCandidates ?? []) {
      const formulaPiece = makeCandidate({
        id: `candidate-${chunkIndex + 1}-formula-candidate-${pieces.length + 1}`,
        text: trimMathSentenceEnding(formulaCandidate.rawFormula),
        chunk,
        kind: "formula",
      });
      pieces.push({
        ...formulaPiece,
        score: formulaPiece.score + Math.round(Math.max(0, Number(formulaCandidate.confidence ?? 0.72)) * 3),
      });
      if (formulaCandidate.surroundingText) {
        pieces.push(
          makeCandidate({
            id: `candidate-${chunkIndex + 1}-formula-context-${pieces.length + 1}`,
            text: trimMathSentenceEnding(formulaCandidate.surroundingText),
            chunk,
            kind: inferPieceKind(formulaCandidate.surroundingText, false),
          }),
        );
      }
    }

    const rawContent = String(chunk.content ?? "");
    const lines = rawContent
      .split(/\r?\n+/)
      .map((line) => collapseMathWhitespace(line))
      .filter((line) => line.length >= 4 && line.length <= 240);

    lines.forEach((line, lineIndex) => {
      const kind = inferPieceKind(line, true);
      if (kind === "explanation" && line.length < 34) return;
      pieces.push(
        makeCandidate({
          id: `candidate-${chunkIndex + 1}-line-${lineIndex + 1}`,
          text: trimMathSentenceEnding(line),
          chunk,
          kind,
        }),
      );
    });

    splitMathSentences(rawContent).forEach((sentence, sentenceIndex) => {
      const cleaned = trimMathSentenceEnding(sentence);
      if (cleaned.length < 32 || cleaned.length > 280) return;
      pieces.push(
        makeCandidate({
          id: `candidate-${chunkIndex + 1}-sentence-${sentenceIndex + 1}`,
          text: cleaned,
          chunk,
          kind: inferPieceKind(cleaned, false),
        }),
      );
    });

    extractFormulaSnippets(rawContent).slice(0, 8).forEach((formula, formulaIndex) => {
      pieces.push(
        makeCandidate({
          id: `candidate-${chunkIndex + 1}-formula-${formulaIndex + 1}`,
          text: formula,
          chunk,
          kind: "formula",
        }),
      );
    });
  });

  return pieces
    .sort((a, b) => b.score - a.score || (a.sourcePage ?? 9999) - (b.sourcePage ?? 9999))
    .slice(0, limit);
}
