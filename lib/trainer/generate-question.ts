import "server-only";

import { deriveFocusTargetsFromLearningSignals, type LearningFocusSessionRow } from "@/lib/learning/focus";

export type Difficulty = "easy" | "medium" | "hard";
export type FocusMode = "normal" | "weakest";

export type FileRow = {
  id: string;
  name: string | null;
  original_name: string | null;
  folder_id: string | null;
  created_at: string | null;
};

export type ChunkRow = {
  id: string;
  file_id: string;
  content: string | null;
  created_at: string | null;
  source_url?: string | null;
  extraction_method?: string | null;
  extraction_quality?: string | null;
  page_from?: number | null;
};

export type WeakPointTarget = {
  key: string;
  label: string;
  action?: string;
};

export type InferredQuestionDifficulty = "easy" | "medium" | "advanced";
export type QuestionCalibrationTarget = "simpler_than_source" | "match_source" | "slightly_simplified";
export type QuestionSubjectFamily = "generic" | "okonomi" | "samfund" | "dansk" | "matematik" | "fysik";

export type QuestionCalibrationProfile = {
  subjectFamily: QuestionSubjectFamily;
  sourceDifficulty: InferredQuestionDifficulty;
  calibrationTarget: QuestionCalibrationTarget;
  technicalDensity: "low" | "medium" | "high";
};

export type PhysicsQuestionFormattingDiagnostics = {
  coordinateSentence: string;
  coordinateSource: "context" | "raw" | "none";
  measurementSentence: string;
  measurementSource: "context" | "raw" | "none";
  timeSentence: string;
  timeSource: "context" | "raw" | "none";
  timeMatches: string[];
  distanceSentence: string;
  distanceSource: "context" | "raw" | "none";
  constantInstruction: string;
  constantSource: "context" | "raw" | "none";
  mainRequirement: string;
  mainRequirementSource: "raw" | "context_fallback" | "none";
  hintSentence: string;
  hintSource: "raw" | "context_fallback" | "none";
  positionGuardTriggered: boolean;
  physicsCompletenessGuardTriggered: boolean;
  hasCoordinates: boolean;
  hasTimes: boolean;
  hasConstant: boolean;
  usedTimesInQuestion: boolean;
  hasDistanceDifferences: boolean;
  hasExtraDistance: boolean;
  usedDerivedDistanceFallback: boolean;
  derivedDistanceSentence: string;
  usedContextEnrichment: boolean;
  usedPhysicsFallbackQuestion: boolean;
  usedFallbackQuestion: boolean;
};

export type TrainerQuestionCalibrationDiagnostics = {
  subjectFamily: QuestionSubjectFamily;
  explicitSubjectFamily: QuestionSubjectFamily;
  inferredSubjectFamily: QuestionSubjectFamily;
  resolvedSubjectFamily: QuestionSubjectFamily;
  rawQuestion: string;
  quantitative?: QuantitativeQuestionGuardDiagnostics;
  physics?: PhysicsQuestionFormattingDiagnostics;
};

export type TrainerQuestionCalibrationResult = {
  question: string;
  profile: QuestionCalibrationProfile;
  diagnostics: TrainerQuestionCalibrationDiagnostics;
};

export type QuantitativeContextExpansionDiagnostics = {
  subjectFamily: QuestionSubjectFamily;
  explicitSubjectFamily: QuestionSubjectFamily;
  inferredSubjectFamily: QuestionSubjectFamily;
  resolvedSubjectFamily: QuestionSubjectFamily;
  isQuantitative: boolean;
  selectedChunkIds: string[];
  addedChunkIds: string[];
  addedReasons: Array<{ chunkId: string; reason: string }>;
  containsCoordinates: boolean;
  containsMeasurements: boolean;
  containsConstant: boolean;
};

type QuantitativeQuestionProfile = {
  subjectFamily: QuestionSubjectFamily;
  isQuantitative: boolean;
  setupFragment: string;
  coordinateFragment: string;
  valueFragment: string;
  constantFragment: string;
};

type QuantitativeGivensSnapshot = {
  hasSetup: boolean;
  hasCoordinates: boolean;
  hasValues: boolean;
  hasConstants: boolean;
  summary: string[];
};

type QuantitativeQuestionGuardDiagnostics = {
  quantitativeGuardTriggered: boolean;
  contextGivens: string[];
  questionGivens: string[];
  missingCriticalGivens: string[];
  usedGivensEnrichment: boolean;
  usedQuantitativeFallback: boolean;
};

const OKONOMI_TOPIC_RE =
  /\b(okonomi|økonomi|makrookonomi|mikrookonomi|virksomhedsokonomi|virksomhedsøkonomi|international okonomi|international økonomi)\b/i;
const OKONOMI_CONTEXT_RE =
  /\b(marked|rente|inflation|vaekst|vækst|efterspoergsel|efterspørgsel|udbud|elasticitet|daekningsbidrag|dækningsbidrag|avance|nulpunkt|omsaetning|omsætning|omkostninger|indekstal|noegletal|nøgletal|konjunktur|konkurrenceevne|beskaeftigelse|beskæftigelse)\b/i;
const OKONOMI_TECHNICAL_SOURCE_RE =
  /(?:\bregress(?:ion|ionsmodel|ionsanalyse)\b|\bkoefficient(?:er)?\b|\bsignifik(?:ant|ans|ansniveau)\b|\bbeta\d*\b|β\d*|Δ|delta\b|\bdummy-?variabel\b|\bforecast\b|\blag\b|\bp-vaerdi\b|\bp-værdi\b|\bstandardfejl\b|\bboks\s*\d+\b|\bmodel\s*\d+\b)/i;
const OKONOMI_TECHNICAL_OUTPUT_RE =
  /(?:β\d*|Δ|\bkoefficient(?:er)?\b|\bsignifik(?:ant|ans|ansniveau)\b|\bregress(?:ion|ionsmodel|ionsanalyse)\b|\bdummy-?variabel\b|\bforecast\b|\blag\b|\bp-vaerdi\b|\bp-værdi\b|\bstandardfejl\b)/i;
const SAMFUND_TOPIC_RE = /\b(samfund|samfundsfag|politik|politiske|velfaerd|velfærd|offentlige finanser|solidaritet|individuelt ansvar)\b/i;
const DANSK_TOPIC_RE = /\b(dansk|novelle|digt|lyrik|fortolk|virkemiddel|tekstbel(aeg|æg)|motiv|symbolik)\b/i;
const MATEMATIK_TOPIC_RE = /\b(matematik|funktion|graf|integral|vektor|parabel|sandsynlighed|ligning)\b/i;
const FYSIK_TOPIC_RE =
  /\b(fysik|kraft|energi|acceleration|spænding|strom|strøm|bølge|frekvens|effekt|bevægelse|hydrofon|lydhastighed|lydsignal|tryk|temperatur)\b/i;
const ADVANCED_MATEMATIK_SOURCE_RE = /\b(integral|differentialligning|vektorfunktion|parameterfremstilling|bevis|udled)\b/i;
const ADVANCED_FYSIK_SOURCE_RE = /\b(vektorfelt|induktion|resonans|interferens|energitab|feltsstyrke)\b/i;
const ADVANCED_SAMFUND_SOURCE_RE = /\b(diskurs|metode|komparativ|institutionel|strukturforklaring|aktorteori)\b/i;
const ADVANCED_DANSK_SOURCE_RE = /\b(metakommunikation|fortaelleinstans|fortælleinstans|kompositorisk|implicit læser|implicit laeser)\b/i;
const SHARED_TASK_VERBS_RE = /\b(redegoer|forklar|analyser|vurder|diskuter|fortolk|dokumenter|perspektiver|beregn|bestem|vis|begrund|bevis)\b/gi;
const QUANTITATIVE_COORDINATE_RE =
  /\b[A-Z]\s*(?:=)?\s*\(\s*[-+]?\d+(?:[.,]\d+)?\s*[,;]\s*[-+]?\d+(?:[.,]\d+)?\s*\)/;
const QUANTITATIVE_LABELED_VALUE_RE =
  /\b(?:[A-Z](?:_[A-Z])?|t_[A-Z]|v|s|g|c|U|I|P|E)\s*=\s*[-+]?\d+(?:[.,]\d+)?(?:\s*(?:·|x|\*)\s*10\^?-?\d+)?\s*(?:ms|s|min|h|m|cm|mm|km|m\/s\^?2|m\/s|N|J|W|V|A|Hz|Pa|°C|K|%|kr)?\b/i;
const QUANTITATIVE_NUMERIC_UNIT_RE =
  /[-+]?\d+(?:[.,]\d+)?(?:\s*(?:·|x|\*)\s*10\^?-?\d+)?\s*(?:ms|s|min|h|m\/s\^?2|m\/s|m|cm|mm|km|kg|g|N|J|W|V|A|Hz|Pa|°C|K|%|kr|mio\.?|mia\.?)\b/i;
const QUANTITATIVE_TABLE_WORD_RE = /\b(tabel|data|måling|maaling|målinger|maalinger|observation|punkt)\b/i;
const QUANTITATIVE_TASK_RE =
  /\b(beregn|bestem|vis|udled|opstil|løs|loes|forklar|fortolk|graf|funktion|måling|maaling|data|model|nøgletal|noegletal|indekstal|elasticitet|dækningsbidrag|daekningsbidrag|nulpunkt|omsætning|omsaetning|omkostninger|usikkerhed)\b/i;
const QUANTITATIVE_FUNCTION_RE = /\b(?:f|g|h)\s*\(\s*[a-z]\s*\)\s*=\s*[^.\n;]+/i;
const QUANTITATIVE_INTERVAL_RE = /(?:\[[^\]]+\]|\binterval(?:let)?\s+[^\n.,;!?]+)/i;
const PHYSICS_TIME_VALUE_RE = /\b(?:t[_\s]*)?([A-Z])\s*(?:=|:)\s*([-+]?\d+(?:[.,]\d+)?)\s*(ms|s|min|h)\b/gi;
const PHYSICS_DISTANCE_DIFF_RE =
  /\b(afstandsforsk(?:el|elle|ellene)?|[-+]?\d+(?:[.,]\d+)?\s*m\s*(?:længere|laengere|kortere)|(?:længere|laengere|kortere)\s+end|ekstra afstand)\b/i;
const PHYSICS_POSITION_TASK_RE =
  /\b(hydrofon|hydrofoner|fiskens position|lydankomst|lydsignal|bestem(?:me)?\s+\w*\s*position)\b/i;

type OkonomiQuestionLanguageProfile = {
  isEconomy: boolean;
  hasTechnicalSource: boolean;
};

type QuestionSubjectResolution = {
  explicitSubjectFamily: QuestionSubjectFamily;
  inferredSubjectFamily: QuestionSubjectFamily;
  resolvedSubjectFamily: QuestionSubjectFamily;
};

