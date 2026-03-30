import "server-only";

export type RetrievalChunkCandidate = {
  id: string;
  file_id: string | null;
  content: string | null;
  created_at?: string | null;
  source_url?: string | null;
  extraction_method?: string | null;
  extraction_quality?: string | null;
  page_from?: number | null;
};

type QueryProfile = {
  symbolHeavy: boolean;
  tableHeavy: boolean;
};

function detectQueryProfile(question: string): QueryProfile {
  const normalized = String(question ?? "").trim();
  const visible = Array.from(normalized).filter((ch) => /\S/u.test(ch));
  const symbols = visible.filter((ch) => /[=+\-/*^%()[\]{}<>~|\\±×÷∑∏√∞≈≠≤≥∆∂µπ]/u.test(ch)).length;
  const digits = visible.filter((ch) => /\d/.test(ch)).length;
  const tokens = normalized.toLowerCase().split(/\s+/).filter(Boolean);
  const hasCalcVerb = tokens.some((t) =>
    ["beregn", "udled", "vis", "løs", "bestem", "procent", "rente", "elasticitet", "reaktion"].includes(t),
  );

  const symbolRatio = visible.length ? symbols / visible.length : 0;
  const digitRatio = visible.length ? digits / visible.length : 0;

  return {
    symbolHeavy: symbolRatio >= 0.06 || hasCalcVerb,
    tableHeavy: digitRatio >= 0.12 || tokens.some((t) => ["tabel", "regnskab", "oversigt", "kolonne"].includes(t)),
  };
}

function detectChunkShape(text: string) {
  const trimmed = String(text ?? "").trim();
  const visible = Array.from(trimmed).filter((ch) => /\S/u.test(ch));
  const symbols = visible.filter((ch) => /[=+\-/*^%()[\]{}<>~|\\±×÷∑∏√∞≈≠≤≥∆∂µπ]/u.test(ch)).length;
  const digits = visible.filter((ch) => /\d/.test(ch)).length;
  const lines = trimmed.split(/\n/).filter(Boolean);
  const multiSpace = (trimmed.match(/ {3,}/g) ?? []).length;
  const tokens = trimmed.split(/\s+/).filter(Boolean);
  const numericTokens = tokens.filter((token) => /^[$€£¥]?\(?[\d.,%:/-]+\)?$/.test(token)).length;

  return {
    symbolRatio: visible.length ? symbols / visible.length : 0,
    digitRatio: visible.length ? digits / visible.length : 0,
    numericTokenRatio: tokens.length ? numericTokens / tokens.length : 0,
    lineCount: lines.length,
    multiSpace,
  };
}

function scoreExtractionQuality(value: string | null | undefined) {
  const normalized = String(value ?? "").trim().toLowerCase();
  if (normalized === "high") return 0.12;
  if (normalized === "medium") return 0.04;
  if (normalized === "low") return -0.14;
  return 0;
}

export function rankChunksForPrompt<T extends RetrievalChunkCandidate>(chunks: T[], prompt: string) {
  const profile = detectQueryProfile(prompt);

  return [...chunks]
    .map((chunk) => {
      const text = String(chunk.content ?? "");
      const shape = detectChunkShape(text);
      let score = 0;

      score += scoreExtractionQuality(chunk.extraction_quality);
      if (String(chunk.extraction_method ?? "").trim().toLowerCase() === "ocr" && score < 0) score -= 0.05;
      if (text.trim().length < 120) score -= 0.06;
      if (text.trim().length >= 300 && text.trim().length <= 1800) score += 0.03;

      if (profile.symbolHeavy && shape.symbolRatio >= 0.06) score += 0.08;
      if (profile.symbolHeavy && shape.numericTokenRatio >= 0.18) score += 0.04;
      if (profile.tableHeavy && (shape.multiSpace >= 1 || shape.numericTokenRatio >= 0.25)) score += 0.08;
      if (!profile.symbolHeavy && shape.symbolRatio >= 0.16 && text.length < 180) score -= 0.03;

      return { chunk, score };
    })
    .sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      return (Date.parse(String(b.chunk.created_at ?? "")) || 0) - (Date.parse(String(a.chunk.created_at ?? "")) || 0);
    });
}
