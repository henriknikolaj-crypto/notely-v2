import { resolveEvaluatorDefinition } from "@/lib/learning/evaluator-registry";
import {
  buildMatematikTrainerPromptAddendum,
  inferMatematikTrainerTask,
  type MatematikTrainerTaskType,
} from "@/lib/matematik/evaluator";

export function resolveMatematikTrainerEvaluateConfig(question: string) {
  const taskType = (inferMatematikTrainerTask(question) ?? "matematik_beregn_og_vis_metode") as MatematikTrainerTaskType;
  return {
    evaluator: resolveEvaluatorDefinition("trainer", {
      subject_family: "matematik",
      task_type: taskType,
      assessment_mode: "trainer",
    }),
    promptAddendum: buildMatematikTrainerPromptAddendum(taskType),
  };
}

export function inferMatematikTrainerEvaluateFamily(question: string) {
  return inferMatematikTrainerTask(question) ? "matematik" : null;
}