function collapseWhitespace(value: string) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function trimQuestionLead(value: string) {
  return collapseWhitespace(value)
    .replace(/^(?:med udgangspunkt i|tag udgangspunkt i|med afsæt i)\s+[^:]{0,140}:\s*/i, "")
    .replace(/^forklar med egne ord,\s*/i, "Forklar ")
    .replace(/^redegør med egne ord,\s*/i, "Redegør ")
    .trim();
}

function splitQuestionSentences(value: string) {
  const matches = collapseWhitespace(value).match(/[^.!?]+[.!?]?/g) ?? [];
  return matches.map((sentence) => sentence.trim()).filter(Boolean);
}

function finalizeQuestionText(value: string) {
  const text = collapseWhitespace(value).replace(/[,:;\-]\s*$/, "").trim();
  if (!text) return "";
  if (/[.!?]\s*$/.test(text)) return text;
  return `${text}.`;
}

function isOverlongQuestionCandidate(value: string) {
  const text = collapseWhitespace(value);
  const numberedParts = (text.match(/(?:^|\n)\s*\d+[.)]/g) ?? []).length;
  return text.length > 420 || numberedParts > 1;
}

function shortenSentence(value: string, maxChars: number) {
  const text = collapseWhitespace(value);
  if (!text) return "";
  if (text.length <= maxChars) return text;

  const clipped = text.slice(0, maxChars);
  const punctuationIdx = Math.max(clipped.lastIndexOf("."), clipped.lastIndexOf("!"), clipped.lastIndexOf("?"));
  if (punctuationIdx >= 48) return clipped.slice(0, punctuationIdx + 1).trim();

  const spaceIdx = clipped.lastIndexOf(" ");
  const end = spaceIdx >= 48 ? spaceIdx : maxChars;
  return `${clipped.slice(0, end).trim()}.`;
}

function countPatternMatches(value: string, pattern: RegExp) {
  const flags = pattern.flags.includes("g") ? pattern.flags : `${pattern.flags}g`;
  return [...String(value ?? "").matchAll(new RegExp(pattern.source, flags))].length;
}

function splitContextFragments(contextText: string) {
  const lines = String(contextText ?? "")
    .replace(/\r\n/g, "\n")
    .split("\n")
    .map((line) => collapseWhitespace(line.replace(/^KILDE:\s*/i, "")))
    .filter(Boolean);

  const fragments = lines.flatMap((line) => {
    const sentences = line.match(/[^.!?]+[.!?]?/g) ?? [line];
    return sentences.map((sentence) => collapseWhitespace(sentence)).filter(Boolean);
  });

  const out: string[] = [];
  const seen = new Set<string>();
  for (const fragment of fragments) {
    if (fragment.length < 10) continue;
    const key = fragment.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(fragment);
  }
  return out;
}

function normalizeFragmentSentence(value: string, maxChars = 180) {
  const text = collapseWhitespace(value);
  if (!text) return "";
  const shortened = text.length > maxChars ? shortenSentence(text, maxChars) : text;
  return finalizeQuestionText(shortened);
}

function compactQuantitativeFragment(value: string, maxChars = 150) {
  const text = collapseWhitespace(value);
  if (!text) return "";

  const indices = [
    text.search(QUANTITATIVE_COORDINATE_RE),
    text.search(QUANTITATIVE_LABELED_VALUE_RE),
    text.search(QUANTITATIVE_NUMERIC_UNIT_RE),
  ].filter((index) => index >= 0);
  const sliced = indices.length ? text.slice(Math.min(...indices)).trim() : text;
  return finalizeQuestionText(sliced.length > maxChars ? shortenSentence(sliced, maxChars) : sliced);
}

function pickQuantitativeFragment(
  fragments: string[],
  predicate: (fragment: string) => boolean,
  maxChars = 180,
) {
  const match = fragments.find((fragment) => predicate(fragment));
  return match ? normalizeFragmentSentence(match, maxChars) : "";
}

function normalizeChunkSequence(rows: ChunkRow[]) {
  return [...rows].sort((a, b) => {
    const pageA = Number.isFinite(a.page_from as number) ? Number(a.page_from) : Number.POSITIVE_INFINITY;
    const pageB = Number.isFinite(b.page_from as number) ? Number(b.page_from) : Number.POSITIVE_INFINITY;
    if (pageA !== pageB) return pageA - pageB;
    return (Date.parse(a.created_at ?? "0") || 0) - (Date.parse(b.created_at ?? "0") || 0);
  });
}

function containsCoordinateData(text: string) {
  return countPatternMatches(text, QUANTITATIVE_COORDINATE_RE) >= 2;
}

function containsMeasurementData(text: string) {
  return countPatternMatches(text, QUANTITATIVE_LABELED_VALUE_RE) >= 2;
}

function containsConstantData(text: string) {
  return /\b\d+(?:[.,]\d+)?\s*m\/s\b/i.test(text) || /\b\d+(?:[.,]\d+)?\s*(N|J|W|V|A|Hz|Pa|°C|K)\b/i.test(text);
}

function looksLikeQuantitativeHintChunk(text: string) {
  const normalized = collapseWhitespace(text).toLowerCase();
  if (!normalized) return false;
  return (
    /\b(vis først|vis derefter|opstil(?: først| derefter)?|afstandsforsk|ligning(?:er)?|udregn|beregn)\b/.test(normalized) &&
    !containsCoordinateData(normalized)
  );
}

