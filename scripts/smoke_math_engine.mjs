import fs from "node:fs/promises";
import path from "node:path";
import { createRequire } from "node:module";
import Module from "node:module";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const ts = require("typescript");
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const originalResolveFilename = Module._resolveFilename;
Module._resolveFilename = function resolveAlias(request, parent, isMain, options) {
  if (typeof request === "string" && request.startsWith("@/")) {
    const target = path.join(repoRoot, request.slice(2));
    try {
      return originalResolveFilename.call(this, target, parent, isMain, options);
    } catch (error) {
      const tsTarget = `${target}.ts`;
      try {
        require("node:fs").accessSync(tsTarget);
        return tsTarget;
      } catch {
        throw error;
      }
    }
  }
  return originalResolveFilename.call(this, request, parent, isMain, options);
};

require.extensions[".ts"] = function compileTypeScript(module, filename) {
  const source = require("node:fs").readFileSync(filename, "utf8");
  const output = ts.transpileModule(source, {
    compilerOptions: {
      esModuleInterop: true,
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2020,
    },
    fileName: filename,
  }).outputText;
  module._compile(output, filename);
};

async function loadPdfjs() {
  try {
    const mod = await import("pdfjs-dist/legacy/build/pdf.mjs");
    return mod.default ?? mod;
  } catch {
    const mod = await import("pdfjs-dist/legacy/build/pdf.js");
    return mod.default ?? mod;
  }
}

function itemText(item) {
  return typeof item?.str === "string" ? item.str.trim() : "";
}

function itemX(item) {
  return Number(item?.transform?.[4] ?? 0);
}

function itemY(item) {
  return Number(item?.transform?.[5] ?? 0);
}

function textItemsToLines(items) {
  const rows = [];
  for (const item of items) {
    const text = itemText(item);
    if (!text) continue;
    const y = itemY(item);
    let row = rows.find((candidate) => Math.abs(candidate.y - y) <= 2.5);
    if (!row) {
      row = { y, items: [] };
      rows.push(row);
    }
    row.items.push(item);
  }

  return rows
    .sort((a, b) => b.y - a.y)
    .map((row) =>
      row.items
        .sort((a, b) => itemX(a) - itemX(b))
        .map(itemText)
        .filter(Boolean)
        .join(" ")
        .replace(/\s+/g, " ")
        .trim(),
    )
    .filter(Boolean);
}

async function extractPageChunks(pdfPath) {
  const pdfjs = await loadPdfjs();
  const buffer = await fs.readFile(pdfPath);
  const loadingTask = pdfjs.getDocument({ data: new Uint8Array(buffer), disableWorker: true });
  const pdf = await loadingTask.promise;
  const chunks = [];

  for (let pageNum = 1; pageNum <= pdf.numPages; pageNum++) {
    const page = await pdf.getPage(pageNum);
    const content = await page.getTextContent();
    const lines = textItemsToLines(content.items || []);
    const text = lines.join("\n").trim();
    if (!text) continue;
    chunks.push({
      id: `mat-del-1-page-${pageNum}`,
      content: text,
      pageFrom: pageNum,
      createdAt: null,
    });
  }

  await pdf.destroy?.();
  return {
    chunks,
    pageCount: Number(pdf.numPages ?? chunks.length),
  };
}

