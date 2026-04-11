import { BIOLOGI_TRAINER_EVALUATOR, buildBiologiTrainerPromptAddendum, inferBiologiTrainerTask } from "@/lib/learning/subjects/evaluate/biologi";
import { inferDanskTrainerEvaluateFamily, resolveDanskTrainerEvaluateConfig } from "@/lib/learning/subjects/evaluate/dansk";
import { inferFysikTrainerEvaluateFamily, resolveFysikTrainerEvaluateConfig } from "@/lib/learning/subjects/evaluate/fysik";
import {
  buildGeografiTrainerPromptAddendum,
  GEOGRAFI_TRAINER_EVALUATOR,
  inferGeografiTrainerTask,
} from "@/lib/learning/subjects/evaluate/geografi";
import { buildInternationalOkonomiTrainerPromptAddendum } from "@/lib/learning/subjects/evaluate/international_okonomi";
import { resolveMatematikTrainerEvaluateConfig, inferMatematikTrainerEvaluateFamily } from "@/lib/learning/subjects/evaluate/matematik";
import { resolveSamfundTrainerEvaluateConfig, inferSamfundTrainerEvaluateFamily } from "@/lib/learning/subjects/evaluate/samfund";
import { buildVirksomhedsokonomiTrainerPromptAddendum } from "@/lib/learning/subjects/evaluate/virksomhedsokonomi";
import type {
  TrainerSharedEvaluateSubjectConfig,
  TrainerSubjectFamily,
} from "@/lib/learning/subjects/types";

type ResolveTrainerEvaluateSharedSubjectConfigArgs = {
  question: string;
  resolvedSubjectFamily: TrainerSubjectFamily | null;
  virksomhedsokonomiGuidance?: boolean;
  internationalOkonomiGuidance?: boolean;
};

export function inferTrainerEvaluateSharedSubjectFamily(question: string): TrainerSubjectFamily | null {
  if (inferSamfundTrainerEvaluateFamily(question)) return "samfund";
  if (inferDanskTrainerEvaluateFamily(question)) return "dansk";
  if (inferFysikTrainerEvaluateFamily(question)) return "fysik";
  if (inferMatematikTrainerEvaluateFamily(question)) return "matematik";
  if (inferBiologiTrainerTask(question)) return "biologi";
  if (inferGeografiTrainerTask(question)) return "geografi";
  return null;
}

export function resolveTrainerEvaluateSharedSubjectConfig(
  args: ResolveTrainerEvaluateSharedSubjectConfigArgs,
): TrainerSharedEvaluateSubjectConfig | null {
  if (args.resolvedSubjectFamily === "samfund") {
    return resolveSamfundTrainerEvaluateConfig(args.question);
  }

  if (args.resolvedSubjectFamily === "dansk") {
    return resolveDanskTrainerEvaluateConfig(args.question);
  }

  if (args.resolvedSubjectFamily === "fysik") {
    return resolveFysikTrainerEvaluateConfig(args.question);
  }

  if (args.resolvedSubjectFamily === "matematik") {
    return resolveMatematikTrainerEvaluateConfig(args.question);
  }

  if (args.resolvedSubjectFamily === "biologi") {
    return {
      evaluator: BIOLOGI_TRAINER_EVALUATOR,
      promptAddendum: buildBiologiTrainerPromptAddendum(),
    };
  }

  if (args.resolvedSubjectFamily === "geografi") {
    return {
      evaluator: GEOGRAFI_TRAINER_EVALUATOR,
      promptAddendum: buildGeografiTrainerPromptAddendum(),
    };
  }

  if (args.resolvedSubjectFamily === "okonomi") {
    const promptAddendum = [
      args.virksomhedsokonomiGuidance ? buildVirksomhedsokonomiTrainerPromptAddendum() : "",
      args.internationalOkonomiGuidance ? buildInternationalOkonomiTrainerPromptAddendum() : "",
    ]
      .filter(Boolean)
      .join("\n");

    return promptAddendum ? { promptAddendum } : null;
  }

  return null;
}
