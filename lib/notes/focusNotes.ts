import { resolveTrainerSubjectFamilyFromCandidates, normalizeLearningSubjectText } from "@/lib/learning/subjects/families";
import { inferTrainerGenerateSharedSubjectFamily } from "@/lib/learning/subjects/generate/registry";
import type { TrainerSubjectFamily } from "@/lib/learning/subjects/types";
import { looksLikeMatematikContent } from "@/lib/matematik/outputStyle";
import { buildMathFocusNotePrompt } from "@/lib/notes/focusNotesMath";
import { buildMathCandidatePieces, type MathCandidatePiece } from "@/lib/notes/mathCandidatePieces";
import { filterMathCandidatePieces, type MathFilteredPiece, type MathRejectedMathPiece } from "@/lib/notes/mathNoiseFilter";
import { recognizeMathConceptLayers, type MathNormalizedConcept } from "@/lib/notes/mathConceptNormalizer";
import {
  buildMathKnowledgeBlocksFromConcepts,
  buildMathKnowledgeBlocksText as renderLayerMathKnowledgeBlocksText,
  buildMathPipelineDebugText,
  type MathKnowledgeBlock,
} from "@/lib/notes/mathKnowledgeBlocks";

export type { MathKnowledgeBlock } from "@/lib/notes/mathKnowledgeBlocks";

type FocusSourceChunk = {
  id: string;
  content: string;
  pageFrom: number | null;
  createdAt: string | null;
};

type RankedChunk = FocusSourceChunk & {
  normalized: string;
  keywords: string[];
  subjectScore: number;
  bleedScore: number;
};

type TopicCluster = {
  id: string;
  label: string;
  keywords: string[];
  chunks: RankedChunk[];
  summary: string;
  sourceRefs: string[];
};

export type FocusNotePlan = {
  folderName: string | null;
  fileName: string;
  resolvedSubjectFamily: TrainerSubjectFamily | null;
  isMath: boolean;
  selectedChunks: RankedChunk[];
  rejectedChunkIds: string[];
  clusters: TopicCluster[];
  clusterPacketsText: string;
  mathCandidatePieces: MathCandidatePiece[];
  mathFilteredPieces: MathFilteredPiece[];
  mathRejectedPieces: MathRejectedMathPiece[];
  mathBroadConcepts: MathNormalizedConcept[];
  mathSplitConcepts: MathNormalizedConcept[];
  mathNormalizedConcepts: MathNormalizedConcept[];
  mathKnowledgeBlocks: MathKnowledgeBlock[];
  mathKnowledgeBlocksText: string;
  mathLayerDebugText: string;
  sourceMappingSeed: string;
  qualitySummary: string;
};

export type FocusNoteValidation = {
  hasIntro: boolean;
  hasLogicalOverview: boolean;
  overviewCount: number;
  hasDeepDives: boolean;
  deepDiveCount: number;
  hasRepetition: boolean;
  hasSubjectBleed: boolean;
  duplicateDeepDiveCount: number;
  missingMathSignals: boolean;
  needsRepair: boolean;
  reasons: string[];
};

const DANISH_STOPWORDS = new Set([
  "og",
  "eller",
  "men",
  "for",
  "med",
  "uden",
  "som",
  "det",
  "den",
  "de",
  "der",
  "til",
  "fra",
  "ved",
  "af",
  "at",
  "en",
  "et",
  "er",
  "var",
  "kan",
  "skal",
  "bliver",
  "blive",
  "om",
  "på",
  "i",
  "vi",
  "man",
  "du",
  "sin",
  "sine",
  "sit",
  "har",
  "have",
  "hvis",
  "når",
  "mere",
  "mindre",
  "meget",
  "også",
  "ogsaa",
  "ofte",
  "typisk",
  "både",
  "baade",
  "kun",
  "over",
  "under",
  "ind",
  "ud",
  "efter",
  "før",
  "foer",
  "gennem",
  "hvad",
  "hvordan",
  "hvorfor",
  "hvilke",
  "hvilken",
  "hvilket",
  "dette",
  "disse",
  "samme",
  "andre",
  "andet",
  "begge",
  "dele",
  "del",
  "kapitel",
  "afsnit",
  "side",
]);

