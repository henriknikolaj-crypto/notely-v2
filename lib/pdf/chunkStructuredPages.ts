import "server-only";

import type {
  ExtractedPageFormulaCandidate,
  ExtractedPdfPage,
  FormulaExtractionOrigin,
  PageType,
} from "@/lib/pdf/extractPdfWithFallback";

export type StructuredChunk = {
  pageNumber: number;
  content: string;
  extractionMethod: "text" | "ocr";
  extractionQuality: "high" | "medium" | "low";
  sourceOrigin?: FormulaExtractionOrigin;
  formulaCandidates?: Array<{
    rawFormula: string;
    normalizedFormula: string;
    latexFormula?: string;
    surroundingText?: string;
    origin: FormulaExtractionOrigin;
    confidence: number;
  }>;
};

type BlockKind = "text" | "table" | "formula";

type Block = {
  kind: BlockKind;
  text: string;
};

const DEFAULT_TEXT_TARGET = 1200;
const DEFAULT_SPECIAL_TARGET = 1800;

function classifyBlock(text: string): BlockKind {
  const trimmed = text.trim();
  if (!trimmed) return "text";
  const lines = trimmed.split(/\n/).filter(Boolean);
  const visible = Array.from(trimmed).filter((ch) => /\S/u.test(ch));
  const symbols = visible.filter((ch) => /[=+\-/*^%()[\]{}<>~|\\±×÷∑∏√∞≈≠≤≥∆∂µπ]/u.test(ch)).length;
  const digits = visible.filter((ch) => /\d/.test(ch)).length;
  const tokens = trimmed.split(/\s+/).filter(Boolean);
  const numericTokens = tokens.filter((token) => /^[$€£¥]?\(?[\d.,%:/-]+\)?$/.test(token)).length;
  const multiSpace = (trimmed.match(/ {3,}/g) ?? []).length;

  const symbolRatio = visible.length ? symbols / visible.length : 0;
  const digitRatio = visible.length ? digits / visible.length : 0;
  const numericTokenRatio = tokens.length ? numericTokens / tokens.length : 0;

  if (multiSpace > 0 || numericTokenRatio >= 0.35 || (digitRatio >= 0.25 && lines.length >= 3)) return "table";
  if (symbolRatio >= 0.1 || symbols >= 4) return "formula";
  return "text";
}

function splitStructuredBlocks(text: string) {
  return text
    .split(/\n{2,}/)
    .map((block) => block.trim())
    .filter(Boolean)
    .map((block) => ({ kind: classifyBlock(block), text: block } satisfies Block));
}

function splitOversizedBlock(block: Block, targetSize: number) {
  if (block.text.length <= targetSize) return [block];

  const lines = block.text.split(/\n/).map((line) => line.trimEnd()).filter(Boolean);
  if (lines.length <= 1) return [block];

  const out: Block[] = [];
  let current: string[] = [];
  let currentLen = 0;
  const maxLines = block.kind === "table" ? 12 : 10;

  for (const line of lines) {
    const nextLen = currentLen + line.length + (current.length ? 1 : 0);
    if (current.length > 0 && (nextLen > targetSize || current.length >= maxLines)) {
      out.push({ kind: block.kind, text: current.join("\n") });
      current = [];
      currentLen = 0;
    }
    current.push(line);
    currentLen += line.length + 1;
  }

  if (current.length) out.push({ kind: block.kind, text: current.join("\n") });
  return out.length ? out : [block];
}

function pagePreferredTarget(pageType: PageType, kind: BlockKind) {
  if (kind === "table" || kind === "formula") return DEFAULT_SPECIAL_TARGET;
  if (pageType === "table_heavy" || pageType === "formula_heavy" || pageType === "mixed") return 1400;
  return DEFAULT_TEXT_TARGET;
}

function mergeBlocksIntoChunks(blocks: Block[], pageType: PageType) {
  const chunks: string[] = [];
  let current = "";

  const flush = () => {
    const trimmed = current.trim();
    if (trimmed) chunks.push(trimmed);
    current = "";
  };

  for (let i = 0; i < blocks.length; i++) {
    const block = blocks[i];
    const next = blocks[i + 1] ?? null;

    if (block.kind === "text" && next && next.kind !== "text" && block.text.length <= 260) {
      const combined = `${block.text}\n\n${next.text}`.trim();
      const combinedTarget = pagePreferredTarget(pageType, next.kind);
      if (combined.length <= combinedTarget) {
        const mergedBlock: Block = { kind: next.kind, text: combined };
        const splitMerged = splitOversizedBlock(mergedBlock, combinedTarget);
        for (const part of splitMerged) {
          flush();
          chunks.push(part.text.trim());
        }
        i += 1;
        continue;
      }
    }

    const target = pagePreferredTarget(pageType, block.kind);
    const safeBlocks = splitOversizedBlock(block, target);

    for (const part of safeBlocks) {
      const candidate = current ? `${current}\n\n${part.text}` : part.text;
      const shouldIsolate = part.kind !== "text";
      if (shouldIsolate) {
        flush();
        chunks.push(part.text.trim());
        continue;
      }

      if (candidate.length > target && current) {
        flush();
      }
      current = current ? `${current}\n\n${part.text}` : part.text;
    }
  }

  flush();
  return chunks;
}

function buildFormulaCandidateChunks(page: ExtractedPdfPage) {
  const formulas = page.extractionMeta.math_formula_candidates ?? [];
  if (!formulas.length) return [] as StructuredChunk[];

  const shouldEmitDedicatedChunks =
    page.extractionMeta.weak_text_for_math ||
    page.extractionMethod === "ocr" ||
    formulas.some((formula) => formula.origin === "vision");
  if (!shouldEmitDedicatedChunks) return [] as StructuredChunk[];

  const seen = new Set<string>();
  const heading = page.extractionMeta.heading_candidates?.[0] ?? "";
  return formulas
    .filter((formula) => {
      const key = formula.normalizedFormula.toLowerCase();
      if (!key || seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .slice(0, 8)
    .map((formula) => {
      const content = [heading, `Formel: ${formula.rawFormula}`, formula.surroundingText ? `Forklaring: ${formula.surroundingText}` : ""]
        .filter(Boolean)
        .join("\n");
      return {
        pageNumber: page.pageNumber,
        content,
        extractionMethod: page.extractionMethod,
        extractionQuality: page.extractionQuality,
        sourceOrigin: formula.origin,
        formulaCandidates: [
          {
            rawFormula: formula.rawFormula,
            normalizedFormula: formula.normalizedFormula,
            latexFormula: formula.latexFormula,
            surroundingText: formula.surroundingText,
            origin: formula.origin,
            confidence: formula.confidence,
          },
        ],
      } satisfies StructuredChunk;
    });
}

export function buildChunksFromExtractedPages(pages: ExtractedPdfPage[]): StructuredChunk[] {
  const out: StructuredChunk[] = [];

  for (const page of pages) {
    const blocks = splitStructuredBlocks(page.text);
    const merged = mergeBlocksIntoChunks(blocks, page.extractionMeta.page_type);

    for (const content of merged) {
      const trimmed = content.trim();
      if (!trimmed) continue;
      out.push({
        pageNumber: page.pageNumber,
        content: trimmed,
        extractionMethod: page.extractionMethod,
        extractionQuality: page.extractionQuality,
        sourceOrigin: page.extractionMethod === "ocr" ? "ocr" : "text_layer",
        formulaCandidates: page.extractionMeta.math_formula_candidates?.map((formula: ExtractedPageFormulaCandidate) => ({
          rawFormula: formula.rawFormula,
          normalizedFormula: formula.normalizedFormula,
          latexFormula: formula.latexFormula,
          surroundingText: formula.surroundingText,
          origin: formula.origin,
          confidence: formula.confidence,
        })),
      });
    }

    out.push(...buildFormulaCandidateChunks(page));
  }

  return out;
}
