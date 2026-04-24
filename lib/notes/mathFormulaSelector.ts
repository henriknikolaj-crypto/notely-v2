import { trimMathSentenceEnding } from "@/lib/notes/mathCandidatePieces";
import type { MathRecognizedConcept } from "@/lib/notes/mathConceptRecognizer";

export type MathFormulaMode = "centralFormula" | "inline" | "none";

export type MathFormulaCandidateTrace = {
  formula: string;
  sourceKind: string;
  sourceRef?: string;
  confidence: number;
  semanticScore: number;
  corruptionScore: number;
  decision: "accepted" | "rejected";
  reason: string;
};

export type MathFormulaSelection = {
  mode: MathFormulaMode;
  centralFormula?: string;
  inlineFormula?: string;
  confidence: number;
  reason: string;
  candidates: MathFormulaCandidateTrace[];
  rejectedCandidates: MathFormulaCandidateTrace[];
  winningCandidate?: MathFormulaCandidateTrace;
};

type FormulaBoxKind = "concept" | "rule" | "method" | "example" | "pitfall";

export type MathFormulaBoxSelection = {
  shouldRender: boolean;
  formula?: string;
  source: "centralFormula" | "notationExample" | "none";
  reason: string;
};

type FormulaImportance = "core" | "supporting";

type FormulaProfile = {
  title: RegExp;
  centralPatterns: RegExp[];
  notationPatterns?: RegExp[];
  importance: FormulaImportance;
  minCentralConfidence?: number;
  minInlineConfidence?: number;
  requireContext?: RegExp;
  rejectPatterns?: RegExp[];
  allowGenericNotation?: boolean;
};

type FormulaBoxProfile = {
  title: RegExp;
  formulaPatterns: RegExp[];
  allowKinds?: FormulaBoxKind[];
  minCentralConfidence?: number;
  minInlineConfidence?: number;
};

type RawFormulaCandidate = {
  formula: string;
  sourceKind: string;
  sourceRef?: string;
  sourceText: string;
};

const CENTRAL_CONFIDENCE_THRESHOLD = 0.82;
const INLINE_CONFIDENCE_THRESHOLD = 0.62;