const SUBJECT_SIGNAL_RE: Record<TrainerSubjectFamily, RegExp> = {
  matematik:
    /\b(matematik|funktion|ligning|integral|vektor|trigonometri|parabel|diskriminant|afledt|deriver|sandsynlighed|kvadrat|potens|koordinat|graf|tangent|vektor|brøk|brok)\b/i,
  fysik:
    /\b(fysik|kraft|acceleration|hastighed|energi|effekt|spænding|spaending|modstand|bølge|boelge|frekvens|hydrofon|bevægelse|bevaegelse|impuls|strøm|stroem)\b/i,
  okonomi:
    /\b(okonomi|økonomi|marked|udbud|efterspørgsel|efterspoergsel|inflation|rente|elasticitet|omsætning|omsaetning|omkostning|nøgletal|noegletal|konjunktur|virksomhed)\b/i,
  samfund:
    /\b(samfund|politik|velfærd|velfaerd|demokrati|magt|socialisering|arbejdsmarked|stat|regering|ideologi|offentlig sektor)\b/i,
  dansk:
    /\b(dansk|novelle|digt|lyrik|analyse|fortolkning|fortæller|fortaeller|virkemiddel|komposition|tema|motiv|synsvinkel|metafor)\b/i,
  history:
    /\b(history|historie|kildekritik|periode|revolution|krig|industriali|nazisme|kolonial|historisk)\b/i,
  biologi:
    /\b(biologi|celle|enzym|dna|evolution|økologi|oekologi|fotosyntese|respiration|genetik|art)\b/i,
  geografi:
    /\b(geografi|klima|vejrsystem|erosion|pladetektonik|befolkning|urbanisering|ressource|landskab)\b/i,
};

const MATH_METHOD_RE = /\b(ligningsstrategi|kvadratkomplettering|potensregler|trigonometriske relationer|differentialregning|integralregning|vektorregning)\b/i;
const TASKY_LABEL_RE =
  /^(bestem|beregn|indsaet|indsæt|bekraeft|bekræft|vis|loes|løs|brug|forklar|redegor|redegør|vurder|diskuter)\b/i;
const MATH_EXPRESSION_LABEL_RE = /(?:=|f'\(|\b[fgh]\([^)]*\)|\bO\([^)]*\)|\+\-|\bminimum\b|\bmaksimum\b|\\frac|\\sqrt)/i;
const TECHNICAL_SOURCE_SECTION_RE = /(?:\r?\n){2,}##\s+Kilder\s*\/\s*source mapping[\s\S]*$/i;
const MATH_TITLE_NOISE_RE =
  /^(?:\d+(?:[.,]\d+)?|[xyzabchdortv]{1,3}|[+\-±=≈<>/\\^_*()]+|\d+[xyzabchdortv]+|[xyzabchdortv]+\d+|punkterne|løsningerne|onsker|ønsker|bestemme|beregne)$/i;
const MATH_EXAMPLE_VALUE_RE = /\b(?:\d+(?:[.,]\d+)?|x\s*[≈=]\s*[-+]?\d+(?:[.,]\d+)?)\b/gi;

function collapseWhitespace(value: string) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function normalizeKey(value: string) {
  return normalizeLearningSubjectText(value).replace(/[^a-z0-9]+/g, " ").trim();
}

function splitSentences(value: string) {
  return collapseWhitespace(value)
    .split(/(?<=[.!?])\s+/)
    .map((part) => part.trim())
    .filter(Boolean);
}

function dedupeChunks(chunks: FocusSourceChunk[]) {
  const seen = new Set<string>();
  const out: FocusSourceChunk[] = [];
  for (const chunk of chunks) {
    const normalized = normalizeKey(chunk.content).slice(0, 280);
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    out.push(chunk);
  }
  return out;
}

function inferFocusNoteSubjectFamily(args: { folderName: string | null; fileName: string; contextText: string }) {
  const resolved =
    resolveTrainerSubjectFamilyFromCandidates([args.folderName, args.fileName]) ??
    inferTrainerGenerateSharedSubjectFamily([args.folderName, args.fileName, args.contextText].filter(Boolean).join("\n"));
  return resolved;
}

function scoreTextForFamily(text: string, family: TrainerSubjectFamily | null) {
  if (!family) return 0;
  const normalized = normalizeLearningSubjectText(text);
  const signal = SUBJECT_SIGNAL_RE[family];
  let score = 0;
  if (signal.test(normalized)) score += 3;
  if (family === "matematik" && /(?:\b[fgh]\s*\([^)]+\)\s*=|\b[a-z]\s*=\s*[-+]?\d|\b\d+[a-z]|\^|_|\\frac|\\sqrt|±|\bpi\b)/i.test(text)) score += 3;
  if (family === "samfund" && /\b(teori|aktør|struktur|velfærdsmodel|velfaerdsmodel|case)\b/i.test(normalized)) score += 2;
  if (family === "dansk" && /\b(citat|tekst|fortæller|fortaeller|symbolik)\b/i.test(normalized)) score += 2;
  return score;
}

function scoreForeignFamilies(text: string, family: TrainerSubjectFamily | null) {
  if (!family) return 0;
  let foreign = 0;
  for (const candidate of Object.keys(SUBJECT_SIGNAL_RE) as TrainerSubjectFamily[]) {
    if (candidate === family) continue;
    if (SUBJECT_SIGNAL_RE[candidate].test(text)) foreign += 1;
  }
  return foreign;
}