function matDel1OfflineVisionFixture() {
  return [
    {
      pageNumber: 4,
      headings: ["Andengradspolynomier"],
      formulas: [{ rawFormula: "f(x) = ax^2 + bx + c", latexFormula: "f(x) = ax^2 + bx + c", surroundingText: "Et andengradspolynomium skrives som f(x) = ax^2 + bx + c.", confidence: 0.96 }],
      explanations: ["Et andengradspolynomium beskriver en parabel og læses via koefficienterne a, b og c."],
    },
    {
      pageNumber: 6,
      headings: ["Diskriminantmetoden"],
      formulas: [
        { rawFormula: "d = b^2 - 4 · a · c", latexFormula: "d = b^2 - 4 \\cdot a \\cdot c", surroundingText: "Diskriminanten afgør hvor mange løsninger ligningen har.", confidence: 0.97 },
        { rawFormula: "x = (-b ± √d) / (2a)", latexFormula: "x = \\frac{-b \\pm \\sqrt{d}}{2a}", surroundingText: "Løsningsformlen bruges når diskriminanten er fundet.", confidence: 0.97 },
      ],
      explanations: ["Når d er fundet, bruges fortegnet på d til at afgøre antal løsninger."],
    },
    {
      pageNumber: 12,
      headings: ["Toppunktsformlen"],
      formulas: [
        { rawFormula: "x_T = -b / (2a)", latexFormula: "x_T = \\frac{-b}{2a}", surroundingText: "Toppunktets x-koordinat findes med toppunktsformlen.", confidence: 0.95 },
        { rawFormula: "y_T = -d / (4a)", latexFormula: "y_T = \\frac{-d}{4a}", surroundingText: "Toppunktets y-koordinat kan skrives ved hjælp af diskriminanten.", confidence: 0.94 },
      ],
      explanations: ["Toppunktet er parablens højeste eller laveste punkt."],
    },
    {
      pageNumber: 16,
      headings: ["Cosinusrelationen"],
      formulas: [{ rawFormula: "c^2 = a^2 + b^2 - 2 · a · b · cos(C)", latexFormula: "c^2 = a^2 + b^2 - 2 \\cdot a \\cdot b \\cdot \\cos(C)", surroundingText: "Cosinusrelationen bruges i vilkårlige trekanter.", confidence: 0.96 }],
      explanations: ["Relationen udvider Pythagoras til trekanter, der ikke er retvinklede."],
    },
    {
      pageNumber: 17,
      headings: ["Cosinusrelationen"],
      formulas: [{ rawFormula: "c^2 = a^2 + b^2 - 2 · a · b · cos(C)", latexFormula: "c^2 = a^2 + b^2 - 2 \\cdot a \\cdot b \\cdot \\cos(C)", surroundingText: "Den ukendte side eller vinkel kan findes med cosinusrelationen.", confidence: 0.94 }],
      explanations: ["Man vælger relationen når to sider og den mellemliggende vinkel kendes."],
    },
    {
      pageNumber: 18,
      headings: ["Sinusrelationen"],
      formulas: [{ rawFormula: "a / sin(A) = b / sin(B) = c / sin(C)", latexFormula: "\\frac{a}{\\sin(A)} = \\frac{b}{\\sin(B)} = \\frac{c}{\\sin(C)}", surroundingText: "Sinusrelationen kobler sider med modstående vinkler.", confidence: 0.96 }],
      explanations: ["Sinusrelationen bruges når et modstående side-vinkel-par er kendt."],
    },
    {
      pageNumber: 19,
      headings: ["Sinusrelationen"],
      formulas: [{ rawFormula: "a / sin(A) = b / sin(B) = c / sin(C)", latexFormula: "\\frac{a}{\\sin(A)} = \\frac{b}{\\sin(B)} = \\frac{c}{\\sin(C)}", surroundingText: "De modstående størrelser indgår parvis i samme relation.", confidence: 0.94 }],
      explanations: ["Relationen kan bruges til både sider og vinkler i en vilkårlig trekant."],
    },
    {
      pageNumber: 23,
      headings: ["Arealformlen"],
      formulas: [{ rawFormula: "T = 1/2 · a · b · sin(C)", latexFormula: "T = \\frac{1}{2} \\cdot a \\cdot b \\cdot \\sin(C)", surroundingText: "Arealet findes ud fra to sider og den mellemliggende vinkel.", confidence: 0.95 }],
      explanations: ["Arealformlen bruges i vilkårlige trekanter."],
    },
    {
      pageNumber: 33,
      headings: ["Afstandsformlen"],
      formulas: [{ rawFormula: "|AB| = √((x2 - x1)^2 + (y2 - y1)^2)", latexFormula: "|AB| = \\sqrt{(x_2 - x_1)^2 + (y_2 - y_1)^2}", surroundingText: "Afstanden mellem to punkter findes via Pythagoras.", confidence: 0.96 }],
      explanations: ["Koordinatforskellene fungerer som kateter i en retvinklet trekant."],
    },
    {
      pageNumber: 37,
      headings: ["Cirklens ligning"],
      formulas: [{ rawFormula: "(x - a)^2 + (y - b)^2 = r^2", latexFormula: "(x - a)^2 + (y - b)^2 = r^2", surroundingText: "Alle punkter på cirklen ligger i afstand r fra centrum.", confidence: 0.96 }],
      explanations: ["Centrum og radius kan aflæses direkte i standardformen."],
    },
    {
      pageNumber: 55,
      headings: ["Monotonisætningen"],
      formulas: [
        { rawFormula: "f'(x) > 0", latexFormula: "f'(x) > 0", surroundingText: "Positiv afledt betyder voksende funktion.", confidence: 0.93 },
        { rawFormula: "f'(x) < 0", latexFormula: "f'(x) < 0", surroundingText: "Negativ afledt betyder aftagende funktion.", confidence: 0.93 },
      ],
      explanations: ["Fortegnet på den afledte afgør funktionens udvikling på et interval."],
    },
    {
      pageNumber: 56,
      headings: ["Nulpunkter for den afledte"],
      formulas: [{ rawFormula: "f'(x) = 0", latexFormula: "f'(x) = 0", surroundingText: "Nulpunkterne for den afledte findes ved at løse f'(x) = 0.", confidence: 0.95 }],
      explanations: ["Nulpunkter for den afledte bruges som kandidater til steder, hvor grafen kan skifte retning."],
    },
    {
      pageNumber: 57,
      headings: ["Tangentligningen"],
      formulas: [
        {
          rawFormula: "y = f(x0) + f'(x0)(x - x0)",
          latexFormula: "y = f(x_0) + f'(x_0)(x - x_0)",
          surroundingText: "Tangentligningen bruger punktet og hældningen i x0.",
          confidence: 0.95,
        },
      ],
      explanations: ["Tangentligningen beskriver den rette linje, der rører grafen i punktet x0."],
    },
    {
      pageNumber: 61,
      headings: ["Optimering med volumenbetingelse"],
      formulas: [
        { rawFormula: "O(x,h) = 4xh + x^2", latexFormula: "O(x,h) = 4xh + x^2", surroundingText: "Overfladearealet opstilles først med både x og h.", confidence: 0.94 },
        { rawFormula: "V = x · x · h = 100", latexFormula: "V = x \\cdot x \\cdot h = 100", surroundingText: "Volumenbetingelsen binder variablerne sammen.", confidence: 0.94 },
        { rawFormula: "h = 100 / x^2", latexFormula: "h = \\frac{100}{x^2}", surroundingText: "Højden isoleres fra volumenbetingelsen.", confidence: 0.95 },
        { rawFormula: "O(x) = 400 / x + x^2", latexFormula: "O(x) = \\frac{400}{x} + x^2", surroundingText: "Overfladearealet skrives som funktion af én variabel.", confidence: 0.95 },
        { rawFormula: "O'(x) = 0", latexFormula: "O'(x) = 0", surroundingText: "Førsteordensbetingelsen bruges til at finde minimum.", confidence: 0.93 },
      ],
      explanations: ["Volumenbetingelsen indsættes i målfunktionen før differentiation."],
    },
    {
      pageNumber: 62,
      headings: ["Definitionsmængde i optimering"],
      formulas: [{ rawFormula: "x > 0", latexFormula: "x > 0", surroundingText: "I optimeringsopgaven skal længder være positive, så x > 0.", confidence: 0.94 }],
      explanations: ["Definitionsmængden afgrænser de værdier, der giver mening i situationen, fx positive længder."],
    },
  ];
}

function applyOfflineVisionFixture(extraction, fixture) {
  const usedPages = new Set();
  for (const entry of fixture) {
    const page = extraction.pages.find((item) => item.pageNumber === entry.pageNumber);
    if (!page) continue;
    const supplement = [...entry.headings, ...entry.formulas.map((formula) => formula.rawFormula), ...entry.explanations].join("\n");
    page.text = compact([page.text, supplement].filter(Boolean).join("\n\n"));
    page.extractionMethod = "ocr";
    page.textCharCount = page.text.length;
    page.wordCount = page.text ? page.text.split(/\s+/).filter(Boolean).length : 0;
    page.extractionMeta = {
      ...page.extractionMeta,
      weak_text_for_math: false,
      heading_candidates: Array.from(new Set([...(page.extractionMeta.heading_candidates ?? []), ...entry.headings])),
      math_formula_candidates: [
        ...(page.extractionMeta.math_formula_candidates ?? []).filter(
          (formula) =>
            !entry.formulas.some(
              (incoming) => compact(incoming.rawFormula).toLowerCase() === compact(formula.rawFormula).toLowerCase(),
            ),
        ),
        ...entry.formulas.map((formula) => ({
          rawFormula: formula.rawFormula,
          normalizedFormula: formula.rawFormula,
          latexFormula: formula.latexFormula,
          surroundingText: formula.surroundingText,
          origin: "vision",
          confidence: formula.confidence,
        })),
      ],
    };
    usedPages.add(entry.pageNumber);
  }
  return usedPages;
}

