import type { EvaluatorDefinition } from "@/lib/learning/evaluator-registry";

export type TrainerSubjectFamily =
  | "okonomi"
  | "samfund"
  | "dansk"
  | "history"
  | "fysik"
  | "matematik"
  | "biologi"
  | "geografi";

export type TrainerSubjectRequestLike = {
  subjectFamily?: unknown;
  subject_family?: unknown;
  meta?: Record<string, unknown> | null;
  metadata?: Record<string, unknown> | null;
};

export type TrainerSharedEvaluateSubjectConfig = {
  evaluator?: EvaluatorDefinition;
  promptAddendum: string;
};

export type TrainerSharedGenerateSubjectConfig = {
  promptAddendum: string;
};
