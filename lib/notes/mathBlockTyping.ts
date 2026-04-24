import type { MathRecognizedConcept } from "@/lib/notes/mathConceptRecognizer";

export type MathKnowledgeBlockKind = "concept" | "rule" | "method" | "example" | "pitfall";

export type MathBlockTypingResult = {
  kind: MathKnowledgeBlockKind;
  secondaryHints: MathKnowledgeBlockKind[];
};

const RULE_TITLE_RE =
  /\b(formel|formlen|sætning|saetning|ligning|diskriminant|standardform|nulreglen|toppunktsformlen|løsningsformlen|loesningsformlen|afstandsformlen|distancen fra punkt til linje|arealformlen|grundrelation|førsteordensbetingelse|foersteordensbetingelse)\b/i;
const METHOD_TITLE_RE =
  /\b(optimering|kvadratkomplettering|diskriminantmetoden|fortegnsskema|monotonilinje|gaffelforskrift|stykkevis|tangent|bollenotation|omskrivning|volumenbetingelse|overfladeareal|nulpunkter for den afledte|tretrinsreglen)\b/i;
const CONCEPT_TITLE_RE = /\b(differentialkvotient|afledt|definitionsmængde|definitionsmaengde|værdimængde|vaerdimaengde|proportionalitet)\b/i;
const EXAMPLE_TITLE_RE = /\b(eksempel|gennemregnet eksempel|modelopgave)\b/i;
const PITFALL_TITLE_RE = /\b(faldgrube|typisk fejl|misforståelse|misforstaaelse)\b/i;
const EXAMPLE_RE = /\b(eksempel|fx|f\.eks\.|opgave)\b/i;
const PITFALL_RE = /\b(pas på|pas paa|bemærk|bemaerk|fejl|undgå|undgaa|ikke|kun hvis|husk|fortegnene|aldrig dividere med 0)\b/i;

function preferredKindFromTitle(title: string): MathKnowledgeBlockKind | null {
  if (PITFALL_TITLE_RE.test(title)) return "pitfall";
  if (EXAMPLE_TITLE_RE.test(title)) return "example";
  if (/monotonisætningen|monotonisaetningen|cosinusrelationen|sinusrelationen/i.test(title)) return "rule";
  if (RULE_TITLE_RE.test(title)) return "rule";
  if (METHOD_TITLE_RE.test(title)) return "method";
  if (CONCEPT_TITLE_RE.test(title)) return "concept";
  return null;
}

export function classifyMathKnowledgeBlock(concept: MathRecognizedConcept): MathBlockTypingResult {
  const evidenceText = concept.pieces.map((piece) => piece.text).join(" ");
  const hints: MathKnowledgeBlockKind[] = [];
  const preferred = preferredKindFromTitle(concept.title);

  if (RULE_TITLE_RE.test(concept.title) || /\b(regel|formel|gælder|gaelder)\b/i.test(evidenceText)) hints.push("rule");
  if (METHOD_TITLE_RE.test(concept.title) || /\b(metode|bruges til|finde|bestemme|beregne|undersøge|undersoege)\b/i.test(evidenceText)) {
    hints.push("method");
  }
  if (EXAMPLE_TITLE_RE.test(concept.title) || (EXAMPLE_RE.test(evidenceText) && concept.pieces.length <= 2)) hints.push("example");
  if (PITFALL_TITLE_RE.test(concept.title) || PITFALL_RE.test(evidenceText)) hints.push("pitfall");
  if (preferred) hints.unshift(preferred);

  const primary =
    preferred ??
    hints.find((hint) => hint === "rule") ??
    hints.find((hint) => hint === "method") ??
    hints.find((hint) => hint === "pitfall") ??
    hints.find((hint) => hint === "example") ??
    "concept";

  return {
    kind: primary,
    secondaryHints: Array.from(new Set(hints.filter((hint) => hint !== primary))),
  };
}
