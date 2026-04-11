import { resolveEvaluatorDefinition } from "@/lib/learning/evaluator-registry";
import {
  buildDanskTrainerPromptAddendum,
  inferDanskTrainerTask,
  type DanskTrainerTaskType,
} from "@/lib/dansk/evaluator";

export function resolveDanskTrainerEvaluateConfig(question: string) {
  const taskType = (inferDanskTrainerTask(question) ?? "dansk_fortolk_tekst") as DanskTrainerTaskType;
  return {
    evaluator: resolveEvaluatorDefinition("trainer", {
      subject_family: "dansk",
      task_type: taskType,
      assessment_mode: "trainer",
    }),
    promptAddendum: buildDanskTrainerPromptAddendum(taskType),
  };
}

export function inferDanskTrainerEvaluateFamily(question: string) {
  return inferDanskTrainerTask(question) ? "dansk" : null;
}
