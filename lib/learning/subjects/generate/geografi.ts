import { normalizeLearningSubjectText } from "@/lib/learning/subjects/families";

const GEOGRAFI_GENERATE_CONTEXT_RE =
  /\b(geografi|geography|geo|klima|nedboer|nedbør|temperatur|vejr|vejrsystem|vandkredslob|vandkredsløb|erosion|forvitring|pladetektonik|vulkan|jordskelv|urbanisering|befolkning|migration|globalisering|erhverv|regional udvikling|kort|kortbilag|figur|graf|tabel|data|diagram|naturgeografi|samfundsgeografi)\b/i;

export function inferGeografiTrainerGenerateFamily(value: string) {
  return GEOGRAFI_GENERATE_CONTEXT_RE.test(normalizeLearningSubjectText(value)) ? "geografi" : null;
}

export function buildGeografiTrainerGeneratePromptAddendum() {
  return [
    "",
    "Geografi-spørgsmålsfokus:",
    "- Foretræk spørgsmål der kræver forklaring af geografiske processer og sammenhænge, ikke kun redegørelse.",
    "- Hvis materialet har kort, figurer, tabeller, grafer eller data, så lad spørgsmålet kræve fortolkning og brug af materialet som belæg.",
    "- Når det passer til materialet, så læg op til at eleven kobler naturgeografiske og samfundsgeografiske forhold sammen.",
    "- Spørg gerne så eleven skal forklare årsag-virkning og samspil mellem natur, mennesker og udvikling.",
  ].join("\n");
}
