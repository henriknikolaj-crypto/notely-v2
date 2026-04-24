import type { MathKnowledgeBlock } from "@/lib/notes/mathKnowledgeBlocks";
import type { MathRenderedNote, MathRenderedNoteBlock, MathRenderedNoteFormula } from "@/lib/notes/mathRenderedNote";
import { selectMathFormulaBox } from "@/lib/notes/mathFormulaSelector";

type MathFocusAssemblyInput = {
  blocks: MathKnowledgeBlock[];
  fileName?: string;
  folderName?: string | null;
  limit?: number;
};

type FeaturedFormula = {
  block: MathKnowledgeBlock;
  title: string;
  meta: string;
  formula: string;
  explanation: string | null;
  key: string;
  score: number;
};

export type MathFocusNoteAssemblyResult = {
  renderedNote: MathRenderedNote;
  markdown: string;
};

type RenderedBlockFormulaAudit = {
  blockId: string;
  title: string;
  kind: MathKnowledgeBlock["kind"];
  selectedFormula?: string;
  selectedFormulaSource: "centralFormula" | "notationExample" | "none";
  promotionReason: string;
  candidateFormulas: string[];
  rejectedFormulas: string[];
  centralFormula?: string;
  notationExample?: string;
  formulaBoxInput?: string;
  formulaBoxSource: "centralFormula" | "notationExample" | "none";
  formulaBoxLatex?: string;
  formulaBoxRendered: boolean;
  formulaBoxReason: string;
  notationLatex?: string;
  exampleLatex?: string;
  exampleText?: string;
  uiFormulaRendered: boolean;
};

type AssemblyDebug = {
  rawKnowledgeBlockFields: string[];
  sanitizedKnowledgeBlockFields: string[];
  droppedKnowledgeBlockFields: string[];
  droppedRenderedFields: string[];
  droppedKnowledgeBlocks: string[];
  sanitizedBlockCount: number;
  markdownBlocks: string[];
  suppressedFormulas: string[];
  featuredFormulaFields: string[];
  featuredFormulaCandidateDecisions: string[];
  selectedFeaturedFormulas: string[];
  suppressedFeaturedFormulas: string[];
  featuredFormulaMarkdownBlock: string;
  blockFieldFindings: string[];
  cleanedBlockFields: string[];
  skippedBlocks: string[];
  renderedBlockDecisions: string[];
  renderedBlockFormulaAudit: RenderedBlockFormulaAudit[];
  transitionPreview: string;
  finalMarkdownPreview: string;
};

let lastAssemblyDebug: AssemblyDebug = {
  rawKnowledgeBlockFields: [],
  sanitizedKnowledgeBlockFields: [],
  droppedKnowledgeBlockFields: [],
  droppedRenderedFields: [],
  droppedKnowledgeBlocks: [],
  sanitizedBlockCount: 0,
  markdownBlocks: [],
  suppressedFormulas: [],
  featuredFormulaFields: [],
  featuredFormulaCandidateDecisions: [],
  selectedFeaturedFormulas: [],
  suppressedFeaturedFormulas: [],
  featuredFormulaMarkdownBlock: "",
  blockFieldFindings: [],
  cleanedBlockFields: [],
  skippedBlocks: [],
  renderedBlockDecisions: [],
  renderedBlockFormulaAudit: [],
  transitionPreview: "",
  finalMarkdownPreview: "",
};

const KIND_LABELS: Record<MathKnowledgeBlock["kind"], string> = {
  concept: "Begreb",
  rule: "Regel",
  method: "Metode",
  example: "Eksempel",
  pitfall: "Faldgrube",
};

const TOPIC_OVERVIEW_COPY: Record<string, string> = {
  Andengradspolynomier: "løsning af andengradsligninger med diskriminant, løsningsformel og kvadratkomplettering.",
  Trigonometri: "sammenhænge mellem vinkler, sidelængder og areal i trekanter.",
  Funktioner: "stykkevise forskrifter og hvordan intervaller afgør, hvilken regel der gælder.",
  "Analytisk geometri": "afstande i koordinatsystemet og cirklens ligning.",
  Differentialregning: "afledte funktioner, monotoni og grafens udvikling.",
  Optimering: "opstilling af funktioner og betingelser for maksimum eller minimum.",
};

const BLOCK_COPY: Record<string, string[]> = {
  "Løsningsformlen for andengradsligninger": [
    "Løsningsformlen bruges, når en andengradsligning står på standardform, og man vil finde rødderne.",
    "Først bestemmes diskriminanten, og derefter sættes koefficienterne ind i formlen.",
    "Den er især nyttig, når ligningen ikke let kan faktoriseres.",
  ],
  "Diskriminant og betydning": [
    "Diskriminanten fortæller, hvor mange reelle løsninger en andengradsligning har.",
    "En positiv diskriminant giver to løsninger, nul giver én dobbeltrod, og en negativ diskriminant giver ingen reelle løsninger.",
    "Derfor er den et hurtigt første tjek, før man regner selve løsningerne ud.",
  ],
  Kvadratkomplettering: [
    "Kvadratkomplettering omskriver et andengradspolynomium, så en del af udtrykket bliver et kvadrat.",
    "Metoden gør det lettere at se struktur i udtrykket og kan bruges både til omskrivning og løsning.",
    "Man skal holde ligningen i balance, hvis man lægger et tal til på den ene side.",
  ],
  "Trigonometriske relationer": [
    "Trigonometri kobler vinkler og sidelængder i trekanter.",
    "I materialet bruges relationerne blandt andet til at beregne sider, vinkler og areal.",
    "Vælg relation efter hvilke sider og vinkler der er kendt i opgaven.",
  ],
  Gaffelforskrift: [
    "En gaffelforskrift beskriver en funktion med forskellige forskrifter på forskellige intervaller.",
    "Når du skal beregne en funktionsværdi, vælger du først det interval, hvor x-værdien ligger.",
    "Endepunkter er vigtige, fordi åbne og lukkede intervaller afgør, hvilken forskrift der gælder.",
  ],
  "Afstandsformlen mellem to punkter": [
    "Afstandsformlen finder længden mellem to punkter ud fra deres koordinater.",
    "Ideen er Pythagoras: forskellen i x-retning og forskellen i y-retning danner kateterne i en retvinklet trekant.",
    "Den bruges typisk, når en afstand skal beregnes uden at kunne måles direkte på en tegning.",
  ],
  "Cirklens ligning": [
    "Cirklens ligning beskriver alle punkter, der ligger samme afstand fra centrum.",
    "Tallene a og b angiver centrum, mens r angiver radius.",
    "Man kan både bruge ligningen til at opstille en cirkel og til at teste, om et punkt ligger på den.",
  ],
  Monotonisætningen: [
    "Monotonisætningen forbinder fortegnet for den afledte med grafens udvikling.",
    "Hvis den afledte er positiv på et interval, vokser funktionen; hvis den er negativ, aftager funktionen.",
    "Sætningen gør det muligt at undersøge grafens form med beregning i stedet for kun aflæsning.",
  ],
  "Differentialkvotient og afledt": [
    "Den afledte beskriver, hvor hurtigt en funktion ændrer sig i et punkt.",
    "Grafisk svarer den afledte til hældningen på tangenten.",
    "Den bruges som grundværktøj i tangentopgaver, monotoni og optimering.",
  ],
  Monotonilinje: [
    "En monotonilinje samler fortegnet for den afledte i intervaller.",
    "Først finder man de steder, hvor den afledte er nul, og derefter undersøger man fortegnet mellem dem.",
    "På den måde kan man læse, hvor funktionen vokser, aftager og eventuelt har ekstremum.",
  ],
  "Optimering med volumenbetingelse": [
    "Ved optimering med en volumenbetingelse bruges den faste volumen til at fjerne en variabel.",
    "Derefter kan problemet beskrives med én funktion, som kan maksimeres eller minimeres.",
    "Husk at kontrollere, at de fundne værdier giver mening i situationen, fx at længder er positive.",
  ],
  Optimering: [
    "Optimering handler om at finde den største eller mindste værdi i en konkret situation.",
    "Først oversættes problemet til en funktion, og derefter undersøges funktionen med relevante metoder.",
    "Det afgørende er at forbinde beregningen med den størrelse, opgaven faktisk spørger efter.",
  ],
};

const BAD_FALLBACK_PROSE_PATTERNS = [
  /derfor har vi ikke foretaget os noget forbudt/i,
  /\bforetaget os noget forbudt\b/i,
  /\bvi har ikke foretaget os\b/i,
];

