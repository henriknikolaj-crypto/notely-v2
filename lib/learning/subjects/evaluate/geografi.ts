import type { EvaluatorDefinition } from "@/lib/learning/evaluator-registry";
import { normalizeLearningSubjectText } from "@/lib/learning/subjects/families";

const GEOGRAFI_CONTEXT_RE =
  /\b(geografi|geography|geo|klima|nedboer|nedbør|temperatur|vejr|vejrsystem|vandkredslob|vandkredsløb|erosion|forvitring|pladetektonik|vulkan|jordskelv|urbanisering|befolkning|migration|globalisering|erhverv|regional udvikling|kort|kortbilag|figur|graf|tabel|data|diagram|naturgeografi|samfundsgeografi)\b/i;

export const GEOGRAFI_TRAINER_EVALUATOR: EvaluatorDefinition = {
  id: "trainer.geografi.trainer.geografi_forklar_analyser_fortolk.v1",
  source_type: "trainer",
  subject_family: "geografi",
  task_type: "geografi_forklar_analyser_fortolk",
  assessment_mode: "trainer",
  label: "Geografi: forklar, analyser og fortolk",
};

export function inferGeografiTrainerTask(question: string) {
  return GEOGRAFI_CONTEXT_RE.test(normalizeLearningSubjectText(question))
    ? "geografi_forklar_analyser_fortolk"
    : null;
}

export function buildGeografiTrainerPromptAddendum() {
  return [
    "",
    "Geografi-fokus:",
    "- Fang når geografiske begreber eller modeller nævnes uden faktisk anvendelse på case eller materiale.",
    "- Skeln tydeligt mellem redegørelse og analyse/forklaring af geografiske processer og sammenhænge.",
    "- Hvis kort, figurer, grafer, tabeller eller data indgår, så vurder om de bliver fortolket og brugt som belæg.",
    "- Vurder om naturgeografiske og samfundsgeografiske forhold kobles tydeligt sammen, når opgaven kræver det.",
    "- Vær opmærksom på uklare årsagskæder, generiske vurderinger og konklusioner der ikke samler argumentet klart.",
  ].join("\n");
}
