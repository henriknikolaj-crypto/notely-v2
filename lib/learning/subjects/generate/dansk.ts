import { normalizeLearningSubjectText } from "@/lib/learning/subjects/families";

const DANSK_GENERATE_CONTEXT_RE =
  /\b(dansk|danish|novelle|digt|lyrik|roman|uddrag|fortaeller|fortæller|synsvinkel|komposition|virkemidler|virkemiddel|sprog|symbolik|tema|motiv|tekstbelaeg|tekstbelæg|fortolk|perspektiv)\b/i;

export function inferDanskTrainerGenerateFamily(value: string) {
  return DANSK_GENERATE_CONTEXT_RE.test(normalizeLearningSubjectText(value)) ? "dansk" : null;
}

export function buildDanskTrainerGeneratePromptAddendum() {
  return [
    "",
    "Danskfagligt spørgmålsfokus:",
    "- Foretræk tekstnære spørgsmål med ét tydeligt analyse- eller fortolkningsfokus.",
    "- Lad gerne spørgsmålet invitere til brug af virkemidler, fortæller, komposition eller tekststeder som belæg.",
    "- Undgå brede mini-opgaver; spørg hellere til én tydelig pointe og højst én kort opfølgning.",
    "- Når det passer til materialet, må spørgsmålet gerne lægge op til kort fortolkning eller perspektivering til sidst.",
  ].join("\n");
}
