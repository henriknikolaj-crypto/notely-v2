import { normalizeMathKey, trimMathSentenceEnding } from "@/lib/notes/mathCandidatePieces";
import type { MathFilteredPiece } from "@/lib/notes/mathNoiseFilter";

export type MathRecognizedConcept = {
  id: string;
  title: string;
  topicGroup: string;
  pieces: MathFilteredPiece[];
  keywords: string[];
  sourcePages: number[];
  sourceRefs: string[];
  confidence: number;
  curriculumId: string;
};

export type MathNormalizedConcept = MathRecognizedConcept;
export type MathConceptRecognitionLayers = {
  broadConcepts: MathRecognizedConcept[];
  splitCandidates: MathRecognizedConcept[];
  splitDebug: string[];
  droppedSplitCandidates: string[];
  finalConcepts: MathRecognizedConcept[];
};

type ConceptPattern = {
  curriculumId: string;
  title: string;
  topicGroup: string;
  keywords: string[];
  pattern: RegExp;
  minScore?: number;
  specificity?: "broad" | "concrete";
};

const BROAD_CONCEPT_PATTERNS: ConceptPattern[] = [
  {
    curriculumId: "broad.quadratics",
    title: "Andengradspolynomier og ligninger",
    topicGroup: "Andengradspolynomier",
    keywords: ["andengradspolynomier", "andengradsligninger"],
    pattern: /\b(andengradspolynomier|andengradsligninger|andengradspolynomier og ligninger|quadratic)\b/i,
    specificity: "broad",
  },
  {
    curriculumId: "broad.geometry",
    title: "Analytisk plangeometri",
    topicGroup: "Analytisk geometri",
    keywords: ["analytisk geometri", "plangeometri", "koordinater"],
    pattern: /\b(analytisk plangeometri|analytisk geometri|koordinatgeometri|plangeometri)\b/i,
    specificity: "broad",
  },
  {
    curriculumId: "broad.calculus",
    title: "Differentialregning",
    topicGroup: "Differentialregning",
    keywords: ["differentialregning", "afledt"],
    pattern: /\b(differentialregning|differentiation|afledte funktioner)\b/i,
    specificity: "broad",
  },
  {
    curriculumId: "broad.functions",
    title: "Funktioner og grafer",
    topicGroup: "Funktioner",
    keywords: ["funktioner", "grafer"],
    pattern: /\b(funktioner og grafer|funktionsbegrebet|grafer)\b/i,
    specificity: "broad",
  },
  {
    curriculumId: "broad.optimization",
    title: "Optimering",
    topicGroup: "Optimering",
    keywords: ["optimering", "maksimum", "minimum"],
    pattern: /\b(optimering|maksimum|minimum|optimere)\b/i,
    specificity: "broad",
  },
];

