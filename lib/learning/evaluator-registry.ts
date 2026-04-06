export type LearningSourceType = "trainer" | "simulator" | "oral";

export type EvaluatorDefinition = {
  id: string;
  source_type: LearningSourceType;
  subject_family: string;
  task_type: string;
  assessment_mode: string;
  label: string;
};

const EVALUATOR_REGISTRY: Record<LearningSourceType, EvaluatorDefinition> = {
  trainer: {
    id: "trainer.generic.formative.free_response.v1",
    source_type: "trainer",
    subject_family: "generic",
    task_type: "free_response",
    assessment_mode: "formative",
    label: "Trainer frit-svar",
  },
  simulator: {
    id: "simulator.generic.summative.written_exam.v1",
    source_type: "simulator",
    subject_family: "generic",
    task_type: "written_exam",
    assessment_mode: "summative",
    label: "Skriftlig simulator",
  },
  oral: {
    id: "oral.generic.summative.oral_exam.v1",
    source_type: "oral",
    subject_family: "generic",
    task_type: "oral_exam",
    assessment_mode: "summative",
    label: "Mundtlig evaluering",
  },
};

export function resolveEvaluatorDefinition(sourceType: LearningSourceType): EvaluatorDefinition {
  return EVALUATOR_REGISTRY[sourceType];
}

export function listEvaluatorDefinitions(): EvaluatorDefinition[] {
  return Object.values(EVALUATOR_REGISTRY);
}