function buildSmokeExtractionFallback(pageCount, chunks) {
  const pages = Array.from({ length: pageCount }, (_, index) => ({
    pageNumber: index + 1,
    text: "",
    extractionMethod: "text",
    extractionQuality: "low",
    textCharCount: 0,
    wordCount: 0,
    alphaNumRatio: 0,
    brokenTokenRatio: 1,
    extractionMeta: {
      page_type: "scan",
      ocr_decision: "scan_like_candidate",
      table_blocks: 0,
      formula_blocks: 0,
      structured_preview: "",
      signals: {
        lineCount: 0,
        nonEmptyLineCount: 0,
        digitRatio: 0,
        symbolRatio: 0,
        formulaLineRatio: 0,
        tableLikeLineRatio: 0,
        numericTokenRatio: 0,
        shortLineRatio: 0,
        usedOcrFallback: false,
      },
      weak_text_for_math: true,
      heading_candidates: [],
      math_formula_candidates: [],
    },
  }));

  for (const chunk of chunks) {
    const page = pages[(chunk.pageFrom ?? 1) - 1];
    if (!page) continue;
    page.text = compact([page.text, chunk.content].filter(Boolean).join("\n\n"));
    page.extractionMethod = chunk.sourceOrigin === "vision" || chunk.sourceOrigin === "ocr" ? "ocr" : "text";
    page.textCharCount = page.text.length;
    page.wordCount = page.text ? page.text.split(/\s+/).filter(Boolean).length : 0;
    page.extractionQuality = page.wordCount >= 18 ? "medium" : "low";
    page.extractionMeta.page_type = /Formel:/i.test(page.text) ? "formula_heavy" : "scan";
    page.extractionMeta.structured_preview = page.text.slice(0, 220);
    page.extractionMeta.weak_text_for_math = page.wordCount < 18;
    if (chunk.formulaCandidates?.length) {
      page.extractionMeta.math_formula_candidates.push(
        ...chunk.formulaCandidates.map((item) => ({
          rawFormula: item.rawFormula,
          normalizedFormula: item.normalizedFormula,
          latexFormula: item.latexFormula,
          surroundingText: item.surroundingText ?? "",
          origin: item.origin,
          confidence: item.confidence,
        })),
      );
    }
  }

  return {
    pageCount,
    ocrPages: pages.filter((page) => page.extractionMethod === "ocr").length,
    extractionMethod: pages.some((page) => page.extractionMethod === "ocr") ? "mixed" : "text",
    extractionQuality: pages.some((page) => page.extractionQuality === "medium") ? "medium" : "low",
    pages,
  };
}

function printSection(title, lines) {
  console.log(`\n## ${title}`);
  for (const line of lines) console.log(line);
}

function compact(value) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function formulaList(value) {
  return Array.from(new Set(value.filter(Boolean)));
}

function normalizeAuditKey(value) {
  return String(value ?? "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9æøå+\-^'=≈<>]+/g, "")
    .trim();
}

function normalizeFormulaForAudit(normalizeMathFormula, normalizeMathFormulaAudit, value) {
  const raw = compact(value);
  const latexFriendly = raw
    .replace(/\\frac\s*\{([^}]*)\}\s*\{([^}]*)\}/gi, "($1) / ($2)")
    .replace(/\\sqrt\s*\{([^}]*)\}/gi, "√$1")
    .replace(/\\pm/gi, "±")
    .replace(/\\cdot/gi, "·")
    .replace(/\\ge/gi, "≥")
    .replace(/\\le/gi, "≤")
    .replace(/\\approx/gi, "≈")
    .replace(/\\ne/gi, "!=");
  return compact(normalizeMathFormula(latexFriendly) || normalizeMathFormulaAudit(latexFriendly) || latexFriendly);
}

function containsFormula(normalizeMathFormula, normalizeMathFormulaAudit, rawFormula, text) {
  const formula = normalizeAuditKey(normalizeFormulaForAudit(normalizeMathFormula, normalizeMathFormulaAudit, rawFormula).toLowerCase());
  const candidate = normalizeAuditKey(normalizeFormulaForAudit(normalizeMathFormula, normalizeMathFormulaAudit, text).toLowerCase());
  if (!formula || !candidate) return false;
  return candidate === formula || candidate.includes(formula) || formula.includes(candidate);
}

function summarizeRoleTrace(roleTrace) {
  const labels = [];
  if (roleTrace.formulaCandidate.length) labels.push(`formulaCandidate=${roleTrace.formulaCandidate.join(", ")}`);
  if (roleTrace.centralFormula.length) labels.push(`centralFormula=${roleTrace.centralFormula.join(", ")}`);
  if (roleTrace.notationExample.length) labels.push(`notationExample=${roleTrace.notationExample.join(", ")}`);
  if (roleTrace.formulaLatex.length) labels.push(`formulaLatex=${roleTrace.formulaLatex.join(", ")}`);
  if (roleTrace.exampleLatex.length) labels.push(`exampleLatex=${roleTrace.exampleLatex.join(", ")}`);
  if (roleTrace.keyFormula.length) labels.push(`keyFormula=${roleTrace.keyFormula.join(", ")}`);
  return labels.join(" | ") || "none";
}

