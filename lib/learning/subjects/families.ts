import type { TrainerSubjectFamily, TrainerSubjectRequestLike } from "@/lib/learning/subjects/types";

const VIRKSOMHEDSOKONOMI_ALIASES = new Set([
  "virksomhedsokonomi",
  "virksomhedsoekonomi",
  "business economics",
  "businesseconomics",
  "vo",
]);

const INTERNATIONAL_OKONOMI_ALIASES = new Set([
  "international okonomi",
  "international oekonomi",
  "international economics",
  "internationaleconomics",
  "ioe",
  "ioek",
  "iok",
]);

export function normalizeLearningSubjectText(value: string) {
  return String(value ?? "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/æ/g, "ae")
    .replace(/ø/g, "oe")
    .replace(/å/g, "aa");
}

function normalizeTrainerSubjectAlias(value: unknown) {
  return normalizeLearningSubjectText(String(value ?? "").trim()).replace(/\s+/g, " ").trim();
}

export function resolveTrainerSubjectFamilyFromCandidates(candidates: unknown[]): TrainerSubjectFamily | null {
  for (const candidate of candidates) {
    const parsed = parseTrainerSubjectFamily(candidate);
    if (parsed) return parsed;
  }

  return null;
}

export function parseTrainerSubjectFamily(value: unknown): TrainerSubjectFamily | null {
  const normalized = normalizeTrainerSubjectAlias(value);
  if (!normalized) return null;
  if (normalized === "fysik" || normalized === "physics") return "fysik";
  if (
    normalized === "matematik" ||
    normalized === "math" ||
    normalized === "maths" ||
    normalized === "mathematics" ||
    normalized === "mat"
  ) {
    return "matematik";
  }
  if (normalized === "biologi" || normalized === "biology" || normalized === "bio") return "biologi";
  if (normalized === "geografi" || normalized === "geography" || normalized === "geo") return "geografi";
  if (normalized === "dansk" || normalized === "danish") return "dansk";
  if (normalized === "history" || normalized === "historie") return "history";
  if (
    normalized === "samfund" ||
    normalized === "samfundsfag" ||
    normalized === "samf" ||
    normalized === "social science" ||
    normalized === "social studies"
  ) {
    return "samfund";
  }
  if (
    normalized === "okonomi" ||
    VIRKSOMHEDSOKONOMI_ALIASES.has(normalized) ||
    INTERNATIONAL_OKONOMI_ALIASES.has(normalized) ||
    normalized === "makrookonomi" ||
    normalized === "mikrookonomi"
  ) {
    return "okonomi";
  }
  return null;
}

export function getTrainerSubjectFamilyCandidates(
  body: Partial<TrainerSubjectRequestLike>,
  trainerRoundMeta: unknown,
): unknown[] {
  const roundMetaRecord =
    trainerRoundMeta && typeof trainerRoundMeta === "object" ? (trainerRoundMeta as Record<string, unknown>) : null;
  const bodyMetaRecord = body.meta && typeof body.meta === "object" ? body.meta : null;
  const bodyMetadataRecord = body.metadata && typeof body.metadata === "object" ? body.metadata : null;
  const roundNestedMeta =
    roundMetaRecord?.meta && typeof roundMetaRecord.meta === "object"
      ? (roundMetaRecord.meta as Record<string, unknown>)
      : null;
  const roundNestedMetadata =
    roundMetaRecord?.metadata && typeof roundMetaRecord.metadata === "object"
      ? (roundMetaRecord.metadata as Record<string, unknown>)
      : null;

  return [
    body.subjectFamily,
    body.subject_family,
    bodyMetaRecord?.subjectFamily,
    bodyMetaRecord?.subject_family,
    bodyMetadataRecord?.subjectFamily,
    bodyMetadataRecord?.subject_family,
    roundMetaRecord?.subjectFamily,
    roundMetaRecord?.subject_family,
    roundNestedMeta?.subjectFamily,
    roundNestedMeta?.subject_family,
    roundNestedMetadata?.subjectFamily,
    roundNestedMetadata?.subject_family,
  ];
}

function hasTrainerSubjectAlias(
  bodyOrCandidates: Partial<TrainerSubjectRequestLike> | unknown[],
  trainerRoundMetaOrAliases: unknown,
  aliases: Set<string>,
) {
  const candidates = Array.isArray(bodyOrCandidates)
    ? bodyOrCandidates
    : getTrainerSubjectFamilyCandidates(bodyOrCandidates, trainerRoundMetaOrAliases);
  return candidates.some((candidate) =>
    aliases.has(normalizeTrainerSubjectAlias(candidate)),
  );
}

export function hasVirksomhedsokonomiSubjectHint(
  body: Partial<TrainerSubjectRequestLike>,
  trainerRoundMeta: unknown,
) {
  return hasTrainerSubjectAlias(body, trainerRoundMeta, VIRKSOMHEDSOKONOMI_ALIASES);
}

export function hasVirksomhedsokonomiSubjectHintFromCandidates(candidates: unknown[]) {
  return hasTrainerSubjectAlias(candidates, null, VIRKSOMHEDSOKONOMI_ALIASES);
}

export function hasInternationalOkonomiSubjectHint(
  body: Partial<TrainerSubjectRequestLike>,
  trainerRoundMeta: unknown,
) {
  return hasTrainerSubjectAlias(body, trainerRoundMeta, INTERNATIONAL_OKONOMI_ALIASES);
}

export function hasInternationalOkonomiSubjectHintFromCandidates(candidates: unknown[]) {
  return hasTrainerSubjectAlias(candidates, null, INTERNATIONAL_OKONOMI_ALIASES);
}

export function resolveExplicitTrainerSubjectFamily(
  body: Partial<TrainerSubjectRequestLike>,
  trainerRoundMeta: unknown,
): TrainerSubjectFamily | null {
  return resolveTrainerSubjectFamilyFromCandidates(getTrainerSubjectFamilyCandidates(body, trainerRoundMeta));
}
