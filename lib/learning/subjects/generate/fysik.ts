import { normalizeLearningSubjectText } from "@/lib/learning/subjects/families";

const FYSIK_GENERATE_CONTEXT_RE =
  /\b(fysik|physics|kraft|energi|acceleration|spænding|stroem|strøm|bølge|frekvens|effekt|bevægelse|hydrofon|lydhastighed|lydsignal|tryk|temperatur|graf|maaling|måling|model|forsoeg|forsøg|usikkerhed|enhed|enheder)\b/i;

export function inferFysikTrainerGenerateFamily(value: string) {
  return FYSIK_GENERATE_CONTEXT_RE.test(normalizeLearningSubjectText(value)) ? "fysik" : null;
}

export function buildFysikTrainerGeneratePromptAddendum() {
  return [
    "",
    "Fysik-spørgsmålsfokus:",
    "- Foretræk spørgsmål der kombinerer beregning eller modelbrug med kort fysisk forklaring.",
    "- Hvis materialet indeholder data, målinger eller grafer, så lad spørgsmålet kræve fortolkning af hvad resultatet betyder fysisk.",
    "- Gør det tydeligt hvilke givne oplysninger eleven skal bruge, og læg op til korrekt brug af enheder og notation.",
    "- Når det passer til materialet, må spørgsmålet gerne invitere til kort kommentar om model, antagelse eller usikkerhed.",
  ].join("\n");
}
