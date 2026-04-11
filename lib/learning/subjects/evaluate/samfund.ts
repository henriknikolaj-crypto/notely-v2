import { resolveEvaluatorDefinition } from "@/lib/learning/evaluator-registry";
import {
  buildSamfundTrainerPromptAddendum,
  inferSamfundTrainerTask,
  type SamfundTrainerTaskType,
} from "@/lib/samfund/evaluator";

export function resolveSamfundTrainerEvaluateConfig(question: string) {
  const taskType = (inferSamfundTrainerTask(question) ?? "samfund_redegoer_analyser") as SamfundTrainerTaskType;
  return {
    evaluator: resolveEvaluatorDefinition("trainer", {
      subject_family: "samfund",
      task_type: taskType,
      assessment_mode: "trainer",
    }),
    promptAddendum: buildSamfundTrainerPromptAddendum(taskType),
  };
}

export function inferSamfundTrainerEvaluateFamily(question: string) {
  return inferSamfundTrainerTask(question) ? "samfund" : null;
}
