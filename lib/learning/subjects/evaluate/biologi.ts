import type { EvaluatorDefinition } from "@/lib/learning/evaluator-registry";
import { normalizeLearningSubjectText } from "@/lib/learning/subjects/families";

const BIOLOGI_CONTEXT_RE =
  /\b(biologi|biology|bio|celle|celler|cellebiologi|fysiologi|genetik|dna|rna|protein|enzym|respiration|fotosyntese|evolution|oekologi|økologi|population|naturlig selektion|mutation|mitose|meiose|forsoeg|forsøg|kontrolgruppe|figur|tabel|graf|data)\b/i;

export const BIOLOGI_TRAINER_EVALUATOR: EvaluatorDefinition = {
  id: "trainer.biologi.trainer.biologi_forklar_analyser_fortolk.v1",
  source_type: "trainer",
  subject_family: "biologi",
  task_type: "biologi_forklar_analyser_fortolk",
  assessment_mode: "trainer",
  label: "Biologi: forklar, analyser og fortolk",
};

export function inferBiologiTrainerTask(question: string) {
  return BIOLOGI_CONTEXT_RE.test(normalizeLearningSubjectText(question)) ? "biologi_forklar_analyser_fortolk" : null;
}

export function buildBiologiTrainerPromptAddendum() {
  return [
    "",
    "Biologi-fokus:",
    "- Fang når biologiske begreber nævnes uden præcis forklaring eller bruges upræcist.",
    "- Skeln tydeligt mellem redegørelse og egentlig forklaring/analyse af biologiske mekanismer og processer.",
    "- Hvis data, figurer, tabeller eller forsøgsresultater indgår, så vurder om de bliver fortolket og brugt som belæg.",
    "- Vurder om teori kobles tydeligt til bilag, case eller forsøgsresultater, og om årsag-virkning forklares biologisk klart.",
    "- Vær opmærksom på konklusioner der ikke udspringer tydeligt af analysen eller data.",
  ].join("\n");
}