const FIELD_BOUNDARY_LEAK_RE =
  /(?:###|####|(?:^|\s)---(?:\s|$)|\*\*Formel:\*\*|##\s*(?:Vidensblokke|Nøgleformler)|_\s*(?:Metode|Regel|Begreb|Faldgrube|Eksempel))/i;

function formulaProseLeak(value) {
  return /\b(?:Bruges til|Eksempel|Pas på|Notation|Det vil sige)\b/i.test(value) || /[;:!?]/.test(value);
}

function findStructuredMathLeaks(note) {
  const rows = [];
  const visit = (scope, field, value, kind = "text") => {
    const text = compact(value);
    if (!text) return;
    const reasons = [];
    if (FIELD_BOUNDARY_LEAK_RE.test(text)) reasons.push("markdown_boundary_fragment");
    if (kind === "formula" && formulaProseLeak(text)) reasons.push("formula_contains_prose");
    if (reasons.length) {
      rows.push(`${scope} | field=${field} | reason=${reasons.join(",")} | value=${text.slice(0, 120)}`);
    }
  };

  note.intro?.paragraphs?.forEach((paragraph, index) => visit("intro", `paragraphs[${index}]`, paragraph));
  note.overview?.forEach((item, index) => {
    visit(`overview:${index + 1}`, "topic", item.topic);
    visit(`overview:${index + 1}`, "summary", item.summary);
  });
  note.keyFormulas?.forEach((formula, index) => {
    visit(`keyFormula:${index + 1}:${formula.title}`, "title", formula.title);
    visit(`keyFormula:${index + 1}:${formula.title}`, "sourceLabel", formula.sourceLabel);
    visit(`keyFormula:${index + 1}:${formula.title}`, "explanation", formula.explanation);
    visit(`keyFormula:${index + 1}:${formula.title}`, "formulaLatex", formula.formulaLatex, "formula");
  });
  note.blocks?.forEach((block) => {
    const scope = `block:${block.id}:${block.title}`;
    visit(scope, "title", block.title);
    visit(scope, "topicGroup", block.topicGroup);
    visit(scope, "sourceLabel", block.sourceLabel);
    visit(scope, "explanation", block.explanation);
    visit(scope, "usageText", block.usageText);
    visit(scope, "meaningText", block.meaningText);
    visit(scope, "warningText", block.warningText);
    visit(scope, "exampleText", block.exampleText);
    visit(scope, "formulaLatex", block.formulaLatex, "formula");
    visit(scope, "notationLatex", block.notationLatex, "formula");
    visit(scope, "exampleLatex", block.exampleLatex, "formula");
    (block.steps ?? []).forEach((step, index) => visit(scope, `steps[${index}]`, step));
  });
  return rows;
}

function findInlineMarkdownLeakLines(markdown) {
  const issues = [];
  const lines = String(markdown ?? "").split("\n");
  const visibleLeakRe = /(?:###|####|(?:^|\s)---(?:\s|$)|\*\*Formel:\*\*|##\s*(?:Vidensblokke|Nøgleformler)|_\s*(?:Metode|Regel|Begreb|Faldgrube|Eksempel))/i;
  lines.forEach((line, index) => {
    const trimmed = line.trim();
    if (!trimmed) return;
    if (/^(?:##\s|###\s|---$|_[^_]+_$|>\s|\$\$|- |\*\*[^*]+\*\*)/.test(trimmed)) return;
    const match = trimmed.match(visibleLeakRe);
    if (match) {
      issues.push(`line=${index + 1} | snippet=${trimmed.slice(0, 160)}`);
    }
  });
  return issues;
}

function normalizeGoldenText(value) {
  return String(value ?? "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\\frac\s*\{([^}]*)\}\s*\{([^}]*)\}/gi, "$1/$2")
    .replace(/\\sqrt\s*\{([^}]*)\}/gi, "sqrt($1)")
    .replace(/\\cdot/gi, "·")
    .replace(/\\pm/gi, "±")
    .replace(/\\ge/gi, ">=")
    .replace(/\\le/gi, "<=")
    .replace(/\\ne/gi, "!=")
    .replace(/\$\$/g, "")
    .replace(/\$/g, "")
    .replace(/[{}]/g, "")
    .replace(/[()]/g, "")
    .replace(/_/g, "")
    .replace(/\s+/g, "")
    .toLowerCase();
}

function collectStructuredRenderedStrings(note) {
  const values = [];
  const push = (value) => {
    if (value == null) return;
    const text = String(value).trim();
    if (!text) return;
    values.push(text);
  };

  push(note.title);
  push(note.fileName);
  note.intro?.paragraphs?.forEach(push);
  note.overview?.forEach((item) => {
    push(item.topic);
    push(item.summary);
  });
  note.keyFormulas?.forEach((formula) => {
    push(formula.title);
    push(formula.formulaLatex);
    push(formula.sourceLabel);
    push(formula.explanation);
  });
  note.blocks?.forEach((block) => {
    push(block.title);
    push(block.topicGroup);
    push(block.sourceLabel);
    push(block.explanation);
    push(block.formulaLatex);
    push(block.notationLatex);
    push(block.usageText);
    push(block.meaningText);
    push(block.warningText);
    push(block.exampleText);
    push(block.exampleLatex);
    (block.steps ?? []).forEach(push);
  });

  return values;
}

function hasNormalizedNeedle(haystackValues, needle) {
  const normalizedNeedle = normalizeGoldenText(needle);
  if (!normalizedNeedle) return false;
  return haystackValues.some((value) => {
    const normalizedValue = normalizeGoldenText(value);
    return normalizedValue.includes(normalizedNeedle) || normalizedNeedle.includes(normalizedValue);
  });
}

function findEmptyFormulaCards(note, markdown) {
  const issues = [];
  note.keyFormulas?.forEach((formula, index) => {
    if (!String(formula.formulaLatex ?? "").trim()) {
      issues.push(`keyFormula:${index + 1}:${formula.title}:empty_formulaLatex`);
    }
  });
  note.blocks?.forEach((block) => {
    if (block.formulaLatex != null && !String(block.formulaLatex).trim()) {
      issues.push(`block:${block.id}:${block.title}:empty_formulaLatex`);
    }
  });

  const markdownText = String(markdown ?? "");
  if (/> \*\*Formel\*\*\s*\n>\s*\$\$\s*\$\$/i.test(markdownText)) {
    issues.push("markdown:empty_formula_card");
  }
  if (/\*\*\s*Formel\s*\*\*\s*\n\s*\$\$\s*\$\$/i.test(markdownText)) {
    issues.push("markdown:empty_formula_card_unquoted");
  }
  return issues;
}

function runMatDel1GoldenRegression({ fileName, renderedMathNote, assembledFocusNote, renderedFormulaBlocks, structuredLeakRows, finalMarkdownLeakRows }) {
  const summary = {
    active: fileName.toLowerCase() === "mat_del.1.pdf",
    passed: true,
    warnings: [],
    failures: [],
    blockCount: renderedMathNote.blocks.length,
    renderedFormulaCount: renderedFormulaBlocks,
    keyFormulaCount: renderedMathNote.keyFormulas.length,
    leakageFound: structuredLeakRows.length > 0 || finalMarkdownLeakRows.length > 0,
    emptyFormulaCards: false,
  };

  if (!summary.active) {
    summary.warnings.push("golden_skipped_non_mat_del_1");
    return summary;
  }

  const expectedBlocks = [
    "Tangentligningen",
    "Toppunktsformlen",
    "Nulpunkter for den afledte",
    "Optimering med volumenbetingelse",
    "Overfladeareal som funktion",
    "Definitionsmængde i optimering",
    "Volumenbetingelse",
  ];
  const expectedFormulas = [
    "y = f(x0) + f'(x0)(x - x0)",
    "x_T = -b/(2a), y_T = -d/(4a)",
    "f'(x) = 0",
    "h = 100/x^2",
    "O(x) = 400/x + x^2",
    "x > 0",
  ];
  const negativePatterns = [
    { label: "bad_heading_fragment", pattern: /####/, scope: "all" },
    { label: "bad_separator_fragment", pattern: /----/, scope: "all" },
    { label: "bad_block_meta_fragment", pattern: /(?:^|[^A-Za-z])_(?:Metode|Regel)\b/, scope: "structured_only" },
    { label: "bad_formula_label_fragment", pattern: /\*\*Formel:\*\*/, scope: "all" },
    { label: "corrupted_derivative_formula", pattern: /f['’]\(x\)\s*=\s*03/i, scope: "all" },
    { label: "bad_fallback_prose", pattern: /Derfor har vi ikke foretaget os noget forbudt/i, scope: "all" },
  ];

  const structuredValues = collectStructuredRenderedStrings(renderedMathNote);
  const noteTitles = renderedMathNote.blocks.map((block) => block.title);
  const searchableValues = [...structuredValues, assembledFocusNote];

  for (const title of expectedBlocks) {
    if (!noteTitles.includes(title)) {
      summary.failures.push(`missing_block:${title}`);
    }
  }

  for (const formula of expectedFormulas) {
    if (!hasNormalizedNeedle(searchableValues, formula)) {
      summary.failures.push(`missing_formula:${formula}`);
    }
  }

  for (const { label, pattern, scope } of negativePatterns) {
    const structuredMatch = structuredValues.some((value) => pattern.test(value));
    const markdownMatch = scope === "structured_only" ? false : pattern.test(assembledFocusNote);
    if (structuredMatch || markdownMatch) {
      summary.failures.push(`forbidden_output:${label}`);
    }
  }

  if (summary.leakageFound) {
    summary.failures.push("raw_markdown_leakage_detected");
  }

  const emptyFormulaCards = findEmptyFormulaCards(renderedMathNote, assembledFocusNote);
  summary.emptyFormulaCards = emptyFormulaCards.length > 0;
  if (summary.emptyFormulaCards) {
    summary.failures.push(...emptyFormulaCards.map((item) => `empty_formula_card:${item}`));
  }

  summary.passed = summary.failures.length === 0;
  return summary;
}

function buildFormulaAudit(args) {
  const {
    rawFormulaCandidates,
    candidates,
    filteredPieces,
    rejectedPieces,
    blocks,
    renderedNote,
    renderedBlockFormulaAudit,
    normalizeMathFormula,
    normalizeMathFormulaAudit,
    pageCount,
    missingStatusByPage,
  } = args;

  const rows = [];
  const roleLines = [];
  const formulasByPage = new Map();
  for (const raw of rawFormulaCandidates) {
    const page = raw.sourcePage ?? 0;
    formulasByPage.set(page, [...(formulasByPage.get(page) ?? []), raw]);
  }

  for (let page = 1; page <= pageCount; page++) {
    const rawOnPage = formulasByPage.get(page) ?? [];
    if (!rawOnPage.length) {
      const missingStatus = missingStatusByPage?.get(page) ?? "extraction_missed";
      rows.push({
        page,
        rawFormula: "none",
        normalizedFormula: "none",
        seen: missingStatus,
        status: missingStatus,
        reason:
          missingStatus === "extraction_missed_due_to_no_ocr_fixture"
            ? "Siden ligner en svag/formeltung matematikside, men lokal OCR/vision-fixture var ikke tilgængelig."
            : "Ingen rå formelkandidater blev udtrukket fra sidens tekstlag/OCR/vision.",
        attachedBlock: "none",
        rendered: "no",
      });
      continue;
    }

    for (const raw of rawOnPage) {
      const rawMatches = candidates.filter(
        (piece) =>
          piece.sourcePage === raw.sourcePage &&
          containsFormula(normalizeMathFormula, normalizeMathFormulaAudit, raw.normalizedFormula, piece.text),
      );
      const filteredMatches = filteredPieces.filter(
        (piece) =>
          piece.sourcePage === raw.sourcePage &&
          containsFormula(normalizeMathFormula, normalizeMathFormulaAudit, raw.normalizedFormula, piece.text),
      );
      const rejectedMatches = rejectedPieces.filter(
        (piece) =>
          piece.sourcePage === raw.sourcePage &&
          containsFormula(normalizeMathFormula, normalizeMathFormulaAudit, raw.normalizedFormula, piece.text),
      );
      const attachedBlocks = [];
      const roleTrace = {
        formulaCandidate: [],
        centralFormula: [],
        notationExample: [],
        formulaLatex: [],
        exampleLatex: [],
        keyFormula: [],
      };

      for (const block of blocks) {
        const pageOverlap = !block.sourcePages.length || block.sourcePages.includes(raw.sourcePage);
        if (!pageOverlap) continue;

        const matchedFormulaCandidate = block.formulaCandidates.some((item) =>
          containsFormula(normalizeMathFormula, normalizeMathFormulaAudit, raw.normalizedFormula, item.formula),
        );
        const matchedRejectedFormula = block.formulaRejectedCandidates.some((item) =>
          containsFormula(normalizeMathFormula, normalizeMathFormulaAudit, raw.normalizedFormula, item.formula),
        );
        const matchedCentral = containsFormula(normalizeMathFormula, normalizeMathFormulaAudit, raw.normalizedFormula, block.centralFormula);
        const matchedNotation = containsFormula(normalizeMathFormula, normalizeMathFormulaAudit, raw.normalizedFormula, block.notationExample);
        if (!matchedFormulaCandidate && !matchedRejectedFormula && !matchedCentral && !matchedNotation) continue;

        attachedBlocks.push(block.title);
        if (matchedFormulaCandidate || matchedRejectedFormula) roleTrace.formulaCandidate.push(block.title);
        if (matchedCentral) roleTrace.centralFormula.push(block.title);
        if (matchedNotation) roleTrace.notationExample.push(block.title);
      }

      for (const blockAudit of renderedBlockFormulaAudit ?? []) {
        if (containsFormula(normalizeMathFormula, normalizeMathFormulaAudit, raw.normalizedFormula, blockAudit.formulaBoxLatex)) {
          roleTrace.formulaLatex.push(blockAudit.title);
        }
        if (containsFormula(normalizeMathFormula, normalizeMathFormulaAudit, raw.normalizedFormula, blockAudit.exampleLatex)) {
          roleTrace.exampleLatex.push(blockAudit.title);
        }
        if (containsFormula(normalizeMathFormula, normalizeMathFormulaAudit, raw.normalizedFormula, blockAudit.notationLatex)) {
          roleTrace.formulaLatex.push(`${blockAudit.title} (notation)`);
        }
      }

      for (const formula of renderedNote.keyFormulas) {
        if (containsFormula(normalizeMathFormula, normalizeMathFormulaAudit, raw.normalizedFormula, formula.formulaLatex)) {
          roleTrace.keyFormula.push(formula.title);
        }
      }

      roleTrace.formulaCandidate = formulaList(roleTrace.formulaCandidate);
      roleTrace.centralFormula = formulaList(roleTrace.centralFormula);
      roleTrace.notationExample = formulaList(roleTrace.notationExample);
      roleTrace.formulaLatex = formulaList(roleTrace.formulaLatex);
      roleTrace.exampleLatex = formulaList(roleTrace.exampleLatex);
      roleTrace.keyFormula = formulaList(roleTrace.keyFormula);

      const renderedYes =
        roleTrace.formulaLatex.length > 0 || roleTrace.exampleLatex.length > 0 || roleTrace.keyFormula.length > 0;
      const seenStatus = raw.origin === "vision" ? "vision_seen" : raw.origin === "ocr" ? "ocr_seen" : "text_layer_seen";
      let status = seenStatus;
      let reason = "Formlen blev set i ekstraktionen, men ikke løftet videre endnu.";

      if (renderedYes) {
        status = "rendered";
        reason = summarizeRoleTrace(roleTrace);
      } else if (attachedBlocks.length > 0) {
        status = "attached_to_block";
        const renderReasons = (renderedBlockFormulaAudit ?? [])
          .filter((item) => attachedBlocks.includes(item.title))
          .filter(
            (item) =>
              containsFormula(normalizeMathFormula, normalizeMathFormulaAudit, raw.normalizedFormula, item.centralFormula) ||
              containsFormula(normalizeMathFormula, normalizeMathFormulaAudit, raw.normalizedFormula, item.notationExample) ||
              containsFormula(normalizeMathFormula, normalizeMathFormulaAudit, raw.normalizedFormula, item.formulaBoxInput),
          )
          .map((item) => `${item.title}: ${item.formulaBoxReason}`)
          .filter(Boolean);
        reason =
          formulaList(renderReasons).join(" | ") ||
          "Formlen nåede en blok, men blev ikke valgt til formulaLatex, notationLatex, exampleLatex eller keyFormula.";
      } else if (rejectedMatches.length > 0) {
        status = "dropped_by_filter";
        reason = formulaList(rejectedMatches.map((piece) => piece.rejectionReason)).join(", ");
      } else if (rawMatches.length > 0 || filteredMatches.length > 0) {
        status = seenStatus;
        reason = "Formlen overlevede kandidat-/filterlaget, men blev ikke knyttet til en MathKnowledgeBlock.";
      } else {
        status = seenStatus;
        reason = "Formlen blev set som sideformel, men blev ikke bevaret som selvstændigt candidate-piece før filtrering.";
      }

      rows.push({
        page,
        rawFormula: raw.rawFormula,
        normalizedFormula: raw.normalizedFormula,
        seen: seenStatus,
        status,
        reason,
        attachedBlock: formulaList(attachedBlocks).join(", ") || "none",
        rendered: renderedYes ? "yes" : "no",
      });
      roleLines.push(
        `page=${page} | formula=${raw.rawFormula} | roles=${summarizeRoleTrace(roleTrace)} | attachedBlocks=${formulaList(attachedBlocks).join(", ") || "none"}`,
      );
    }
  }

  return { rows, roleLines };
}

async function main() {
  const inputPath = path.resolve(process.argv[2] ?? path.join(repoRoot, "Materiale", "Mat_del.1.pdf"));
  const fileName = path.basename(inputPath);
  const {
    buildMathCandidatePieces,
    extractRawMathFormulaCandidates,
    normalizeMathFormulaAudit,
  } = require("../lib/notes/mathCandidatePieces.ts");
  const {
    filterMathCandidatePieces,
  } = require("../lib/notes/mathNoiseFilter.ts");
  const {
    recognizeMathConceptLayers,
  } = require("../lib/notes/mathConceptRecognizer.ts");
  const {
    buildMathKnowledgeBlocksFromConcepts,
  } = require("../lib/notes/mathKnowledgeBlocks.ts");
  const {
    buildMathFocusNoteArtifactsFromBlocks,
    getLastMathFocusNoteAssemblyDebug,
  } = require("../lib/notes/mathFocusNoteAssembly.ts");
  const {
    normalizeMathFormula,
  } = require("../lib/notes/mathFormulaSelector.ts");
  const {
    buildMathRenderedNoteMetadata,
    readMathRenderedNoteFromMetadata,
  } = require("../lib/notes/mathRenderedNote.ts");
  const ocrAvailable = Boolean((process.env.OPENAI_API_KEY ?? "").trim());
  let usedOfflineVisionFixturePages = new Set();
  let extraction;
  let chunks;

  try {
    const {
      extractPdfWithFallback,
    } = require("../lib/pdf/extractPdfWithFallback.ts");
    const {
      buildChunksFromExtractedPages,
    } = require("../lib/pdf/chunkStructuredPages.ts");
    const pdfBuffer = await fs.readFile(inputPath);
    extraction = await extractPdfWithFallback(pdfBuffer, {
      fileName,
      maxPages: 200,
      allowOcr: true,
    });
    if (!ocrAvailable && fileName.toLowerCase() === "mat_del.1.pdf") {
      usedOfflineVisionFixturePages = applyOfflineVisionFixture(extraction, matDel1OfflineVisionFixture());
      if (usedOfflineVisionFixturePages.size > 0) {
        console.log("Using offline math vision fixture for Mat_del.1.pdf because local OCR/vision is unavailable.");
      }
    }
    chunks = buildChunksFromExtractedPages(extraction.pages).map((chunk, index) => ({
      id: `math-smoke-page-${chunk.pageNumber}-chunk-${index + 1}`,
      content: chunk.content,
      pageFrom: chunk.pageNumber,
      createdAt: null,
      sourceOrigin: chunk.sourceOrigin,
      formulaCandidates: chunk.formulaCandidates,
    }));
  } catch {
    console.log("Falling back to local pdfjs smoke extraction because extractPdfWithFallback could not be loaded in the smoke harness.");
    const extracted = await extractPageChunks(inputPath);
    let fallbackChunks = extracted.chunks.map((chunk) => ({ ...chunk, sourceOrigin: "text_layer", formulaCandidates: [] }));
    if (fileName.toLowerCase() === "mat_del.1.pdf") {
      usedOfflineVisionFixturePages = new Set(matDel1OfflineVisionFixture().map((item) => item.pageNumber));
      fallbackChunks = [
        ...fallbackChunks,
        ...matDel1OfflineVisionFixture().map((entry, index) => ({
          id: `mat-del-1-vision-page-${entry.pageNumber}-${index + 1}`,
          content: [...entry.headings, ...entry.formulas.map((formula) => formula.rawFormula), ...entry.explanations].join("\n"),
          pageFrom: entry.pageNumber,
          createdAt: null,
          sourceOrigin: "vision",
          formulaCandidates: entry.formulas.map((formula) => ({
            rawFormula: formula.rawFormula,
            normalizedFormula: formula.rawFormula,
            latexFormula: formula.latexFormula,
            surroundingText: formula.surroundingText,
            origin: "vision",
            confidence: formula.confidence,
          })),
        })),
      ];
      console.log("Using offline math vision fixture for Mat_del.1.pdf because local OCR/vision is unavailable.");
    }
    chunks = fallbackChunks;
    extraction = buildSmokeExtractionFallback(extracted.pageCount || 63, chunks);
  }
  const pageCount = extraction.pageCount;
  const rawFormulaCandidates = extractRawMathFormulaCandidates(chunks);
  const candidates = buildMathCandidatePieces(chunks, 220);
  const { filteredPieces, rejectedPieces } = filterMathCandidatePieces(candidates, 150);
  const conceptLayers = recognizeMathConceptLayers(filteredPieces, 32);
  const concepts = conceptLayers.finalConcepts;
  const blocks = buildMathKnowledgeBlocksFromConcepts(concepts, 28);

  const missingStatusByPage = new Map();
  for (const page of extraction.pages) {
    const formulaDense =
      page.extractionMeta.page_type === "formula_heavy" ||
      page.extractionMeta.page_type === "mixed" ||
      page.extractionMeta.formula_blocks > 0 ||
      page.extractionMeta.signals.formulaLineRatio >= 0.18 ||
      page.extractionMeta.signals.symbolRatio >= 0.05;
    if (
      !ocrAvailable &&
      !usedOfflineVisionFixturePages.has(page.pageNumber) &&
      page.extractionMeta.weak_text_for_math &&
      formulaDense
    ) {
      missingStatusByPage.set(page.pageNumber, "extraction_missed_due_to_no_ocr_fixture");
    }
  }

  console.log(`Math engine smoke: ${fileName}`);
  console.log(`pages=${pageCount} extractionMethod=${extraction.extractionMethod} extractionQuality=${extraction.extractionQuality} ocrPages=${extraction.ocrPages} textChunks=${chunks.length} rawFormulas=${rawFormulaCandidates.length} candidates=${candidates.length} filtered=${filteredPieces.length} rejected=${rejectedPieces.length} broad=${conceptLayers.broadConcepts.length} split=${conceptLayers.splitCandidates.length} concepts=${concepts.length} blocks=${blocks.length}`);

  printSection(
    "LAG 0 Raw Formula Audit Before Candidate Filtering",
    rawFormulaCandidates.length
      ? rawFormulaCandidates.slice(0, 40).map(
          (formula) =>
            `- page=${formula.sourcePage ?? "?"} origin=${formula.origin} detectedFrom=${formula.detectedFrom} confidence=${formula.confidence.toFixed(2)} raw=${formula.rawFormula} | normalized=${formula.normalizedFormula} | context=${compact(formula.contextText).slice(0, 140)}`,
        )
      : ["- none"],
  );

  printSection(
    "LAG 1 Candidate Extraction",
    candidates.slice(0, 12).map((piece) => `- ${piece.id} [${piece.kind}] ${piece.sourceRef}: ${piece.text}`),
  );
  printSection(
    "LAG 2 Noise Filtering",
    [
      ...filteredPieces.slice(0, 10).map((piece) => `KEEP ${piece.id} [${piece.kind}] score=${piece.filterScore}: ${piece.text}`),
      ...rejectedPieces.slice(0, 10).map((piece) => `DROP ${piece.id} reason=${piece.rejectionReason}: ${piece.text}`),
    ],
  );
  printSection(
    "LAG 3a Broad Concepts Before Split",
    conceptLayers.broadConcepts.map((concept) => `- ${concept.id}: ${concept.title} | ${concept.topicGroup} | refs=${concept.sourceRefs.join(", ")} | confidence=${concept.confidence.toFixed(2)}`),
  );
  printSection(
    "LAG 3b Split Candidates",
    conceptLayers.splitCandidates.map((concept) => `- ${concept.id}: ${concept.title} | ${concept.topicGroup} | refs=${concept.sourceRefs.join(", ")} | confidence=${concept.confidence.toFixed(2)}`),
  );
  printSection(
    "LAG 3b.1 Split Drivers",
    (conceptLayers.splitDebug ?? []).map((line) => `- ${line}`),
  );
  printSection(
    "LAG 3b.2 Dropped/Merged Split Candidates",
    (conceptLayers.droppedSplitCandidates ?? ["none"]).map((line) => `- ${line}`),
  );
  printSection(
    "LAG 3c Final Merged Concepts",
    concepts.map((concept) => `- ${concept.id}: ${concept.title} | ${concept.topicGroup} | refs=${concept.sourceRefs.join(", ")} | confidence=${concept.confidence.toFixed(2)}`),
  );
  printSection(
    "LAG 4-6 Typed MathKnowledgeBlocks",
    blocks.slice(0, 32).map((block) =>
      [
        `- ${block.id}: ${block.title}`,
        `  kind=${block.kind}; topicGroup=${block.topicGroup}; formulaMode=${block.formulaMode}; confidence=${block.confidence}`,
        `  formulaConfidence=${block.formulaConfidence.toFixed(2)}; formulaDecision=${block.formulaDecision}`,
        `  shortExplanation=${block.shortExplanation}`,
        `  howToUse=${block.howToUse ?? ""}`,
        `  teachingSteps=${block.teachingSteps?.join(" | ") ?? "none"}`,
        `  centralFormula=${block.centralFormula ?? "none"}`,
        `  notationExample=${block.notationExample ?? "none"}`,
        `  formulaCandidates=${block.formulaCandidates.length ? block.formulaCandidates.map((item) => `${item.formula} [${item.decision}/conf=${item.confidence.toFixed(2)}/sem=${item.semanticScore}/corr=${item.corruptionScore}/${item.reason}]`).join(" | ") : "none"}`,
        `  formulaRejected=${block.formulaRejectedCandidates.length ? block.formulaRejectedCandidates.map((item) => `${item.formula} [sem=${item.semanticScore}/corr=${item.corruptionScore}/${item.reason}]`).join(" | ") : "none"}`,
        `  sourceRefs=${block.sourceRefs.join(", ")}`,
      ].join("\n"),
    ),
  );

  console.log("\n## JSON sample: first 8 MathKnowledgeBlocks");
  console.log(JSON.stringify(blocks.slice(0, 8), null, 2));

  const assembledArtifacts = buildMathFocusNoteArtifactsFromBlocks({
    blocks,
    fileName,
    folderName: "Matematik",
    limit: 20,
  });
  const assembledFocusNote = assembledArtifacts.markdown;
  const renderedMathNote = assembledArtifacts.renderedNote;
  const assemblyDebug = getLastMathFocusNoteAssemblyDebug();
  const renderedFormulaBlocks = renderedMathNote.blocks.filter((block) => Boolean(block.formulaLatex)).length;
  const structuredLeakRows = findStructuredMathLeaks(renderedMathNote);
  const finalMarkdownLeakRows = findInlineMarkdownLeakLines(assembledFocusNote);
  const metadataRoundtrip = readMathRenderedNoteFromMetadata(buildMathRenderedNoteMetadata(renderedMathNote));
  const goldenRegression = runMatDel1GoldenRegression({
    fileName,
    renderedMathNote,
    assembledFocusNote,
    renderedFormulaBlocks,
    structuredLeakRows,
    finalMarkdownLeakRows,
  });
  const formulaAudit = buildFormulaAudit({
    rawFormulaCandidates,
    candidates,
    filteredPieces,
    rejectedPieces,
    blocks,
    renderedNote: renderedMathNote,
    renderedBlockFormulaAudit: assemblyDebug?.renderedBlockFormulaAudit ?? [],
    normalizeMathFormula,
    normalizeMathFormulaAudit,
    pageCount,
    missingStatusByPage,
  });

  printSection(
    "LAG 6 Structured MathRenderedNote Summary",
    [
      `kind=${renderedMathNote.kind}`,
      `title=${renderedMathNote.title}`,
      `knowledgeBlocks=${blocks.length}`,
      `renderedBlocks=${renderedMathNote.blocks.length}`,
      `renderedFormulaBlocks=${renderedFormulaBlocks}`,
      `keyFormulas=${renderedMathNote.keyFormulas.map((item) => item.title).join(" | ") || "none"}`,
      `blockKinds=${Array.from(new Set(renderedMathNote.blocks.map((block) => block.kind))).join(", ") || "none"}`,
      "rendererPath=structured_math_renderer",
    ].map((line) => `- ${line}`),
  );
  printSection(
    "LAG 6 Extraction Page Summary",
    extraction.pages.map(
      (page) =>
        `- page=${page.pageNumber} | method=${page.extractionMethod} | pageType=${page.extractionMeta.page_type} | weakMath=${page.extractionMeta.weak_text_for_math ? "yes" : "no"} | headings=${page.extractionMeta.heading_candidates.join(" | ") || "none"} | formulaCandidates=${page.extractionMeta.math_formula_candidates.map((item) => `${item.origin}:${item.rawFormula}`).join(" | ") || "none"}`,
    ),
  );

  printSection(
    "LAG 6a Raw MathKnowledgeBlock Fields Before Assembly",
    (assemblyDebug?.rawKnowledgeBlockFields?.length ? assemblyDebug.rawKnowledgeBlockFields : ["none"]).map((line) => `- ${line}`),
  );
  printSection(
    "LAG 6a.1 Cleaned MathKnowledgeBlocks Before Assembly",
    [
      `finalCleanBlockCount=${assemblyDebug?.sanitizedBlockCount ?? 0}`,
      ...(assemblyDebug?.sanitizedKnowledgeBlockFields?.length ? assemblyDebug.sanitizedKnowledgeBlockFields : ["none"]),
    ].map((line) => `- ${line}`),
  );
  printSection(
    "LAG 6a.2 Dropped MathKnowledgeBlock Fields/Blocks",
    [
      ...(assemblyDebug?.droppedKnowledgeBlockFields?.length ? assemblyDebug.droppedKnowledgeBlockFields.map((line) => `FIELD ${line}`) : []),
      ...(assemblyDebug?.droppedKnowledgeBlocks?.length ? assemblyDebug.droppedKnowledgeBlocks.map((line) => `BLOCK ${line}`) : []),
      ...(!assemblyDebug?.droppedKnowledgeBlockFields?.length && !assemblyDebug?.droppedKnowledgeBlocks?.length ? ["none"] : []),
    ].map((line) => `- ${line}`),
  );
  printSection(
    "LAG 6b Featured Formula Field Trace",
    (assemblyDebug?.featuredFormulaFields?.length ? assemblyDebug.featuredFormulaFields : ["none"]).map((line) => `- ${line}`),
  );
  printSection(
    "LAG 6b.0 Featured Formula Candidate Decisions",
    (assemblyDebug?.featuredFormulaCandidateDecisions?.length ? assemblyDebug.featuredFormulaCandidateDecisions : ["none"]).map((line) => `- ${line}`),
  );
  printSection(
    "LAG 6b.1 Selected Featured Formula Winners",
    (assemblyDebug?.selectedFeaturedFormulas?.length ? assemblyDebug.selectedFeaturedFormulas : ["none"]).map((line) => `- ${line}`),
  );
  printSection(
    "LAG 6c Suppressed Featured Formula Cards",
    (assemblyDebug?.suppressedFeaturedFormulas?.length ? assemblyDebug.suppressedFeaturedFormulas : ["none"]).map((line) => `- ${line}`),
  );
  printSection(
    "LAG 6d Rendered Block Field Trace",
    (assemblyDebug?.blockFieldFindings?.length ? assemblyDebug.blockFieldFindings : ["none"]).map((line) => `- ${line}`),
  );
  printSection(
    "LAG 6d.1 Rendered Textbook Block Decisions",
    (assemblyDebug?.renderedBlockDecisions?.length ? assemblyDebug.renderedBlockDecisions : ["none"]).map((line) => `- ${line}`),
  );
  printSection(
    "LAG 6d.1b Formula Promotion Audit By Block",
    (assemblyDebug?.renderedBlockFormulaAudit?.length
      ? assemblyDebug.renderedBlockFormulaAudit.map(
          (item) =>
            `- block=${item.blockId} | title=${item.title} | selected=${item.selectedFormula ?? "none"} | selectedSource=${item.selectedFormulaSource} | promotionReason=${item.promotionReason} | candidates=${item.candidateFormulas.join(" || ") || "none"} | rejected=${item.rejectedFormulas.join(" || ") || "none"} | uiFormulaRendered=${item.uiFormulaRendered ? "yes" : "no"}`,
        )
      : ["- none"]),
  );
  printSection(
    "LAG 6d.2 Rendered Formula Audit Objects",
    (assemblyDebug?.renderedBlockFormulaAudit?.length
      ? assemblyDebug.renderedBlockFormulaAudit.map(
          (item) =>
            `- block=${item.blockId} | title=${item.title} | formulaBox=${item.formulaBoxRendered ? "yes" : "no"} | input=${item.formulaBoxInput ?? "none"} | formulaLatex=${item.formulaBoxLatex ?? "none"} | notationLatex=${item.notationLatex ?? "none"} | exampleLatex=${item.exampleLatex ?? "none"} | uiFormulaRendered=${item.uiFormulaRendered ? "yes" : "no"} | reason=${item.formulaBoxReason}`,
        )
      : ["- none"]),
  );
  printSection(
    "LAG 6e Cleaned/Skipped Block Fields",
    [
      ...(assemblyDebug?.cleanedBlockFields?.length ? assemblyDebug.cleanedBlockFields.map((line) => `CLEAN ${line}`) : []),
      ...(assemblyDebug?.droppedRenderedFields?.length ? assemblyDebug.droppedRenderedFields.map((line) => `DROP ${line}`) : []),
      ...(assemblyDebug?.skippedBlocks?.length ? assemblyDebug.skippedBlocks.map((line) => `SKIP ${line}`) : []),
      ...(!assemblyDebug?.cleanedBlockFields?.length && !assemblyDebug?.droppedRenderedFields?.length && !assemblyDebug?.skippedBlocks?.length ? ["none"] : []),
    ].map((line) => `- ${line}`),
  );
  printSection(
    "LAG 7 Final Markdown Blocks Before Join",
    (assemblyDebug?.markdownBlocks ?? []).map((block, index) => `--- block ${index + 1} ---\n${block}`),
  );
  printSection(
    "LAG 7a Exact Nøgleformler Markdown Block",
    [assemblyDebug?.featuredFormulaMarkdownBlock || "none"],
  );
  printSection(
    "LAG 7b Assembly-Suppressed Formulas",
    (assemblyDebug?.suppressedFormulas?.length ? assemblyDebug.suppressedFormulas : ["none"]).map((line) => `- ${line}`),
  );
  printSection(
    "LAG 7c Nøgleformler to Vidensblokke Transition Preview",
    [assemblyDebug?.transitionPreview || "none"],
  );
  printSection(
    "LAG 8 Formula Role Trace",
    formulaAudit.roleLines.length ? formulaAudit.roleLines.map((line) => `- ${line}`) : ["- none"],
  );
  printSection(
    "LAG 8.1 Formula Audit Table",
    formulaAudit.rows.map(
      (row) =>
        `page=${row.page} | raw formula=${row.rawFormula} | normalized formula=${row.normalizedFormula} | seen=${row.seen} | status=${row.status}${row.reason ? ` (${row.reason})` : ""} | attached block=${row.attachedBlock} | final rendered=${row.rendered}`,
    ),
  );
  printSection(
    "LAG 9 Field Boundary Leak Audit",
    [
      ...(structuredLeakRows.length ? structuredLeakRows.map((line) => `STRUCTURED ${line}`) : []),
      ...(finalMarkdownLeakRows.length ? finalMarkdownLeakRows.map((line) => `MARKDOWN ${line}`) : []),
      ...(!structuredLeakRows.length && !finalMarkdownLeakRows.length ? ["none"] : []),
    ].map((line) => `- ${line}`),
  );
  printSection(
    "LAG 10 Golden Regression",
    [
      `goldenTarget=${fileName.toLowerCase() === "mat_del.1.pdf" ? "Mat_del.1.pdf" : "skipped"}`,
      `passed=${goldenRegression.passed ? "yes" : "no"}`,
      `blockCount=${goldenRegression.blockCount}`,
      `renderedFormulaCount=${goldenRegression.renderedFormulaCount}`,
      `keyFormulaCount=${goldenRegression.keyFormulaCount}`,
      `leakageFound=${goldenRegression.leakageFound ? "yes" : "no"}`,
      `emptyFormulaCards=${goldenRegression.emptyFormulaCards ? "yes" : "no"}`,
      `metadataRoundtrip=${metadataRoundtrip?.blocks?.length ? "ok" : "failed"}`,
      "generatedNoteObject=not_available_in_smoke_harness",
      ...(goldenRegression.failures.length ? goldenRegression.failures.map((item) => `FAIL ${item}`) : ["none"]),
      ...(goldenRegression.warnings.length ? goldenRegression.warnings.map((item) => `WARN ${item}`) : ["WARN generated_note_object_not_available"]),
    ].map((line) => `- ${line}`),
  );

  console.log("\n## Assembled Fokusnote preview");
  console.log(assembledFocusNote);

  if (structuredLeakRows.length || finalMarkdownLeakRows.length) {
    throw new Error(
      `Math rendered note leakage audit failed: structured=${structuredLeakRows.length}, markdown=${finalMarkdownLeakRows.length}`,
    );
  }
  if (fileName.toLowerCase() === "mat_del.1.pdf" && !goldenRegression.passed) {
    throw new Error(`Mat_del.1 structured math golden regression failed: ${goldenRegression.failures.join(", ")}`);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