const CONCEPT_PATTERNS: ConceptPattern[] = [
  {
    curriculumId: "quadratic.standard_form",
    title: "Standardform for andengradsligninger",
    topicGroup: "Andengradspolynomier",
    keywords: ["standardform", "andengradsligning", "koefficienter"],
    pattern: /\b(ax\^?2\s*\+\s*bx\s*\+\s*c\s*=\s*0|standardform|a\s*!=\s*0|a\s*,?\s*b\s*(?:og|,)\s*c|tallene\s+a\s*,?\s*b\s+og\s+c)\b/i,
  },
  {
    curriculumId: "quadratic.coefficients",
    title: "Koefficienterne a, b og c",
    topicGroup: "Andengradspolynomier",
    keywords: ["koefficienter", "a", "b", "c", "standardform"],
    pattern: /\b(koefficienterne?\s+a\s*,?\s*b\s*(?:og|,)\s*c|tallene\s+a\s*,?\s*b\s+og\s+c|a\s*,?\s*b\s*(?:og|,)\s*c\s+aflæses|a\s*,?\s*b\s*(?:og|,)\s*c\s+aflaeses)\b/i,
  },
  {
    curriculumId: "quadratic.formula",
    title: "Løsningsformlen for andengradsligninger",
    topicGroup: "Andengradspolynomier",
    keywords: ["løsningsformel", "andengradsligning", "rødder"],
    pattern: /\b(løsningsformel|loesningsformel|andengradsligning|plus minus|\\pm|±|sqrt\s*\(?d|x\s*=\s*\(?-?b)\b/i,
  },
  {
    curriculumId: "quadratic.discriminant_method",
    title: "Diskriminantmetoden",
    topicGroup: "Andengradspolynomier",
    keywords: ["diskriminantmetoden", "løsninger", "metode"],
    pattern: /\b(diskriminantmetoden|først finder man diskriminanten|foerst finder man diskriminanten|når man har fundet diskriminanten|naar man har fundet diskriminanten)\b/i,
  },
  {
    curriculumId: "quadratic.zero_rule",
    title: "Nulreglen",
    topicGroup: "Andengradspolynomier",
    keywords: ["nulreglen", "produkt", "nul"],
    pattern: /\b(nulreglen|nulprodukt|produktet\s+er\s+0|faktor(?:er|isere).{0,50}=+\s*0|en af faktorerne er nul)\b/i,
  },
  {
    curriculumId: "quadratic.discriminant",
    title: "Diskriminant og betydning",
    topicGroup: "Andengradspolynomier",
    keywords: ["diskriminant", "løsninger", "rødder"],
    pattern: /\b(diskriminant|d\s*=\s*b\^?2|ingen løsninger|ingen loesninger|to løsninger|to loesninger|én løsning|en loesning)\b/i,
  },
  {
    curriculumId: "quadratic.discriminant_cases",
    title: "Diskriminantens løsningstilfælde",
    topicGroup: "Andengradspolynomier",
    keywords: ["diskriminant", "løsningstilfælde", "d større end 0", "d mindre end 0"],
    pattern: /\b(hvis\s+d\s*(?:>|<|=)\s*0|d\s*>\s*0|d\s*<\s*0|d\s*=\s*0|tre\s+muligheder|antal\s+løsninger|antal\s+loesninger)\b/i,
  },
  {
    curriculumId: "quadratic.vertex",
    title: "Toppunktsformlen",
    topicGroup: "Andengradspolynomier",
    keywords: ["toppunkt", "parabel", "ekstremum"],
    pattern: /\b(toppunkt|toppunktsformlen|t_x|t_y|-\s*b\s*\/\s*\(?2a\)?|glad parabel|sur parabel|parablens toppunkt)\b/i,
  },
  {
    curriculumId: "quadratic.completing_square",
    title: "Kvadratkomplettering",
    topicGroup: "Andengradspolynomier",
    keywords: ["kvadratkomplettering", "kvadratsætning"],
    pattern: /\b(kvadratkomplettering|kvadratsætning|kvadratsaetning|\(x\s*[+-]\s*\d+\)\^?2)\b/i,
  },
  {
    curriculumId: "calculus.slope_tangent",
    title: "Differentialkvotient som tangentens hældning",
    topicGroup: "Differentialregning",
    keywords: ["differentialkvotient", "tangent", "hældning"],
    pattern: /\b(differentialkvotienten.{0,80}tangentens hældning|differentialkvotienten.{0,80}tangentens haeldning|tangentens hældning.{0,80}punktet|tangentens haeldning.{0,80}punktet)\b/i,
  },
  {
    curriculumId: "calculus.derivative",
    title: "Differentialkvotient og afledt",
    topicGroup: "Differentialregning",
    keywords: ["differentialkvotient", "afledt", "derivere"],
    pattern: /\b(differentialkvotient|afledt|afledte|derivere|differentier|f'\(x\)|f’\(x\)|hældning for tangenten|haeldning for tangenten)\b/i,
  },
  {
    curriculumId: "calculus.three_step_rule",
    title: "Tretrinsreglen",
    topicGroup: "Differentialregning",
    keywords: ["tretrinsreglen", "differentialkvotient", "grænseværdi"],
    pattern: /\b(tretrinsreglen|tre-trins-reglen|tretrinsmetoden|differenskvotient|grænseværdi|graensevaerdi|h\s*går\s*mod\s*0|h\s*gaar\s*mod\s*0)\b/i,
  },
  {
    curriculumId: "calculus.monotonicity_intervals",
    title: "Monotoniforhold",
    topicGroup: "Differentialregning",
    keywords: ["monotoniforhold", "voksende", "aftagende"],
    pattern: /\b(monotoniforhold|bestemme.{0,40}monotoniforhold|i hvilke intervaller funktionen er voksende|i hvilke intervaller funktionen er aftagende)\b/i,
  },
  {
    curriculumId: "calculus.monotonicity",
    title: "Monotonisætningen",
    topicGroup: "Differentialregning",
    keywords: ["monotoni", "voksende", "aftagende", "afledt"],
    pattern: /\b(monotonisætningen|monotonisaetningen|voksende|aftagende|konstant|f'\(x\)\s*[<>=]|f’\(x\)\s*[<>=])\b/i,
  },
  {
    curriculumId: "calculus.derivative_sign",
    title: "Fortegn for den afledte",
    topicGroup: "Differentialregning",
    keywords: ["fortegn", "afledt", "voksende", "aftagende"],
    pattern: /\b(fortegnet\s+for\s+(?:den\s+)?afledte|fortegn\s+for\s+f['’]|f['’]\(x\)\s*>\s*0|f['’]\(x\)\s*<\s*0|positiv\s+afledt|negativ\s+afledt)\b/i,
  },
  {
    curriculumId: "calculus.sign_chart",
    title: "Monotonilinje",
    topicGroup: "Differentialregning",
    keywords: ["fortegnsskema", "monotonilinje", "afledt"],
    pattern: /\b(monotonilinje|fortegnsskema|fortegn|nulpunkt for f'|nulpunkter for f'|fortegnet for den afledte)\b/i,
  },
  {
    curriculumId: "calculus.critical_points",
    title: "Nulpunkter for den afledte",
    topicGroup: "Differentialregning",
    keywords: ["afledt", "nulpunkt", "ekstremum"],
    pattern: /\b(sætter den afledte lig med 0|saetter den afledte lig med 0|f['’]\(x\)\s*=\s*0|nulpunkter?\s+for\s+f['’]|nulpunkterne.{0,40}afledte)\b/i,
  },
  {
    curriculumId: "calculus.tangent",
    title: "Tangentligningen",
    topicGroup: "Differentialregning",
    keywords: ["tangent", "tangentligning", "afledt"],
    pattern: /\b(tangentligning|tangentens ligning|tangent|sekant|y\s*=\s*f\(x_?0\)\s*\+\s*f['’]\(x_?0\))\b/i,
  },
  {
    curriculumId: "calculus.inflection_tangent",
    title: "Vendetangenter via f''(x)",
    topicGroup: "Differentialregning",
    keywords: ["vendetangent", "vendepunkt", "anden afledte"],
    pattern: /\b(vendetangent|vendepunkt|krumningsforhold|f''\(x\)|f’’\(x\)|anden afledte|2\.\s*afledte)\b/i,
  },
  {
    curriculumId: "optimization.volume",
    title: "Optimering med volumenbetingelse",
    topicGroup: "Optimering",
    keywords: ["optimering", "volumen", "betingelse"],
    pattern: /\b(volumenbetingelse|volumen|overfladeareal|kasse|h\s*=\s*100\s*\/\s*x\^?2|400\s*\/\s*x)\b/i,
  },
  {
    curriculumId: "optimization.surface_area",
    title: "Overfladeareal som funktion",
    topicGroup: "Optimering",
    keywords: ["overfladeareal", "funktion", "kasse"],
    pattern: /\b(overfladeareal|O\(x\s*,\s*h\)\s*=\s*4xh\s*\+\s*x\^?2|O\(x\)\s*=\s*400\s*\/\s*x\s*\+\s*x\^?2|metalforbrug)\b/i,
  },
  {
    curriculumId: "optimization.substitution",
    title: "Indsættelse af volumenbetingelsen",
    topicGroup: "Optimering",
    keywords: ["volumenbetingelse", "indsættelse", "overfladeareal", "én variabel"],
    pattern: /\b(sættes\s+ind\s+i\s+overfladearealet|saettes\s+ind\s+i\s+overfladearealet|sætter\s+vi\s+ind\s+i\s+O\(x|saetter\s+vi\s+ind\s+i\s+O\(x|O\(x\)\s*=\s*(?:400\s*\/\s*x\s*\+\s*x\^?2|x\^?2\s*\+\s*400\s*\/\s*x))\b/i,
  },
  {
    curriculumId: "optimization.volume_constraint",
    title: "Volumenbetingelse",
    topicGroup: "Optimering",
    keywords: ["volumenbetingelse", "volumen", "højde"],
    pattern: /\b(volumenbetingelse|kassens volumen|V\s*=\s*x\s*·?\s*x\s*·?\s*h|x\^?2h\s*=\s*100|h\s*=\s*100\s*\/\s*x\^?2)\b/i,
  },
  {
    curriculumId: "optimization.domain",
    title: "Definitionsmængde i optimering",
    topicGroup: "Optimering",
    keywords: ["definitionsmængde", "positive længder", "optimering", "x større end 0"],
    pattern: /\b(x\s*>\s*0|positive\s+længder|positive\s+laengder|længder\s+skal\s+være\s+positive|laengder\s+skal\s+vaere\s+positive|giver\s+mening\s+i\s+situationen)\b/i,
  },
  {
    curriculumId: "optimization.derivative_condition",
    title: "Førsteordensbetingelse for optimering",
    topicGroup: "Optimering",
    keywords: ["optimering", "afledt", "minimum"],
    pattern: /\b(O['’]\(x\)\s*=\s*0|sætter\s+O['’]\(x\)\s*=\s*0|saetter\s+O['’]\(x\)\s*=\s*0|differentierer\s+vi\s+O\(x\)|for at finde minimum)\b/i,
  },
  {
    curriculumId: "optimization.general",
    title: "Optimering",
    topicGroup: "Optimering",
    keywords: ["optimering", "maksimum", "minimum"],
    pattern: /\b(optimering|optimere|maksimere|minimere|største værdi|mindste værdi|stoerste vaerdi|mindste vaerdi)\b/i,
  },
  {
    curriculumId: "functions.linear",
    title: "Lineære funktioner",
    topicGroup: "Funktioner",
    keywords: ["lineær", "hældning", "begyndelsesværdi"],
    pattern: /\b(lineær funktion|lineaer funktion|rette linje|begyndelsesværdi|begyndelsesvaerdi|y\s*=\s*a\s*x\s*\+\s*b|f\(x\)\s*=\s*a\s*x\s*\+\s*b)\b/i,
  },
  {
    curriculumId: "functions.proportionality",
    title: "Proportionalitet",
    topicGroup: "Funktioner",
    keywords: ["proportionalitet", "ligefrem", "omvendt"],
    pattern: /\b(proportionalitet|ligefrem proportional|omvendt proportional|proportional med|konstant forhold)\b/i,
  },
  {
    curriculumId: "functions.exponential",
    title: "Eksponentialfunktioner",
    topicGroup: "Funktioner",
    keywords: ["eksponentialfunktion", "fremskrivningsfaktor", "vækst"],
    pattern: /\b(eksponentialfunktion|eksponentiel|fremskrivningsfaktor|vækstrate|vaekstrate|fordobling|halvering|a\s*·?\s*b\^?x|a\s*\*\s*b\^?x)\b/i,
  },
  {
    curriculumId: "functions.piecewise_concept",
    title: "Stykkevise funktioner",
    topicGroup: "Funktioner",
    keywords: ["stykkevise funktioner", "intervaller", "funktionsforskrift"],
    pattern: /\b(stykkevise funktioner|funktionsforskriften ændrer sig|funktionsforskriften aendrer sig|forskellige intervaller)\b/i,
  },
  {
    curriculumId: "functions.piecewise",
    title: "Gaffelforskrift",
    topicGroup: "Funktioner",
    keywords: ["gaffelforskrift", "stykkevis", "intervaller"],
    pattern: /\b(gaffelforskrift|stykkevis)\b/i,
  },
  {
    curriculumId: "functions.piecewise_intervals",
    title: "Intervaller i stykkevise funktioner",
    topicGroup: "Funktioner",
    keywords: ["intervaller", "stykkevis", "endepunkter"],
    pattern: /\b(intervallerne?\s+afgør|intervallerne?\s+afgoer|hvilket\s+interval\s+x|for\s+x\s*(?:<|>|≤|≥|<=|>=)|åbne\s+og\s+lukkede\s+intervaller|aabne\s+og\s+lukkede\s+intervaller)\b/i,
  },
  {
    curriculumId: "functions.piecewise_differentiation",
    title: "Differentiation af stykkevise funktioner",
    topicGroup: "Funktioner",
    keywords: ["differentiation", "stykkevis", "intervaller"],
    pattern: /\b(differentierer\s+stykkevise\s+funktioner|differentierer vi i virkeligheden bare i de forskellige intervaller|differentier.{0,60}intervaller hver for sig)\b/i,
  },
  {
    curriculumId: "functions.piecewise_endpoint_notation",
    title: "Bollenotation for sammensatte funktioner",
    topicGroup: "Funktioner",
    keywords: ["bollenotation", "åben bolle", "lukket bolle", "intervaller"],
    pattern: /\b(bollenotation|åben bolle|aaben bolle|lukket bolle|åbne og lukkede endepunkter|aabne og lukkede endepunkter)\b/i,
  },
  {
    curriculumId: "functions.domain_range",
    title: "Definitionsmængde og værdimængde",
    topicGroup: "Funktioner",
    keywords: ["definitionsmængde", "værdimængde", "intervaller"],
    pattern: /\b(definitionsmængde|definitionsmaengde|værdimængde|vaerdimaengde|dm\s*\(|vm\s*\(|tilladte x-værdier|funktionsværdier)\b/i,
  },
  {
    curriculumId: "geometry.distance",
    title: "Afstandsformlen mellem to punkter",
    topicGroup: "Analytisk geometri",
    keywords: ["afstand", "punkter", "koordinater"],
    pattern: /\b(afstandsformlen|afstanden mellem to punkter|pythagoras|\|ab\||kvadratrod|√\(\(x_?2\s*-\s*x_?1)\b/i,
  },
  {
    curriculumId: "geometry.point_line_distance",
    title: "Distancen fra punkt til linje",
    topicGroup: "Analytisk geometri",
    keywords: ["punkt", "linje", "distance"],
    pattern: /\b(distancen fra punkt til linje|afstand fra punkt til linje|punkt til linje|d\s*\(\s*P\s*,\s*l\s*\)|\|a\s*x_?0\s*\+\s*b\s*y_?0\s*\+\s*c\|\s*\/\s*√?\(?a\^?2\s*\+\s*b\^?2\)?)\b/i,
  },
  {
    curriculumId: "geometry.circle",
    title: "Cirklens ligning",
    topicGroup: "Analytisk geometri",
    keywords: ["cirkel", "centrum", "radius"],
    pattern: /\b(cirklens ligning|centrum|radius|r\^?2|\(x\s*-\s*a\)\^?2|\(y\s*-\s*b\)\^?2)\b/i,
  },
  {
    curriculumId: "geometry.circle.rewrite",
    title: "Omskrivning af cirklens ligning",
    topicGroup: "Analytisk geometri",
    keywords: ["cirkel", "omskrivning", "kvadratkomplettering"],
    pattern: /\b(omskriv(?:e|ning).{0,40}cirklens ligning|cirkel.{0,40}standardform|fuldstændige kvadrater|fuldstaendige kvadrater|kvadratkompletter.{0,40}cirkel)\b/i,
  },
  {
    curriculumId: "trig.unit_circle_sine",
    title: "Sinus på enhedscirklen",
    topicGroup: "Trigonometri",
    keywords: ["sinus", "enhedscirkel", "vinkel"],
    pattern: /\b(enhedscirklen|sinus til en vinkel|samme sinusværdi|samme sinusvaerdi|vinkelbenet)\b/i,
  },
  {
    curriculumId: "trig.area_formula",
    title: "Arealformlen for vilkårlige trekanter",
    topicGroup: "Trigonometri",
    keywords: ["arealformel", "trekant", "sinus"],
    pattern: /\b(arealformlen|arealet af en trekant|T\s*=\s*1\s*\/\s*2\s*·?\s*a\s*·?\s*b\s*·?\s*sin\(?C\)?|to sider og den mellemliggende vinkel)\b/i,
  },
  {
    curriculumId: "trig.relations",
    title: "Trigonometriske relationer",
    topicGroup: "Trigonometri",
    keywords: ["trigonometri", "sinus", "cosinus", "tangens"],
    pattern: /\b(trigonometriske relationer|trigonometri|retvinklet trekant|sin\(|cos\(|tan\(|sinus|cosinus|tangens)\b/i,
  },
  {
    curriculumId: "trig.pythagorean_identity",
    title: "Pythagoræisk grundrelation",
    topicGroup: "Trigonometri",
    keywords: ["pythagoræisk", "sinus", "cosinus"],
    pattern: /\b(pythagoræisk grundrelation|pythagoraeisk grundrelation|sin\^?2\s*\(?x\)?\s*\+\s*cos\^?2\s*\(?x\)?\s*=\s*1|cos\^?2\s*\+\s*sin\^?2)\b/i,
  },
  {
    curriculumId: "trig.cosine_rule",
    title: "Cosinusrelationen",
    topicGroup: "Trigonometri",
    keywords: ["cosinusrelation", "trekant"],
    pattern: /\b(cosinusrelation|cosinusrelationen|cosinusrelationerne)\b/i,
  },
  {
    curriculumId: "trig.sine_rule",
    title: "Sinusrelationen",
    topicGroup: "Trigonometri",
    keywords: ["sinusrelation", "trekant"],
    pattern: /\b(sinusrelation|sinusrelationen|sinusrelationerne)\b/i,
  },
];

const TITLE_NOISE_RE = /^(?:\d+(?:[.,]\d+)?|[xyzabctd]{1,3}|punkterne|løsningerne|loesningerne|ønsker|onsker|bestemme|beregne)$/i;
const GENERIC_HEADING_RE = /^(?:opsummering|resume|resumé|eksempel|figur|opgave|facit|løsning|loesning|svar)$/i;
const STOPWORDS = new Set(["med", "til", "fra", "som", "der", "det", "den", "for", "har", "kan", "skal", "ved", "bruges"]);
const BROAD_TITLE_RE =
  /^(?:andengradspolynomier og ligninger|analytisk plangeometri|analytisk geometri|differentialregning|funktioner og grafer|optimering)$/i;
const BAD_BLOCK_TITLE_RE =
  /^(?:\d+(?:[.,]\d+)?|[xyzabchdortv]{1,3}|[+\-±=≈<>/\\^_*()]+|\d+[xyzabchdortv]+|[xyzabchdortv]+\d+|punkterne|løsningerne|loesningerne|ønsker|onsker|bestemme|beregne)$/i;

function findPatterns(text: string) {
  return CONCEPT_PATTERNS.filter((entry) => entry.pattern.test(text));
}

function findBroadPatterns(text: string) {
  return BROAD_CONCEPT_PATTERNS.filter((entry) => entry.pattern.test(text));
}

function cleanTitleCandidate(value: string) {
  const cleaned = trimMathSentenceEnding(value)
    .replace(/\b(?:side|figur|s\.)\s+\d+\b/gi, "")
    .replace(/\s*\/\s*/g, " / ")
    .replace(/\s+/g, " ")
    .trim();
  const key = normalizeMathKey(cleaned);
  if (!cleaned || cleaned.length < 8 || cleaned.length > 78) return null;
  if (TITLE_NOISE_RE.test(key)) return null;
  if (GENERIC_HEADING_RE.test(key)) return null;
  if (/[=≈<>]/.test(cleaned)) return null;
  if ((cleaned.match(/\d/g) ?? []).length >= 3) return null;
  if (/^(?:bestem|beregn|vis|indsæt|indsaet|forklar|løs|loes)\b/i.test(cleaned)) return null;
  return cleaned.charAt(0).toUpperCase() + cleaned.slice(1);
}

function isConcreteTeachingTitle(title: string) {
  const normalized = normalizeMathKey(title);
  if (!normalized || BAD_BLOCK_TITLE_RE.test(normalized)) return false;
  if (BROAD_TITLE_RE.test(title)) return false;
  return /\b(?:formel|formlen|sætning|saetning|ligning|metode|standardform|koefficient|nulregel|distance|afstand|cirkel|monotoni|monotonilinje|tangent|differentialkvotient|tretrinsreglen|diskriminant|kvadratkomplettering|gaffelforskrift|bollenotation|afledt|fortegn|relation|enhedscirklen|arealformlen|overfladeareal|volumenbetingelse|definitionsmængde|definitionsmaengde|førsteordensbetingelse|foersteordensbetingelse|stykkevise funktioner|intervaller)\b/i.test(
    title,
  );
}

function extractKeywords(text: string, seed: string[]) {
  const counts = new Map<string, number>();
  for (const keyword of seed) counts.set(keyword, (counts.get(keyword) ?? 0) + 4);
  for (const token of normalizeMathKey(text).match(/[a-zæøå]{4,}/g) ?? []) {
    if (STOPWORDS.has(token)) continue;
    counts.set(token, (counts.get(token) ?? 0) + 1);
  }
  return Array.from(counts.entries())
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, 7)
    .map(([token]) => token);
}

function sourcePagesForPieces(pieces: MathFilteredPiece[]) {
  return Array.from(new Set(pieces.map((piece) => piece.sourcePage).filter((page): page is number => page != null))).sort(
    (a, b) => a - b,
  );
}

function sourceRefsForPieces(pieces: MathFilteredPiece[]) {
  return Array.from(new Set(pieces.map((piece) => piece.sourceRef).filter(Boolean))).slice(0, 5);
}

function isRetainableFormulaPiece(piece: MathFilteredPiece) {
  if (piece.kind !== "formula" && piece.kind !== "example") return false;
  const text = trimMathSentenceEnding(piece.text);
  if (text.length < 6 || text.length > 220) return false;
  if (/\\begin|\\end|aligned|cases|array|matrix|\$\$/i.test(text)) return false;
  return /(?:=|≈|≤|≥|<|>|\^|√|±|\\frac|\\sqrt|f['’]\(|\b(?:sin|cos|tan)\s*\()/i.test(text);
}

function attachNearbyFormulaEvidence(byTitle: Map<string, MathRecognizedConcept>, filteredPieces: MathFilteredPiece[]) {
  const concepts = Array.from(byTitle.values());
  const formulaPieces = filteredPieces.filter(isRetainableFormulaPiece);

  for (const formulaPiece of formulaPieces) {
    const nearbyConcepts = concepts.filter((concept) => {
      const sameRef = formulaPiece.sourceRef && concept.sourceRefs.includes(formulaPiece.sourceRef);
      const samePage = formulaPiece.sourcePage != null && concept.sourcePages.includes(formulaPiece.sourcePage);
      return sameRef || samePage;
    });

    for (const concept of nearbyConcepts.slice(0, 2)) {
      if (concept.pieces.some((piece) => piece.id === formulaPiece.id)) continue;
      concept.pieces.push(formulaPiece);
      concept.keywords = extractKeywords(concept.pieces.map((entry) => entry.text).join(" "), concept.keywords);
      concept.sourcePages = sourcePagesForPieces(concept.pieces);
      concept.sourceRefs = sourceRefsForPieces(concept.pieces);
      concept.confidence = Math.max(concept.confidence, Math.min(0.94, concept.confidence + 0.03));
    }
  }
}

function confidenceFor(pattern: ConceptPattern | null, piece: MathFilteredPiece, evidenceCount: number) {
  const base = pattern ? (pattern.specificity === "broad" ? 0.5 : 0.68) : 0.42;
  const scoreBoost = Math.min(0.2, Math.max(0, piece.filterScore) / 55);
  const evidenceBoost = Math.min(0.12, Math.max(0, evidenceCount - 1) * 0.04);
  const kindBoost = piece.kind === "heading" || piece.kind === "keyword" ? 0.06 : 0;
  return Math.min(0.98, base + scoreBoost + evidenceBoost + kindBoost);
}

function addConceptMatch(
  byTitle: Map<string, MathRecognizedConcept>,
  match: ConceptPattern,
  piece: MathFilteredPiece,
) {
  const key = normalizeMathKey(match.title);
  if (!key) return;
  const existing = byTitle.get(key);
  if (existing) {
    existing.pieces.push(piece);
    existing.keywords = extractKeywords(existing.pieces.map((entry) => entry.text).join(" "), [
      ...existing.keywords,
      ...match.keywords,
    ]);
    existing.sourcePages = sourcePagesForPieces(existing.pieces);
    existing.sourceRefs = sourceRefsForPieces(existing.pieces);
    existing.confidence = Math.max(existing.confidence, confidenceFor(match, piece, existing.pieces.length));
    return;
  }

  const pieces = [piece];
  byTitle.set(key, {
    id: `math-concept-${byTitle.size + 1}`,
    title: match.title,
    topicGroup: match.topicGroup,
    pieces,
    keywords: extractKeywords(piece.text, match.keywords),
    sourcePages: sourcePagesForPieces(pieces),
    sourceRefs: sourceRefsForPieces(pieces),
    confidence: confidenceFor(match, piece, 1),
    curriculumId: match.curriculumId,
  });
}

function sortAndLimitConcepts(concepts: MathRecognizedConcept[], limit: number, idPrefix = "math-concept") {
  return concepts
    .filter((concept) => concept.confidence >= 0.46 && concept.pieces.length > 0)
    .sort((a, b) => {
      const firstPageA = a.sourcePages[0] ?? 9999;
      const firstPageB = b.sourcePages[0] ?? 9999;
      return firstPageA - firstPageB || b.confidence - a.confidence || a.title.localeCompare(b.title);
    })
    .slice(0, limit)
    .map((concept, index) => ({ ...concept, id: `${idPrefix}-${index + 1}` }));
}

function buildBroadConcepts(filteredPieces: MathFilteredPiece[]) {
  const byTitle = new Map<string, MathRecognizedConcept>();

  for (const piece of filteredPieces) {
    for (const match of findBroadPatterns(piece.text)) {
      addConceptMatch(byTitle, match, piece);
    }

    if (piece.kind !== "heading" && piece.kind !== "subheading") continue;
    const title = cleanTitleCandidate(piece.text);
    if (!title || !BROAD_TITLE_RE.test(title)) continue;
    addConceptMatch(byTitle, {
      curriculumId: `broad.local.${normalizeMathKey(title).slice(0, 32)}`,
      title,
      topicGroup: title,
      keywords: [],
      pattern: /$a/,
      specificity: "broad",
    }, piece);
  }

  return sortAndLimitConcepts(Array.from(byTitle.values()), 16, "math-broad");
}

function hasNearbyConcreteConcept(broad: MathRecognizedConcept, concrete: MathRecognizedConcept[]) {
  return concrete.some((candidate) => {
    if (!isConcreteTeachingTitle(candidate.title)) return false;
    if (candidate.topicGroup === broad.topicGroup) return true;
    const sameRef = candidate.sourceRefs.some((ref) => broad.sourceRefs.includes(ref));
    const samePage = candidate.sourcePages.some((page) => broad.sourcePages.includes(page));
    return sameRef || samePage;
  });
}

function dropBroadTitlesWhenConcreteExists(concepts: MathRecognizedConcept[]) {
  const concrete = concepts.filter((concept) => isConcreteTeachingTitle(concept.title));
  return concepts.filter((concept) => !BROAD_TITLE_RE.test(concept.title) || !hasNearbyConcreteConcept(concept, concrete));
}

function mergeEquivalentConcepts(concepts: MathRecognizedConcept[]) {
  const alias = (title: string) => {
    const key = normalizeMathKey(title);
    if (/monotoni/.test(key) && /saetning|sætning|f'/.test(key)) return "monotonisaetningen";
    if (/^fortegn for den afledte$/.test(key)) return "fortegn for den afledte";
    if (/monotonilinje|fortegnsskema|fortegn/.test(key)) return "monotonilinje";
    if (/monotoniforhold/.test(key)) return "monotoniforhold";
    if (/diskriminantmetoden/.test(key)) return "diskriminantmetoden";
    if (/diskriminantens loesningstilfaelde|diskriminantens løsningstilfælde/.test(key)) {
      return "diskriminantens loesningstilfaelde";
    }
    if (/diskriminant/.test(key)) return "diskriminant og betydning";
    if (/standardform/.test(key) && /andengrad/.test(key)) return "standardform for andengradsligninger";
    if (/loesningsformel|løsningsformel/.test(key)) return "loesningsformlen for andengradsligninger";
    if (/cirklens ligning/.test(key) && !/omskriv|standardform|kvadrat/.test(key)) return "cirklens ligning";
    if (/afstand/.test(key) && /to punkter|mellem to/.test(key)) return "afstandsformlen mellem to punkter";
    if (/arealformlen/.test(key) && /trekant/.test(key)) return "arealformlen for vilkarlige trekanter";
    if (/optimering med volumenbetingelse/.test(key)) return "optimering med volumenbetingelse";
    if (/^volumenbetingelse$/.test(key)) return "volumenbetingelse";
    if (/overfladeareal/.test(key)) return "overfladeareal som funktion";
    return key;
  };

  const byAlias = new Map<string, MathRecognizedConcept>();
  for (const concept of concepts) {
    const key = alias(concept.title);
    const existing = byAlias.get(key);
    if (!existing) {
      byAlias.set(key, { ...concept, pieces: [...concept.pieces], keywords: [...concept.keywords] });
      continue;
    }

    existing.pieces.push(...concept.pieces.filter((piece) => !existing.pieces.some((item) => item.id === piece.id)));
    existing.keywords = extractKeywords(existing.pieces.map((entry) => entry.text).join(" "), [
      ...existing.keywords,
      ...concept.keywords,
    ]);
    existing.sourcePages = sourcePagesForPieces(existing.pieces);
    existing.sourceRefs = sourceRefsForPieces(existing.pieces);
    existing.confidence = Math.max(existing.confidence, concept.confidence);
  }

  return Array.from(byAlias.values());
}

function splitDriverForConcept(concept: MathRecognizedConcept) {
  const kinds = Array.from(new Set(concept.pieces.map((piece) => piece.kind))).join("+");
  const formulaEvidence = concept.pieces.some(isRetainableFormulaPiece);
  const headingEvidence = concept.pieces.some((piece) => piece.kind === "heading" || piece.kind === "subheading");
  const pageText = concept.sourceRefs.join(", ") || "ukendt kilde";
  const driver = formulaEvidence ? "formula/local rule" : headingEvidence ? "heading/subheading" : "keyword/example";
  return `${concept.title} <= ${driver}; pieces=${concept.pieces.length}; kinds=${kinds}; refs=${pageText}`;
}

function droppedSplitDebug(splitCandidates: MathRecognizedConcept[], finalConcepts: MathRecognizedConcept[]) {
  const finalKeys = new Set(finalConcepts.map((concept) => normalizeMathKey(concept.title)));
  return splitCandidates
    .filter((concept) => !finalKeys.has(normalizeMathKey(concept.title)))
    .map((concept) => `${concept.title} dropped/merged; confidence=${concept.confidence.toFixed(2)}; refs=${concept.sourceRefs.join(", ")}`);
}

function buildSplitCandidates(filteredPieces: MathFilteredPiece[]) {
  const byTitle = new Map<string, MathRecognizedConcept>();

  for (const piece of filteredPieces) {
    const patterns = findPatterns(piece.text);
    const matches =
      patterns.length > 0
        ? patterns
        : piece.kind === "heading" || piece.kind === "subheading"
          ? [
              {
                curriculumId: `local.${normalizeMathKey(piece.text).slice(0, 32)}`,
                title: cleanTitleCandidate(piece.text) ?? "",
                topicGroup: "Matematiske begreber",
                keywords: [],
                pattern: /$a/,
              },
            ].filter((entry) => entry.title)
          : [];

    for (const match of matches) {
      addConceptMatch(byTitle, match, piece);
    }
  }

  attachNearbyFormulaEvidence(byTitle, filteredPieces);

  return Array.from(byTitle.values());
}

export function recognizeMathConceptLayers(filteredPieces: MathFilteredPiece[], limit = 32): MathConceptRecognitionLayers {
  const broadConcepts = buildBroadConcepts(filteredPieces);
  const splitCandidates = sortAndLimitConcepts(buildSplitCandidates(filteredPieces), Math.max(limit + 10, 36), "math-split");
  const finalConcepts = sortAndLimitConcepts(
    mergeEquivalentConcepts(dropBroadTitlesWhenConcreteExists(splitCandidates)),
    limit,
    "math-concept",
  );

  return {
    broadConcepts,
    splitCandidates,
    splitDebug: splitCandidates.map(splitDriverForConcept),
    droppedSplitCandidates: droppedSplitDebug(splitCandidates, finalConcepts),
    finalConcepts,
  };
}

export function recognizeMathConcepts(filteredPieces: MathFilteredPiece[], limit = 32): MathRecognizedConcept[] {
  return recognizeMathConceptLayers(filteredPieces, limit).finalConcepts;
}

export const normalizeMathConcepts = recognizeMathConcepts;
