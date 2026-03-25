import "server-only";

import OpenAI from "openai";
import { PDFDocument } from "pdf-lib";

export type ExtractionMethod = "text" | "ocr" | "mixed";
export type ExtractionQuality = "high" | "medium" | "low";
export type PageType = "text" | "scan" | "table_heavy" | "formula_heavy" | "mixed";

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

export type PageExtractionMeta = {
  page_type: PageType;
  table_blocks: number;
  formula_blocks: number;
  structured_preview: string;
  signals: PageClassificationSignals;
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
    page_count: number;
    ocr_pages: number;
    dominant_page_type: PageType | null;
    page_type_counts: Record<PageType, number>;
    pages: Array<{
      page: number;
      page_type: PageType;
      extraction_method: "text" | "ocr";
      extraction_quality: ExtractionQuality;
      text_char_count: number;
      word_count: number;
      table_blocks: number;
      formula_blocks: number;
      structured_preview: string;
      signals: PageClassificationSignals;
    }>;
    total_table_blocks: number;
    total_formula_blocks: number;
  };
};

type ExtractOpts = {
  fileName?: string;
  maxPages?: number;
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

const OCR_ENGINE = "openai_pdf_ocr";
const OCR_MODEL = (process.env.OPENAI_MODEL_OCR ?? process.env.OPENAI_MODEL ?? "gpt-4o-mini").trim();

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
): Promise<{ pageCount: number; pages: PdfPageSource[] }> {
  const mod: any = await import("pdfjs-dist/legacy/build/pdf.js");
  const pdfjs: any = mod?.default ?? mod;

  const loadingTask = pdfjs.getDocument({
    data: new Uint8Array(buf),
    disableWorker: true,
  });

  const pdf = await loadingTask.promise;
  const pageCount = Math.min(Number(pdf?.numPages ?? 0) || 0, maxPages);
  const pages: PdfPageSource[] = [];

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

  return { pageCount, pages };
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
  pagePdfBuffer: Buffer;
}): Promise<string> {
  const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  const base64 = args.pagePdfBuffer.toString("base64");

  const response: any = await (openai as any).responses.create({
    model: OCR_MODEL,
    input: [
      {
        role: "user",
        content: [
          {
            type: "input_file",
            filename: `${args.fileName.replace(/\.pdf$/i, "")}-page-${args.pageNumber}.pdf`,
            file_data: `data:application/pdf;base64,${base64}`,
          },
          {
            type: "input_text",
            text:
              "Transcribe all readable text from this single PDF page. Return only plain text. " +
              "Keep line breaks when helpful. If no useful text is readable, return an empty string.",
          },
        ],
      },
    ],
  });

  return normalizePageText(getResponseText(response));
}

function summarizeDocumentMeta(pages: ExtractedPdfPage[]) {
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
    page_count: pages.length,
    ocr_pages: pages.filter((p) => p.extractionMethod === "ocr").length,
    dominant_page_type: dominantPageType,
    page_type_counts: pageTypeCounts,
    pages: pages.map((page) => ({
      page: page.pageNumber,
      page_type: page.extractionMeta.page_type,
      extraction_method: page.extractionMethod,
      extraction_quality: page.extractionQuality,
      text_char_count: page.textCharCount,
      word_count: page.wordCount,
      table_blocks: page.extractionMeta.table_blocks,
      formula_blocks: page.extractionMeta.formula_blocks,
      structured_preview: page.extractionMeta.structured_preview,
      signals: page.extractionMeta.signals,
    })),
    total_table_blocks: totalTableBlocks,
    total_formula_blocks: totalFormulaBlocks,
  };
}

export async function extractPdfWithFallback(
  buf: Buffer,
  opts: ExtractOpts = {},
): Promise<ExtractedPdfDocument> {
  const maxPages = Math.max(1, Math.min(opts.maxPages ?? 500, 2000));
  const fileName = (opts.fileName ?? "document.pdf").trim() || "document.pdf";
  const raw = await extractPdfPagesViaPdfjs(buf, maxPages);

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
        table_blocks: structured.tableBlocks,
        formula_blocks: structured.formulaBlocks,
        structured_preview: structuredAnalysis.normalizedText.slice(0, 220),
      },
    };
  });

  const ocrTexts: Array<{ page: number; text: string; engine: string }> = [];
  if (raw.pageCount > 0 && canRunOcr()) {
    for (const page of pages) {
      if (page.extractionQuality === "high") continue;

      try {
        const pagePdfBuffer = await extractSinglePagePdf(buf, page.pageNumber - 1);
        const ocrText = await runOpenAIOcrForPage({
          fileName,
          pageNumber: page.pageNumber,
          pagePdfBuffer,
        });

        if (!ocrText) continue;

        const originalAnalysis = analyzeText(page.text);
        const ocrStructured = structurePageText({
          pageType: page.extractionMeta.page_type,
          text: ocrText,
        });
        const ocrAnalysis = analyzeText(ocrStructured.text || ocrText);
        if (ocrAnalysis.score <= originalAnalysis.score && originalAnalysis.looksUsable) continue;

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
          table_blocks: ocrStructured.tableBlocks,
          formula_blocks: ocrStructured.formulaBlocks,
          structured_preview: ocrAnalysis.normalizedText.slice(0, 220),
        };
        ocrTexts.push({ page: page.pageNumber, text: page.text, engine: OCR_ENGINE });
      } catch (error) {
        console.warn(`[pdf/extract] OCR fallback failed for page ${page.pageNumber}:`, error);
      }
    }
  }

  const ocrPages = pages.filter((p) => p.extractionMethod === "ocr").length;
  const extractionMethod: ExtractionMethod =
    ocrPages === 0 ? "text" : ocrPages === pages.length ? "ocr" : "mixed";

  return {
    pageCount: raw.pageCount,
    ocrPages,
    extractionMethod,
    extractionQuality: summarizeDocumentQuality(pages),
    pages,
    ocrTexts,
    extractionMeta: summarizeDocumentMeta(pages),
  };
}
