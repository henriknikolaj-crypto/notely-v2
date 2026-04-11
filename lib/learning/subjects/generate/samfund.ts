import { normalizeLearningSubjectText } from "@/lib/learning/subjects/families";

const SAMFUND_GENERATE_CONTEXT_RE =
  /\b(samfund|samfundsfag|samf|social science|social studies|politik|politiske|velfaerd|velfærd|offentlige finanser|solidaritet|individuelt ansvar|arbejdsmarked|offentlig sektor|statens udgifter|globalisering|magt|demokrati|ideologi)\b/i;

export function inferSamfundTrainerGenerateFamily(value: string) {
  return SAMFUND_GENERATE_CONTEXT_RE.test(normalizeLearningSubjectText(value)) ? "samfund" : null;
}

export function buildSamfundTrainerGeneratePromptAddendum() {
  return [
    "",
    "Samfundsfagligt spørgmålsfokus:",
    "- Foretræk spørgsmål der kræver brug af samfundsfaglige begreber, analyse og tydelig teori-case-kobling.",
    "- Spørg gerne så eleven skal forklare sammenhænge mellem aktører, interesser, konsekvenser og samfundsmæssige forhold.",
    "- Når materialet lægger op til det, må spørgsmålet gerne slutte med en kort vurdering eller diskussion.",
    "- Undgå rene referatspørgsmål; spørg hellere hvad forholdene betyder, og hvordan de hænger sammen.",
  ].join("\n");
}
