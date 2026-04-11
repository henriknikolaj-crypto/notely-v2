import { resolveEvaluatorDefinition } from "@/lib/learning/evaluator-registry";
import {
  buildFysikTrainerPromptAddendum,
  inferFysikTrainerTask,
  type FysikTrainerTaskType,
} from "@/lib/fysik/evaluator";

export function resolveFysikTrainerEvaluateConfig(question: string) {
  const taskType = (inferFysikTrainerTask(question) ?? "fysik_beregn_og_forklar") as FysikTrainerTaskType;
  return {
    evaluator: resolveEvaluatorDefinition("trainer", {
      subject_family: "fysik",
      task_type: taskType,
      assessment_mode: "trainer",
    }),
    promptAddendum: buildFysikTrainerPromptAddendum(taskType),
  };
}

export function inferFysikTrainerEvaluateFamily(question: string) {
  return inferFysikTrainerTask(question) ? "fysik" : null;
}
