import { normalizeLearningSubjectText } from "@/lib/learning/subjects/families";

const BIOLOGI_GENERATE_CONTEXT_RE =
  /\b(biologi|biology|bio|celle|celler|cellebiologi|fysiologi|genetik|dna|rna|protein|enzym|respiration|fotosyntese|evolution|oekologi|økologi|population|naturlig selektion|mutation|mitose|meiose|forsoeg|forsøg|kontrolgruppe|figur|tabel|graf|data)\b/i;

export function inferBiologiTrainerGenerateFamily(value: string) {
  return BIOLOGI_GENERATE_CONTEXT_RE.test(normalizeLearningSubjectText(value)) ? "biologi" : null;
}

export function buildBiologiTrainerGeneratePromptAddendum() {
  return [
    "",
    "Biologi-spørgsmålsfokus:",
    "- Foretræk spørgsmål der får eleven til at forklare biologiske mekanismer, processer og årsag-virkning frem for kun at nævne fagord.",
    "- Hvis materialet indeholder data, figurer, tabeller eller forsøgsresultater, så lad spørgsmålet kræve fortolkning og brug af data som belæg.",
    "- Kobl gerne biologisk teori tydeligt til case, bilag eller forsøg i materialet.",
    "- Spørg gerne så eleven skal forklare sammenhængen mellem delprocesser, ikke kun opliste dem.",
  ].join("\n");
}
