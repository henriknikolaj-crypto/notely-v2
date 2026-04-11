import {
  hasInternationalOkonomiSubjectHintFromCandidates,
  hasVirksomhedsokonomiSubjectHintFromCandidates,
} from "@/lib/learning/subjects/families";
import { buildBiologiTrainerGeneratePromptAddendum, inferBiologiTrainerGenerateFamily } from "@/lib/learning/subjects/generate/biologi";
import { buildDanskTrainerGeneratePromptAddendum, inferDanskTrainerGenerateFamily } from "@/lib/learning/subjects/generate/dansk";
import { buildFysikTrainerGeneratePromptAddendum, inferFysikTrainerGenerateFamily } from "@/lib/learning/subjects/generate/fysik";
import { buildGeografiTrainerGeneratePromptAddendum, inferGeografiTrainerGenerateFamily } from "@/lib/learning/subjects/generate/geografi";
import { buildInternationalOkonomiTrainerGeneratePromptAddendum } from "@/lib/learning/subjects/generate/international_okonomi";
import { buildMatematikTrainerGeneratePromptAddendum, inferMatematikTrainerGenerateFamily } from "@/lib/learning/subjects/generate/matematik";
import { buildSamfundTrainerGeneratePromptAddendum, inferSamfundTrainerGenerateFamily } from "@/lib/learning/subjects/generate/samfund";
import { buildVirksomhedsokonomiTrainerGeneratePromptAddendum } from "@/lib/learning/subjects/generate/virksomhedsokonomi";
import type { TrainerSharedGenerateSubjectConfig, TrainerSubjectFamily } from "@/lib/learning/subjects/types";

const OKONOMI_GENERATE_CONTEXT_RE =
  /\b(okonomi|økonomi|makrookonomi|mikrookonomi|virksomhedsokonomi|virksomhedsøkonomi|international okonomi|international økonomi|marked|rente|inflation|vaekst|vækst|efterspoergsel|efterspørgsel|udbud|elasticitet|daekningsbidrag|dækningsbidrag|avance|nulpunkt|omsaetning|omsætning|omkostninger|indekstal|noegletal|nøgletal|konjunktur|konkurrenceevne|beskaeftigelse|beskæftigelse)\b/i;

type ResolveTrainerGenerateSharedSubjectConfigArgs = {
  resolvedSubjectFamily: TrainerSubjectFamily | null;
  candidates?: unknown[];
};

export function inferTrainerGenerateSharedSubjectFamily(value: string): TrainerSubjectFamily | null {
  if (inferSamfundTrainerGenerateFamily(value)) return "samfund";
  if (inferDanskTrainerGenerateFamily(value)) return "dansk";
  if (inferFysikTrainerGenerateFamily(value)) return "fysik";
  if (inferMatematikTrainerGenerateFamily(value)) return "matematik";
  if (inferBiologiTrainerGenerateFamily(value)) return "biologi";
  if (inferGeografiTrainerGenerateFamily(value)) return "geografi";
  if (OKONOMI_GENERATE_CONTEXT_RE.test(value)) return "okonomi";
  return null;
}

export function resolveTrainerGenerateSharedSubjectConfig(
  args: ResolveTrainerGenerateSharedSubjectConfigArgs,
): TrainerSharedGenerateSubjectConfig | null {
  if (args.resolvedSubjectFamily === "samfund") {
    return { promptAddendum: buildSamfundTrainerGeneratePromptAddendum() };
  }

  if (args.resolvedSubjectFamily === "dansk") {
    return { promptAddendum: buildDanskTrainerGeneratePromptAddendum() };
  }

  if (args.resolvedSubjectFamily === "fysik") {
    return { promptAddendum: buildFysikTrainerGeneratePromptAddendum() };
  }

  if (args.resolvedSubjectFamily === "matematik") {
    return { promptAddendum: buildMatematikTrainerGeneratePromptAddendum() };
  }

  if (args.resolvedSubjectFamily === "biologi") {
    return { promptAddendum: buildBiologiTrainerGeneratePromptAddendum() };
  }

  if (args.resolvedSubjectFamily === "geografi") {
    return { promptAddendum: buildGeografiTrainerGeneratePromptAddendum() };
  }

  if (args.resolvedSubjectFamily === "okonomi") {
    const candidates = args.candidates ?? [];
    const promptAddendum = [
      hasVirksomhedsokonomiSubjectHintFromCandidates(candidates)
        ? buildVirksomhedsokonomiTrainerGeneratePromptAddendum()
        : "",
      hasInternationalOkonomiSubjectHintFromCandidates(candidates)
        ? buildInternationalOkonomiTrainerGeneratePromptAddendum()
        : "",
    ]
      .filter(Boolean)
      .join("\n");

    return promptAddendum ? { promptAddendum } : null;
  }

  return null;
}
