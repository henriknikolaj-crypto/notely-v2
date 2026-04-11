import { normalizeLearningSubjectText } from "@/lib/learning/subjects/families";

const MATEMATIK_GENERATE_CONTEXT_RE =
  /\b(matematik|math|maths|mathematics|mat|beregn|bestem|loes|løs|udled|begrund|bevis|graf|funktion|haeldning|hældning|skaering|skæring|sandsynlighed|enhed|enheder|model|ligning|parabel|vektor|procent|deriver|integral)\b/i;

export function inferMatematikTrainerGenerateFamily(value: string) {
  return MATEMATIK_GENERATE_CONTEXT_RE.test(normalizeLearningSubjectText(value)) ? "matematik" : null;
}

export function buildMatematikTrainerGeneratePromptAddendum() {
  return [
    "",
    "Matematik-spørgsmålsfokus:",
    "- Foretræk spørgsmål der tydeligt peger på metodevalg, mellemregninger og matematisk præcision.",
    "- Hvis materialet handler om graf, funktion eller model, så lad spørgsmålet lægge op til både beregning og kort fortolkning.",
    "- Gør det tydeligt hvilke oplysninger eller størrelser eleven skal bruge, uden at gøre spørgsmålet til en lang delopgave.",
    "- Læg gerne op til korrekt notation, enheder og en klar begrundelse, når opgaven kræver det.",
  ].join("\n");
}