function tokenizeTopicWords(text: string) {
  const normalized = normalizeLearningSubjectText(text);
  const matches = normalized.match(/[a-z0-9^'_+-]{3,}/g) ?? [];
  return matches.filter((token) => !DANISH_STOPWORDS.has(token) && !isNoisyMathKeyword(token));
}

function isNoisyMathKeyword(token: string) {
  const normalized = normalizeKey(token);
  if (!normalized) return true;
  if (normalized.length <= 2) return true;
  if (MATH_TITLE_NOISE_RE.test(normalized)) return true;
  if (/^\d+$/.test(normalized)) return true;
  if (/^\d+(?:[.,]\d+)?$/.test(normalized)) return true;
  if (/^(?:\d+[a-z]+|[a-z]+\d+)$/i.test(normalized)) return true;
  if ((normalized.match(/\d/g) ?? []).length >= 2) return true;
  return false;
}

function topKeywords(text: string, limit = 6) {
  const counts = new Map<string, number>();
  const tokens = tokenizeTopicWords(text);
  for (const token of tokens) {
    const base = counts.get(token) ?? 0;
    counts.set(token, base + 1);
  }
  return Array.from(counts.entries())
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, limit)
    .map(([token]) => token);
}

function topicOverlap(a: string[], b: string[]) {
  if (!a.length || !b.length) return 0;
  const setB = new Set(b);
  let shared = 0;
  for (const token of a) {
    if (setB.has(token)) shared += 1;
  }
  return shared / Math.min(a.length, b.length);
}

function buildChunkSummary(text: string) {
  const sentences = splitSentences(text);
  return sentences.slice(0, 2).join(" ").slice(0, 240).trim();
}

function trimSentenceEnding(text: string) {
  return collapseWhitespace(text).replace(/[.;,:]\s*$/, "").trim();
}

function buildSourceRef(chunk: FocusSourceChunk) {
  return chunk.pageFrom ? `${chunk.id} (s.${chunk.pageFrom})` : chunk.id;
}

function normalizeMathConceptTitle(args: { text: string; keywords: string[]; summary: string }) {
  const text = normalizeLearningSubjectText(args.text);
  const keywordSet = new Set(args.keywords.map((keyword) => normalizeKey(keyword)));

  if (/\b(loesningsformel|løsningsformel|plus minus|diskriminantmetoden|x\s*=\s*[-(]?b|sqrt d|sqrt\(d\))\b/i.test(text)) {
    return "Løsningsformlen for andengradsligninger";
  }
  if (/\b(diskriminant|d\s*=\s*b\^?2|ingen løsninger|1 løsning|2 løsninger)\b/i.test(text)) {
    return "Diskriminant og betydning";
  }
  if (/\b(kvadratkomplettering|kvadratsaetningerne|kvadratsætningerne|\(x\s*\+\s*\d+\)\^2)\b/i.test(text)) {
    return "Kvadratkomplettering";
  }
  if (/\b(faktorisering|nullreglen|nulreglen)\b/i.test(text)) {
    return "Faktorisering og nulreglen";
  }
  if (/\b(toppunkt|toppunktsformlen|t_x|t_y|sur parabel|glad parabel)\b/i.test(text)) {
    return "Toppunktsformlen";
  }
  if (/\b(cosinusrelation|cosinusrelationerne)\b/i.test(text)) {
    return "Cosinusrelationen";
  }
  if (/\b(sinusrelation|sinusrelationerne)\b/i.test(text)) {
    return "Sinusrelationen";
  }
  if (/\b(arealformlen|sin\(c\)|sin\(a\)|sin\(b\)|trekant)\b/i.test(text)) {
    return "Arealformlen i trigonometri";
  }
  if (/\b(stykkevis|gaffelforskrift|intervaller|aaben bolle|åben bolle|lukkede bolle|lukket bolle)\b/i.test(text)) {
    return "Gaffelforskrift";
  }
  if (/\b(afstandsformlen|afstanden mellem to punkter|pythagoras|\|ab\|)\b/i.test(text)) {
    return "Afstandsformlen mellem to punkter";
  }
  if (/\b(ortogonale linjer|vinkelret|haeldning|hældning)\b/i.test(text)) {
    return "Ortogonale linjer";
  }
  if (/\b(cirklens ligning|centrum|radius|r\^2|\(x-a\)\^2|\(y-b\)\^2)\b/i.test(text)) {
    return "Cirklens ligning";
  }
  if (/\b(monotonisaetningen|monotonisætningen|voksende|aftagende|konstant)\b/i.test(text)) {
    return "Monotonisætningen";
  }
  if (/\b(fortegn|fortegnsskema|monotonilinje|monotonilinje)\b/i.test(text)) {
    return "Fortegnsskema for f'";
  }
  if (/\b(optimering|maksimum|minimum|overfladeareal|volumenbetingelse|v\s*=\s*x)\b/i.test(text)) {
    if (/\b(volumen|overfladeareal|kasse|v\s*=\s*x|h\s*=\s*100\/x\^2|400\/x)\b/i.test(text)) {
      return "Optimering med volumenbetingelse";
    }
    return "Introduktion til optimering";
  }
  if (/\b(tangentens ligning|tangentligning|sekant og tangent|tangent)\b/i.test(text)) {
    return "Tangentens ligning";
  }
  if (/\b(omvendte funktioner|inverse funktioner|f-1|sin-1|cos-1|tan-1)\b/i.test(text)) {
    return "Omvendte funktioner";
  }
  if (keywordSet.has("funktion") && keywordSet.has("graf")) return "Funktioner og grafer";
  if (keywordSet.has("ligning") || keywordSet.has("ligninger")) return "Ligninger og løsningsstrategier";
  if (keywordSet.has("trigonometri")) return "Trigonometriske relationer";
  if (keywordSet.has("afledt") || keywordSet.has("deriver")) return "Differentialregning";
  return null;
}

function cleanMathTitleCandidate(value: string) {
  const collapsed = trimSentenceEnding(value)
    .replace(MATH_EXAMPLE_VALUE_RE, "")
    .replace(/\s*\/\s*/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!collapsed) return null;
  if (MATH_TITLE_NOISE_RE.test(normalizeKey(collapsed))) return null;
  if (/[=≈<>]/.test(collapsed)) return null;
  if ((collapsed.match(/\d/g) ?? []).length >= 2) return null;
  if (collapsed.length < 8) return null;
  return collapsed;
}

function friendlyTopicLabel(keywords: string[], subjectFamily: TrainerSubjectFamily | null, summary: string, sourceText?: string) {
  const keywordSet = new Set(keywords);
  if (subjectFamily === "matematik") {
    const normalizedMathTitle = normalizeMathConceptTitle({
      text: [sourceText, summary, keywords.join(" ")].filter(Boolean).join(" "),
      keywords,
      summary,
    });
    if (normalizedMathTitle) return normalizedMathTitle;
    if (keywordSet.has("vektor") || keywordSet.has("vektorer")) return "Vektorer og notation";
    if (keywordSet.has("integral") || keywordSet.has("afledt") || keywordSet.has("deriver")) return "Analyse, afledte og integraler";
    if (keywordSet.has("potens") || keywordSet.has("kvadrat")) return "Potenser, rødder og kvadratiske mønstre";
  }
  if (subjectFamily === "samfund") {
    if (keywordSet.has("velfaerd") || keywordSet.has("velfaerdsstat")) return "Velfærdsstat, modeller og legitimitet";
    if (keywordSet.has("ideologi") || keywordSet.has("parti")) return "Ideologier, interesser og politiske positioner";
    if (keywordSet.has("demokrati") || keywordSet.has("magt")) return "Demokrati, magt og politiske aktører";
    if (keywordSet.has("arbejdsmarked") || keywordSet.has("okonomi")) return "Arbejdsmarked, økonomi og samfundsmæssige konsekvenser";
  }

  const firstSentence = splitSentences(summary)[0] ?? "";
  const cleanedFirstSentence = cleanMathTitleCandidate(firstSentence);
  if (cleanedFirstSentence && cleanedFirstSentence.length <= 72 && !TASKY_LABEL_RE.test(cleanedFirstSentence) && !MATH_EXPRESSION_LABEL_RE.test(cleanedFirstSentence)) {
    return cleanedFirstSentence;
  }

  const safeKeywords = keywords.filter((keyword) => !isNoisyMathKeyword(keyword));
  if (safeKeywords.length >= 2) {
    const candidate = safeKeywords
      .slice(0, 3)
      .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
      .join(" / ");
    const cleanedCandidate = cleanMathTitleCandidate(candidate);
    if (cleanedCandidate) return cleanedCandidate;
  }

  if (keywords.length >= 2) {
    return keywords
      .slice(0, 3)
      .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
      .join(" / ");
  }

  return "Centralt emne";
}

function clusterChunks(chunks: RankedChunk[], subjectFamily: TrainerSubjectFamily | null) {
  const clusters: TopicCluster[] = [];

  for (const chunk of chunks) {
    let bestCluster: TopicCluster | null = null;
    let bestScore = 0;
    for (const cluster of clusters) {
      const overlap = topicOverlap(chunk.keywords, cluster.keywords);
      if (overlap > bestScore) {
        bestScore = overlap;
        bestCluster = cluster;
      }
    }

    if (bestCluster && bestScore >= 0.34) {
      bestCluster.chunks.push(chunk);
      const mergedKeywords = topKeywords(
        `${bestCluster.keywords.join(" ")} ${bestCluster.chunks.map((entry) => entry.normalized).join(" ")}`,
        6,
      );
      bestCluster.keywords = mergedKeywords;
      bestCluster.summary = buildChunkSummary(bestCluster.chunks.map((entry) => entry.content).join(" "));
      bestCluster.sourceRefs = bestCluster.chunks.slice(0, 4).map(buildSourceRef);
      bestCluster.label = friendlyTopicLabel(
        bestCluster.keywords,
        subjectFamily,
        bestCluster.summary,
        bestCluster.chunks.map((entry) => entry.content).join(" "),
      );
      continue;
    }

    clusters.push({
      id: `topic-${clusters.length + 1}`,
      label: friendlyTopicLabel(chunk.keywords, subjectFamily, chunk.content, chunk.content),
      keywords: chunk.keywords,
      chunks: [chunk],
      summary: buildChunkSummary(chunk.content),
      sourceRefs: [buildSourceRef(chunk)],
    });
  }

  return clusters
    .sort((a, b) => b.chunks.length - a.chunks.length || b.summary.length - a.summary.length)
    .slice(0, 8)
    .map((cluster, index) => ({
      ...cluster,
      id: `topic-${index + 1}`,
      sourceRefs: cluster.chunks.slice(0, 4).map(buildSourceRef),
    }));
}

function buildClusterPacketsText(clusters: TopicCluster[]) {
  return clusters
    .map((cluster, index) => {
      const chunkLines = cluster.chunks
        .slice(0, 3)
        .map((chunk) => `- ${buildChunkSummary(chunk.content)}`)
        .join("\n");
      return [
        `TOPIC ${index + 1}: ${cluster.label}`,
        `Nøgleord: ${cluster.keywords.join(", ") || "ingen sikre nøgleord"}`,
        `Kort essens: ${cluster.summary}`,
        "Uddrag:",
        chunkLines,
      ].join("\n");
    })
    .join("\n\n---\n\n");
}

function buildSourceMappingSeed(clusters: TopicCluster[]) {
  return clusters
    .map((cluster) => `- ${cluster.label}: ${cluster.sourceRefs.join(", ")}`)
    .join("\n");
}

function buildSingletonCluster(chunk: RankedChunk, subjectFamily: TrainerSubjectFamily | null, index: number): TopicCluster {
  return {
    id: `topic-${index + 1}`,
    label: friendlyTopicLabel(chunk.keywords, subjectFamily, chunk.content, chunk.content),
    keywords: chunk.keywords,
    chunks: [chunk],
    summary: buildChunkSummary(chunk.content),
    sourceRefs: [buildSourceRef(chunk)],
  };
}

function ensureMinimumClusterCoverage(
  clusters: TopicCluster[],
  chunks: RankedChunk[],
  subjectFamily: TrainerSubjectFamily | null,
) {
  const byKey = new Map<string, TopicCluster>();
  for (const cluster of clusters) {
    const key = normalizeKey(cluster.label || cluster.keywords.join(" "));
    if (!key || byKey.has(key)) continue;
    byKey.set(key, cluster);
  }

  if (byKey.size >= 5) {
    return Array.from(byKey.values()).slice(0, 8);
  }

  for (const chunk of chunks) {
    const singleton = buildSingletonCluster(chunk, subjectFamily, byKey.size);
    const key = normalizeKey(singleton.label || singleton.keywords.join(" "));
    if (!key || byKey.has(key)) continue;
    byKey.set(key, singleton);
    if (byKey.size >= 5) break;
  }

  return Array.from(byKey.values())
    .sort((a, b) => b.chunks.length - a.chunks.length || b.summary.length - a.summary.length)
    .slice(0, 8)
    .map((cluster, index) => ({ ...cluster, id: `topic-${index + 1}` }));
}

export function prepareFocusNotePlan(args: {
  fileName: string;
  folderName: string | null;
  chunks: Array<{ id: string; content: string; pageFrom: number | null; createdAt: string | null }>;
}): FocusNotePlan {
  const deduped = dedupeChunks(
    args.chunks.map((chunk) => ({
      ...chunk,
      content: collapseWhitespace(chunk.content),
    })),
  ).filter((chunk) => chunk.content.length >= 70);
  const effectiveChunks = deduped.length > 0 ? deduped : dedupeChunks(args.chunks).slice(0, 12);

  const contextSample = effectiveChunks.map((chunk) => chunk.content).join("\n\n").slice(0, 5000);
  const resolvedSubjectFamily = inferFocusNoteSubjectFamily({
    folderName: args.folderName,
    fileName: args.fileName,
    contextText: contextSample,
  });

  const ranked = effectiveChunks.map((chunk) => {
    const normalized = collapseWhitespace(chunk.content);
    const subjectScore = scoreTextForFamily(normalized, resolvedSubjectFamily);
    const bleedScore = scoreForeignFamilies(normalized, resolvedSubjectFamily);
    return {
      ...chunk,
      normalized,
      keywords: topKeywords(normalized),
      subjectScore,
      bleedScore,
    };
  });

  const selectedChunks = ranked.filter((chunk) => {
    if (!resolvedSubjectFamily) return true;
    if (chunk.subjectScore >= 2) return true;
    return chunk.bleedScore === 0;
  });

  const fallbackChunks = selectedChunks.length >= 6 ? selectedChunks : ranked.slice(0, Math.min(12, ranked.length));
  const clusters = ensureMinimumClusterCoverage(clusterChunks(fallbackChunks, resolvedSubjectFamily), fallbackChunks, resolvedSubjectFamily);
  const limitedClusters = clusters.slice(0, Math.max(5, Math.min(8, clusters.length)));
  const isMath =
    resolvedSubjectFamily === "matematik" ||
    looksLikeMatematikContent([args.folderName, args.fileName, contextSample].filter(Boolean).join("\n"));
  const mathCandidatePieces = isMath ? buildMathCandidatePieces(fallbackChunks) : [];
  const { filteredPieces: mathFilteredPieces, rejectedPieces: mathRejectedPieces } = isMath
    ? filterMathCandidatePieces(mathCandidatePieces)
    : { filteredPieces: [], rejectedPieces: [] };
  const mathConceptLayers = isMath
    ? recognizeMathConceptLayers(mathFilteredPieces)
    : { broadConcepts: [], splitCandidates: [], splitDebug: [], droppedSplitCandidates: [], finalConcepts: [] };
  const mathBroadConcepts = mathConceptLayers.broadConcepts;
  const mathSplitConcepts = mathConceptLayers.splitCandidates;
  const mathNormalizedConcepts = mathConceptLayers.finalConcepts;
  const mathKnowledgeBlocks = isMath ? buildMathKnowledgeBlocksFromConcepts(mathNormalizedConcepts) : [];
  const mathKnowledgeBlocksText = isMath ? renderLayerMathKnowledgeBlocksText(mathKnowledgeBlocks) : "";
  const mathLayerDebugText = isMath
    ? buildMathPipelineDebugText({
        candidatePieces: mathCandidatePieces,
        filteredPieces: mathFilteredPieces,
        rejectedPieces: mathRejectedPieces,
        broadConcepts: mathBroadConcepts,
        splitConcepts: mathSplitConcepts,
        splitDebug: mathConceptLayers.splitDebug,
        droppedSplitCandidates: mathConceptLayers.droppedSplitCandidates,
        normalizedConcepts: mathNormalizedConcepts,
        knowledgeBlocks: mathKnowledgeBlocks,
      })
    : "";

  if (isMath && process.env.NOTELY_DEBUG_MATH_NOTES === "1") {
    console.info("[notes/math-pipeline]", {
      fileName: args.fileName,
      candidatePieces: mathCandidatePieces.length,
      filteredPieces: mathFilteredPieces.length,
      rejectedPieces: mathRejectedPieces.length,
      normalizedConcepts: mathNormalizedConcepts.length,
      knowledgeBlocks: mathKnowledgeBlocks.length,
      sample: mathLayerDebugText,
    });
  }

  return {
    folderName: args.folderName,
    fileName: args.fileName,
    resolvedSubjectFamily,
    isMath,
    selectedChunks: fallbackChunks,
    rejectedChunkIds: ranked.filter((chunk) => !fallbackChunks.some((kept) => kept.id === chunk.id)).map((chunk) => chunk.id),
    clusters: limitedClusters,
    clusterPacketsText: buildClusterPacketsText(limitedClusters),
    mathCandidatePieces,
    mathFilteredPieces,
    mathRejectedPieces,
    mathBroadConcepts,
    mathSplitConcepts,
    mathNormalizedConcepts,
    mathKnowledgeBlocks,
    mathKnowledgeBlocksText,
    mathLayerDebugText,
    sourceMappingSeed: buildSourceMappingSeed(limitedClusters),
    qualitySummary: [
      resolvedSubjectFamily ? `subject=${resolvedSubjectFamily}` : "subject=generic",
      `selectedChunks=${fallbackChunks.length}`,
      `clusters=${limitedClusters.length}`,
      ...(isMath ? [`mathBlocks=${mathKnowledgeBlocks.length}`] : []),
      `rejected=${ranked.length - fallbackChunks.length}`,
    ].join(" | "),
  };
}

function buildGenericFocusNotePrompt(plan: FocusNotePlan) {
  const overviewTarget = Math.max(5, Math.min(8, plan.clusters.length || 5));
  const subjectGuardLine = plan.resolvedSubjectFamily
    ? `- Folderen og materialet skal behandles som ${plan.resolvedSubjectFamily}. Ignorér emner, der ligner andre fag eller topic drift.`
    : "- Hold dig stramt til de topic-pakker, der er givet, og bland ikke andre fag eller sideemner ind.";

  const systemPrompt = [
    "Du hjælper en studerende med at skrive Fokusnoter i høj kvalitet ud fra allerede organiserede topic-pakker.",
    "",
    "VIGTIGT:",
    "- Arbejd KUN ud fra topic-pakkerne og kildehenvisningerne nedenfor.",
    "- Fokusnoten skal være organiseret, hierarkisk og fri for subject bleed.",
    "- Undgå gentagelser mellem overview og deep dives; overview skal være komprimeret, deep dives skal forklare og binde stoffet sammen.",
    subjectGuardLine,
    "- Skriv kun selve noten i Markdown.",
    "- Brug præcis denne struktur og disse overskrifter:",
    "  ## Kort faglig intro",
    "  ## Logical Overview",
    "  ## Topic Deep Dives",
    "  ## Repetition og overblik",
    "- Under Logical Overview skal der være 5-8 nummererede hovedemner.",
    "- Logical Overview skal være begrebsstyret: emner, principper, metoder og sammenhænge. Det må ikke ligne en opgaveløsning eller en liste af konkrete delspørgsmål.",
    "- Undgå overview-punkter som 'bestem f'(x)', 'indsæt i ...' eller andre opgaveformuleringer. Skriv i stedet begrebskategorier som fx Funktioner og grafer, Ligningsstrategier eller Velfærdsmodeller og legitimitet.",
    "- Under Topic Deep Dives skal der være ét `###`-afsnit pr. hovedemne fra overviewet.",
    "- Hvert deep dive skal starte med et kort, sammenhængende forklarende afsnit og derefter højst 2-4 korte nøglepointer.",
    "- Deep dives må ikke ligne rå chunk-opsummeringer eller bullet-dumps. De skal føles redigerede og fagligt sammenhængende.",
    "- Vis ikke tekniske kilder, chunk-id'er, sidehenvisninger eller intern source mapping i selve noten.",
  ]
    .filter(Boolean)
    .join("\n");

  const userPrompt = [
    `Fil: ${plan.fileName}`,
    `Mappe: ${plan.folderName ?? "ukendt mappe"}`,
    `Kvalitetsprofil: ${plan.qualitySummary}`,
    "",
    "Lav Fokusnoter i denne stil:",
    "- Start med 2-4 linjer, der rammesætter emnet og kernen.",
    `- Logical Overview skal have ${overviewTarget} nummererede hovedemner med begreber, metoder eller principper som overskrifter.`,
    "- Topic Deep Dives skal være mere forklarende, men stadig note-agtige og kompakte.",
    "- Skriv deep dives som korte redigerede mini-afsnit med få, stærke nøglepointer bagefter.",
    "- Repetition og overblik skal være kort og hjælpe med repetition.",
    "- Vis ikke nogen teknisk kilde- eller source mapping-sektion for brugeren.",
    "",
    "TOPIC-PAKKER:",
    plan.clusterPacketsText,
  ].join("\n");

  return { systemPrompt, userPrompt };
}

export function buildFocusNotePrompt(plan: FocusNotePlan) {
  if (plan.isMath || plan.resolvedSubjectFamily === "matematik") {
    return buildMathFocusNotePrompt(plan);
  }
  return buildGenericFocusNotePrompt(plan);
}

function countLogicalOverviewItems(draft: string) {
  const match = draft.match(/##\s+Logical Overview([\s\S]*?)(?:\n##\s+|$)/i);
  if (!match) return 0;
  return (match[1].match(/^\s*\d+\.\s+/gm) ?? []).length;
}

function extractDeepDiveHeadings(draft: string) {
  const match = draft.match(/##\s+Topic Deep Dives([\s\S]*?)(?:\n##\s+|$)/i);
  if (!match) return [];
  return Array.from(match[1].matchAll(/^\s*###\s+(.+)$/gm)).map((item) => collapseWhitespace(item[1]));
}

function detectSubjectBleed(draft: string, family: TrainerSubjectFamily | null) {
  if (!family) return false;
  let foreignHits = 0;
  for (const candidate of Object.keys(SUBJECT_SIGNAL_RE) as TrainerSubjectFamily[]) {
    if (candidate === family) continue;
    if (SUBJECT_SIGNAL_RE[candidate].test(draft)) foreignHits += 1;
  }
  return foreignHits >= 2;
}

export function validateFocusNoteDraft(draft: string, plan: FocusNotePlan): FocusNoteValidation {
  const normalized = stripTechnicalSourceSections(String(draft ?? "").trim());
  const deepDiveHeadings = extractDeepDiveHeadings(normalized);
  const normalizedDeepDiveHeadings = deepDiveHeadings.map((heading) => normalizeKey(heading)).filter(Boolean);
  const duplicateDeepDiveCount = normalizedDeepDiveHeadings.length - new Set(normalizedDeepDiveHeadings).size;
  const hasIntro = /##\s+Kort faglig intro/i.test(normalized);
  const hasLogicalOverview = /##\s+Logical Overview/i.test(normalized);
  const overviewCount = countLogicalOverviewItems(normalized);
  const hasDeepDives = /##\s+Topic Deep Dives/i.test(normalized);
  const hasRepetition = /##\s+Repetition og overblik/i.test(normalized);
  const hasSubjectBleed = detectSubjectBleed(normalized, plan.resolvedSubjectFamily);
  const missingMathSignals =
    plan.isMath &&
    !/(?:\$[^$]+\$|\$\$[\s\S]+?\$\$|\\frac|\\sqrt|\\pm|f'\(|a_n|MATH|Kvadratkomplettering|Potensregler|Ligningsstrategi|Trigonometriske relationer)/i.test(normalized);

  const reasons: string[] = [];
  if (!hasIntro) reasons.push("missing_intro");
  if (!hasLogicalOverview) reasons.push("missing_logical_overview");
  if (hasLogicalOverview && (overviewCount < 5 || overviewCount > 8)) reasons.push("bad_overview_count");
  if (!hasDeepDives) reasons.push("missing_topic_deep_dives");
  if (hasDeepDives && deepDiveHeadings.length < Math.min(3, plan.clusters.length || 3)) reasons.push("too_few_deep_dives");
  if (!hasRepetition) reasons.push("missing_repetition");
  if (duplicateDeepDiveCount > 0) reasons.push("duplicate_deep_dives");
  if (hasSubjectBleed) reasons.push("subject_bleed");
  if (missingMathSignals) reasons.push("missing_math_signals");

  return {
    hasIntro,
    hasLogicalOverview,
    overviewCount,
    hasDeepDives,
    deepDiveCount: deepDiveHeadings.length,
    hasRepetition,
    hasSubjectBleed,
    duplicateDeepDiveCount,
    missingMathSignals,
    needsRepair: reasons.length > 0,
    reasons,
  };
}

export function buildFocusNoteRepairPrompt(args: {
  plan: FocusNotePlan;
  draft: string;
  validation: FocusNoteValidation;
}) {
  return [
    "Ret denne Fokusnote, så den følger strukturen stramt og fjerner bleed/gentagelser.",
    `Fejl, der skal rettes: ${args.validation.reasons.join(", ")}`,
    "",
    "Krav:",
    "- Bevar kun indhold, der passer til scope og subject.",
    "- Sørg for 5-8 punkter i Logical Overview.",
    "- Gør Logical Overview mere begrebsstyret og mindre opgavestyret.",
    "- Sørg for ét ###-deep-dive pr. hovedemne.",
    "- Sørg for et kort repetitionsafsnit.",
    "- Fjern tekniske kilder, chunk-id'er, sidehenvisninger og source mapping fra den bruger-synlige note.",
    "- Gør deep dives mere redigerede: ét kort forklarende afsnit plus højst 2-4 nøglepointer.",
    args.plan.isMath
      ? "- Sørg for at matematiknoten stadig bruger korte, render-venlige formler eller metodeetiketter dér, hvor det er relevant."
      : "- Hold tonen fagligt præcis og note-agtig.",
    "",
    "Eksisterende noteudkast:",
    args.draft,
  ].join("\n");
}

export function stripTechnicalSourceSections(draft: string) {
  return String(draft ?? "").replace(TECHNICAL_SOURCE_SECTION_RE, "").trimEnd();
}

export function appendSourceMappingFallback(draft: string, plan: FocusNotePlan) {
  void plan;
  return stripTechnicalSourceSections(draft);
}

export function ensureMathFocusHints(draft: string, plan: FocusNotePlan) {
  if (!plan.isMath) return draft;
  if (/(Ligningsstrategi|Kvadratkomplettering|Potensregler|Trigonometriske relationer)/i.test(draft)) return draft;
  if (!MATH_METHOD_RE.test(plan.clusterPacketsText)) return draft;
  return `${draft.trim()}\n\n## Repetition og overblik\n- Centrale metodeord: Ligningsstrategi, Kvadratkomplettering, Potensregler og Trigonometriske relationer bruges kun, når de matcher materialet.`;
}