function scoreSetupLikeChunk(text: string, subjectFamily: QuestionSubjectFamily) {
  const normalized = collapseWhitespace(text).toLowerCase();
  if (!normalized) return 0;

  let score = 0;
  if (containsCoordinateData(normalized)) score += 5;
  if (containsMeasurementData(normalized)) score += 5;
  if (containsConstantData(normalized)) score += 3;
  if (/\b(er placeret|placeret i|givet|givet ved|målt|måling|målt ved|bestem|punkterne|data|opfanges|tid|tider)\b/.test(normalized)) {
    score += 2;
  }
  if (subjectFamily === "fysik" && /\b(hydrofon|hydrofoner|lydsignal|afstand|lydhastighed|fiskens position|positioner|placeret)\b/.test(normalized)) {
    score += 4;
  }
  if (subjectFamily === "fysik" && /\b(?:a|b|c)\s*(?:=)?\s*\(/i.test(text)) score += 3;
  if (subjectFamily === "matematik" && /\b(punkt|koordinat|funktion|graf)\b/.test(normalized)) score += 2;
  if (subjectFamily === "okonomi" && /\b(tabel|nøgletal|noegletal|indekstal|omsætning|omsaetning|omkostning)\b/.test(normalized)) score += 2;
  if (looksLikeQuantitativeHintChunk(normalized)) score -= 3;
  return score;
}

export function expandQuantitativeContextChunks(args: {
  topic: string;
  explicitSubjectFamily?: QuestionSubjectFamily | null;
  selectedChunks: ChunkRow[];
  poolRows: ChunkRow[];
  maxExtraChunks?: number;
}): { chunks: ChunkRow[]; diagnostics: QuantitativeContextExpansionDiagnostics } {
  const orderedPool = normalizeChunkSequence(args.poolRows.filter((row) => (row.content ?? "").trim().length > 0));
  const selectedOrdered = normalizeChunkSequence(args.selectedChunks);
  const selectedChunkIds = selectedOrdered.map((chunk) => String(chunk.id));
  const selectedText = selectedOrdered.map((chunk) => chunk.content ?? "").join("\n\n");
  const subjectResolution = resolveQuestionSubjectFamily(args.topic, selectedText, args.explicitSubjectFamily);
  const subjectFamily = subjectResolution.resolvedSubjectFamily;
  const quantitativeProfile = inferQuantitativeQuestionProfile(
    args.topic,
    selectedText || args.poolRows.map((row) => row.content ?? "").join("\n"),
    args.explicitSubjectFamily,
  );
  const isQuantitative = quantitativeProfile.isQuantitative;
  const maxExtraChunks = Math.max(0, args.maxExtraChunks ?? 2);

  const addedChunkIds: string[] = [];
  const addedReasons: Array<{ chunkId: string; reason: string }> = [];
  const selectedSet = new Set(selectedChunkIds);
  const out = [...selectedOrdered];

  const addChunk = (chunk: ChunkRow | undefined, reason: string) => {
    if (!chunk || addedChunkIds.length >= maxExtraChunks) return;
    const id = String(chunk.id);
    if (selectedSet.has(id)) return;
    selectedSet.add(id);
    out.push(chunk);
    addedChunkIds.push(id);
    addedReasons.push({ chunkId: id, reason });
  };

  if (isQuantitative) {
    const combined = () => out.map((chunk) => chunk.content ?? "").join("\n\n");
    const needsCoordinates = () => !containsCoordinateData(combined());
    const needsMeasurements = () => !containsMeasurementData(combined());
    const needsConstant = () => !containsConstantData(combined());

    const selectedIndices = selectedOrdered
      .map((chunk) => orderedPool.findIndex((candidate) => String(candidate.id) === String(chunk.id)))
      .filter((index) => index >= 0);

    const selectedHintLike = selectedOrdered.some((chunk) => looksLikeQuantitativeHintChunk(chunk.content ?? ""));
    if (selectedHintLike) {
      for (const index of selectedIndices) {
        addChunk(orderedPool[index - 1], "neighbor_before_hint");
        addChunk(orderedPool[index + 1], "neighbor_after_hint");
      }
    }

    const setupCandidates = orderedPool
      .filter((chunk) => !selectedSet.has(String(chunk.id)))
      .map((chunk) => ({
        chunk,
        score: scoreSetupLikeChunk(chunk.content ?? "", subjectFamily),
      }))
      .filter((item) => item.score > 0)
      .sort((a, b) => b.score - a.score);

    if (needsCoordinates()) {
      addChunk(setupCandidates.find((item) => containsCoordinateData(item.chunk.content ?? ""))?.chunk, "setup_coordinates");
    }
    if (needsMeasurements()) {
      addChunk(setupCandidates.find((item) => containsMeasurementData(item.chunk.content ?? ""))?.chunk, "setup_measurements");
    }
    if (needsConstant()) {
      addChunk(setupCandidates.find((item) => containsConstantData(item.chunk.content ?? ""))?.chunk, "setup_constant");
    }
    if (selectedHintLike && addedChunkIds.length < maxExtraChunks) {
      addChunk(setupCandidates[0]?.chunk, "setup_problem_statement");
    }
  }

  const expanded = normalizeChunkSequence(out);
  const expandedText = expanded.map((chunk) => chunk.content ?? "").join("\n\n");
  return {
    chunks: expanded,
    diagnostics: {
      subjectFamily,
      explicitSubjectFamily: subjectResolution.explicitSubjectFamily,
      inferredSubjectFamily: subjectResolution.inferredSubjectFamily,
      resolvedSubjectFamily: subjectResolution.resolvedSubjectFamily,
      isQuantitative,
      selectedChunkIds,
      addedChunkIds,
      addedReasons,
      containsCoordinates: containsCoordinateData(expandedText),
      containsMeasurements: containsMeasurementData(expandedText),
      containsConstant: containsConstantData(expandedText),
    },
  };
}

function inferQuantitativeQuestionProfile(
  topic: string,
  contextText: string,
  explicitSubjectFamily?: QuestionSubjectFamily | null,
): QuantitativeQuestionProfile {
  const subjectFamily = inferQuestionSubjectFamily(topic, contextText, explicitSubjectFamily);
  const joined = normalizeTopicAndContext(topic, contextText);
  const fragments = splitContextFragments(contextText);

  const coordinateFragment = pickQuantitativeFragment(
    fragments,
    (fragment) => countPatternMatches(fragment, QUANTITATIVE_COORDINATE_RE) >= 2,
    170,
  );
  const setupFragment = pickQuantitativeFragment(
    fragments,
    (fragment) =>
      QUANTITATIVE_FUNCTION_RE.test(fragment) ||
      QUANTITATIVE_INTERVAL_RE.test(fragment) ||
      (QUANTITATIVE_TABLE_WORD_RE.test(fragment) && countPatternMatches(fragment, QUANTITATIVE_NUMERIC_UNIT_RE) >= 2),
    180,
  );
  const valueFragment = pickQuantitativeFragment(
    fragments,
    (fragment) =>
      (subjectFamily === "fysik" && extractPhysicsTimeMatches(fragment).length >= 2) ||
      countPatternMatches(fragment, QUANTITATIVE_LABELED_VALUE_RE) >= 2 ||
      (countPatternMatches(fragment, QUANTITATIVE_NUMERIC_UNIT_RE) >= 2 && QUANTITATIVE_TABLE_WORD_RE.test(fragment)),
    180,
  );
  const constantFragment = pickQuantitativeFragment(
    fragments,
    (fragment) =>
      QUANTITATIVE_LABELED_VALUE_RE.test(fragment) &&
      QUANTITATIVE_NUMERIC_UNIT_RE.test(fragment) &&
      !fragment.includes(" og "),
    120,
  );

  const quantitativeBySubject =
    subjectFamily === "matematik" ||
    subjectFamily === "fysik" ||
    (subjectFamily === "okonomi" && QUANTITATIVE_TASK_RE.test(joined));
  const hasStructuredData = Boolean(setupFragment || coordinateFragment || valueFragment || constantFragment);

  return {
    subjectFamily,
    isQuantitative: quantitativeBySubject && hasStructuredData,
    setupFragment,
    coordinateFragment,
    valueFragment,
    constantFragment,
  };
}

function buildQuantitativePromptBlock(profile: QuantitativeQuestionProfile) {
  if (!profile.isQuantitative) return "";

  const criticalData = [profile.setupFragment, profile.coordinateFragment, profile.valueFragment, profile.constantFragment]
    .filter(Boolean)
    .slice(0, 3)
    .join(" | ");

  const lines = [
    "",
    "KVANTITATIV DATA-COMPLETEHED:",
    "- Hvis spørgsmålet afhænger af konkrete givne data, skal de nødvendige tal, koordinater, tider, målinger, konstanter og enheder bevares eksplicit i spørgsmålet.",
    "- Du må gerne forenkle sproget, men du må ikke fjerne data, som er nødvendige for at løse opgaven.",
    "- Hvis materialet giver navngivne punkter eller målinger, så nævn dem kort og komplet i spørgsmålet.",
  ];

  if (criticalData) {
    lines.push(`- Bevar især disse givne oplysninger, hvis de er nødvendige: ${criticalData}`);
  }

  return lines.join("\n");
}

function startsWithActionVerb(value: string) {
  return /^(bestem|beregn|vis|forklar|fortolk|opstil|udled|løs|loes|vurder|begrund)\b/i.test(collapseWhitespace(value));
}

function toInfinitiveAction(value: string) {
  const text = collapseWhitespace(value).replace(/[.!?]\s*$/g, "").trim();
  if (!text) return "";

  const match = /^(bestem|beregn|vis|forklar|fortolk|opstil|udled|løs|loes|vurder|begrund)\b/i.exec(text);
  if (!match) return text.charAt(0).toLowerCase() + text.slice(1);

  const infinitiveMap: Record<string, string> = {
    bestem: "bestemme",
    beregn: "beregne",
    vis: "vise",
    forklar: "forklare",
    fortolk: "fortolke",
    opstil: "opstille",
    udled: "udlede",
    løs: "løse",
    loes: "løse",
    vurder: "vurdere",
    begrund: "begrunde",
  };

  const verb = match[1].toLowerCase();
  const infinitive = infinitiveMap[verb] ?? verb;
  return `${infinitive}${text.slice(match[0].length)}`.trim();
}

function cleanQuantitativeActionSentence(value: string) {
  const stripped = collapseWhitespace(value)
    .replace(/\bbrug disse givne data:.*$/i, "")
    .replace(/\bbrug (?:disse|de) data:.*$/i, "")
    .trim();
  const sentences = splitQuestionSentences(stripped);
  const actionSentence = sentences.find((sentence) => startsWithActionVerb(sentence)) ?? sentences[0] ?? stripped;
  return finalizeQuestionText(actionSentence);
}

function looksLikeRawQuantitativeQuestion(value: string) {
  const text = collapseWhitespace(value);
  if (!text) return false;
  if (/brug disse givne data:/i.test(text)) return true;
  const sentences = splitQuestionSentences(text);
  if (sentences.length <= 1 && countPatternMatches(text, QUANTITATIVE_COORDINATE_RE) >= 2) return true;
  return !startsWithActionVerb(text) && countPatternMatches(text, QUANTITATIVE_NUMERIC_UNIT_RE) >= 2;
}

function formatQuantitativeFragmentSentence(
  fragment: string,
  kind: "setup" | "coordinates" | "values" | "constant",
  subjectFamily: QuestionSubjectFamily,
  compact: boolean,
) {
  const raw = compact ? compactQuantitativeFragment(fragment, kind === "constant" ? 90 : 150) : normalizeFragmentSentence(fragment, 180);
  const text = raw.replace(/[.!?]\s*$/g, "").trim();
  if (!text) return "";

  if (/[a-zæøå]/i.test(text.charAt(0)) && /\b(er|har|viser|opfanges|måles|målt|givet|angivet|placeret)\b/i.test(text)) {
    return finalizeQuestionText(text.charAt(0).toUpperCase() + text.slice(1));
  }

  if (kind === "setup") {
    if (/[a-zæøå]/i.test(text.charAt(0)) && /\b(er|givet|gælder|viser|angivet)\b/i.test(text)) {
      return finalizeQuestionText(text.charAt(0).toUpperCase() + text.slice(1));
    }
    if (subjectFamily === "matematik") return finalizeQuestionText(`Brug de givne oplysninger ${text}`);
    if (subjectFamily === "okonomi") return finalizeQuestionText(`Brug disse oplysninger fra materialet: ${text}`);
    return finalizeQuestionText(`Brug de givne oplysninger: ${text}`);
  }

  if (kind === "coordinates") {
    if (subjectFamily === "fysik") return finalizeQuestionText(`De relevante placeringer er ${text}`);
    if (subjectFamily === "matematik") return finalizeQuestionText(`De givne punkter er ${text}`);
    return finalizeQuestionText(`De relevante punkter og koordinater er ${text}`);
  }

  if (kind === "values") {
    if (subjectFamily === "fysik") return finalizeQuestionText(`De tilhørende målinger er ${text}`);
    if (subjectFamily === "okonomi") return finalizeQuestionText(`Brug også disse tal fra materialet: ${text}`);
    return finalizeQuestionText(`De givne værdier er ${text}`);
  }

  if (subjectFamily === "fysik") return finalizeQuestionText(`Brug ${text}`);
  return finalizeQuestionText(`Brug også ${text}`);
}

function extractPhysicsCoordinateSentence(fragment: string, compact: boolean) {
  const raw = compact ? compactQuantitativeFragment(fragment, 140) : normalizeFragmentSentence(fragment, 180);
  const text = raw.replace(/[.!?]\s*$/g, "").trim();
  if (!text) return "";

  const coords = text.match(new RegExp(QUANTITATIVE_COORDINATE_RE.source, "g")) ?? [];
  if (coords.length >= 2) {
    const joinedCoords = coords.join(", ").replace(/, ([^,]+)$/, " og $1");
    if (/\bhydrofon/i.test(text)) {
      return finalizeQuestionText(`Tre hydrofoner er placeret i punkterne ${joinedCoords}`);
    }
    if (coords.length === 3) {
      return finalizeQuestionText(`Følgende punkter er givet: ${joinedCoords}`);
    }
    return finalizeQuestionText(`Punkterne ${joinedCoords} er givet`);
  }

  if (/[a-zæøå]/i.test(text.charAt(0)) && /\b(er|har|placeret|koordinater)\b/i.test(text)) {
    return finalizeQuestionText(text.charAt(0).toUpperCase() + text.slice(1));
  }

  return finalizeQuestionText(`De relevante placeringer er ${text}`);
}

function extractPhysicsTimeMatches(value: string) {
  const matches = [...collapseWhitespace(value).matchAll(new RegExp(PHYSICS_TIME_VALUE_RE.source, "gi"))];
  const out: string[] = [];
  const seen = new Set<string>();
  for (const match of matches) {
    const label = String(match[1] ?? "").trim().toUpperCase();
    const amount = String(match[2] ?? "").trim();
    const unit = String(match[3] ?? "").trim();
    if (!label || !amount || !unit) continue;
    const key = `${label}|${amount}|${unit.toLowerCase()}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(`${label} = ${amount} ${unit}`);
  }
  return out;
}

function buildPhysicsTimeSentenceFromMatches(matches: string[]) {
  const uniqueMatches = matches.map(collapseWhitespace).filter(Boolean);
  if (uniqueMatches.length < 2) return "";
  const joined = uniqueMatches.join(", ").replace(/, ([^,]+)$/, " og $1");
  return finalizeQuestionText(`Et lydsignal opfanges ved tiderne ${joined}`);
}

function extractPhysicsMeasurementSentence(fragment: string, compact: boolean) {
  const labeledValues = extractPhysicsTimeMatches(fragment);
  if (labeledValues.length >= 2) return buildPhysicsTimeSentenceFromMatches(labeledValues);

  const raw = compact ? compactQuantitativeFragment(fragment, 150) : normalizeFragmentSentence(fragment, 190);
  const text = raw.replace(/[.!?]\s*$/g, "").trim();
  if (!text) return "";

  if (/[a-zæøå]/i.test(text.charAt(0)) && /\b(er|har|opfanges|måles|målt)\b/i.test(text)) {
    return finalizeQuestionText(text.charAt(0).toUpperCase() + text.slice(1));
  }

  return finalizeQuestionText(`De tilhørende målinger er ${text}`);
}

function extractPhysicsDistanceSentence(fragment: string, compact: boolean) {
  const raw = compact ? compactQuantitativeFragment(fragment, 150) : normalizeFragmentSentence(fragment, 190);
  const text = raw.replace(/[.!?]\s*$/g, "").trim();
  if (!text) return "";

  const extraDistanceMatch =
    /\b(?:\d+(?:[.,]\d+)?\s*m\/s\s*=\s*)?(\d+(?:[.,]\d+)?)\s*m\s*(længere|laengere|kortere)\s+end\s+(?:til\s+)?(?:den\s+)?(første|anden|tredje)\s+hydrofon\b/i.exec(
      text,
    );
  if (extraDistanceMatch) {
    const [, distanceValue, relation, hydrofonOrdinal] = extraDistanceMatch;
    const normalizedRelation = /^kortere$/i.test(relation) ? "kortere" : "længere";
    return finalizeQuestionText(
      `Tidsforskellen svarer til en ekstra afstand på ${distanceValue} m, så signalet har tilbagelagt ${normalizedRelation} til den ${hydrofonOrdinal} hydrofon.`,
    );
  }

  const simpleExtraDistanceMatch = /\b(?:\d+(?:[.,]\d+)?\s*m\/s\s*=\s*)?(\d+(?:[.,]\d+)?)\s*m\s*(længere|laengere|kortere)\b/i.exec(text);
  if (simpleExtraDistanceMatch) {
    const [, distanceValue, relation] = simpleExtraDistanceMatch;
    const normalizedRelation = /^kortere$/i.test(relation) ? "kortere" : "længere";
    return finalizeQuestionText(
      `Tidsforskellen svarer til en ekstra afstand på ${distanceValue} m, så signalet har tilbagelagt ${normalizedRelation} til en af hydrofonerne.`,
    );
  }

  if (/[a-zæøå]/i.test(text.charAt(0)) && /\b(er|har|viser|afstandsforsk|længere|laengere|kortere)\b/i.test(text)) {
    return finalizeQuestionText(text.charAt(0).toUpperCase() + text.slice(1));
  }

  if (/\b[-+]?\d+(?:[.,]\d+)?\s*m\s*(?:længere|laengere|kortere)\b/i.test(text)) {
    return finalizeQuestionText(`Afstandsforskellen er ${text}`);
  }

  return finalizeQuestionText(`Brug også denne afstandsoplysning: ${text}`);
}

function extractPhysicsConstantInstruction(fragment: string, compact: boolean) {
  const raw = compact ? compactQuantitativeFragment(fragment, 100) : normalizeFragmentSentence(fragment, 120);
  const text = raw.replace(/[.!?]\s*$/g, "").trim();
  if (!text) return "";

  const speedMatch = /\b(\d+(?:[.,]\d+)?)\s*m\/s\b/i.exec(text);
  if (speedMatch) {
    return `Brug lydhastigheden ${speedMatch[1]} m/s`;
  }

  const unitValueMatch = /([-+]?\d+(?:[.,]\d+)?(?:\s*(?:·|x|\*)\s*10\^?-?\d+)?)\s*(N|J|W|V|A|Hz|Pa|°C|K|m\/s\^?2|m\/s|m|cm|mm|km)\b/i.exec(
    text,
  );
  if (unitValueMatch) {
    return `Brug størrelsen ${unitValueMatch[1]} ${unitValueMatch[2]}`;
  }

  if (/^(brug|anvend)\b/i.test(text)) return text.charAt(0).toUpperCase() + text.slice(1);
  return `Brug ${text}`;
}

function hasPhysicsCoordinateData(value: string) {
  return countPatternMatches(value, QUANTITATIVE_COORDINATE_RE) >= 2;
}

function hasPhysicsMeasurementData(value: string) {
  return extractPhysicsTimeMatches(value).length >= 2 || countPatternMatches(value, QUANTITATIVE_LABELED_VALUE_RE) >= 2;
}

function hasPhysicsTimeData(value: string) {
  return extractPhysicsTimeMatches(value).length >= 2 || /\b(ankomsttid|ankomsttider|tiderne|opfanges ved tiderne)\b/i.test(value);
}

function hasPhysicsConstantData(value: string) {
  return /\b\d+(?:[.,]\d+)?\s*m\/s\b/i.test(value) || /\b\d+(?:[.,]\d+)?\s*(N|J|W|V|A|Hz|Pa|°C|K)\b/i.test(value);
}

function hasPhysicsDistanceDifferenceData(value: string) {
  return PHYSICS_DISTANCE_DIFF_RE.test(value);
}

function hasPhysicsExtraDistanceData(value: string) {
  return /\b[-+]?\d+(?:[.,]\d+)?\s*m\b/i.test(value) && /\b(længere|laengere|kortere|afstand)\b/i.test(value);
}

function isPhysicsPositionTask(contextText: string, rawQuestion: string) {
  return PHYSICS_POSITION_TASK_RE.test(normalizeTopicAndContext(rawQuestion, contextText));
}

function isUsablePhysicsRequirement(value: string) {
  const text = collapseWhitespace(value);
  if (!text) return false;
  if (!startsWithActionVerb(text)) return false;
  if (/^[=x×*0-9]/i.test(text)) return false;
  if (/1500\s*m\/s|=\s*\d+/i.test(text.slice(0, 48))) return false;
  return text.length >= 14;
}

function extractPhysicsMainRequirement(actionSentence: string) {
  const text = collapseWhitespace(actionSentence)
    .replace(/^brug(?: også)?\s+.+?\s+til at\s+/i, "")
    .replace(/^med udgangspunkt i\s+/i, "")
    .trim();
  if (!text) return "";

  const hintLead = text.search(/\b(vis først|opstil(?: først| derefter)?|angiv(?: først)?|vis derefter)\b/i);
  const mainPart = hintLead > 0 ? text.slice(0, hintLead).trim().replace(/\bog\s*$/i, "").trim() : text;
  if (!mainPart) return "";

  const imperativeMatch = /\b(bestem|beregn|forklar|fortolk|vurder|begrund)\b.+$/i.exec(mainPart);
  const requirement = imperativeMatch ? imperativeMatch[0] : mainPart;
  return finalizeQuestionText(requirement);
}

function extractPhysicsHintSentence(actionSentence: string) {
  const text = collapseWhitespace(actionSentence);
  const hintMatch = /\b(vis først|opstil(?: først| derefter)?|angiv(?: først)?|vis derefter)\b.+$/i.exec(text);
  if (!hintMatch) return "";
  return finalizeQuestionText(hintMatch[0]);
}

function inferPhysicsContextRequirement(contextText: string, rawQuestion: string) {
  const joined = normalizeTopicAndContext(rawQuestion, contextText).toLowerCase();
  if (/\bhydrofon|fiskens position|lydsignal\b/.test(joined)) return "Bestem fiskens position.";
  if (/\bgraf|maaling|måling|data\b/.test(joined)) return "Forklar hvad resultaterne viser fysisk.";
  if (/\bberegn|bestem\b/.test(joined)) return "Bestem det relevante resultat.";
  return "Forklar den fysiske sammenhæng og det vigtigste resultat.";
}

function inferPhysicsContextHint(contextText: string, rawQuestion: string) {
  const joined = normalizeTopicAndContext(rawQuestion, contextText).toLowerCase();
  if (/\bhydrofon|afstandsforsk|lydsignal\b/.test(joined)) {
    return "Vis først afstandsforskellene og opstil derefter de ligninger, du bruger.";
  }
  if (/\bgraf|maaling|måling|data\b/.test(joined)) {
    return "Brug grafen eller data aktivt som belæg i din forklaring.";
  }
  return "";
}

function isPhysicsCompletenessSensitiveTask(contextText: string, rawQuestion: string) {
  const joined = normalizeTopicAndContext(rawQuestion, contextText).toLowerCase();
  return /\b(hydrofon|hydrofoner|position|triangul|cirkelligning|cirkel|afstand|måling|maaling|lydankomst|lydsignal)\b/.test(
    joined,
  );
}

function pickPhysicsSupportFragment(
  contextText: string,
  predicate: (fragment: string) => boolean,
  maxChars = 190,
) {
  return pickQuantitativeFragment(splitContextFragments(contextText), predicate, maxChars);
}

function pickPhysicsPiece(
  contextValue: string,
  rawValue: string,
): { text: string; source: "context" | "raw" | "none" } {
  if (contextValue) return { text: contextValue, source: "context" };
  if (rawValue) return { text: rawValue, source: "raw" };
  return { text: "", source: "none" };
}

function pickPhysicsPiecePreferringRaw(
  rawValue: string,
  contextValue: string,
): { text: string; source: "context" | "raw" | "none" } {
  if (rawValue) return { text: rawValue, source: "raw" };
  if (contextValue) return { text: contextValue, source: "context" };
  return { text: "", source: "none" };
}

function buildNaturalPhysicsQuestion(
  baseQuestion: string,
  profile: QuantitativeQuestionProfile,
  contextText: string,
  options?: { compact?: boolean },
): { question: string; diagnostics: PhysicsQuestionFormattingDiagnostics } {
  const compact = options?.compact === true;
  const contextCoordinateSentence = profile.coordinateFragment
    ? extractPhysicsCoordinateSentence(profile.coordinateFragment, compact)
    : "";
  const rawCoordinateSentence = hasPhysicsCoordinateData(baseQuestion) ? extractPhysicsCoordinateSentence(baseQuestion, compact) : "";
  const coordinate = pickPhysicsPiece(contextCoordinateSentence, rawCoordinateSentence);

  const rawTimeMatches = extractPhysicsTimeMatches(baseQuestion);
  const contextTimeMatches = profile.valueFragment ? extractPhysicsTimeMatches(profile.valueFragment) : [];
  const rawTimeSentence = buildPhysicsTimeSentenceFromMatches(rawTimeMatches);
  const contextTimeSentence = buildPhysicsTimeSentenceFromMatches(contextTimeMatches);
  const contextMeasurementSentence =
    !contextTimeSentence && profile.valueFragment ? extractPhysicsMeasurementSentence(profile.valueFragment, compact) : "";
  const rawMeasurementSentence =
    !rawTimeSentence && hasPhysicsMeasurementData(baseQuestion) ? extractPhysicsMeasurementSentence(baseQuestion, compact) : "";
  const timeData =
    rawTimeMatches.length >= 2 || contextTimeMatches.length >= 2
      ? pickPhysicsPiecePreferringRaw(rawTimeSentence, contextTimeSentence)
      : pickPhysicsPiece("", "");
  const measurements = timeData.text
    ? timeData
    : pickPhysicsPiece(contextMeasurementSentence, rawMeasurementSentence);

  const contextDistanceFragment = pickPhysicsSupportFragment(
    contextText,
    (fragment) => hasPhysicsDistanceDifferenceData(fragment) || hasPhysicsExtraDistanceData(fragment),
    180,
  );
  const contextDistanceSentence = contextDistanceFragment ? extractPhysicsDistanceSentence(contextDistanceFragment, compact) : "";
  const rawDistanceSentence =
    hasPhysicsDistanceDifferenceData(baseQuestion) || hasPhysicsExtraDistanceData(baseQuestion)
      ? extractPhysicsDistanceSentence(baseQuestion, compact)
      : "";
  const distance = pickPhysicsPiece(contextDistanceSentence, rawDistanceSentence);

  const contextConstantInstruction = profile.constantFragment
    ? extractPhysicsConstantInstruction(profile.constantFragment, compact)
    : "";
  const rawConstantInstruction = hasPhysicsConstantData(baseQuestion) ? extractPhysicsConstantInstruction(baseQuestion, compact) : "";
  const constant = pickPhysicsPiece(contextConstantInstruction, rawConstantInstruction);

  const rawRequirement = extractPhysicsMainRequirement(baseQuestion);
  const mainRequirement = isUsablePhysicsRequirement(rawRequirement) ? rawRequirement : inferPhysicsContextRequirement(contextText, baseQuestion);
  const mainRequirementSource: PhysicsQuestionFormattingDiagnostics["mainRequirementSource"] = isUsablePhysicsRequirement(rawRequirement)
    ? "raw"
    : mainRequirement
      ? "context_fallback"
      : "none";

  const rawHint = extractPhysicsHintSentence(baseQuestion);
  const contextHint = inferPhysicsContextHint(contextText, baseQuestion);
  const hint = rawHint
    ? { text: rawHint, source: "raw" as const }
    : contextHint
      ? { text: contextHint, source: "context_fallback" as const }
      : { text: "", source: "none" as const };

  const positionTask = isPhysicsPositionTask(contextText, baseQuestion);
  const hasCoordinates = Boolean(coordinate.text);
  const timeMatches = timeData.source === "raw" ? rawTimeMatches : timeData.source === "context" ? contextTimeMatches : [];
  const hasTimes = timeMatches.length >= 2 || hasPhysicsTimeData(measurements.text);
  const hasConstant = Boolean(constant.text);
  const hasDistanceDifferences = hasPhysicsDistanceDifferenceData(distance.text);
  const hasExtraDistance = hasPhysicsExtraDistanceData(distance.text);
  const usedTimesInQuestion = timeMatches.length >= 2 || hasTimes;
  const usedDerivedDistanceFallback = !usedTimesInQuestion && Boolean(distance.text);
  const positionGuardTriggered = positionTask;

  let actionSentence = mainRequirement || cleanQuantitativeActionSentence(baseQuestion);
  if (constant.text && !(positionTask && usedDerivedDistanceFallback)) {
    const infinitiveAction = toInfinitiveAction(actionSentence);
    actionSentence = infinitiveAction
      ? finalizeQuestionText(`${constant.text} til at ${infinitiveAction}`)
      : finalizeQuestionText(`${constant.text}. ${actionSentence}`);
  }

  const supportSentence = measurements.text || distance.text;
  let usedFallbackQuestion = false;
  let question = finalizeQuestionText([coordinate.text, supportSentence, actionSentence, hint.text].filter(Boolean).slice(0, compact ? 3 : 4).join(" "));

  if (positionTask && !hasTimes && !hasDistanceDifferences && !hasExtraDistance) {
    usedFallbackQuestion = true;
    question = finalizeQuestionText(
      [
        coordinate.text,
        constant.text ? `${constant.text} i din forklaring` : "",
        "Forklar, hvilke måleoplysninger der skal bruges sammen med de givne placeringer for at bestemme positionen.",
      ]
        .filter(Boolean)
        .join(". "),
    );
  }

  return {
    question,
    diagnostics: {
      coordinateSentence: coordinate.text,
      coordinateSource: coordinate.source,
      measurementSentence: measurements.text,
      measurementSource: measurements.source,
      timeSentence: timeData.text,
      timeSource: timeData.source,
      timeMatches,
      distanceSentence: distance.text,
      distanceSource: distance.source,
      constantInstruction: constant.text,
      constantSource: constant.source,
      mainRequirement,
      mainRequirementSource,
      hintSentence: hint.text,
      hintSource: hint.source,
      positionGuardTriggered,
      physicsCompletenessGuardTriggered: false,
      hasCoordinates,
      hasTimes,
      hasConstant,
      usedTimesInQuestion,
      hasDistanceDifferences,
      hasExtraDistance,
      usedDerivedDistanceFallback,
      derivedDistanceSentence: usedDerivedDistanceFallback ? distance.text : "",
      usedContextEnrichment: false,
      usedPhysicsFallbackQuestion: false,
      usedFallbackQuestion,
    },
  };
}

function buildPhysicsQuestionFromContext(
  baseQuestion: string,
  profile: QuantitativeQuestionProfile,
  contextText: string,
  options?: { compact?: boolean },
) {
  const contextProfile: QuantitativeQuestionProfile = {
    ...profile,
    coordinateFragment:
      profile.coordinateFragment ||
      pickPhysicsSupportFragment(contextText, (fragment) => hasPhysicsCoordinateData(fragment), 190),
    valueFragment:
      profile.valueFragment ||
      pickPhysicsSupportFragment(
        contextText,
        (fragment) =>
          hasPhysicsMeasurementData(fragment) || hasPhysicsDistanceDifferenceData(fragment) || hasPhysicsExtraDistanceData(fragment),
        190,
      ),
    constantFragment:
      profile.constantFragment ||
      pickPhysicsSupportFragment(contextText, (fragment) => hasPhysicsConstantData(fragment), 120),
  };
  return buildNaturalPhysicsQuestion(baseQuestion, contextProfile, contextText, options);
}

function buildPhysicsFallbackQuestion(
  baseQuestion: string,
  profile: QuantitativeQuestionProfile,
  contextText: string,
  options?: { compact?: boolean },
) {
  const rebuilt = buildPhysicsQuestionFromContext(baseQuestion, profile, contextText, options);
  const pieces = [
    rebuilt.diagnostics.coordinateSentence,
    rebuilt.diagnostics.timeSentence || rebuilt.diagnostics.distanceSentence,
  ].filter(Boolean);

  const fallbackAction =
    pieces.length >= 2
      ? rebuilt.diagnostics.hasConstant
        ? finalizeQuestionText(`${rebuilt.diagnostics.constantInstruction} til at bestemme den relevante størrelse`)
        : "Brug de givne oplysninger til at bestemme den relevante størrelse."
      : "Forklar, hvilke givne oplysninger der er centrale, og hvordan de bruges i opstillingen.";

  const question = finalizeQuestionText(
    [...pieces, fallbackAction, rebuilt.diagnostics.hintSentence].filter(Boolean).slice(0, options?.compact ? 3 : 4).join(" "),
  );

  return {
    question,
    diagnostics: {
      ...rebuilt.diagnostics,
      physicsCompletenessGuardTriggered: true,
      usedContextEnrichment: true,
      usedPhysicsFallbackQuestion: true,
      usedFallbackQuestion: true,
    },
  };
}

function buildNaturalQuantitativeQuestion(
  baseQuestion: string,
  profile: QuantitativeQuestionProfile,
  contextText: string,
  options?: { compact?: boolean },
): { question: string; physicsDiagnostics?: PhysicsQuestionFormattingDiagnostics } {
  if (profile.subjectFamily === "fysik") {
    const physics = buildNaturalPhysicsQuestion(baseQuestion, profile, contextText, options);
    return { question: physics.question, physicsDiagnostics: physics.diagnostics };
  }

  const compact = options?.compact === true;
  const actionSentence = cleanQuantitativeActionSentence(baseQuestion);
  const introSentences = [
    profile.setupFragment ? formatQuantitativeFragmentSentence(profile.setupFragment, "setup", profile.subjectFamily, compact) : "",
    profile.coordinateFragment
      ? formatQuantitativeFragmentSentence(profile.coordinateFragment, "coordinates", profile.subjectFamily, compact)
      : "",
    profile.valueFragment ? formatQuantitativeFragmentSentence(profile.valueFragment, "values", profile.subjectFamily, compact) : "",
  ].filter(Boolean);

  const constantText = profile.constantFragment
    ? formatQuantitativeFragmentSentence(profile.constantFragment, "constant", profile.subjectFamily, compact)
        .replace(/[.!?]\s*$/g, "")
        .trim()
    : "";

  let finalAction = actionSentence;
  if (constantText) {
    const infinitiveAction = toInfinitiveAction(actionSentence);
    finalAction = infinitiveAction
      ? finalizeQuestionText(`${constantText} til at ${infinitiveAction}`)
      : finalizeQuestionText(`${constantText}. ${actionSentence}`);
  }

  const sentenceLimit = compact ? 2 : 3;
  const out = [...introSentences, finalAction].filter(Boolean).slice(0, sentenceLimit);
  return { question: finalizeQuestionText(out.join(" ")) };
}

function extractQuantitativeGivensFromText(value: string, subjectFamily: QuestionSubjectFamily): QuantitativeGivensSnapshot {
  const text = collapseWhitespace(value);
  const setupFragments = [
    ...(text.match(new RegExp(QUANTITATIVE_FUNCTION_RE.source, "gi")) ?? []),
    ...(text.match(new RegExp(QUANTITATIVE_INTERVAL_RE.source, "gi")) ?? []),
  ]
    .map((match) => collapseWhitespace(match))
    .filter(Boolean);
  if (subjectFamily === "okonomi" && QUANTITATIVE_TABLE_WORD_RE.test(text) && countPatternMatches(text, QUANTITATIVE_NUMERIC_UNIT_RE) >= 2) {
    setupFragments.push("tabel/data med tal");
  }

  const coordinates = [...text.matchAll(new RegExp(QUANTITATIVE_COORDINATE_RE.source, "g"))].map((match) => collapseWhitespace(match[0]));
  const values = [...text.matchAll(new RegExp(QUANTITATIVE_LABELED_VALUE_RE.source, "gi"))].map((match) => collapseWhitespace(match[0]));
  const constants = [...text.matchAll(/\b(?:g\s*=\s*[-+]?\d+(?:[.,]\d+)?(?:\s*m\/s\^?2)?|lydhastigheden?\s*[-=]?\s*[-+]?\d+(?:[.,]\d+)?\s*m\/s|[-+]?\d+(?:[.,]\d+)?\s*m\/s)\b/gi)].map(
    (match) => collapseWhitespace(match[0]),
  );

  const summary: string[] = [];
  if (setupFragments.length > 0) summary.push(`setup: ${setupFragments[0]}`);
  if (coordinates.length > 0) summary.push(`koordinater: ${coordinates.slice(0, 3).join(", ")}`);
  if (values.length > 0) summary.push(`målinger: ${values.slice(0, 3).join(", ")}`);
  if (constants.length > 0) summary.push(`konstanter: ${constants[0]}`);

  return {
    hasSetup: setupFragments.length > 0,
    hasCoordinates: coordinates.length >= 2,
    hasValues: values.length >= 2 || countPatternMatches(text, QUANTITATIVE_NUMERIC_UNIT_RE) >= 2,
    hasConstants: constants.length > 0,
    summary: summary.slice(0, 4),
  };
}

function listMissingCriticalGivens(
  profile: QuantitativeQuestionProfile,
  contextGivens: QuantitativeGivensSnapshot,
  questionGivens: QuantitativeGivensSnapshot,
) {
  const required: Array<{ key: string; needed: boolean; present: boolean }> = [
    { key: "setup", needed: contextGivens.hasSetup, present: questionGivens.hasSetup },
    {
      key: "coordinates",
      needed: contextGivens.hasCoordinates && (profile.subjectFamily === "fysik" || profile.subjectFamily === "matematik"),
      present: questionGivens.hasCoordinates,
    },
    { key: "målinger", needed: contextGivens.hasValues, present: questionGivens.hasValues },
    {
      key: "konstanter",
      needed: contextGivens.hasConstants && (profile.subjectFamily === "fysik" || profile.subjectFamily === "okonomi"),
      present: questionGivens.hasConstants,
    },
  ];

  return required.filter((item) => item.needed && !item.present).map((item) => item.key);
}

function buildQuantitativeFallbackQuestion(
  profile: QuantitativeQuestionProfile,
  baseQuestion: string,
  options?: { compact?: boolean },
) {
  const compact = options?.compact === true;
  const introSentences = [
    profile.setupFragment ? formatQuantitativeFragmentSentence(profile.setupFragment, "setup", profile.subjectFamily, compact) : "",
    profile.coordinateFragment ? formatQuantitativeFragmentSentence(profile.coordinateFragment, "coordinates", profile.subjectFamily, compact) : "",
    profile.valueFragment ? formatQuantitativeFragmentSentence(profile.valueFragment, "values", profile.subjectFamily, compact) : "",
  ].filter(Boolean);

  const fallbackAction =
    profile.subjectFamily === "okonomi"
      ? "Forklar, hvad tallene i materialet viser, og fortolk kort resultatet."
      : profile.subjectFamily === "matematik"
        ? "Brug de givne oplysninger til at bestemme det relevante resultat, og vis kort din metode."
        : "Brug de givne oplysninger til at forklare eller bestemme det relevante resultat.";

  const rawAction = cleanQuantitativeActionSentence(baseQuestion);
  const actionSentence = looksLikeRawQuantitativeQuestion(rawAction) ? fallbackAction : rawAction;
  return finalizeQuestionText([...introSentences, actionSentence].filter(Boolean).slice(0, compact ? 2 : 3).join(" "));
}

function ensureQuantitativeQuestionCompleteness(
  question: string,
  args: { topic: string; contextText: string; explicitSubjectFamily?: QuestionSubjectFamily | null },
  options?: { compact?: boolean },
): {
  question: string;
  physicsDiagnostics?: PhysicsQuestionFormattingDiagnostics;
  quantitativeDiagnostics?: QuantitativeQuestionGuardDiagnostics;
} {
  const profile = inferQuantitativeQuestionProfile(args.topic, args.contextText, args.explicitSubjectFamily);
  const base = finalizeQuestionText(trimQuestionLead(question));
  if (!profile.isQuantitative) return { question: base };
  const questionText = collapseWhitespace(base);
  const contextGivens = extractQuantitativeGivensFromText(args.contextText, profile.subjectFamily);
  const originalQuestionGivens = extractQuantitativeGivensFromText(questionText, profile.subjectFamily);
  const missingCoordinates =
    Boolean(profile.coordinateFragment) && countPatternMatches(questionText, QUANTITATIVE_COORDINATE_RE) < 2;
  const missingValues =
    Boolean(profile.valueFragment) &&
    countPatternMatches(questionText, QUANTITATIVE_LABELED_VALUE_RE) < 2 &&
    countPatternMatches(questionText, QUANTITATIVE_NUMERIC_UNIT_RE) < 2;
  const missingConstant =
    Boolean(profile.constantFragment) &&
    !questionText.toLowerCase().includes(collapseWhitespace(profile.constantFragment).toLowerCase().slice(0, 8));
  const missingCriticalGivens = listMissingCriticalGivens(profile, contextGivens, originalQuestionGivens);
  const quantitativeGuardTriggered =
    missingCriticalGivens.length > 0 &&
    (looksLikeRawQuantitativeQuestion(base) ||
      (contextGivens.summary.length >= 2 && originalQuestionGivens.summary.length < contextGivens.summary.length));

  if (!missingCoordinates && !missingValues && !missingConstant && !quantitativeGuardTriggered && !looksLikeRawQuantitativeQuestion(base)) {
    return {
      question: base,
      quantitativeDiagnostics: {
        quantitativeGuardTriggered: false,
        contextGivens: contextGivens.summary,
        questionGivens: originalQuestionGivens.summary,
        missingCriticalGivens: [],
        usedGivensEnrichment: false,
        usedQuantitativeFallback: false,
      },
    };
  }

  const enriched = buildNaturalQuantitativeQuestion(base, profile, args.contextText, options);
  const enrichedGivens = extractQuantitativeGivensFromText(enriched.question, profile.subjectFamily);
  const remainingCriticalGivens = listMissingCriticalGivens(profile, contextGivens, enrichedGivens);
  const usedGivensEnrichment = enriched.question !== base;

  if (profile.subjectFamily === "fysik" && enriched.physicsDiagnostics) {
    const physicsCompletenessGuardTriggered =
      (quantitativeGuardTriggered || remainingCriticalGivens.length > 0) && isPhysicsCompletenessSensitiveTask(args.contextText, base);

    if (!physicsCompletenessGuardTriggered) {
      return {
        question: enriched.question,
        physicsDiagnostics: {
          ...enriched.physicsDiagnostics,
          physicsCompletenessGuardTriggered: false,
          usedContextEnrichment: usedGivensEnrichment,
          usedPhysicsFallbackQuestion: false,
        },
        quantitativeDiagnostics: {
          quantitativeGuardTriggered,
          contextGivens: contextGivens.summary,
          questionGivens: enrichedGivens.summary,
          missingCriticalGivens,
          usedGivensEnrichment,
          usedQuantitativeFallback: false,
        },
      };
    }

    const contextRebuilt = buildPhysicsQuestionFromContext(base, profile, args.contextText, options);
    const contextRebuiltGivens = extractQuantitativeGivensFromText(contextRebuilt.question, profile.subjectFamily);
    const contextRemainingCriticalGivens = listMissingCriticalGivens(profile, contextGivens, contextRebuiltGivens);

    if (contextRemainingCriticalGivens.length === 0) {
      return {
        question: contextRebuilt.question,
        physicsDiagnostics: {
          ...contextRebuilt.diagnostics,
          physicsCompletenessGuardTriggered: true,
          usedContextEnrichment: true,
          usedPhysicsFallbackQuestion: false,
        },
        quantitativeDiagnostics: {
          quantitativeGuardTriggered: true,
          contextGivens: contextGivens.summary,
          questionGivens: contextRebuiltGivens.summary,
          missingCriticalGivens: contextRemainingCriticalGivens,
          usedGivensEnrichment: true,
          usedQuantitativeFallback: false,
        },
      };
    }

    const physicsFallback = buildPhysicsFallbackQuestion(base, profile, args.contextText, options);
    const physicsFallbackGivens = extractQuantitativeGivensFromText(physicsFallback.question, profile.subjectFamily);
    return {
      question: physicsFallback.question,
      physicsDiagnostics: physicsFallback.diagnostics,
      quantitativeDiagnostics: {
        quantitativeGuardTriggered: true,
        contextGivens: contextGivens.summary,
        questionGivens: physicsFallbackGivens.summary,
        missingCriticalGivens: contextRemainingCriticalGivens,
        usedGivensEnrichment: true,
        usedQuantitativeFallback: true,
      },
    };
  }

  if (quantitativeGuardTriggered && remainingCriticalGivens.length > 0 && profile.subjectFamily !== "fysik") {
    const fallbackQuestion = buildQuantitativeFallbackQuestion(profile, base, options);
    const fallbackGivens = extractQuantitativeGivensFromText(fallbackQuestion, profile.subjectFamily);
    return {
      question: fallbackQuestion,
      ...(enriched.physicsDiagnostics ? { physicsDiagnostics: enriched.physicsDiagnostics } : {}),
      quantitativeDiagnostics: {
        quantitativeGuardTriggered: true,
        contextGivens: contextGivens.summary,
        questionGivens: fallbackGivens.summary,
        missingCriticalGivens,
        usedGivensEnrichment,
        usedQuantitativeFallback: true,
      },
    };
  }

  return {
    question: enriched.question,
    ...(enriched.physicsDiagnostics ? { physicsDiagnostics: enriched.physicsDiagnostics } : {}),
    quantitativeDiagnostics: {
      quantitativeGuardTriggered,
      contextGivens: contextGivens.summary,
      questionGivens: enrichedGivens.summary,
      missingCriticalGivens,
      usedGivensEnrichment,
      usedQuantitativeFallback: false,
    },
  };
}

function normalizeTopicAndContext(topic: string, contextText: string) {
  return `${String(topic ?? "")}\n${String(contextText ?? "")}`.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
}

function inferQuestionSubjectFamilyFromText(value: string): QuestionSubjectFamily {
  const joined = String(value ?? "").normalize("NFD").replace(/[\u0300-\u036f]/g, "");
  if (OKONOMI_TOPIC_RE.test(joined) || OKONOMI_CONTEXT_RE.test(joined)) return "okonomi";
  if (SAMFUND_TOPIC_RE.test(joined)) return "samfund";
  if (DANSK_TOPIC_RE.test(joined)) return "dansk";
  if (FYSIK_TOPIC_RE.test(joined)) return "fysik";
  if (MATEMATIK_TOPIC_RE.test(joined)) return "matematik";
  return "generic";
}

function resolveQuestionSubjectFamily(
  topic: string,
  contextText: string,
  explicitSubjectFamily?: QuestionSubjectFamily | null,
): QuestionSubjectResolution {
  const explicitFromArg = explicitSubjectFamily && explicitSubjectFamily !== "generic" ? explicitSubjectFamily : null;
  const explicitFromTopic = inferQuestionSubjectFamilyFromText(topic);
  const inferredSubjectFamily = inferQuestionSubjectFamilyFromText(normalizeTopicAndContext(topic, contextText));
  const resolvedSubjectFamily = explicitFromArg ?? (explicitFromTopic !== "generic" ? explicitFromTopic : inferredSubjectFamily);
  return {
    explicitSubjectFamily: explicitFromArg ?? explicitFromTopic,
    inferredSubjectFamily,
    resolvedSubjectFamily,
  };
}

export function inferQuestionSubjectFamily(
  topic: string,
  contextText: string,
  explicitSubjectFamily?: QuestionSubjectFamily | null,
): QuestionSubjectFamily {
  return resolveQuestionSubjectFamily(topic, contextText, explicitSubjectFamily).resolvedSubjectFamily;
}

export function inferQuestionCalibrationProfile(
  topic: string,
  contextText: string,
  explicitSubjectFamily?: QuestionSubjectFamily | null,
): QuestionCalibrationProfile {
  const subjectFamily = inferQuestionSubjectFamily(topic, contextText, explicitSubjectFamily);
  const joined = normalizeTopicAndContext(topic, contextText);
  const verbCount = (joined.match(SHARED_TASK_VERBS_RE) ?? []).length;

  let score = 0;
  if (joined.length > 8500) score += 2;
  else if (joined.length > 5000) score += 1;
  if (verbCount >= 4) score += 2;
  else if (verbCount >= 2) score += 1;

  if (subjectFamily === "okonomi" && OKONOMI_TECHNICAL_SOURCE_RE.test(joined)) score += 3;
  if (subjectFamily === "matematik" && ADVANCED_MATEMATIK_SOURCE_RE.test(joined)) score += 2;
  if (subjectFamily === "fysik" && ADVANCED_FYSIK_SOURCE_RE.test(joined)) score += 2;
  if (subjectFamily === "samfund" && ADVANCED_SAMFUND_SOURCE_RE.test(joined)) score += 2;
  if (subjectFamily === "dansk" && ADVANCED_DANSK_SOURCE_RE.test(joined)) score += 2;

  const sourceDifficulty: InferredQuestionDifficulty = score >= 4 ? "advanced" : score >= 2 ? "medium" : "easy";
  const calibrationTarget: QuestionCalibrationTarget = sourceDifficulty === "advanced" ? "slightly_simplified" : "match_source";
  const technicalDensity = score >= 4 ? "high" : score >= 2 ? "medium" : "low";

  return {
    subjectFamily,
    sourceDifficulty,
    calibrationTarget,
    technicalDensity,
  };
}

function inferOkonomiQuestionLanguageProfile(topic: string, contextText: string): OkonomiQuestionLanguageProfile {
  const joined = normalizeTopicAndContext(topic, contextText);
  const isEconomy = OKONOMI_TOPIC_RE.test(joined) || OKONOMI_CONTEXT_RE.test(joined);
  return {
    isEconomy,
    hasTechnicalSource: isEconomy && OKONOMI_TECHNICAL_SOURCE_RE.test(joined),
  };
}

function buildQuestionCalibrationPromptBlock(profile: QuestionCalibrationProfile) {
  const lines = [
    "",
    "NIVEAU-KALIBRERING:",
    `- Materialets omtrentlige niveau vurderes som ${profile.sourceDifficulty}.`,
    `- Output skal som udgangspunkt være ${profile.calibrationTarget} i forhold til kilden, ikke en rå spejling af dens stil.`,
    "- Bevar det faglige niveau, men gør formuleringen mere træningsvenlig og lettere at gå til for en elev.",
  ];

  if (profile.subjectFamily === "matematik" || profile.subjectFamily === "fysik") {
    lines.push(
      "- Undgå at pakke for mange delkrav ind i ét spørgsmål.",
      "- Hvis opgaven naturligt har to trin, så gør rækkefølgen tydelig med fx 'først' og 'derefter'.",
    );
  }

  if (profile.subjectFamily === "okonomi" || profile.subjectFamily === "samfund") {
    lines.push(
      "- Undgå unødigt akademisk og tæt pakket sprog.",
      "- Foretræk tydelige elevverber som redegør, forklar, analysér og vurder.",
    );
  }

  if (profile.subjectFamily === "dansk") {
    lines.push(
      "- Undgå at pakke for mange analysekrav sammen på én gang.",
      "- Hold ét tydeligt hovedkrav og højst én kort opfølgning.",
    );
  }

  return lines.join("\n");
}

function pickOkonomiThemePair(contextText: string) {
  const text = normalizeTopicAndContext("", contextText).toLowerCase();
  const themePairs: Array<{ score: number; parts: [string, string] }> = [
    {
      score: (/\bforventning/.test(text) ? 2 : 0) + (/\bbeskaeftigelse\b/.test(text) ? 2 : 0),
      parts: ["forventninger", "beskæftigelsen"] as [string, string],
    },
    {
      score: (/\brente\b/.test(text) ? 2 : 0) + (/\binflation\b/.test(text) ? 2 : 0),
      parts: ["renten", "inflationen"] as [string, string],
    },
    {
      score: (/\befterspoergsel\b/.test(text) ? 2 : 0) + (/\budbud\b/.test(text) ? 2 : 0),
      parts: ["efterspørgsel", "udbud"] as [string, string],
    },
    {
      score: (/\bomsaetning\b/.test(text) ? 2 : 0) + (/\bomkostning/.test(text) ? 2 : 0),
      parts: ["omsætning", "omkostninger"] as [string, string],
    },
    {
      score: (/\bdaekningsbidrag\b/.test(text) ? 2 : 0) + (/\bavance\b/.test(text) ? 2 : 0),
      parts: ["dækningsbidrag", "avance"] as [string, string],
    },
    {
      score: (/\bvaekst\b/.test(text) ? 2 : 0) + (/\bkonkurrenceevne\b/.test(text) ? 2 : 0),
      parts: ["væksten", "konkurrenceevnen"] as [string, string],
    },
  ].sort((a, b) => b.score - a.score);

  const best = themePairs.find((pair) => pair.score >= 3);
  return best?.parts ?? ["de centrale økonomiske forhold", "resultaterne i materialet"];
}

function buildOkonomiPlainLanguagePromptBlock(profile: OkonomiQuestionLanguageProfile) {
  if (!profile.isEconomy) return "";

  const lines = [
    "",
    "ØKONOMI-NIVEAU (elevvenligt spørgsmål):",
    "- Skriv spørgsmålet i almindeligt gymnasie-/HHX-sprog.",
    "- Lav ét kort spørgsmål på højst 2 sætninger.",
    "- Brug resultater, tal og pointer fra materialet, men oversæt metode og analysejargon til almindeligt elevsprog.",
    "- Spørg hellere: hvad viser analysen, hvad betyder resultatet, hvordan hænger forholdene sammen, og hvilke styrker eller begrænsninger kan man pege på.",
    '- Foretræk formuleringer som "Forklar med egne ord", "Brug et eller to tal fra materialet", "Vurder til sidst".',
    "- Undgå som default græske symboler, regressionsnotation og metodejargon som beta, delta, koefficient, signifikans, dummy-variabel, lag og forecast.",
  ];

  if (profile.hasTechnicalSource) {
    lines.push(
      "- Hvis materialet ligner et bilag eller en regressionsanalyse, skal spørgsmålet stadig handle om konklusioner, sammenhænge, usikkerhed og begrænsninger i almindeligt sprog.",
      '- Nævn normalt ikke regression eller modelnavne direkte; omskriv i stedet til "analysen", "resultatet" eller "materialet".',
    );
  }

  return lines.join("\n");
}

export function rewriteTechnicalEconomyQuestionToStudentLanguage(question: string, topic: string, contextText: string) {
  const text = collapseWhitespace(question);
  const profile = inferOkonomiQuestionLanguageProfile(topic, contextText);
  if (!profile.isEconomy || !OKONOMI_TECHNICAL_OUTPUT_RE.test(text)) return text;

  const [leftTheme, rightTheme] = pickOkonomiThemePair(contextText);
  return `Forklar med egne ord, hvad analysen viser om sammenhængen mellem ${leftTheme} og ${rightTheme}. Brug gerne et eller to tal fra materialet, og nævn til sidst en styrke eller begrænsning ved analysen.`;
}

function splitMathLikeQuestion(value: string) {
  const text = collapseWhitespace(value);
  const match = /^(Bestem|Beregn|Løs|Vis|Forklar)\s+(.+?)\s+og\s+(bestem|beregn|løs|vis|forklar)\s+(.+)$/i.exec(text);
  if (!match) return text;

  const firstVerb = `${match[1].charAt(0).toUpperCase()}${match[1].slice(1).toLowerCase()}`;
  const secondVerb = `${match[3].charAt(0).toUpperCase()}${match[3].slice(1).toLowerCase()}`;
  const secondLead = secondVerb === "Vis" ? "Vis derefter" : `${secondVerb} derefter`;
  return `${firstVerb} ${match[2]}. ${secondLead} ${match[4]}`;
}

function softenHumanitiesQuestion(value: string, subjectFamily: QuestionSubjectFamily) {
  let text = trimQuestionLead(value);
  if (subjectFamily === "samfund") {
    text = text.replace(/\s+og\s+vurder\b/i, ". Vurder til sidst");
    text = text.replace(/\s+og\s+diskuter\b/i, ". Diskuter til sidst");
  }
  if (subjectFamily === "dansk") {
    text = text.replace(/\s+og\s+perspektiver\b/i, ". Perspektiver kort til sidst");
    text = text.replace(/\s+og\s+dokumenter\b/i, ". Dokumenter undervejs med et par tekststeder");
  }
  return finalizeQuestionText(text);
}

export function calibrateGeneratedQuestionWithDiagnostics(
  question: string,
  args: { topic: string; contextText: string; explicitSubjectFamily?: QuestionSubjectFamily | null },
): TrainerQuestionCalibrationResult {
  const subjectResolution = resolveQuestionSubjectFamily(args.topic, args.contextText, args.explicitSubjectFamily);
  const profile = inferQuestionCalibrationProfile(args.topic, args.contextText, args.explicitSubjectFamily);
  let text = finalizeQuestionText(trimQuestionLead(question));

  if (profile.subjectFamily === "okonomi") {
    text = finalizeQuestionText(rewriteTechnicalEconomyQuestionToStudentLanguage(text, args.topic, args.contextText));
  }

  if (profile.calibrationTarget === "slightly_simplified") {
    if (profile.subjectFamily === "matematik" || profile.subjectFamily === "fysik") {
      text = finalizeQuestionText(splitMathLikeQuestion(text));
    } else if (profile.subjectFamily === "samfund" || profile.subjectFamily === "dansk") {
      text = softenHumanitiesQuestion(text, profile.subjectFamily);
    }
  }

  const quantitative = ensureQuantitativeQuestionCompleteness(text, args);
  return {
    question: quantitative.question,
    profile,
    diagnostics: {
      subjectFamily: profile.subjectFamily,
      explicitSubjectFamily: subjectResolution.explicitSubjectFamily,
      inferredSubjectFamily: subjectResolution.inferredSubjectFamily,
      resolvedSubjectFamily: subjectResolution.resolvedSubjectFamily,
      rawQuestion: collapseWhitespace(question),
      ...(quantitative.quantitativeDiagnostics ? { quantitative: quantitative.quantitativeDiagnostics } : {}),
      ...(quantitative.physicsDiagnostics ? { physics: quantitative.physicsDiagnostics } : {}),
    },
  };
}

export function calibrateGeneratedQuestionForStudentLevel(
  question: string,
  args: { topic: string; contextText: string; explicitSubjectFamily?: QuestionSubjectFamily | null },
) {
  return calibrateGeneratedQuestionWithDiagnostics(question, args).question;
}

export function salvageTooLongTrainerQuestion(
  question: string,
  args: { topic: string; contextText: string; explicitSubjectFamily?: QuestionSubjectFamily | null },
) {
  const rewritten = rewriteTechnicalEconomyQuestionToStudentLanguage(question, args.topic, args.contextText);
  const compactQuantitative = ensureQuantitativeQuestionCompleteness(question, args, { compact: true }).question;
  const candidates = [compactQuantitative, rewritten, trimQuestionLead(rewritten), trimQuestionLead(question)]
    .map((candidate) => collapseWhitespace(candidate))
    .filter(Boolean);

  for (const candidate of candidates) {
    const withRequiredData = ensureQuantitativeQuestionCompleteness(candidate, args, {
      compact: candidate === compactQuantitative,
    }).question;
    if (!isOverlongQuestionCandidate(withRequiredData)) {
      return finalizeQuestionText(withRequiredData);
    }

    const firstTwoSentences = ensureQuantitativeQuestionCompleteness(
      splitQuestionSentences(candidate).slice(0, 2).join(" "),
      args,
      { compact: true },
    ).question;
    if (firstTwoSentences && !isOverlongQuestionCandidate(firstTwoSentences)) {
      return finalizeQuestionText(firstTwoSentences);
    }

    const firstSentence = ensureQuantitativeQuestionCompleteness(splitQuestionSentences(candidate)[0] ?? "", args, {
      compact: true,
    }).question;
    if (firstSentence && !isOverlongQuestionCandidate(firstSentence)) {
      return finalizeQuestionText(firstSentence);
    }

    const shortened = ensureQuantitativeQuestionCompleteness(shortenSentence(candidate, 280), args, {
      compact: true,
    }).question;
    if (shortened && !isOverlongQuestionCandidate(shortened)) {
      return finalizeQuestionText(shortened);
    }
  }

  return "";
}

export function pickDifficulty(raw: any): Difficulty {
  return raw === "easy" || raw === "hard" ? raw : "medium";
}

export function clampInt(raw: any, min: number, max: number, fallback: number) {
  const n = typeof raw === "number" && Number.isFinite(raw) ? Math.round(raw) : fallback;
  return Math.min(max, Math.max(min, n));
}

export function pickFocusMode(raw: any): FocusMode {
  return raw === "weakest" ? "weakest" : "normal";
}

export function uniqTrimmed(ids: unknown) {
  if (!Array.isArray(ids)) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const x of ids) {
    const s = String(x ?? "").trim();
    if (!s) continue;
    if (seen.has(s)) continue;
    seen.add(s);
    out.push(s);
  }
  return out;
}

export function scopeKeyFromFolderIds(folderIds: string[]) {
  const ids = uniqTrimmed(folderIds).sort();
  return ids.length ? `folders:${ids.join(",")}` : "all";
}

export function fileTitle(row: any) {
  return (row?.name as string | null) || (row?.original_name as string | null) || "Ukendt kilde";
}

export function normalizeQuestion(s: string) {
  return String(s ?? "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .replace(/[.,;:!?()"'’”“\[\]{}]/g, "")
    .trim();
}

export function normalizeWeakPointTarget(raw: unknown): WeakPointTarget | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const obj = raw as Record<string, unknown>;
  const keyRaw = String(obj.key ?? "").trim();
  const labelRaw = String(obj.label ?? "").trim();
  const actionRaw = String(obj.action ?? "").trim();

  const key = keyRaw || labelRaw.toLowerCase().replace(/\s+/g, "_").slice(0, 80);
  const label = labelRaw || keyRaw.replace(/_/g, " ");
  if (!key || !label) return null;

  const out: WeakPointTarget = { key, label };
  if (actionRaw) out.action = actionRaw;
  return out;
}

export function deriveFocusTargetsFromWeakSessions(rows: LearningFocusSessionRow[]): WeakPointTarget[] {
  return deriveFocusTargetsFromLearningSignals(rows, 2).targets.map((target) => ({
    key: target.key,
    label: target.label,
    ...(target.suggested_action ? { action: target.suggested_action } : {}),
  }));
}

export function compactWeakPointTargetsForPrompt(targets: WeakPointTarget[], limit = 1): WeakPointTarget[] {
  return targets.slice(0, Math.max(1, limit)).map((target) => ({
    key: target.key,
    label: shortenSentence(target.label, 72) || target.label,
    ...(target.action ? { action: shortenSentence(target.action, 140) } : {}),
  }));
}

export function truncateContextForQuestionPrompt(contextText: string, maxChars: number) {
  const text = String(contextText ?? "").trim();
  if (!text || text.length <= maxChars) return text;

  const separator = "\n\n---\n\n";
  const boundary = text.lastIndexOf(separator, maxChars);
  if (boundary >= Math.max(800, Math.floor(maxChars * 0.55))) {
    return text.slice(0, boundary).trim();
  }

  const lineBoundary = text.lastIndexOf("\n", maxChars);
  if (lineBoundary >= Math.max(600, Math.floor(maxChars * 0.5))) {
    return text.slice(0, lineBoundary).trim();
  }

  return text.slice(0, maxChars).trim();
}

export function buildGenerateQuestionPrompts(args: {
  topic: string;
  explicitSubjectFamily?: QuestionSubjectFamily | null;
  difficulty: Difficulty;
  effectiveFocusMode: FocusMode;
  focusTargets: WeakPointTarget[];
  avoidQuestions: string[];
  usedFileTitle: string;
  contextText: string;
}) {
  const { topic, explicitSubjectFamily, difficulty, effectiveFocusMode, focusTargets, avoidQuestions, usedFileTitle, contextText } = args;
  const okonomiProfile = inferOkonomiQuestionLanguageProfile(topic, contextText);
  const calibrationProfile = inferQuestionCalibrationProfile(topic, contextText, explicitSubjectFamily);

  const avoidBlock =
    avoidQuestions.length > 0
      ? `\nUNDGÅ at gentage nogen af disse spørgsmål (nøjagtigt eller næsten):\n- ${avoidQuestions.join("\n- ")}\n`
      : "";
  const focusBiasBlock =
    effectiveFocusMode === "weakest" && focusTargets.length > 0
      ? [
          `Fokusér især på: ${focusTargets.map((t) => t.label).join(", ")}. Spørgsmålet skal træne disse områder.`,
          ...focusTargets
            .map((t) => (t.action ? `Hint - ${t.label}: ${t.action}` : ""))
            .filter(Boolean),
        ].join("\n")
      : "";
  const biasApplied = effectiveFocusMode === "weakest" && focusTargets.length > 0;
  const okonomiPlainLanguageBlock = buildOkonomiPlainLanguagePromptBlock(okonomiProfile);
  const calibrationPromptBlock = buildQuestionCalibrationPromptBlock(calibrationProfile);
  const quantitativePromptBlock = buildQuantitativePromptBlock(
    inferQuantitativeQuestionProfile(topic, contextText, explicitSubjectFamily),
  );

		const systemPrompt = `
		Du er en dansk studieassistent.
	Du laver ét (1) eksamenslignende frit-svar spørgsmål ud fra elevens pensum-uddrag.

VIGTIGT:
- Du MÅ KUN bruge konteksten (KILDE-afsnit).
- Skriv alt på dansk.
- Ingen multiple choice.
	- Spørgsmålet skal være konkret og teste forståelse/anvendelse (ikke kun genkendelse).
	- Identificér først de centrale begreber, temaer eller problemstillinger i materialet.
	- Vælg derefter 1-2 af dem som fokus for spørgsmålet.
	- Vælg en passende spørgsmålsmode, fx: definér, redegør for, forklar, sammenlign, analysér, diskutér eller anvend på eksempel/case.
		- Hold spørgsmålet kort og fokuseret: én klar hovedopgave og højst én kort opfølgning.
		- Undgå lange nummererede delspørgsmål, brede mini-opgaver eller formuleringer, der føles som en hel skriftlig aflevering.
		- Sigt efter et spørgsmål, som en elev realistisk kan besvare i ét fokuseret svar.
		- Hvis materialet er kort eller repetitivt, skal du skabe variation gennem vinkel, framing og spørgsmålstype, ikke ved at opfinde nyt indhold.
		- Du må ikke opfinde teorier, kilder, cases eller fakta, som ikke er understøttet af materialet.
${okonomiPlainLanguageBlock}
${calibrationPromptBlock}
${quantitativePromptBlock}

		Returnér gyldig JSON:
{
  "question": "..."
}
`.trim();

  const userPrompt = [
    `Fag/tema: ${topic}`,
    `Sværhedsgrad: ${difficulty}`,
    focusBiasBlock,
    `Kilde (primary): ${usedFileTitle}`,
    avoidBlock.trim(),
    "Arbejd ud fra centrale begreber og temaer i materialet, ikke kun enkelte linjer eller formuleringer.",
    okonomiProfile.isEconomy
      ? "Hvis materialet er teknisk, så omsæt det til elevvenligt økonomisprog: spørg til hvad analysen viser, hvad resultaterne betyder, og hvilke styrker eller begrænsninger man kan pege på."
      : "",
    "",
    "KONTEKST (brug dette som eneste grundlag):",
    "",
    contextText,
  ]
    .filter(Boolean)
    .join("\n");

  return { systemPrompt, userPrompt, biasApplied };
}