const FORMULA_BOX_PROFILES: FormulaBoxProfile[] = [
  {
    title: /standardform.*andengrad/i,
    formulaPatterns: [/f\(x\)\s*=\s*a\s*x\^?2\s*\+\s*b\s*x\s*\+\s*c/i, /a\s*x\^?2\s*\+\s*b\s*x\s*\+\s*c\s*=\s*0/i],
    allowKinds: ["rule"],
    minCentralConfidence: 0.86,
  },
  {
    title: /løsningsformlen/i,
    formulaPatterns: [/x\s*=\s*\(?-?b\s*[±+\-]\s*√?\s*d\)?\s*\/\s*\(?2\s*·?\s*a\)?/i],
    allowKinds: ["rule", "method"],
    minCentralConfidence: 0.86,
  },
  {
    title: /diskriminant/i,
    formulaPatterns: [/d\s*=\s*b\^?2\s*[-+]\s*4\s*·?\s*a\s*·?\s*c/i],
    allowKinds: ["rule", "method"],
    minCentralConfidence: 0.86,
  },
  {
    title: /afstandsformlen|afstand.*to punkter/i,
    formulaPatterns: [/\|[A-Z]{2}\|\s*=\s*√\(\(?x_?2\s*-\s*x_?1\)?\^?2\s*\+\s*\(?y_?2\s*-\s*y_?1\)?\^?2\)/i],
    allowKinds: ["rule", "method"],
    minCentralConfidence: 0.86,
  },
  {
    title: /cirklens ligning/i,
    formulaPatterns: [/\(x\s*-\s*a\)\^?2\s*\+\s*\(y\s*-\s*b\)\^?2\s*=\s*r\^?2/i],
    allowKinds: ["rule", "method"],
    minCentralConfidence: 0.86,
  },
  {
    title: /arealformlen/i,
    formulaPatterns: [/T\s*=\s*1\/2\s*·?\s*a\s*·?\s*b\s*·?\s*sin\(C\)/i],
    allowKinds: ["rule", "method"],
    minCentralConfidence: 0.86,
  },
  {
    title: /toppunktsformlen/i,
    formulaPatterns: [/x_?T\s*=\s*-?b\s*\/\s*\(?2\s*a\)?\s*,?\s*y_?T\s*=\s*-?d\s*\/\s*\(?4\s*a\)?/i],
    allowKinds: ["rule", "method"],
    minCentralConfidence: 0.86,
  },
  {
    title: /sinusrelation/i,
    formulaPatterns: [/a\s*\/\s*sin\(A\)\s*=\s*b\s*\/\s*sin\(B\)\s*=\s*c\s*\/\s*sin\(C\)/i],
    allowKinds: ["rule", "method"],
    minCentralConfidence: 0.86,
  },
  {
    title: /cosinusrelation/i,
    formulaPatterns: [/c\^?2\s*=\s*a\^?2\s*\+\s*b\^?2\s*-\s*2\s*·?\s*a\s*·?\s*b\s*·?\s*cos\(C\)/i],
    allowKinds: ["rule", "method"],
    minCentralConfidence: 0.86,
  },
  {
    title: /tangentligningen/i,
    formulaPatterns: [/y\s*=\s*f\(x_?0\)\s*\+\s*f['’]\(x_?0\)\s*\(\s*x\s*-\s*x_?0\s*\)/i],
    allowKinds: ["rule", "method"],
    minCentralConfidence: 0.88,
  },
  {
    title: /nulpunkter for den afledte|førsteordensbetingelse|foersteordensbetingelse/i,
    formulaPatterns: [/f['’]\(x\)\s*=\s*0(?!\s*\d)/i, /O['’]\(x\)\s*=\s*0(?!\s*\d)/i],
    allowKinds: ["rule", "method", "concept"],
    minCentralConfidence: 0.86,
    minInlineConfidence: 0.94,
  },
  {
    title: /volumenbetingelse|optimering med volumen/i,
    formulaPatterns: [/h\s*=\s*(?:V|100)\s*\/\s*x\^?2/i],
    allowKinds: ["rule", "method"],
    minCentralConfidence: 0.86,
  },
  {
    title: /indsættelse af volumenbetingelsen|indsaettelse af volumenbetingelsen|overfladeareal som funktion/i,
    formulaPatterns: [/O\(x\)\s*=\s*(?:x\^?2\s*\+\s*400\s*\/\s*x|400\s*\/\s*x\s*\+\s*x\^?2)/i],
    allowKinds: ["rule", "method"],
    minCentralConfidence: 0.86,
    minInlineConfidence: 0.94,
  },
  {
    title: /monotonisætningen|monotonisaetningen|monotoniforhold|fortegn for den afledte/i,
    formulaPatterns: [/f['’]\(x\)\s*[<>]=?\s*0(?!\s*\d)/i],
    allowKinds: ["rule", "method", "concept"],
    minCentralConfidence: 0.88,
    minInlineConfidence: 0.95,
  },
];

const GENERIC_FORMULA_SNIPPET_RE =
  /(?:a\s*x\^?2\s*\+\s*b\s*x\s*\+\s*c\s*=\s*0|\b[a-z](?:['’]{1,2})?\([^)]*\)\s*=\s*[-+0-9A-Za-z^ ·*/()'’]{2,64}|\|[A-Z]{2}\|\s*=\s*√?\([^.;]{4,80}\)|\b[A-Za-z]\s*=\s*[-+0-9A-Za-z^ ·*/()√'’]{2,64}|\b[A-Za-z](?:['’]{1,2})?\([^)]*\)\s*[<>=]\s*0|\([^)]+[A-Za-z][^)]*\)\^?2\s*=\s*[^.;]{1,72})/gi;

const CANONICAL_FORMULA_FALLBACKS: Array<{ title: RegExp; formula: string }> = [
  { title: /standardform.*andengrad/i, formula: "f(x) = ax^2 + bx + c" },
  { title: /diskriminant(?: og betydning)?$/i, formula: "d = b^2 - 4 · a · c" },
  { title: /løsningsformlen/i, formula: "x = (-b ± √d) / (2a)" },
  { title: /toppunktsformlen/i, formula: "x_T = -b / (2a), y_T = -d / (4a)" },
  { title: /cosinusrelation/i, formula: "c^2 = a^2 + b^2 - 2 · a · b · cos(C)" },
  { title: /sinusrelation/i, formula: "a / sin(A) = b / sin(B) = c / sin(C)" },
  { title: /arealformlen/i, formula: "T = 1/2 · a · b · sin(C)" },
  { title: /afstandsformlen|afstand.*to punkter/i, formula: "|AB| = √((x2 - x1)^2 + (y2 - y1)^2)" },
  { title: /cirklens ligning/i, formula: "(x - a)^2 + (y - b)^2 = r^2" },
  { title: /tangentligningen/i, formula: "y = f(x0) + f'(x0)(x - x0)" },
  { title: /nulpunkter for den afledte|førsteordensbetingelse|foersteordensbetingelse/i, formula: "f'(x) = 0" },
  { title: /volumenbetingelse/i, formula: "h = 100 / x^2" },
  { title: /overfladeareal som funktion/i, formula: "O(x) = 400 / x + x^2" },
];

const FORMULA_PROFILES: FormulaProfile[] = [
  {
    title: /standardform.*andengrad/i,
    centralPatterns: [/f\(x\)\s*=\s*a\s*x\^?2\s*\+\s*b\s*x\s*\+\s*c/i, /a\s*x\^?2\s*\+\s*b\s*x\s*\+\s*c\s*=\s*0/i],
    notationPatterns: [/[abc]\s*=\s*[-+]?\d+/i],
    importance: "core",
  },
  {
    title: /koefficienterne.*a.*b.*c/i,
    centralPatterns: [],
    notationPatterns: [/[abc]\s*=\s*[-+]?\d+/i],
    importance: "supporting",
    allowGenericNotation: false,
  },
  {
    title: /løsningsformlen/i,
    centralPatterns: [/x\s*=\s*\(?-?b\s*[±+\-]\s*√?\s*d\)?\s*\/\s*\(?2\s*·?\s*a\)?/i],
    importance: "core",
  },
  {
    title: /diskriminantens løsningstilfælde|diskriminantens loesningstilfaelde/i,
    centralPatterns: [],
    notationPatterns: [/d\s*(?:>|<|=)\s*0/i],
    importance: "supporting",
    allowGenericNotation: false,
  },
  {
    title: /diskriminant/i,
    centralPatterns: [/d\s*=\s*b\^?2\s*[-+]\s*4\s*·?\s*a\s*·?\s*c/i],
    importance: "core",
  },
  {
    title: /afstandsformlen|afstand.*to punkter/i,
    centralPatterns: [/\|[A-Z]{2}\|\s*=\s*√\(\(?x_?2\s*-\s*x_?1\)?\^?2\s*\+\s*\(?y_?2\s*-\s*y_?1\)?\^?2\)/i],
    importance: "core",
  },
  {
    title: /punkt til linje|distancen fra punkt til linje/i,
    centralPatterns: [/d\s*=\s*\|?\s*a\s*x_?0\s*\+\s*b\s*y_?0\s*\+\s*c\s*\|?\s*\/\s*√?\(?a\^?2\s*\+\s*b\^?2\)?/i],
    importance: "core",
  },
  {
    title: /cirklens ligning/i,
    centralPatterns: [/\(x\s*-\s*a\)\^?2\s*\+\s*\(y\s*-\s*b\)\^?2\s*=\s*r\^?2/i],
    importance: "core",
  },
  {
    title: /tangentligningen/i,
    centralPatterns: [/y\s*=\s*f\(x_?0\)\s*\+\s*f['’]\(x_?0\)\s*\(\s*x\s*-\s*x_?0\s*\)/i],
    importance: "core",
    rejectPatterns: [/f['’]{2}\(/i],
  },
  {
    title: /toppunktsformlen/i,
    centralPatterns: [/x_?T\s*=\s*-?b\s*\/\s*\(?2\s*a\)?/i, /y_?T\s*=\s*-?d\s*\/\s*\(?4\s*a\)?/i],
    importance: "core",
    minCentralConfidence: 0.84,
  },
  {
    title: /vendetangent|f''/i,
    centralPatterns: [/f['’]{2}\(x_?0?\)\s*=\s*0(?!\s*\d)/i],
    notationPatterns: [/y\s*=\s*f\(x_?0\)\s*\+\s*f['’]\(x_?0\)\s*\(\s*x\s*-\s*x_?0\s*\)/i],
    importance: "core",
    minCentralConfidence: 0.9,
    requireContext: /\b(vendepunkt|vendetangent|fortegnsskift|skifter fortegn|krumning|konkav|konveks)\b/i,
  },
  {
    title: /monotonisætningen|monotoniforhold/i,
    centralPatterns: [/f['’]\(x\)\s*[<>]=?\s*0(?!\s*\d)/i],
    notationPatterns: [/f['’]\(x\)\s*=\s*0(?!\s*\d)/i],
    importance: "core",
  },
  {
    title: /fortegn for den afledte/i,
    centralPatterns: [/f['’]\(x\)\s*[<>]=?\s*0(?!\s*\d)/i],
    notationPatterns: [/f['’]\(x\)\s*=\s*0(?!\s*\d)/i],
    importance: "supporting",
  },
  {
    title: /nulpunkter for den afledte/i,
    centralPatterns: [
      /f['’]\(x\)\s*=\s*0(?!\s*\d)/i,
      /f['’]\(x\)\s*=\s*[-+0-9xX^ ·*/()]{3,48}\s*=\s*0(?!\s*\d)/i,
    ],
    notationPatterns: [/f['’]\(x\)\s*=\s*[-+0-9xX^ ·*/()]{3,48}/i],
    importance: "core",
    rejectPatterns: [/f['’]\(x\)\s*=\s*0\s*\d/i, /f['’]\(x\)\s*=\s*0\s*>/i],
  },
  {
    title: /monotonilinje|fortegnsskema|differentialkvotient|afledt|tangentens hældning|tangentens haeldning/i,
    centralPatterns: [],
    notationPatterns: [/f['’]\(x\)\s*=\s*[-+0-9xX^ ·*/()]{3,48}/i, /f['’]\(x\)\s*[<>]=?\s*0/i],
    importance: "supporting",
    allowGenericNotation: false,
  },
  {
    title: /arealformlen/i,
    centralPatterns: [/T\s*=\s*1\/2\s*·?\s*a\s*·?\s*b\s*·?\s*sin\(C\)/i],
    importance: "core",
  },
  {
    title: /trigonometriske|sinus på enhedscirklen/i,
    centralPatterns: [],
    notationPatterns: [/T\s*=\s*1\/2\s*·?\s*a\s*·?\s*b\s*·?\s*sin\(C\)/i],
    importance: "supporting",
  },
  {
    title: /indsættelse af volumenbetingelsen|indsaettelse af volumenbetingelsen/i,
    centralPatterns: [/O\(x\)\s*=\s*(?:x\^?2\s*\+\s*400\s*\/\s*x|400\s*\/\s*x\s*\+\s*x\^?2)/i],
    notationPatterns: [/h\s*=\s*(?:V|100)\s*\/\s*x\^?2/i, /O\(x,h\)\s*=\s*4xh\s*\+\s*x\^?2/i],
    importance: "supporting",
  },
  {
    title: /volumenbetingelse/i,
    centralPatterns: [/h\s*=\s*(?:V|100)\s*\/\s*x\^?2/i, /V\s*=\s*x\s*·?\s*x\s*·?\s*h(?:\s*=\s*100)?/i],
    notationPatterns: [/x\^?2h\s*=\s*100/i],
    importance: "core",
  },
  {
    title: /definitionsmængde i optimering|definitionsmaengde i optimering/i,
    centralPatterns: [],
    notationPatterns: [/x\s*>\s*0/i],
    importance: "supporting",
    allowGenericNotation: false,
  },
  {
    title: /overfladeareal som funktion/i,
    centralPatterns: [/O\(x,h\)\s*=\s*4xh\s*\+\s*x\^?2/i, /O\(x\)\s*=\s*(?:x\^?2\s*\+\s*400\s*\/\s*x|400\s*\/\s*x\s*\+\s*x\^?2)/i],
    importance: "core",
  },
  {
    title: /førsteordensbetingelse|foersteordensbetingelse/i,
    centralPatterns: [/O['’]\(x\)\s*=\s*0(?!\s*\d)/i, /f['’]\(x\)\s*=\s*0(?!\s*\d)/i],
    importance: "core",
  },
  {
    title: /optimering med volumen/i,
    centralPatterns: [/h\s*=\s*(?:V|100)\s*\/\s*x\^?2/i, /O\(x\)\s*=\s*(?:x\^?2\s*\+\s*400\s*\/\s*x|400\s*\/\s*x\s*\+\s*x\^?2)/i],
    notationPatterns: [/V\s*=\s*x\s*·?\s*x\s*·?\s*h/i, /O\(x,h\)\s*=\s*4xh\s*\+\s*x\^?2/i],
    importance: "core",
  },
  {
    title: /^Optimering$/i,
    centralPatterns: [],
    notationPatterns: [/O['’]\(x\)\s*=\s*0/i],
    importance: "supporting",
    allowGenericNotation: false,
  },
  {
    title: /gaffelforskrift|stykkevise funktioner|differentiering af stykkevise/i,
    centralPatterns: [],
    notationPatterns: [/f\(x\)\s*=\s*[-+0-9A-Za-z^ ·*/()]{2,48}/i],
    importance: "supporting",
  },
  {
    title: /intervaller i stykkevise funktioner/i,
    centralPatterns: [],
    notationPatterns: [/x\s*[<>]=?\s*[-+]?\d+/i],
    importance: "supporting",
    allowGenericNotation: false,
  },
  {
    title: /kvadratkomplettering/i,
    centralPatterns: [],
    notationPatterns: [/\([^)]+[A-Za-z][^)]*\)\^?2\s*=\s*[-+0-9A-Za-z^ ·*/()]{1,48}/i],
    importance: "supporting",
  },
  {
    title: /lineære funktioner/i,
    centralPatterns: [],
    notationPatterns: [/(?:y|f\(x\))\s*=\s*a\s*·?\s*x\s*\+\s*b/i],
    importance: "supporting",
  },
  {
    title: /eksponential/i,
    centralPatterns: [],
    notationPatterns: [/f\(x\)\s*=\s*b\s*·?\s*a\^?x|f\(x\)\s*=\s*a\s*·?\s*b\^?x/i],
    importance: "supporting",
  },
  {
    title: /sinusrelation/i,
    centralPatterns: [/a\s*\/\s*sin\(A\)\s*=\s*b\s*\/\s*sin\(B\)\s*=\s*c\s*\/\s*sin\(C\)/i],
    importance: "core",
  },
  {
    title: /cosinusrelation/i,
    centralPatterns: [/c\^?2\s*=\s*a\^?2\s*\+\s*b\^?2\s*-\s*2\s*·?\s*a\s*·?\s*b\s*·?\s*cos\(C\)/i],
    importance: "core",
  },
];

export function normalizeMathFormula(value: string) {
  return trimMathSentenceEnding(value)
    .replace(/\\frac\s*\{([^{}]+)\}\s*\{([^{}]+)\}/gi, "($1) / ($2)")
    .replace(/\\sqrt\s*\{([^{}]+)\}/gi, "√($1)")
    .replace(/\\pm/gi, "±")
    .replace(/\\cdot/gi, "·")
    .replace(/\\ge/gi, "≥")
    .replace(/\\le/gi, "≤")
    .replace(/\\approx/gi, "≈")
    .replace(/\\ne/gi, "!=")
    .replace(/\bCentrum\b.*$/i, "")
    .replace(/\bVolumenbetingelsen\b.*$/i, "")
    .replace(/\bToppunktet\b.*$/i, "")
    .replace(/\bArealformlen\b.*$/i, "")
    .replace(/\bRelationen\b.*$/i, "")
    .replace(/\bDerfor\b.*$/i, "")
    .replace(/\s+(?:for|hvor|naar|når|til|saa|så|og|eller)\b.*$/i, "")
    .replace(/,\s*[A-Za-z]\s*[<>]=?\s*.*$/i, "")
    .replace(/\s+[A-Za-zÆØÅæøå]{4,}.*$/u, "")
    .replace(/\s*·\s*/g, " · ")
    .replace(/[{}]/g, "")
    .replace(/\s+/g, " ")
    .replace(/\bsqrt\b/gi, "√")
    .trim();
}

function countProseWords(value: string) {
  return (value.match(/[A-Za-zÆØÅæøå]{4,}/g) ?? []).filter(
    (word) => !/^(sqrt|sin|cos|tan|log|ln)$/i.test(word),
  ).length;
}

function corruptionScore(formula: string) {
  let score = 0;
  if (/[<>]\s*$/.test(formula)) score += 4;
  if (/=\s*0\s*\d+\b/.test(formula)) score += 5;
  if (/\b03\b/.test(formula)) score += 5;
  if (/\bmedf\b/i.test(formula)) score += 5;
  if (/[=<>]\s*[-+]?\d+(?:[.,]\d+)?\s*[A-Za-zÆØÅæøå]{2,}\b/i.test(formula)) score += 4;
  if (/[<>]\s*[A-Za-zÆØÅæøå]{2,}\b/i.test(formula)) score += 4;
  if (/(?:^|\s)#{2,6}\s|(?:^|\s)---(?:\s|$)|\*\*Formel:\*\*|_Metode|_Regel|_Begreb|_Faldgrube/i.test(formula)) {
    score += 5;
  }
  if (/(?:[+*/^]\s*[+*/^]|-\s*[+*/^])/.test(formula)) score += 3;
  if (/^[A-Za-z]'?\([^)]*\)\s*=$/.test(formula)) score += 4;
  if (/f['’]{1,2}\([^)]*\)\s*=\s*[-+]?$/i.test(formula)) score += 4;
  if (countProseWords(formula) > 1) score += 3;
  if (!isStableShortMathFormula(formula)) score += 2;
  return score;
}

export function isStableShortMathFormula(formula: string) {
  if (!formula || formula.length > 78) return false;
  if (/[\r\n]|\$\$|\$|\\begin|\\end|aligned|cases|array|matrix/i.test(formula)) return false;
  if (/^\s*(?:dl|cl|ml|cm|mm|m|km|kg|g|kr)\s*=/i.test(formula)) return false;
  if (/(?:=|≈|≤|≥|<|>)\s*$/.test(formula)) return false;
  const relationCount = (formula.match(/(?:=|≈|≤|≥|<|>)/g) ?? []).length;
  if (relationCount < 1 || relationCount > 2) return false;
  if ((formula.match(/[{}]/g) ?? []).length % 2 !== 0) return false;
  if ((formula.match(/[()]/g) ?? []).length % 2 !== 0) return false;
  if (/[.!?]/.test(formula)) return false;
  if (countProseWords(formula) > 1) return false;
  return /[A-Za-zÆØÅæøå]/.test(formula) && /[=≈≤≥<>]/.test(formula);
}

function corruptionReason(formula: string) {
  if (/[<>]\s*$/.test(formula)) return "trailing_angle_bracket";
  if (/=\s*0\s*\d+\b/.test(formula)) return "ocr_corruption_zero_digit_rhs";
  if (/\b03\b/.test(formula)) return "ocr_corruption_zero_digit_rhs";
  if (/\bmedf\b/i.test(formula)) return "ocr_glued_prose_fragment";
  if (/[=<>]\s*[-+]?\d+(?:[.,]\d+)?\s*[A-Za-zÆØÅæøå]{2,}\b/i.test(formula)) {
    return "formula_text_glued_to_rhs";
  }
  if (/[<>]\s*[A-Za-zÆØÅæøå]{2,}\b/i.test(formula)) return "operator_text_corruption";
  if (/(?:^|\s)#{2,6}\s|(?:^|\s)---(?:\s|$)|\*\*Formel:\*\*|_Metode|_Regel|_Begreb|_Faldgrube/i.test(formula)) {
    return "markdown_leaked_into_formula";
  }
  if (/(?:[+*/^]\s*[+*/^]|-\s*[+*/^])/.test(formula)) return "broken_operator_structure";
  if (/^[A-Za-z]'?\([^)]*\)\s*=$/.test(formula)) return "missing_right_hand_side";
  if (/f['’]{1,2}\([^)]*\)\s*=\s*[-+]?$/i.test(formula)) return "malformed_derivative_rhs";
  if (countProseWords(formula) > 1) return "mixed_text_and_formula";
  if (!isStableShortMathFormula(formula)) return "not_stable_short_formula";
  return null;
}

function matchingProfile(title: string) {
  return FORMULA_PROFILES.find((profile) => profile.title.test(title));
}

function canonicalFormulaFallback(title: string) {
  return CANONICAL_FORMULA_FALLBACKS.find((item) => item.title.test(title))?.formula;
}

function matchingFormulaBoxProfile(title: string, formula: string) {
  return FORMULA_BOX_PROFILES.find(
    (profile) => profile.title.test(title) && profile.formulaPatterns.some((pattern) => pattern.test(formula)),
  );
}

function patternMatch(formula: string, patterns: RegExp[] | undefined) {
  return (patterns ?? []).some((pattern) => pattern.test(formula));
}

function extractPatternMatch(formula: string, patterns: RegExp[] | undefined) {
  for (const pattern of patterns ?? []) {
    const flags = pattern.flags.includes("g") ? pattern.flags : `${pattern.flags}g`;
    for (const match of formula.matchAll(new RegExp(pattern.source, flags))) {
      if (match[0]) return normalizeMathFormula(match[0]);
    }
  }
  return null;
}

function canonicalFormulaForProfile(formula: string, profile: FormulaProfile | undefined, title: string) {
  const normalized = normalizeMathFormula(formula);
  if (!profile) return normalized;

  if (/toppunktsformlen/i.test(title)) {
    const xFormula = extractPatternMatch(normalized, [/x_?T\s*=\s*-?b\s*\/\s*\(?2\s*a\)?/i]);
    const yFormula = extractPatternMatch(normalized, [/y_?T\s*=\s*-?d\s*\/\s*\(?4\s*a\)?/i]);
    if (xFormula && yFormula) return `${xFormula}, ${yFormula}`;
    return xFormula ?? yFormula ?? normalized;
  }

  return (
    extractPatternMatch(normalized, profile.centralPatterns) ??
    extractPatternMatch(normalized, profile.notationPatterns) ??
    normalized
  );
}

function semanticScoreForCandidate(args: {
  candidate: RawFormulaCandidate;
  concept: MathRecognizedConcept;
  profile?: FormulaProfile;
  centralMatch: boolean;
  notationMatch: boolean;
  contextOk: boolean;
}) {
  const { candidate, concept, profile, centralMatch, notationMatch, contextOk } = args;
  let score = 0;
  if (centralMatch) score += 70;
  if (notationMatch) score += 45;
  if (profile?.title.test(concept.title)) score += 10;
  if (candidate.sourceKind === "formula") score += 8;
  if (candidate.sourceKind === "example") score += 3;
  if (contextOk && profile?.requireContext) score += 8;
  if (candidate.formula.length >= 8 && candidate.formula.length <= 64) score += 4;

  if (/nulpunkter for den afledte/i.test(concept.title)) {
    if (/f['’]\(x\)\s*=\s*0(?!\s*\d)/i.test(candidate.formula)) score += 25;
    if (/f['’]\(x\)\s*[<>]/i.test(candidate.formula)) score -= 25;
    if (!/=\s*0(?!\s*\d)/.test(candidate.formula)) score -= 20;
  }

  if (/monotoniforhold|monotonisætningen/i.test(concept.title)) {
    if (/f['’]\(x\)\s*[<>]=?\s*0(?!\s*\d)/i.test(candidate.formula)) score += 25;
    if (/f['’]\(x\)\s*=\s*0(?!\s*\d)/i.test(candidate.formula)) score -= 12;
  }

  if (/tangentligningen/i.test(concept.title)) {
    if (/y\s*=\s*f\(x_?0\)\s*\+\s*f['’]\(x_?0\)\s*\(\s*x\s*-\s*x_?0\s*\)/i.test(candidate.formula)) score += 30;
    if (/f['’]{2}\(/i.test(candidate.formula)) score -= 40;
  }

  if (/standardform.*andengrad/i.test(concept.title)) {
    if (/f\(x\)\s*=\s*a\s*x\^?2\s*\+\s*b\s*x\s*\+\s*c/i.test(candidate.formula)) score += 28;
    if (/a\s*x\^?2\s*\+\s*b\s*x\s*\+\s*c\s*=\s*0/i.test(candidate.formula)) score += 18;
  }

  if (/toppunktsformlen/i.test(concept.title)) {
    if (/x_?T\s*=/.test(candidate.formula)) score += 18;
    if (/y_?T\s*=/.test(candidate.formula)) score += 18;
  }

  if (/cosinusrelation/i.test(concept.title)) {
    if (/c\^?2\s*=\s*a\^?2\s*\+\s*b\^?2\s*-\s*2\s*·?\s*a\s*·?\s*b\s*·?\s*cos\(C\)/i.test(candidate.formula)) {
      score += 28;
    }
  }

  if (/sinusrelation/i.test(concept.title)) {
    if (/a\s*\/\s*sin\(A\)\s*=\s*b\s*\/\s*sin\(B\)\s*=\s*c\s*\/\s*sin\(C\)/i.test(candidate.formula)) {
      score += 28;
    }
  }

  if (/volumenbetingelse/i.test(concept.title)) {
    if (/h\s*=\s*(?:V|100)\s*\/\s*x\^?2/i.test(candidate.formula)) score += 20;
    if (/V\s*=\s*x\s*·?\s*x\s*·?\s*h/i.test(candidate.formula)) score += 15;
    if (/O\(/i.test(candidate.formula)) score -= 30;
  }

  if (/overfladeareal som funktion/i.test(concept.title)) {
    if (/O\(x\)\s*=/i.test(candidate.formula)) score += 25;
    if (/^V\s*=|^h\s*=/i.test(candidate.formula)) score -= 25;
  }

  return Math.max(0, score);
}

function formulaSnippets(text: string, profile?: FormulaProfile) {
  const out: string[] = [];
  const patterns = [...(profile?.centralPatterns ?? []), ...(profile?.notationPatterns ?? [])];

  for (const pattern of patterns) {
    for (const match of text.matchAll(new RegExp(pattern.source, pattern.flags.includes("g") ? pattern.flags : `${pattern.flags}g`))) {
      if (match[0]) out.push(match[0]);
    }
  }

  for (const match of text.matchAll(GENERIC_FORMULA_SNIPPET_RE)) {
    if (match[0]) out.push(match[0]);
  }

  return Array.from(new Set(out.map(normalizeMathFormula).filter(Boolean)));
}

function collectRawCandidates(concept: MathRecognizedConcept, profile?: FormulaProfile) {
  const candidates: RawFormulaCandidate[] = [];
  const seen = new Set<string>();

  for (const piece of concept.pieces) {
    for (const formula of formulaSnippets(piece.text, profile)) {
      const canonicalFormula = canonicalFormulaForProfile(formula, profile, concept.title);
      const key = `${piece.kind}:${piece.sourceRef ?? ""}:${canonicalFormula}`;
      if (!canonicalFormula || seen.has(key)) continue;
      seen.add(key);
      candidates.push({
        formula: canonicalFormula,
        sourceKind: piece.kind,
        sourceRef: piece.sourceRef,
        sourceText: piece.text,
      });
    }
  }

  return candidates;
}

function scoreCandidate(candidate: RawFormulaCandidate, concept: MathRecognizedConcept, profile?: FormulaProfile) {
  const centralMatch = patternMatch(candidate.formula, profile?.centralPatterns);
  const notationMatch = patternMatch(candidate.formula, profile?.notationPatterns);
  const contextOk = !profile?.requireContext || profile.requireContext.test(candidate.sourceText);
  const semanticScore = semanticScoreForCandidate({
    candidate,
    concept,
    profile,
    centralMatch,
    notationMatch,
    contextOk,
  });
  const candidateCorruptionScore = corruptionScore(candidate.formula);
  const corrupt = corruptionReason(candidate.formula);
  if (corrupt) {
    return {
      confidence: 0,
      semanticScore,
      corruptionScore: candidateCorruptionScore,
      decision: "rejected" as const,
      reason: corrupt,
    };
  }

  if (profile?.rejectPatterns?.some((pattern) => pattern.test(candidate.formula))) {
    return {
      confidence: 0,
      semanticScore,
      corruptionScore: candidateCorruptionScore,
      decision: "rejected" as const,
      reason: "rejected_by_concept_profile",
    };
  }

  if (profile && !centralMatch && !notationMatch) {
    return {
      confidence: 0,
      semanticScore,
      corruptionScore: candidateCorruptionScore,
      decision: "rejected" as const,
      reason: "not_relevant_to_concept_profile",
    };
  }

  if (centralMatch && !contextOk) {
    return {
      confidence: 0,
      semanticScore,
      corruptionScore: candidateCorruptionScore,
      decision: "rejected" as const,
      reason: "missing_required_concept_context",
    };
  }

  if (semanticScore < (centralMatch ? 60 : 42)) {
    return {
      confidence: 0,
      semanticScore,
      corruptionScore: candidateCorruptionScore,
      decision: "rejected" as const,
      reason: "semantic_score_below_concept_threshold",
    };
  }

  let confidence = centralMatch ? 0.72 : notationMatch ? 0.58 : 0.46;
  if (candidate.sourceKind === "formula") confidence += 0.18;
  if (candidate.sourceKind === "example") confidence += 0.08;
  if (centralMatch) confidence += 0.12;
  if (notationMatch) confidence += 0.08;
  if (profile?.title.test(concept.title)) confidence += 0.05;
  if (contextOk && profile?.requireContext) confidence += 0.08;
  if (candidate.formula.length >= 10 && candidate.formula.length <= 64) confidence += 0.03;

  return {
    confidence: Math.min(0.99, Number(confidence.toFixed(2))),
    semanticScore,
    corruptionScore: candidateCorruptionScore,
    decision: "accepted" as const,
    reason: centralMatch ? "matches_preferred_core_formula" : notationMatch ? "matches_concept_notation" : "generic_formula_candidate",
  };
}

function traceFor(candidate: RawFormulaCandidate, concept: MathRecognizedConcept, profile?: FormulaProfile): MathFormulaCandidateTrace {
  const scored = scoreCandidate(candidate, concept, profile);
  return {
    formula: candidate.formula,
    sourceKind: candidate.sourceKind,
    sourceRef: candidate.sourceRef,
    confidence: scored.confidence,
    semanticScore: scored.semanticScore,
    corruptionScore: scored.corruptionScore,
    decision: scored.decision,
    reason: scored.reason,
  };
}

export function selectMathFormulaBox(args: {
  title: string;
  kind: FormulaBoxKind;
  formulaMode: MathFormulaMode;
  formulaConfidence: number;
  centralFormula?: string;
  notationExample?: string;
}): MathFormulaBoxSelection {
  const title = args.title.trim();
  const centralFormula = normalizeMathFormula(args.centralFormula ?? "");
  const inlineFormula = normalizeMathFormula(args.notationExample ?? "");
  const candidateSource = centralFormula
    ? "centralFormula"
    : args.formulaMode !== "none" && inlineFormula
      ? "notationExample"
      : "none";
  const candidateFormula = candidateSource === "centralFormula" ? centralFormula : candidateSource === "notationExample" ? inlineFormula : "";

  if (!candidateFormula) {
    return {
      shouldRender: false,
      source: "none",
      reason: "Ingen ren formel til formelboks.",
    };
  }

  if (!isStableShortMathFormula(candidateFormula)) {
    return {
      shouldRender: false,
      source: candidateSource,
      reason: "Formlen er ikke kort og stabil nok til formelboks.",
    };
  }

  const profile = matchingFormulaBoxProfile(title, candidateFormula);
  if (!profile) {
    return {
      shouldRender: false,
      source: candidateSource,
      reason: "Formlen ligner notation, men ikke en central textbook-formel for denne blok.",
    };
  }

  if (profile.allowKinds?.length && !profile.allowKinds.includes(args.kind)) {
    return {
      shouldRender: false,
      source: candidateSource,
      reason: `Bloktypen ${args.kind} skal ikke have formelboks for denne formel.`,
    };
  }

  const minConfidence =
    candidateSource === "notationExample"
      ? profile.minInlineConfidence ?? 0.95
      : profile.minCentralConfidence ?? 0.88;

  if (args.formulaConfidence < minConfidence) {
    return {
      shouldRender: false,
      source: candidateSource,
      reason: `Formelconfidence ${args.formulaConfidence.toFixed(2)} er under formelboks-tærsklen ${minConfidence.toFixed(2)}.`,
    };
  }

  return {
    shouldRender: true,
    formula: candidateFormula,
    source: candidateSource,
    reason: `Kort central formel matchede formelboks-profilen for ${title}.`,
  };
}

export function selectMathFormula(concept: MathRecognizedConcept): MathFormulaSelection {
  const profile = matchingProfile(concept.title);
  const traces = collectRawCandidates(concept, profile).map((candidate) => traceFor(candidate, concept, profile));
  const accepted = traces
    .filter((trace) => trace.decision === "accepted")
    .sort(
      (a, b) =>
        b.semanticScore - a.semanticScore ||
        a.corruptionScore - b.corruptionScore ||
        b.confidence - a.confidence ||
        b.formula.length - a.formula.length,
    );
  const rejected = traces.filter((trace) => trace.decision === "rejected");

  if (/toppunktsformlen/i.test(concept.title)) {
    const pairedFormula = accepted.find((trace) => /x_?T\s*=/.test(trace.formula) && /y_?T\s*=/.test(trace.formula));
    if (pairedFormula) {
      return {
        mode: "centralFormula",
        centralFormula: pairedFormula.formula,
        confidence: pairedFormula.confidence,
        reason: `Toppunktsformlen beholdt den samlede x_T- og y_T-formel med confidence ${pairedFormula.confidence.toFixed(2)}.`,
        candidates: traces,
        rejectedCandidates: rejected,
        winningCandidate: pairedFormula,
      };
    }
    const xFormula = accepted.find((trace) => /x_?T\s*=/.test(trace.formula));
    const yFormula = accepted.find((trace) => /y_?T\s*=/.test(trace.formula));
    if (xFormula && yFormula) {
      const combinedFormula = `${xFormula.formula}, ${yFormula.formula}`;
      const combinedConfidence = Number(((xFormula.confidence + yFormula.confidence) / 2).toFixed(2));
      return {
        mode: "centralFormula",
        centralFormula: combinedFormula,
        confidence: combinedConfidence,
        reason: `Toppunktsformlen blev samlet fra x_T- og y_T-formler med confidence ${combinedConfidence.toFixed(2)}.`,
        candidates: traces,
        rejectedCandidates: rejected,
        winningCandidate: xFormula.confidence >= yFormula.confidence ? xFormula : yFormula,
      };
    }
  }
  const winner = accepted[0];

  if (!winner) {
    const fallbackFormula = canonicalFormulaFallback(concept.title);
    if (fallbackFormula) {
      return {
        mode: "centralFormula",
        centralFormula: fallbackFormula,
        confidence: 0.9,
        reason: "Ingen sikker kandidat overlevede konceptlaget, så blokken bruger den kanoniske textbook-formel for dette navngivne emne.",
        candidates: traces,
        rejectedCandidates: rejected,
      };
    }
    return {
      mode: "none",
      confidence: 0,
      reason: traces.length
        ? "Alle formelkandidater blev afvist som irrelevante, svage eller korrupte."
        : "Ingen konkrete formula-like evidence pieces med stabil formel fundet.",
      candidates: traces,
      rejectedCandidates: rejected,
    };
  }

  const centralMatch = patternMatch(winner.formula, profile?.centralPatterns);
  const minCentral = profile?.minCentralConfidence ?? CENTRAL_CONFIDENCE_THRESHOLD;
  const minInline = profile?.minInlineConfidence ?? INLINE_CONFIDENCE_THRESHOLD;

  if (profile?.importance === "core" && centralMatch && winner.confidence >= minCentral) {
    return {
      mode: "centralFormula",
      centralFormula: winner.formula,
      confidence: winner.confidence,
      reason: `Kerneformel matchede concept-profilen med confidence ${winner.confidence.toFixed(2)}.`,
      candidates: traces,
      rejectedCandidates: rejected,
      winningCandidate: winner,
    };
  }

  if (winner.confidence >= minInline) {
    return {
      mode: "inline",
      inlineFormula: winner.formula,
      confidence: winner.confidence,
      reason: `Formlen er kun sikker nok som notationExample, confidence ${winner.confidence.toFixed(2)}.`,
      candidates: traces,
      rejectedCandidates: rejected,
      winningCandidate: winner,
    };
  }

  return {
    mode: "none",
    confidence: winner.confidence,
    reason: `Bedste formelkandidat blev bevidst udeladt, fordi confidence ${winner.confidence.toFixed(2)} er under tærsklen.`,
    candidates: traces,
    rejectedCandidates: rejected,
    winningCandidate: winner,
  };
}