const SECTION_HEADING_RE = /##\s*(?:Matematik Fokusnote|Emneoversigt|Nøgleformler|Vidensblokke)\b/i;
const BLOCK_HEADING_RE = /(?:^|\s)#{3,4}\s+/;
const BLOCK_META_RE = /(?:^|\s)_(?:Metode|Regel|Begreb|Faldgrube|Eksempel)\b/i;
const RAW_MARKDOWN_FRAGMENT_RE = /(?:\*\*Formel:\*\*|(?:^|\s)---(?:\s|$)|#{2,6}\s+|(?:^|\s)>\s*)/i;
const FIELD_LABEL_LEAK_RE = /\b(?:Bruges til|Eksempel|Pas på|Notation|Det vil sige)\b.*(?:###|####|---|##\s*(?:Nøgleformler|Vidensblokke))/i;

function cleanText(value: string | null | undefined) {
  return String(value ?? "")
    .replace(/\$\$/g, "")
    .replace(/\$/g, "")
    .replace(/\\begin\{(?:aligned|cases|array|matrix)\}/gi, "")
    .replace(/\\end\{(?:aligned|cases|array|matrix)\}/gi, "")
    .replace(/\s+/g, " ")
    .trim();
}

function cleanMarkdownText(value: string | null | undefined) {
  return cleanText(value)
    .replace(/^#{1,6}\s+/g, "")
    .replace(/^\s*-{3,}\s*$/g, "")
    .replace(/\*\*/g, "")
    .replace(/^\s*_[^_]{1,80}_\s*$/g, "")
    .trim();
}

function hasBadFallbackProse(value: string | null | undefined) {
  const text = cleanText(value);
  return BAD_FALLBACK_PROSE_PATTERNS.some((pattern) => pattern.test(text));
}

function safeTrimAtWordBoundary(value: string, maxLength: number) {
  if (value.length <= maxLength) return value;
  return value.slice(0, maxLength).replace(/\s+\S*$/, "").trim();
}

function fieldBoundaryReasons(value: string | null | undefined) {
  const raw = String(value ?? "");
  const reasons: string[] = [];
  const headingMatches = raw.match(/#{2,6}\s+/g) ?? [];
  const separatorMatches = raw.match(/(?:^|\s)---(?:\s|$)/g) ?? [];
  const newlineCount = (raw.match(/\n/g) ?? []).length;

  if (SECTION_HEADING_RE.test(raw)) reasons.push("section_heading_fragment");
  if (BLOCK_HEADING_RE.test(raw)) reasons.push("block_heading_fragment");
  if (BLOCK_META_RE.test(raw)) reasons.push("block_meta_fragment");
  if (/\*\*Formel:\*\*/i.test(raw)) reasons.push("formula_label_fragment");
  if (/(?:^|\n)\s*>/.test(raw)) reasons.push("blockquote_fragment");
  if (headingMatches.length > 1) reasons.push("multiple_markdown_headings");
  if (separatorMatches.length > 0) reasons.push("block_separator_fragment");
  if (FIELD_LABEL_LEAK_RE.test(raw)) reasons.push("cross_block_label_fragment");
  if (newlineCount >= 3 && RAW_MARKDOWN_FRAGMENT_RE.test(raw)) reasons.push("long_markdown_fragment");
  return Array.from(new Set(reasons));
}

function countFormulaProseWords(value: string) {
  return (value.match(/[A-Za-zÆØÅæøå]{4,}/g) ?? []).filter(
    (word) => !/^(sqrt|sin|cos|tan|frac|cdot|approx|ge|le|ne)$/i.test(word),
  ).length;
}

function formulaFieldReasons(value: string | null | undefined) {
  const raw = String(value ?? "").trim();
  if (!raw) return [];
  const reasons = [...fieldBoundaryReasons(raw)];
  if (/\b(?:Bruges til|Eksempel|Pas på|Notation|Det vil sige)\b/i.test(raw)) reasons.push("formula_contains_prose_label");
  if (/[;:!?]/.test(raw)) reasons.push("formula_contains_sentence_punctuation");
  if (countFormulaProseWords(raw) > 0) reasons.push("formula_contains_long_words");
  if ((raw.match(/(?:=|≈|≤|≥|<|>|\\ne)/g) ?? []).length > 3) reasons.push("too_many_formula_relations");
  return Array.from(new Set(reasons));
}

function previewField(value: string | null | undefined, length = 160) {
  return String(value ?? "")
    .replace(/\r\n/g, "\n")
    .replace(/\n/g, "\\n")
    .slice(0, length);
}

function markdownControlHits(value: string | null | undefined) {
  const raw = String(value ?? "");
  const hits: string[] = [];
  if (/(?:^|\n)\s*#{2,6}\s+/.test(raw) || /##\s*Vidensblokke/i.test(raw)) hits.push("heading");
  if (/(?:^|\n)\s*---\s*(?:\n|$)/.test(raw) || /(?:^|\s)---(?:\s|$)/.test(raw)) hits.push("separator");
  if (/\*\*Formel:\*\*/i.test(raw)) hits.push("formula_label");
  if (/_\s*(?:Metode|Regel|Begreb|Faldgrube|Eksempel)\s*·/i.test(raw)) hits.push("block_meta");
  if (/(?:^|\n)\s*>/.test(raw)) hits.push("blockquote");
  if (/\n{2,}/.test(raw)) hits.push("multi_paragraph");
  if (/\*\*/.test(raw)) hits.push("bold_marker");
  if (/\\begin\{/i.test(raw)) hits.push("latex_environment");
  if (/[<>]\s*$/.test(raw)) hits.push("trailing_angle_bracket");
  if (/=\s*0\d+\b/.test(raw)) hits.push("ocr_zero_digit");
  if (/\bmedf\b/i.test(raw)) hits.push("ocr_glued_medf");
  return hits;
}

function stripMarkdownControls(value: string | null | undefined) {
  return cleanText(value)
    .replace(/##\s*Vidensblokke/gi, " ")
    .replace(/#{2,6}\s+/g, " ")
    .replace(/\*\*Formel:\*\*/gi, " ")
    .replace(/_\s*(?:Metode|Regel|Begreb|Faldgrube|Eksempel)\s*·[^_]{0,180}_/gi, " ")
    .replace(/(?:^|\s)---(?:\s|$)/g, " ")
    .replace(/(?:^|\n)\s*>\s*/g, " ")
    .replace(/\*\*/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function plainChildField(
  value: string | null | undefined,
  debug: AssemblyDebug,
  context: string,
  options: {
    maxLength?: number;
    required?: boolean;
    rejectOnUnsafe?: boolean;
    bucket?: "featured" | "block";
  } = {},
) {
  const raw = String(value ?? "").trim();
  if (!raw) return null;
  if (hasBadFallbackProse(raw)) {
    if (options.bucket === "featured") {
      debug.suppressedFeaturedFormulas.push(`${context}: removed_bad_fallback_prose raw="${previewField(raw)}"`);
      return null;
    }
    debug.skippedBlocks.push(`${context}: removed_bad_fallback_prose raw="${previewField(raw)}"`);
    return null;
  }
  const boundaryReasons = fieldBoundaryReasons(raw);
  if (boundaryReasons.length) {
    const line = `${context}: dropped_for_field_boundary reason=${boundaryReasons.join(",")} raw="${previewField(raw, 120)}"`;
    if (options.bucket === "featured") {
      debug.suppressedFeaturedFormulas.push(line);
      return null;
    }
    debug.droppedRenderedFields.push(line);
    return null;
  }

  const hits = markdownControlHits(raw);
  const cleaned = hits.length ? stripMarkdownControls(raw) : cleanMarkdownText(raw);
  const maxLength = options.maxLength ?? 260;
  const compact = safeTrimAtWordBoundary(cleaned, maxLength);
  const stillUnsafe = markdownControlHits(compact).length > 0;
  const cleanedBoundaryReasons = fieldBoundaryReasons(compact);

  if (hits.length) {
    const line = `${context}: hits=${hits.join(",")} raw="${previewField(raw)}" cleaned="${previewField(compact)}"`;
    if (options.bucket === "featured") {
      debug.suppressedFeaturedFormulas.push(line);
      return null;
    }
    if (options.rejectOnUnsafe || stillUnsafe || cleanedBoundaryReasons.length || !compact) {
      debug.skippedBlocks.push(line);
      return null;
    }
    debug.cleanedBlockFields.push(line);
  }

  if (cleanedBoundaryReasons.length) {
    const line = `${context}: dropped_after_cleaning reason=${cleanedBoundaryReasons.join(",")} raw="${previewField(raw, 120)}" cleaned="${previewField(compact, 120)}"`;
    if (options.bucket === "featured") {
      debug.suppressedFeaturedFormulas.push(line);
      return null;
    }
    debug.droppedRenderedFields.push(line);
    return null;
  }

  if (!compact && options.required) {
    if (options.bucket === "featured") debug.suppressedFeaturedFormulas.push(`${context}: empty_after_cleaning`);
    return null;
  }

  return compact;
}

function joinMarkdownBlocks(blocks: Array<string | null | undefined>) {
  return blocks
    .map((block) =>
      String(block ?? "")
        .replace(/\r\n/g, "\n")
        .split("\n")
        .map((line) => line.replace(/[ \t]+$/g, ""))
        .join("\n")
        .trim(),
    )
    .filter(Boolean)
    .join("\n\n")
    .replace(/\n{3,}/g, "\n\n");
}

function sanitizeFinalMarkdown(markdown: string) {
  return String(markdown ?? "")
    .replace(/\r\n/g, "\n")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/([^\n])\n(#{1,6}\s+)/g, "$1\n\n$2")
    .replace(/([^\n])\n(---)\n/g, "$1\n\n$2\n")
    .replace(/\n(---)([^\n])/g, "\n$1\n\n$2")
    .replace(/([^\n])\n(>\s)/g, "$1\n\n$2")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function markdownParagraph(value: string | null | undefined) {
  return cleanMarkdownText(value).replace(/\n+/g, " ").trim();
}

function sentence(value: string | null | undefined) {
  const cleaned = markdownParagraph(value).replace(/[.;,:]\s*$/, "").trim();
  if (!cleaned) return "";
  return /[.!?]$/.test(cleaned) ? cleaned : `${cleaned}.`;
}

function capitalize(value: string) {
  return value ? `${value.charAt(0).toUpperCase()}${value.slice(1)}` : "";
}

function teachingSentence(value: string | null | undefined) {
  const cleaned = sentence(value)
    .replace(/^Det betyder,\s+at\s+/i, "")
    .replace(/^Det bruges til\s+/i, "Bruges til ")
    .trim();
  return capitalize(cleaned);
}

function uniqueSentences(lines: Array<string | null | undefined>, limit = 4) {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const line of lines) {
    const cleaned = teachingSentence(line);
    const key = cleaned.toLowerCase();
    if (!cleaned || seen.has(key)) continue;
    seen.add(key);
    out.push(cleaned);
    if (out.length >= limit) break;
  }
  return out;
}

function uniqueMarkdownLines(lines: Array<string | null | undefined>) {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const line of lines) {
    const cleaned = String(line ?? "")
      .replace(/\r\n/g, "\n")
      .trim();
    const key = cleanText(cleaned).toLowerCase();
    if (!cleaned || seen.has(key)) continue;
    seen.add(key);
    out.push(cleaned);
  }
  return out;
}

function contentWords(value: string) {
  return cleanText(value)
    .toLowerCase()
    .split(/\s+/)
    .filter((word) => word.length >= 5 && !/^(dette|denne|disse|bruges|typisk|materialet|funktion|ligning)$/i.test(word));
}

function isNearDuplicateSentence(a: string, b: string) {
  const aWords = new Set(contentWords(a));
  const bWords = new Set(contentWords(b));
  if (aWords.size === 0 || bWords.size === 0) return false;
  const overlap = Array.from(aWords).filter((word) => bWords.has(word)).length;
  return overlap / Math.min(aWords.size, bWords.size) >= 0.5;
}

function sourceLabel(block: MathKnowledgeBlock) {
  if (block.sourceRefs.length) return block.sourceRefs.join(", ");
  return block.sourcePages.length ? `Side ${block.sourcePages.join(", ")}` : "Materialeuddrag";
}

function toMathFormula(value: string | null | undefined) {
  return cleanText(value)
    .replace(/’/g, "'")
    .replace(/±/g, "\\pm")
    .replace(/·/g, "\\cdot")
    .replace(/>=/g, "\\ge")
    .replace(/<=/g, "\\le")
    .replace(/≥/g, "\\ge")
    .replace(/≤/g, "\\le")
    .replace(/≈/g, "\\approx")
    .replace(/!=/g, "\\ne")
    .replace(/√\s*\(\(([^()]*)\)\^2\s*\+\s*\(([^()]*)\)\^2\)/g, "\\sqrt{($1)^2 + ($2)^2}")
    .replace(/√\s*\(([^()]+(?:\([^()]*\)[^()]*)*)\)/g, "\\sqrt{$1}")
    .replace(/√\s*([A-Za-z0-9_]+)/g, "\\sqrt{$1}")
    .replace(/\b([xy])([0-9])\b/g, "$1_$2")
    .replace(/\bsin\s*\(/g, "\\sin(")
    .replace(/\bcos\s*\(/g, "\\cos(")
    .replace(/\btan\s*\(/g, "\\tan(")
    .replace(/\(([^()]+)\)\s*\/\s*\(([^()]+)\)/g, "\\frac{$1}{$2}")
    .replace(/\b([A-Za-z][A-Za-z0-9_']*|\d+)\s*\/\s*([A-Za-z][A-Za-z0-9_]*(?:\^\d+)?|\d+)\b/g, "\\frac{$1}{$2}")
    .trim();
}

function balancedPairs(value: string, open: string, close: string) {
  return (value.match(new RegExp(`\\${open}`, "g")) ?? []).length === (value.match(new RegExp(`\\${close}`, "g")) ?? []).length;
}

function formulaCorruptionReason(value: string | null | undefined) {
  const raw = String(value ?? "").trim();
  if (!raw) return "empty_formula";
  if (/[\r\n]/.test(raw)) return "multiline_formula";
  if (/(?:^|\s)#{1,6}\s|(?:^|\s)---(?:\s|$)|\*\*|_Metode|_Regel|_Begreb|_Faldgrube/i.test(raw)) {
    return "markdown_leaked_into_formula";
  }
  if (formulaFieldReasons(raw).length) return formulaFieldReasons(raw)[0] ?? "formula_field_boundary";
  if (/[<>]\s*$/.test(raw)) return "trailing_angle_bracket";
  if (/[<>]\s*[A-Za-zÆØÅæøå]{2,}\b/.test(raw)) return "operator_text_corruption";
  if (/=\s*0\d+\b/.test(raw)) return "ocr_zero_digit_corruption";
  if (/\bmedf\b/i.test(raw)) return "ocr_glued_prose_fragment";
  if (/[=<>]\s*[-+]?\d+(?:[.,]\d+)?\s*[A-Za-zÆØÅæøå]{2,}\b/i.test(raw)) {
    return "formula_text_glued_to_rhs";
  }
  if (/\\begin|\\end|aligned|cases|array|matrix|\$\$/i.test(raw)) return "unsafe_math_environment";

  const formula = toMathFormula(raw);
  if (!formula) return "empty_formula_after_normalization";
  if (/[\r\n]|\$\$|\$|\*\*|#{1,6}\s|---|_Metode|_Regel|_Begreb/i.test(formula)) return "unsafe_formula_markdown";
  if (/[<>]\s*$/.test(formula)) return "trailing_angle_bracket";
  if (/[<>]\s*[A-Za-zÆØÅæøå]{2,}\b/.test(formula)) return "operator_text_corruption";
  if (/=\s*0\d+\b/.test(formula)) return "ocr_zero_digit_corruption";
  if (/\bmedf\b/i.test(formula)) return "ocr_glued_prose_fragment";
  if (/[=<>]\s*[-+]?\d+(?:[.,]\d+)?\s*[A-Za-zÆØÅæøå]{2,}\b/i.test(formula)) {
    return "formula_text_glued_to_rhs";
  }
  if (formulaFieldReasons(formula).length) return formulaFieldReasons(formula)[0] ?? "formula_field_boundary";
  if (!balancedPairs(formula, "(", ")")) return "unmatched_parentheses";
  if (!balancedPairs(formula, "{", "}")) return "unmatched_braces";
  if ((formula.match(/(?:=|≈|≤|≥|<|>|\\ne)/g) ?? []).length > 2) return "too_many_relations";
  if (formula.length > 160) return "formula_too_long";
  return null;
}

function safeMathFormula(
  value: string | null | undefined,
  debug: AssemblyDebug,
  context: string,
  requireDisplaySafe = false,
) {
  const reason = formulaCorruptionReason(value);
  if (reason === "empty_formula") return null;
  const formula = reason ? "" : toMathFormula(value);
  if (reason || !formula || (requireDisplaySafe && !isDisplaySafeFormula(formula))) {
    debug.suppressedFormulas.push(`${context}: ${reason ?? "not_display_safe"} (${cleanText(value).slice(0, 120) || "empty"})`);
    return null;
  }
  return formula;
}

function isDisplaySafeFormula(value: string | null | undefined) {
  const formula = toMathFormula(value);
  if (!formula || formula.length > 160) return false;
  if (/[\r\n]|\$\$|\$|\\begin|\\end|aligned|cases|array|matrix/i.test(formula)) return false;
  if ((formula.match(/[{}]/g) ?? []).length % 2 !== 0) return false;
  if ((formula.match(/(?:=|≈|≤|≥|<|>|\\ne)/g) ?? []).length > 3) return false;
  if (formulaFieldReasons(formula).length) return false;
  return /[=≈≤≥<>^_']|\\(?:sqrt|frac|pm|cdot|ne)|\b(?:sin|cos|tan)\b/i.test(formula);
}

function isStandaloneMathLikeFormula(value: string | null | undefined) {
  const formula = toMathFormula(value);
  if (!formula || formula.length > 160) return false;
  if (!/[=≈≤≥<>]/.test(formula)) return false;
  if (!/[A-Za-zÆØÅæøå]/.test(formula)) return false;
  if (formulaFieldReasons(formula).length) return false;
  if (formulaCorruptionReason(formula)) return false;
  return /[=≈≤≥<>^_']|\\(?:sqrt|frac|pm|cdot|ne)|\b(?:sin|cos|tan)\b/i.test(formula);
}

function logRawKnowledgeBlock(block: MathKnowledgeBlock, debug: AssemblyDebug) {
  debug.rawKnowledgeBlockFields.push(
    [
      `raw:${block.id}`,
      `title="${previewField(block.title)}"`,
      `kind=${block.kind}`,
      `topicGroup="${previewField(block.topicGroup)}"`,
      `centralFormula="${previewField(block.centralFormula)}"`,
      `notationExample="${previewField(block.notationExample)}"`,
      `shortExplanation="${previewField(block.shortExplanation)}"`,
      `whatItMeans="${previewField(block.whatItMeans)}"`,
      `howToUse="${previewField(block.howToUse)}"`,
      `shortExample="${previewField(block.shortExample)}"`,
      `pitfalls="${previewField(block.pitfalls?.join(" | "))}"`,
      `sourcePages=${block.sourcePages.join(",") || "none"}`,
      `dirty=${[
        ...markdownControlHits(block.title).map((hit) => `title:${hit}`),
        ...markdownControlHits(block.topicGroup).map((hit) => `topicGroup:${hit}`),
        ...markdownControlHits(block.centralFormula).map((hit) => `centralFormula:${hit}`),
        ...markdownControlHits(block.notationExample).map((hit) => `notationExample:${hit}`),
        ...markdownControlHits(block.shortExplanation).map((hit) => `shortExplanation:${hit}`),
        ...markdownControlHits(block.whatItMeans).map((hit) => `whatItMeans:${hit}`),
        ...markdownControlHits(block.howToUse).map((hit) => `howToUse:${hit}`),
        ...markdownControlHits(block.shortExample).map((hit) => `shortExample:${hit}`),
        ...(block.pitfalls ?? []).flatMap((pitfall, index) => markdownControlHits(pitfall).map((hit) => `pitfalls[${index}]:${hit}`)),
      ].join(",") || "none"}`,
    ].join(" | "),
  );
}

function sanitizePlainBlockField(
  value: string | null | undefined,
  debug: AssemblyDebug,
  context: string,
  options: { maxLength?: number; required?: boolean } = {},
) {
  const raw = String(value ?? "").trim();
  if (!raw) return null;
  if (hasBadFallbackProse(raw)) {
    debug.droppedKnowledgeBlockFields.push(`${context}: dropped_bad_fallback_prose raw="${previewField(raw)}"`);
    return null;
  }
  const boundaryReasons = fieldBoundaryReasons(raw);
  if (boundaryReasons.length) {
    debug.droppedKnowledgeBlockFields.push(
      `${context}: dropped_for_field_boundary reason=${boundaryReasons.join(",")} raw="${previewField(raw, 120)}"`,
    );
    return null;
  }

  const hits = markdownControlHits(raw);
  const cleaned = stripMarkdownControls(raw)
    .replace(/\bmedf\b/gi, "")
    .replace(/\s+/g, " ")
    .trim();
  const compact = safeTrimAtWordBoundary(cleaned, options.maxLength ?? 360);
  const remainingHits = markdownControlHits(compact);
  const cleanedBoundaryReasons = fieldBoundaryReasons(compact);

  if (hits.length || remainingHits.length || compact !== raw) {
    debug.droppedKnowledgeBlockFields.push(
      `${context}: cleaned hits=${[...hits, ...remainingHits].join(",") || "text_normalized"} raw="${previewField(raw)}" cleaned="${previewField(compact)}"`,
    );
  }

  if (!compact && options.required) return null;
  if (cleanedBoundaryReasons.length) {
    debug.droppedKnowledgeBlockFields.push(
      `${context}: dropped_after_cleaning reason=${cleanedBoundaryReasons.join(",")} raw="${previewField(raw, 120)}" cleaned="${previewField(compact, 120)}"`,
    );
    return null;
  }
  if (remainingHits.some((hit) => ["heading", "separator", "formula_label", "block_meta", "latex_environment"].includes(hit))) {
    debug.droppedKnowledgeBlockFields.push(`${context}: dropped_after_cleaning raw="${previewField(raw)}"`);
    return null;
  }
  return compact || null;
}

function sanitizeFormulaBlockField(
  value: string | null | undefined,
  debug: AssemblyDebug,
  context: string,
) {
  const raw = cleanText(value);
  if (!raw) return undefined;
  const fieldReasons = formulaFieldReasons(raw);
  const reason = formulaCorruptionReason(raw);
  if (fieldReasons.length || reason || !isStandaloneMathLikeFormula(raw)) {
    const dropReason = fieldReasons.join(",") || reason || "not_standalone_math_like";
    debug.droppedKnowledgeBlockFields.push(
      `${context}: formula dropped reason=${dropReason} raw="${previewField(raw, 120)}"`,
    );
    return undefined;
  }
  return raw;
}

function sanitizeMathKnowledgeBlock(block: MathKnowledgeBlock, debug: AssemblyDebug) {
  logRawKnowledgeBlock(block, debug);

  const title = sanitizePlainBlockField(block.title, debug, `${block.id}.title`, {
    maxLength: 80,
    required: true,
  });
  if (!title) {
    debug.droppedKnowledgeBlocks.push(`${block.id}: dropped because title was empty/unsafe`);
    return null;
  }

  const topicGroup =
    sanitizePlainBlockField(block.topicGroup, debug, `${block.id}.topicGroup`, { maxLength: 120 }) ?? "Centrale begreber";
  const shortExplanation = sanitizePlainBlockField(block.shortExplanation, debug, `${block.id}.shortExplanation`, {
    maxLength: 320,
    required: true,
  });
  if (!shortExplanation) {
    debug.droppedKnowledgeBlocks.push(`${block.id}: dropped because shortExplanation was empty/unsafe`);
    return null;
  }

  const centralFormula = sanitizeFormulaBlockField(block.centralFormula, debug, `${block.id}.centralFormula`);
  const notationExample = sanitizeFormulaBlockField(block.notationExample, debug, `${block.id}.notationExample`);
  const formulaMode: MathKnowledgeBlock["formulaMode"] = centralFormula ? "centralFormula" : notationExample ? "inline" : "none";
  const formulaConfidence = formulaMode === "none" ? 0 : block.formulaConfidence;
  const formulaDecision =
    formulaMode === block.formulaMode
      ? block.formulaDecision
      : `${block.formulaDecision} Assembly-sanitizer fjernede usikker eller beskidt formelnotation.`;
  const pitfalls = (block.pitfalls ?? [])
    .map((pitfall, index) =>
      sanitizePlainBlockField(pitfall, debug, `${block.id}.pitfalls[${index}]`, { maxLength: 180 }),
    )
    .filter((pitfall): pitfall is string => Boolean(pitfall));

  const cleaned: MathKnowledgeBlock = {
    ...block,
    title,
    topicGroup,
    shortExplanation,
    whatItMeans: sanitizePlainBlockField(block.whatItMeans, debug, `${block.id}.whatItMeans`, { maxLength: 220 }) ?? undefined,
    howToUse: sanitizePlainBlockField(block.howToUse, debug, `${block.id}.howToUse`, { maxLength: 220 }) ?? undefined,
    centralFormula,
    notationExample,
    formulaMode,
    formulaConfidence,
    formulaDecision,
    shortExample: sanitizePlainBlockField(block.shortExample, debug, `${block.id}.shortExample`, { maxLength: 220 }) ?? undefined,
    pitfalls: pitfalls.length ? pitfalls : undefined,
    sourceRefs: block.sourceRefs
      .map((ref, index) => sanitizePlainBlockField(ref, debug, `${block.id}.sourceRefs[${index}]`, { maxLength: 120 }))
      .filter((ref): ref is string => Boolean(ref)),
  };

  debug.sanitizedKnowledgeBlockFields.push(
    [
      `clean:${cleaned.id}`,
      `title="${previewField(cleaned.title)}"`,
      `kind=${cleaned.kind}`,
      `topicGroup="${previewField(cleaned.topicGroup)}"`,
      `centralFormula="${previewField(cleaned.centralFormula)}"`,
      `notationExample="${previewField(cleaned.notationExample)}"`,
      `shortExplanation="${previewField(cleaned.shortExplanation)}"`,
      `howToUse="${previewField(cleaned.howToUse)}"`,
      `shortExample="${previewField(cleaned.shortExample)}"`,
      `pitfalls="${previewField(cleaned.pitfalls?.join(" | "))}"`,
    ].join(" | "),
  );

  return cleaned;
}

function firstSourcePage(block: MathKnowledgeBlock) {
  return block.sourcePages.length ? Math.min(...block.sourcePages) : Number.MAX_SAFE_INTEGER;
}

function blockPriority(block: MathKnowledgeBlock) {
  const kindScore: Record<MathKnowledgeBlock["kind"], number> = {
    rule: 0,
    method: 1,
    concept: 2,
    example: 3,
    pitfall: 4,
  };
  return kindScore[block.kind] ?? 5;
}

function orderBlocksForReading(blocks: MathKnowledgeBlock[]) {
  return [...blocks].sort((a, b) => {
    const pageDelta = firstSourcePage(a) - firstSourcePage(b);
    if (pageDelta !== 0) return pageDelta;
    const groupDelta = cleanText(a.topicGroup).localeCompare(cleanText(b.topicGroup), "da");
    if (groupDelta !== 0) return groupDelta;
    const priorityDelta = blockPriority(a) - blockPriority(b);
    if (priorityDelta !== 0) return priorityDelta;
    return b.confidence - a.confidence;
  });
}

function formulaKey(value: string) {
  return toMathFormula(value).replace(/\s+/g, "").toLowerCase();
}

function formulaTitle(block: MathKnowledgeBlock) {
  return cleanText(block.title).replace(/\s*og betydning$/i, "");
}

function formulaExplanation(block: MathKnowledgeBlock) {
  const editorial = BLOCK_COPY[cleanText(block.title)]?.[0];
  if (editorial) return editorial;
  const use = teachingSentence(block.howToUse).replace(/^Bruges til\s+/i, "");
  if (use) return capitalize(use);
  return teachingSentence(block.shortExplanation);
}

function featuredFormulaFamily(block: MathKnowledgeBlock) {
  const title = cleanText(block.title).toLowerCase();
  if (/optimering med volumenbetingelse|volumenbetingelse|overfladeareal som funktion|førsteordensbetingelse/.test(title)) {
    return "optimization";
  }
  if (/diskriminant|løsningsformlen|standardform|toppunktsformlen/.test(title)) return "quadratic";
  if (/afstandsformlen|cirklens ligning/.test(title)) return title;
  if (/sinusrelation|cosinusrelation|arealformlen/.test(title)) return title;
  if (/tangentligningen/.test(title)) return "tangent";
  return title || block.topicGroup.toLowerCase();
}

function featuredFormulaPriority(block: MathKnowledgeBlock, formula: string) {
  const title = cleanText(block.title).toLowerCase();
  const key = formulaKey(formula);

  if (/løsningsformlen/.test(title)) return 1.6;
  if (/diskriminant og betydning|^diskriminant$/.test(title)) return 1.45;
  if (/arealformlen/.test(title) || /t=\\frac\{1\}\{2\}|t=1\/2/.test(key)) return 1.42;
  if (/afstandsformlen/.test(title)) return 1.3;
  if (/cirklens ligning/.test(title)) return 1.25;
  if (/sinusrelation/.test(title)) return 1.22;
  if (/cosinusrelation/.test(title)) return 1.2;
  if (/optimering med volumenbetingelse|volumenbetingelse|overfladeareal/.test(title)) return 1.02;
  if (/tangentligningen/.test(title)) return 1;
  if (/monotonisætningen|monotoniforhold|fortegn for den afledte/.test(title)) return 0.75;
  if (/toppunktsformlen/.test(title)) return 0.74;
  if (/standardform/.test(title)) return 0.62;
  if (/koefficienterne|intervaller|definitionsmængde/.test(title)) return 0.15;
  if (block.kind === "rule") return 0.45;
  if (block.kind === "method") return 0.3;
  return 0.1;
}

function selectFeaturedFormulas(blocks: MathKnowledgeBlock[], debug: AssemblyDebug, limit = 6): FeaturedFormula[] {
  const ranked = blocks
    .map((block) => {
      const central = cleanText(block.centralFormula);
      const notation = cleanText(block.notationExample);
      const formulaSource = central ? "centralFormula" : block.formulaConfidence >= 0.92 && notation ? "notationExample" : "none";
      const raw = central || (block.formulaConfidence >= 0.92 ? notation : "");
      const rawTitle = formulaTitle(block);
      const rawMeta = sourceLabel(block);
      const rawExplanation = formulaExplanation(block);
      const formulaIssue = formulaCorruptionReason(raw);
      const normalizedFormula = formulaIssue ? "" : toMathFormula(raw);
      const displaySafe = Boolean(normalizedFormula && isDisplaySafeFormula(normalizedFormula));
      const fieldHits = {
        title: markdownControlHits(rawTitle),
        meta: markdownControlHits(rawMeta),
        formula: markdownControlHits(raw),
        explanation: markdownControlHits(rawExplanation),
      };
      debug.featuredFormulaFields.push(
        [
          `featured-candidate:${block.id}`,
          `source=${formulaSource}`,
          `blockTitle="${previewField(block.title, 90)}"`,
          `titleHits=${fieldHits.title.join(",") || "none"}`,
          `metaHits=${fieldHits.meta.join(",") || "none"}`,
          `formulaHits=${fieldHits.formula.join(",") || "none"}`,
          `explanationHits=${fieldHits.explanation.join(",") || "none"}`,
          `formula="${previewField(raw)}"`,
          `explanation="${previewField(rawExplanation)}"`,
        ].join(" | "),
      );
      if (!raw) {
        debug.featuredFormulaCandidateDecisions.push(
          `featured-candidate:${block.id} rejected reason=no_formula source=${formulaSource} title="${previewField(block.title, 90)}" central="${previewField(block.centralFormula)}" notation="${previewField(block.notationExample)}" confidence=${block.formulaConfidence.toFixed(2)}`,
        );
        return null;
      }
      const formula = safeMathFormula(raw, debug, `featured:${block.title}`, true);
      if (!formula) {
        debug.featuredFormulaCandidateDecisions.push(
          `featured-candidate:${block.id} rejected reason=${formulaIssue ?? "not_display_safe"} source=${formulaSource} raw="${previewField(raw)}" normalized="${previewField(normalizedFormula)}" displaySafe=${displaySafe} sourceRefs="${previewField(sourceLabel(block))}"`,
        );
        debug.suppressedFeaturedFormulas.push(
          `featured:${block.id}:formula source=${formulaSource} reason=${formulaIssue ?? "not_display_safe"} raw="${previewField(raw)}"`,
        );
        return null;
      }
      if (block.formulaConfidence < 0.92) {
        debug.featuredFormulaCandidateDecisions.push(
          `featured-candidate:${block.id} rejected reason=low_formula_confidence source=${formulaSource} raw="${previewField(raw)}" normalized="${previewField(formula)}" confidence=${block.formulaConfidence.toFixed(2)}`,
        );
        return null;
      }
      if (block.formulaMode !== "centralFormula" && block.kind !== "rule" && block.kind !== "method") {
        debug.featuredFormulaCandidateDecisions.push(
          `featured-candidate:${block.id} rejected reason=not_featured_kind_or_mode source=${formulaSource} raw="${previewField(raw)}" normalized="${previewField(formula)}" mode=${block.formulaMode} kind=${block.kind}`,
        );
        return null;
      }

      const title = plainChildField(rawTitle, debug, `featured:${block.id}:title`, {
        maxLength: 80,
        required: true,
        rejectOnUnsafe: true,
        bucket: "featured",
      });
      const meta = plainChildField(rawMeta, debug, `featured:${block.id}:meta`, {
        maxLength: 120,
        required: true,
        rejectOnUnsafe: true,
        bucket: "featured",
      });
      const explanation = plainChildField(rawExplanation, debug, `featured:${block.id}:explanation`, {
        maxLength: 220,
        rejectOnUnsafe: true,
        bucket: "featured",
      });
      if (!title || !meta || (!explanation && markdownControlHits(rawExplanation).length > 0)) {
        debug.featuredFormulaCandidateDecisions.push(
          `featured-candidate:${block.id} rejected reason=unsafe_featured_text raw="${previewField(raw)}" title="${previewField(rawTitle)}" explanation="${previewField(rawExplanation)}"`,
        );
        return null;
      }

      const key = formulaKey(formula);
      if (!key) {
        debug.featuredFormulaCandidateDecisions.push(
          `featured-candidate:${block.id} rejected reason=empty_formula_key source=${formulaSource} raw="${previewField(raw)}" normalized="${previewField(formula)}"`,
        );
        return null;
      }
      const kindBoost = block.kind === "rule" ? 0.22 : block.kind === "method" ? 0.12 : 0.04;
      const centralBoost = block.formulaMode === "centralFormula" ? 0.2 : 0;
      const priorityBoost = featuredFormulaPriority(block, formula);
      const score = block.formulaConfidence + kindBoost + centralBoost + block.confidence / 10 + priorityBoost;
      debug.featuredFormulaCandidateDecisions.push(
        `featured-candidate:${block.id} accepted source=${formulaSource} title="${previewField(block.title, 90)}" raw="${previewField(raw)}" normalized="${previewField(formula)}" confidence=${block.formulaConfidence.toFixed(2)} priority=${priorityBoost.toFixed(2)} score=${score.toFixed(2)} sourceRefs="${previewField(sourceLabel(block))}"`,
      );

      return {
        block,
        title,
        meta,
        formula,
        explanation,
        key,
        score,
      };
    })
    .filter((item): item is FeaturedFormula => Boolean(item))
    .sort((a, b) => b.score - a.score || firstSourcePage(a.block) - firstSourcePage(b.block));

  const familyCounts = new Map<string, number>();
  const seenFormulaKeys = new Set<string>();
  const selected: FeaturedFormula[] = [];
  for (const item of ranked) {
    if (seenFormulaKeys.has(item.key)) {
      debug.featuredFormulaCandidateDecisions.push(
        `featured-candidate:${item.block.id} rejected reason=duplicate_formula_after_ranking raw="${previewField(item.formula)}"`,
      );
      continue;
    }
    const family = featuredFormulaFamily(item.block);
    const familyCap = family === "optimization" ? 1 : Number.POSITIVE_INFINITY;
    if ((familyCounts.get(family) ?? 0) >= familyCap) {
      debug.featuredFormulaCandidateDecisions.push(
        `featured-candidate:${item.block.id} rejected reason=family_cap family=${family} raw="${previewField(item.formula)}"`,
      );
      continue;
    }
    seenFormulaKeys.add(item.key);
    familyCounts.set(family, (familyCounts.get(family) ?? 0) + 1);
    selected.push(item);
    if (selected.length >= limit) break;
  }

  selected.sort((a, b) => firstSourcePage(a.block) - firstSourcePage(b.block));
  debug.selectedFeaturedFormulas = selected.map(
    (item) =>
      `featured-winner:${item.block.id} | title="${previewField(item.title, 90)}" | formula="${previewField(item.formula)}" | score=${item.score.toFixed(2)} | meta="${previewField(item.meta)}"`,
  );
  return selected;
}

function lowercaseFirst(value: string) {
  return value ? `${value.charAt(0).toLowerCase()}${value.slice(1)}` : "";
}

function blockExplanation(block: MathKnowledgeBlock) {
  const lines = uniqueSentences([block.shortExplanation], 1);
  return lines[0] ?? teachingSentence(block.shortExplanation || block.whatItMeans);
}

function blockMeaningText(block: MathKnowledgeBlock) {
  const meaning = teachingSentence(block.whatItMeans)
    .replace(/^Det betyder,\s+at\s+/i, "")
    .replace(/^Det vil sige,\s+at\s+/i, "")
    .replace(/^Det vil sige\s+/i, "")
    .trim();
  if (!meaning) return null;
  if (isNearDuplicateSentence(block.shortExplanation, meaning)) return null;
  return meaning;
}

function blockUsageText(block: MathKnowledgeBlock) {
  const use = teachingSentence(block.howToUse).replace(/^Bruges til\s+/i, "").trim();
  if (!use) return null;
  if (isNearDuplicateSentence(block.shortExplanation, use) || isNearDuplicateSentence(block.whatItMeans ?? "", use)) return null;
  return use;
}

function blockPitfallText(block: MathKnowledgeBlock) {
  const pitfall = sentence(block.pitfalls?.[0]);
  if (!pitfall) return null;
  if (hasBadFallbackProse(pitfall)) return null;
  if (!/^(?:Pas på|Husk|Tjek|Vær opmærksom|Vaer opmaerksom|Undgå|Undgaa|Brug)\b/i.test(pitfall)) {
    return null;
  }
  return pitfall;
}

function blockNotationLatex(block: MathKnowledgeBlock, debug: AssemblyDebug, boxedFormula: string | null) {
  const rawFormula = cleanText(block.notationExample) || (block.kind === "example" ? cleanText(block.centralFormula) : "");
  if (!rawFormula) return null;
  if (boxedFormula && formulaKey(rawFormula) === formulaKey(boxedFormula)) return null;
  return safeMathFormula(rawFormula, debug, `block:${block.title}:notationLatex`);
}

function blockExampleField(block: MathKnowledgeBlock, debug: AssemblyDebug, boxedFormula: string | null) {
  const example = sentence(block.shortExample);
  if (example) {
    return {
      text: example,
      latex: null,
    };
  }

  const rawFormula = cleanText(block.notationExample) || cleanText(block.centralFormula);
  if (!rawFormula || (boxedFormula && formulaKey(rawFormula) === formulaKey(boxedFormula))) {
    return {
      text: null,
      latex: null,
    };
  }
  return {
    text: null,
    latex: safeMathFormula(rawFormula, debug, `block:${block.title}:exampleLatex`),
  };
}

function blockFormulaBox(block: MathKnowledgeBlock, debug: AssemblyDebug) {
  const decision = selectMathFormulaBox({
    title: block.title,
    kind: block.kind,
    formulaMode: block.formulaMode,
    formulaConfidence: block.formulaConfidence,
    centralFormula: block.centralFormula,
    notationExample: block.notationExample,
  });
  if (!decision.shouldRender || !decision.formula) {
    return {
      markdown: null,
      formula: null,
      inputFormula: decision.formula ?? null,
      source: decision.source,
      reason: decision.reason,
    };
  }

  const formula = safeMathFormula(decision.formula, debug, `block:${block.title}:formulaBox`, true);
  if (!formula) {
    return {
      markdown: null,
      formula: null,
      inputFormula: decision.formula,
      source: decision.source,
      reason: `${decision.reason} Assembly kunne ikke gøre formlen display-sikker.`,
    };
  }

  return {
    markdown: ["> **Formel**", `> $$${formula}$$`].join("\n"),
    formula,
    inputFormula: decision.formula,
    source: decision.source,
    reason: decision.reason,
  };
}

function renderInlineLatexLine(label: string, latex: string | null | undefined) {
  return latex ? `${label}: $${latex}$` : null;
}

function renderStructuredBlockToMarkdown(block: MathRenderedNoteBlock) {
  const meta = [KIND_LABELS[block.kind], block.topicGroup].filter(Boolean).join(" · ");
  const bodyByKind: Record<MathRenderedNoteBlock["kind"], Array<string | null | undefined>> = {
    rule: [
      block.explanation,
      block.formulaLatex ? ["> **Formel**", `> $$${block.formulaLatex}$$`].join("\n") : null,
      block.usageText ? `Bruges til: ${lowercaseFirst(block.usageText)}` : null,
      block.meaningText ? `Det vil sige: ${lowercaseFirst(block.meaningText)}` : null,
      block.warningText ? `Pas på: ${block.warningText}` : null,
    ],
    method: [
      block.explanation,
      block.formulaLatex ? ["> **Formel**", `> $$${block.formulaLatex}$$`].join("\n") : null,
      block.steps?.length ? block.steps.map((step) => `- ${step}`).join("\n") : null,
      block.usageText ? `Bruges til: ${lowercaseFirst(block.usageText)}` : null,
      block.warningText ? `Pas på: ${block.warningText}` : null,
    ],
    concept: [
      block.explanation,
      block.formulaLatex ? ["> **Formel**", `> $$${block.formulaLatex}$$`].join("\n") : null,
      block.meaningText ? `Det vil sige: ${lowercaseFirst(block.meaningText)}` : null,
      renderInlineLatexLine("Notation", block.notationLatex),
      block.exampleText ? `Eksempel: ${block.exampleText}` : renderInlineLatexLine("Eksempel", block.exampleLatex),
    ],
    example: [
      block.explanation,
      block.exampleText ? `Eksempel: ${block.exampleText}` : renderInlineLatexLine("Eksempel", block.exampleLatex ?? block.notationLatex),
    ],
    pitfall: [
      block.explanation,
      block.warningText ? `Pas på: ${block.warningText}` : block.meaningText,
    ],
  };

  return joinMarkdownBlocks([
    `### ${block.title}`,
    `_${[meta, block.sourceLabel].filter(Boolean).join(" · ")}_`,
    joinMarkdownBlocks(uniqueMarkdownLines(bodyByKind[block.kind])),
  ]);
}

function buildRenderedKnowledgeBlock(block: MathKnowledgeBlock, debug: AssemblyDebug): MathRenderedNoteBlock | null {
  debug.blockFieldFindings.push(
    [
      `block:${block.id}`,
      `titleHits=${markdownControlHits(block.title).join(",") || "none"}`,
      `topicHits=${markdownControlHits(block.topicGroup).join(",") || "none"}`,
      `shortHits=${markdownControlHits(block.shortExplanation).join(",") || "none"}`,
      `useHits=${markdownControlHits(block.howToUse).join(",") || "none"}`,
      `exampleHits=${markdownControlHits(block.shortExample).join(",") || "none"}`,
      `centralHits=${markdownControlHits(block.centralFormula).join(",") || "none"}`,
      `notationHits=${markdownControlHits(block.notationExample).join(",") || "none"}`,
      `title="${previewField(block.title, 90)}"`,
    ].join(" | "),
  );

  const title = plainChildField(block.title, debug, `block:${block.id}:title`, {
    maxLength: 80,
    required: true,
    rejectOnUnsafe: true,
  });
  if (!title) {
    debug.skippedBlocks.push(`block:${block.id}:title rejected raw="${previewField(block.title)}"`);
    return null;
  }

  const topic = plainChildField(block.topicGroup, debug, `block:${block.id}:${title}:topicGroup`, { maxLength: 120 });
  const source = plainChildField(sourceLabel(block), debug, `block:${block.id}:${title}:sourceLabel`, { maxLength: 120 });
  const explanation = plainChildField(blockExplanation(block), debug, `block:${block.id}:${title}:explanation`, { maxLength: 320 });
  const meaning = plainChildField(blockMeaningText(block), debug, `block:${block.id}:${title}:meaning`, { maxLength: 220 });
  const usage = plainChildField(blockUsageText(block), debug, `block:${block.id}:${title}:usage`, { maxLength: 220 });
  const formulaBox = blockFormulaBox(block, debug);
  const miniSteps = (block.teachingSteps ?? [])
    .map((step, index) => plainChildField(sentence(step), debug, `block:${block.id}:${title}:miniStep[${index}]`, { maxLength: 140 }))
    .filter((step): step is string => Boolean(step));
  const notationLatex = blockNotationLatex(block, debug, formulaBox.formula);
  const example = blockExampleField(block, debug, formulaBox.formula);
  const warning = plainChildField(blockPitfallText(block), debug, `block:${block.id}:${title}:warning`, { maxLength: 180 });

  const fallbackByKind: Record<MathKnowledgeBlock["kind"], Array<string | null | undefined>> = {
    rule: [explanation, usage, meaning, warning, formulaBox.formula],
    method: [explanation, usage, warning, miniSteps.join(" ") || null, formulaBox.formula],
    concept: [explanation, meaning, notationLatex, example.text, example.latex],
    example: [explanation, example.text, example.latex, notationLatex],
    pitfall: [explanation, warning, meaning],
  };
  if (!uniqueMarkdownLines(fallbackByKind[block.kind]).length) {
    debug.skippedBlocks.push(`block:${block.id}:empty body after markdown-field guards`);
    return null;
  }

  const renderedBlock: MathRenderedNoteBlock = {
    id: block.id,
    title,
    kind: block.kind,
    topicGroup: topic ?? undefined,
    sourceLabel: source ?? undefined,
    explanation: explanation ?? undefined,
    formulaLatex: formulaBox.formula ?? undefined,
    notationLatex: notationLatex ?? undefined,
    usageText: usage ?? undefined,
    meaningText: meaning ?? undefined,
    warningText: warning ?? undefined,
    exampleText: example.text ?? undefined,
    exampleLatex: example.latex ?? undefined,
    steps: miniSteps.length ? miniSteps : undefined,
  };
  debug.renderedBlockFormulaAudit.push({
    blockId: block.id,
    title,
    kind: block.kind,
    selectedFormula: cleanText(block.centralFormula) || cleanText(block.notationExample) || undefined,
    selectedFormulaSource: block.centralFormula ? "centralFormula" : block.notationExample ? "notationExample" : "none",
    promotionReason: block.formulaDecision,
    candidateFormulas: block.formulaCandidates.map(
      (item) =>
        `${cleanText(item.formula)} [${item.decision}/conf=${item.confidence.toFixed(2)}/sem=${item.semanticScore}/corr=${item.corruptionScore}/${item.reason}]`,
    ),
    rejectedFormulas: block.formulaRejectedCandidates.map(
      (item) => `${cleanText(item.formula)} [sem=${item.semanticScore}/corr=${item.corruptionScore}/${item.reason}]`,
    ),
    centralFormula: cleanText(block.centralFormula) || undefined,
    notationExample: cleanText(block.notationExample) || undefined,
    formulaBoxInput: cleanText(formulaBox.inputFormula) || undefined,
    formulaBoxSource: formulaBox.source,
    formulaBoxLatex: formulaBox.formula ?? undefined,
    formulaBoxRendered: Boolean(formulaBox.formula),
    formulaBoxReason: formulaBox.reason,
    notationLatex: notationLatex ?? undefined,
    exampleLatex: example.latex ?? undefined,
    exampleText: example.text ?? undefined,
    uiFormulaRendered: Boolean(formulaBox.formula || notationLatex || example.latex),
  });
  const rendered = renderStructuredBlockToMarkdown(renderedBlock);
  debug.renderedBlockDecisions.push(
    [
      `rendered:${block.id}`,
      `kind=${block.kind}`,
      `title="${previewField(title, 90)}"`,
      `formulaBox=${formulaBox.formula ? "yes" : "no"}`,
      `formulaSource=${formulaBox.source}`,
      `formula="${previewField(formulaBox.formula)}"`,
      `formulaReason="${previewField(formulaBox.reason, 180)}"`,
      `miniSteps=${miniSteps.length ? "yes" : "no"}`,
      `preview="${previewField(rendered, 320)}"`,
    ].join(" | "),
  );
  return renderedBlock;
}

function topicSummaries(blocks: MathKnowledgeBlock[], limit = 5) {
  const groups = new Map<string, MathKnowledgeBlock[]>();
  for (const block of blocks) {
    const group = stripMarkdownControls(block.topicGroup) || "Centrale begreber";
    groups.set(group, [...(groups.get(group) ?? []), block]);
  }

  return Array.from(groups.entries())
    .map(([group, groupBlocks]) => ({
      group,
      blocks: groupBlocks,
      firstPage: Math.min(...groupBlocks.map(firstSourcePage)),
      confidence: groupBlocks.reduce((sum, block) => sum + block.confidence, 0) / groupBlocks.length,
    }))
    .sort((a, b) => a.firstPage - b.firstPage || b.confidence - a.confidence)
    .slice(0, limit);
}

function buildIntroParagraphs(blocks: MathKnowledgeBlock[], fileName?: string) {
  if (blocks.length === 0) {
    return ["Der blev ikke fundet nok sikre matematiske vidensblokke i materialet."];
  }

  const fileText = fileName ? ` fra ${cleanText(fileName)}` : "";
  const groups = topicSummaries(blocks, 4).map((item) => item.group.toLowerCase());
  const primary = groups.slice(0, 3).join(", ");
  const hasDifferential = groups.includes("differentialregning");
  const hasGeometry = groups.includes("analytisk geometri");
  const secondLine =
    hasDifferential || hasGeometry
      ? "Fokus er på at genkende de centrale formler, forstå hvad symbolerne betyder og bruge dem i opgaver."
      : "Fokus er på at koble begreber, formler og metodevalg, så stoffet bliver lettere at bruge i opgaver.";

  return [
    `Materialet${fileText} dækker centrale matematiske emner fra det valgte materiale, især ${primary || "de vigtigste begreber og metoder"}.`,
    secondLine,
    "Formlerne er samlet tidligt på siden, og bagefter gennemgås stoffet i korte vidensblokke.",
  ];
}

function buildOverviewItems(blocks: MathKnowledgeBlock[]) {
  const topics = topicSummaries(blocks, 7);
  if (!topics.length) return [];

  return topics.map(({ group, blocks: groupBlocks }) => {
    const overview = TOPIC_OVERVIEW_COPY[group];
    if (overview) {
      return {
        topic: group,
        summary: overview,
      };
    }

    const concepts = groupBlocks
      .slice(0, 2)
      .map((block) => cleanText(block.title).toLowerCase())
      .join(" og ");
    return {
      topic: group,
      summary: `centrale begreber og metoder omkring ${concepts}.`,
    };
  });
}

function renderFeaturedFormula(item: FeaturedFormula) {
  return joinMarkdownBlocks([
    `**${item.title}** · ${item.meta}`,
    ["$$", item.formula, "$$"].join("\n"),
    item.explanation ? sentence(item.explanation) : null,
  ]);
}

function buildFeaturedFormulaSection(formulas: FeaturedFormula[]) {
  if (!formulas.length) return null;
  return joinMarkdownBlocks(["## Nøgleformler", ...formulas.map(renderFeaturedFormula)]);
}

function toRenderedNoteFormula(item: FeaturedFormula): MathRenderedNoteFormula {
  return {
    title: item.title,
    formulaLatex: item.formula,
    sourceLabel: item.meta,
    explanation: item.explanation ? sentence(item.explanation) : undefined,
  };
}

function renderMathRenderedNoteToMarkdown(note: MathRenderedNote) {
  const knowledgeBlocks =
    note.blocks.length > 0
      ? note.blocks.flatMap((block, index) => {
          const rendered = renderStructuredBlockToMarkdown(block);
          return index === 0 ? [rendered] : ["---", rendered];
        })
      : ["### Ingen sikre vidensblokke", "Materialet gav ikke nok renset matematikindhold til selvstændige blokke."];

  const keyFormulaSection = note.keyFormulas.length
    ? joinMarkdownBlocks([
        "## Nøgleformler",
        ...note.keyFormulas.map((formula) =>
          joinMarkdownBlocks([
            `**${formula.title}**${formula.sourceLabel ? ` · ${formula.sourceLabel}` : ""}`,
            ["$$", formula.formulaLatex, "$$"].join("\n"),
            formula.explanation ?? null,
          ]),
        ),
      ])
    : null;

  return sanitizeFinalMarkdown(
    joinMarkdownBlocks([
      "## Matematik Fokusnote",
      joinMarkdownBlocks(note.intro.paragraphs),
      note.overview.length
        ? joinMarkdownBlocks([
            "## Emneoversigt",
            note.overview.map((item) => `- **${item.topic}:** ${item.summary}`).join("\n"),
          ])
        : null,
      keyFormulaSection,
      "## Vidensblokke",
      ...knowledgeBlocks,
    ]),
  );
}

export function buildMathFocusNoteArtifactsFromBlocks(args: MathFocusAssemblyInput): MathFocusNoteAssemblyResult {
  const debug: AssemblyDebug = {
    rawKnowledgeBlockFields: [],
    sanitizedKnowledgeBlockFields: [],
    droppedKnowledgeBlockFields: [],
    droppedRenderedFields: [],
    droppedKnowledgeBlocks: [],
    sanitizedBlockCount: 0,
    markdownBlocks: [],
    suppressedFormulas: [],
    featuredFormulaFields: [],
    featuredFormulaCandidateDecisions: [],
    selectedFeaturedFormulas: [],
    suppressedFeaturedFormulas: [],
    featuredFormulaMarkdownBlock: "",
    blockFieldFindings: [],
    cleanedBlockFields: [],
    skippedBlocks: [],
    renderedBlockDecisions: [],
    renderedBlockFormulaAudit: [],
    transitionPreview: "",
    finalMarkdownPreview: "",
  };
  const sanitizedBlocks = args.blocks
    .map((block) => sanitizeMathKnowledgeBlock(block, debug))
    .filter((block): block is MathKnowledgeBlock => Boolean(block));
  debug.sanitizedBlockCount = sanitizedBlocks.length;

  const blocks = orderBlocksForReading(sanitizedBlocks).filter(
    (block) => cleanText(block.title) && block.confidence >= 0.45,
  );
  const visibleLimit = Math.min(blocks.length, Math.max(args.limit ?? 20, 28));
  const visibleBlocks = blocks.slice(0, visibleLimit);
  const featuredFormulas = selectFeaturedFormulas(blocks, debug);
  const renderedBlocks = visibleBlocks
    .map((block) => buildRenderedKnowledgeBlock(block, debug))
    .filter((block): block is MathRenderedNoteBlock => Boolean(block));

  const renderedNote: MathRenderedNote = {
    kind: "math_focus_note",
    title: "Matematik Fokusnote",
    fileName: cleanText(args.fileName) || "Ukendt fil",
    folderName: args.folderName ?? null,
    intro: {
      paragraphs: buildIntroParagraphs(visibleBlocks, args.fileName),
    },
    overview: buildOverviewItems(visibleBlocks),
    keyFormulas: featuredFormulas.map(toRenderedNoteFormula),
    blocks: renderedBlocks,
  };

  const finalMarkdown = renderMathRenderedNoteToMarkdown(renderedNote);
  const featuredFormulaMarkdownBlock = buildFeaturedFormulaSection(featuredFormulas);
  debug.featuredFormulaMarkdownBlock = featuredFormulaMarkdownBlock ?? "";
  debug.markdownBlocks = finalMarkdown
    .split(/\n(?=##\s)/)
    .map((block) => block.trim())
    .filter(Boolean);
  const transitionIndex = finalMarkdown.indexOf("## Nøgleformler");
  debug.transitionPreview =
    transitionIndex >= 0
      ? finalMarkdown.slice(transitionIndex, Math.min(finalMarkdown.length, transitionIndex + 1800))
      : finalMarkdown.slice(0, 1800);
  debug.finalMarkdownPreview = finalMarkdown;
  lastAssemblyDebug = debug;

  if (process.env.NOTELY_DEBUG_MATH_NOTES === "1") {
    console.info("[notes/math-focus-assembly]", {
      markdownBlocks: debug.markdownBlocks,
      rawKnowledgeBlockFields: debug.rawKnowledgeBlockFields,
      sanitizedKnowledgeBlockFields: debug.sanitizedKnowledgeBlockFields,
      droppedKnowledgeBlockFields: debug.droppedKnowledgeBlockFields,
      droppedRenderedFields: debug.droppedRenderedFields,
      droppedKnowledgeBlocks: debug.droppedKnowledgeBlocks,
      sanitizedBlockCount: debug.sanitizedBlockCount,
      suppressedFormulas: debug.suppressedFormulas,
      featuredFormulaFields: debug.featuredFormulaFields,
      featuredFormulaCandidateDecisions: debug.featuredFormulaCandidateDecisions,
      selectedFeaturedFormulas: debug.selectedFeaturedFormulas,
      suppressedFeaturedFormulas: debug.suppressedFeaturedFormulas,
      featuredFormulaMarkdownBlock: debug.featuredFormulaMarkdownBlock,
      blockFieldFindings: debug.blockFieldFindings,
      cleanedBlockFields: debug.cleanedBlockFields,
      skippedBlocks: debug.skippedBlocks,
      renderedBlockDecisions: debug.renderedBlockDecisions,
      renderedBlockFormulaAudit: debug.renderedBlockFormulaAudit,
      transitionPreview: debug.transitionPreview,
      finalMarkdownPreview: debug.finalMarkdownPreview.slice(0, 4000),
      renderedNoteSummary: {
        keyFormulas: renderedNote.keyFormulas.length,
        blocks: renderedNote.blocks.length,
        blockKinds: Array.from(new Set(renderedNote.blocks.map((block) => block.kind))),
      },
    });
  }

  return {
    renderedNote,
    markdown: finalMarkdown,
  };
}

export function buildMathFocusNoteFromBlocks(args: MathFocusAssemblyInput) {
  return buildMathFocusNoteArtifactsFromBlocks(args).markdown;
}

export function getLastMathFocusNoteAssemblyDebug() {
  return lastAssemblyDebug;
}
