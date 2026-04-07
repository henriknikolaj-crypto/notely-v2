import {
  deriveWeakPointTargetsFromContainer,
  readFeedbackV2FromContainer,
  type LearningCitation,
  type LearningIssueSeverity,
} from "@/lib/learning/feedback";
import type { LearningSourceType } from "@/lib/learning/evaluator-registry";

export type LearningSessionLike = {
  id?: string | null;
  score?: number | null;
  created_at?: string | null;
  source_type?: string | null;
  feedback?: string | null;
  metadata?: unknown;
  feedback_structured?: unknown;
  meta?: unknown;
  evaluation_meta?: unknown;
  feedback_meta?: unknown;
};

export type LearningReadingRef = {
  chunk_id: string;
  file_id: string | null;
  title: string | null;
  url: string | null;
  snippet: string | null;
  why: string | null;
  practice_prompt: string | null;
  count: number;
  tags: string[];
  page?: string | number | null;
  page_from?: string | number | null;
  page_to?: string | number | null;
  source_page?: string | number | null;
  page_label?: string | null;
  source_page_label?: string | null;
  printed_page?: string | number | null;
  printed_page_from?: string | number | null;
  printed_page_to?: string | number | null;
  printed_page_label?: string | null;
  position?: string | null;
};

export type LearningIssueCard = {
  key: string;
  label: string;
  severity: LearningIssueSeverity;
  count: number;
  weight: number;
  reason: string;
  repair: string;
  example: string | null;
  evidence: string[];
  citations: LearningReadingRef[];
  next_best_action: string | null;
  evidence_specificity: "general" | "specific";
  evidence_bridge: string | null;
  source: "issue" | "task_coverage" | "legacy_weak_point";
};

export type FolderLearningSummary = {
  structured_session_count: number;
  legacy_session_count: number;
  sessions_with_focus: number;
  focus_label: string | null;
  focus_reason: string | null;
  next_training_text: string | null;
  next_step_text: string | null;
  badge_tone: "neutral" | "low" | "medium" | "high";
  top_issues: LearningIssueCard[];
  reading_refs: LearningReadingRef[];
  writing_tips: string[];
  suggestion_prefill: {
    improvement: string;
    example: string;
    shortExplanation: string;
  };
};

type FolderSummaryOptions = {
  avgLast5?: number | null;
  attemptsTotal?: number;
};

type AccIssue = {
  issue: LearningIssueCard;
};

const SEVERITY_WEIGHT: Record<LearningIssueSeverity, number> = {
  low: 1,
  medium: 2,
  high: 3.25,
};

const SPECIFICITY_STOPWORDS = new Set([
  "eller",
  "fordi",
  "derfor",
  "dette",
  "denne",
  "svaret",
  "svar",
  "tekst",
  "teksten",
  "kilden",
  "kilderne",
  "nyere",
  "senere",
  "mere",
  "mindre",
  "tydeligt",
  "tydeligere",
  "konkret",
  "konkrete",
  "bedre",
  "næste",
  "skridt",
  "arbejd",
  "bruge",
  "brug",
  "svarene",
  "spørgsmålet",
  "spørgsmål",
  "delene",
  "dele",
  "analysen",
  "analyse",
  "vurderingen",
  "vurdering",
]);

const SOURCE_SENTENCE_START_RE = /^(teksten|kilden|baggrundsteksten|materialet|uddraget)\b/i;
const IMPERATIVE_TO_INFINITIVE: Record<string, string> = {
  "tilføj": "tilføje",
  "tilfoj": "tilføje",
  "brug": "bruge",
  "gør": "gøre",
  "gor": "gøre",
  "vis": "vise",
  "forklar": "forklare",
  "sammenlign": "sammenligne",
  "diskutér": "diskutere",
  "diskuter": "diskutere",
  "vurder": "vurdere",
  "definér": "definere",
  "definer": "definere",
  "anvend": "anvende",
  "underbyg": "underbygge",
  "afslut": "afslutte",
  "svar": "svare",
  "vælg": "vælge",
  "beskriv": "beskrive",
  "uddyb": "uddybe",
};

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function asText(value: unknown): string {
  return String(value ?? "").trim();
}

function clampText(value: unknown, maxLen: number) {
  const text = asText(value);
  if (!text) return "";
  return text.length <= maxLen ? text : `${text.slice(0, Math.max(0, maxLen - 1)).trim()}...`;
}

function stripTerminalPunctuation(value: unknown) {
  return asText(value).replace(/\s*[.!?]+\s*$/g, "").trim();
}

function ensureSentence(value: unknown) {
  const text = asText(value);
  if (!text) return "";
  return /[.!?]\s*$/.test(text) ? text : `${text}.`;
}

function firstWholeSentence(value: unknown, fallback = "") {
  const text = asText(value).replace(/\s+/g, " ").trim();
  if (!text) return fallback;
  const match = text.match(/.+?[.!?](?=\s|$)/);
  if (match?.[0]) {
    const sentence = match[0].trim();
    if (/\.\.\.\s*$/.test(sentence)) return fallback;
    if (/\b(?!fx|osv|ca|bl.a|mfl)[a-zæøå]{1,3}\.\s*$/i.test(sentence)) return fallback;
    return sentence;
  }
  if (text.length <= 180 && !/\.\.\.\s*$/.test(text)) {
    const trimmed = text.replace(/\.\.\.\s*$/, "").trim();
    const words = trimmed.split(/\s+/).filter(Boolean);
    if (/^[a-zæøå-]{1,8}$/i.test(trimmed)) return fallback;
    if (words.length < 4) return fallback;
    if ((words[words.length - 1] ?? "").length < 4) return fallback;
    return ensureSentence(trimmed);
  }
  return fallback;
}

function rewriteForFolderSummary(value: unknown) {
  const text = ensureSentence(value);
  if (!text) return "";

  const directTaskPattern = /^(spørgsmålet|opgaven)\s+kræver,?\s+at du\s+/i;
  if (directTaskPattern.test(text)) {
    return ensureSentence(text.replace(directTaskPattern, "I dine seneste svar mangler du stadig at "));
  }

  if (/^(spørgsmålet|opgaven)\s+kræver\b/i.test(text)) {
    return ensureSentence(text.replace(/^(spørgsmålet|opgaven)\s+kræver\b/i, "På tværs af de seneste vurderinger er et gennemgående mønster, at"));
  }

  return text;
}

function lowerFirst(value: unknown) {
  const text = asText(value);
  if (!text) return "";
  return text.charAt(0).toLowerCase() + text.slice(1);
}

function extractSpecificityTokens(value: unknown): string[] {
  return asText(value)
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .split(/[^a-z0-9æøå-]+/i)
    .map((token) => token.trim())
    .filter((token) => token.length >= 5 && !SPECIFICITY_STOPWORDS.has(token))
    .slice(0, 24);
}

function inferEvidenceSpecificity(issue: Pick<LearningIssueCard, "label" | "reason" | "evidence" | "citations">) {
  const evidenceText = [
    issue.evidence.join(" "),
    ...issue.citations.map((citation) => `${citation.snippet ?? ""} ${citation.why ?? ""}`),
  ]
    .map((value) => asText(value))
    .filter(Boolean)
    .join(" ");

  if (!evidenceText) return "general" as const;

  const issueTokens = new Set(
    extractSpecificityTokens(`${issue.label} ${issue.reason}`),
  );
  const evidenceTokens = new Set(extractSpecificityTokens(evidenceText));
  let overlap = 0;
  for (const token of issueTokens) {
    if (evidenceTokens.has(token)) overlap += 1;
  }

  const hasGeneralMarkers =
    /\b(debat|pres|retning|retninger|tema|tematik|problem|problematik|spørgsmål|udvikling|ansvarlighed|solidaritet|størrelse|finanser)\b/i.test(
      evidenceText,
    );
  const hasDirectMarkers =
    /\b(ifølge|citat|står|viser|beskriver|forklarer|nævner|fremhæver|angiver)\b/i.test(evidenceText);

  if (overlap >= 3) return "specific" as const;
  if (overlap >= 2 && hasDirectMarkers && !hasGeneralMarkers) return "specific" as const;
  return "general" as const;
}

function softenDirectiveForGeneralEvidence(value: unknown) {
  const base = stripTerminalPunctuation(value);
  if (!base) return "";
  const body = base.endsWith(".") ? base.slice(0, -1).trim() : base;
  if (
    /\b(vurder|diskutere|konsekvens|konsekvenser|løsning|løsninger|retning|retninger)\b/i.test(body) &&
    /\b(offentlige udgifter|skatter|besparelser|offentlige finanser|indtægter)\b/i.test(body)
  ) {
    return "Brug teksten som afsæt til at vurdere, hvilke konsekvenser de forskellige løsninger eller retninger kan få for offentlige udgifter, indtægter og prioriteringer.";
  }

  const imperativeMatch = body.match(/^([A-Za-zÆØÅæøåéÉ]+)/);
  const firstWord = imperativeMatch?.[1] ? imperativeMatch[1].toLowerCase() : "";
  const infinitive = IMPERATIVE_TO_INFINITIVE[firstWord];
  if (infinitive) {
    const rest = body.slice(imperativeMatch?.[1]?.length ?? 0).trim().replace(/^,?\s*/, "");
    const candidate = rest ? `Brug teksten som afsæt til at ${infinitive} ${lowerFirst(rest)}` : `Brug teksten som afsæt til at ${infinitive}`;
    return ensureSentence(candidate);
  }

  const candidate = body.match(/^[a-zæøå]/i)
    ? `Brug teksten som afsæt til at arbejde videre med ${lowerFirst(body)}`
    : `Brug teksten som afsæt til at arbejde videre med ${body}`;
  return ensureSentence(candidate);
}

function getIssueThemeText(issue: Pick<LearningIssueCard, "evidence" | "citations" | "reason">) {
  return (
    firstWholeSentence(issue.citations[0]?.snippet) ||
    firstWholeSentence(issue.citations[0]?.why) ||
    firstWholeSentence(issue.evidence[0]) ||
    firstWholeSentence(issue.reason)
  );
}

function buildEvidenceBridge(issue: Pick<LearningIssueCard, "reason" | "evidence" | "citations" | "evidence_specificity">) {
  const theme = stripTerminalPunctuation(getIssueThemeText(issue));
  if (!theme) return null;
  if (SOURCE_SENTENCE_START_RE.test(theme)) {
    const lead = rewriteForFolderSummary(theme);
    if (issue.evidence_specificity === "specific") {
      return `${lead} Brug det som konkret belæg i svaret.`;
    }
    return `${lead} Brug det som afsæt til din egen analyse eller vurdering.`;
  }
  if (issue.evidence_specificity === "specific") {
    return ensureSentence(`Teksten peger direkte på ${lowerFirst(theme)}. Brug det som konkret belæg i svaret`);
  }
  return ensureSentence(
    `Teksten peger overordnet på ${lowerFirst(theme)}. Brug det som afsæt til din egen analyse eller vurdering.`,
  );
}

function shouldUseOpenPolicyRepairTemplate(
  issue: Pick<LearningIssueCard, "label" | "reason" | "repair" | "next_best_action" | "evidence_specificity">,
) {
  if (issue.evidence_specificity !== "general") return false;
  const text = `${issue.label} ${issue.reason} ${issue.repair} ${issue.next_best_action ?? ""}`.toLowerCase();
  const mentionsEvaluationTheme = /\b(vurder|konsekvens|konsekvenser|forklar|diskuter|diskutere|analyse|analyser)\b/.test(text);
  const mentionsPolicyOptions =
    /\b(løsning|løsninger|retning|retninger|offentlige finanser|finanser|skatter|besparelser|solidaritet|individuelt ansvar|individuel ansvarlighed|offentlige udgifter|indtægter)\b/.test(
      text,
    );
  return mentionsEvaluationTheme && mentionsPolicyOptions;
}

function buildIssueRepair(issue: Pick<LearningIssueCard, "label" | "reason" | "repair" | "next_best_action" | "evidence_specificity">) {
  const base = rewriteForFolderSummary(issue.repair || issue.next_best_action || "");
  if (!base) return "";
  if (issue.evidence_specificity === "specific") return base;
  if (shouldUseOpenPolicyRepairTemplate(issue)) {
    return "Brug teksten som afsæt til at vurdere, hvilke konsekvenser de forskellige løsninger kan få for de offentlige finanser og for balancen mellem solidaritet og individuelt ansvar.";
  }
  const softened = softenDirectiveForGeneralEvidence(base);
  if (softened) return `${softened} Teksten giver retning, men du skal selv udfolde vurderingen i svaret.`;
  return `${base} Teksten giver retning, men du skal selv udfolde vurderingen i svaret.`;
}

function buildIssueNextBestAction(issue: Pick<LearningIssueCard, "next_best_action" | "repair" | "evidence_specificity">) {
  const base = rewriteForFolderSummary(issue.next_best_action || issue.repair || "");
  if (!base) return null;
  if (issue.evidence_specificity === "specific") return base;
  return softenDirectiveForGeneralEvidence(base) || base;
}

function buildWritingTips(
  primaryIssue: LearningIssueCard | null,
  secondaryIssue: LearningIssueCard | null,
): string[] {
  if (!primaryIssue) return [];

  if (primaryIssue.evidence_specificity === "general" && shouldUseOpenPolicyRepairTemplate(primaryIssue)) {
    return [
      "Brug teksten som afsæt til at tilføje 1-2 sætninger med et tydeligt valg og en kort begrundelse.",
      "Når du nævner flere mulige løsninger, så gør det tydeligt, hvilken du vurderer som mest holdbar, og hvorfor.",
      secondaryIssue?.repair || "Forklar kort, hvilke konsekvenser dine valgte løsninger kan få for økonomi og ansvar.",
    ]
      .map((tip) => ensureSentence(tip))
      .filter(Boolean);
  }

  return [primaryIssue.repair, primaryIssue.evidence_bridge, secondaryIssue?.repair]
    .map((tip) => ensureSentence(tip))
    .filter(Boolean);
}

function buildSuggestionExample(primaryIssue: LearningIssueCard | null, fallbackExample: string) {
  if (!primaryIssue) return ensureSentence(fallbackExample);

  if (primaryIssue.evidence_specificity === "general" && shouldUseOpenPolicyRepairTemplate(primaryIssue)) {
    return "Når du nævner flere mulige løsninger, så gør det tydeligt, hvilken du vurderer som mest holdbar, og hvorfor.";
  }

  if (primaryIssue.evidence_specificity === "general") {
    return "Tilføj 1-2 sætninger, hvor du kobler tekstens hovedtema til din egen vurdering.";
  }

  const base = asText(primaryIssue.example) || fallbackExample;
  if (SOURCE_SENTENCE_START_RE.test(base)) {
    return "Brug et kort tekstbelæg og forklar, hvad det viser i din analyse.";
  }
  return ensureSentence(base);
}

function buildSuggestionShortExplanation(primaryIssue: LearningIssueCard | null) {
  if (!primaryIssue) return "Det gør svaret mere præcist, mere dækkende og lettere at vurdere fagligt.";
  if (primaryIssue.evidence_specificity === "general" && shouldUseOpenPolicyRepairTemplate(primaryIssue)) {
    return "Det gør din vurdering tydeligere og viser, hvordan du selv forbinder tekstens tema med dine faglige pointer.";
  }
  if (primaryIssue.evidence_specificity === "general") {
    return "Det gør tydeligere, hvordan du selv bruger tekstens tema som afsæt for din analyse.";
  }
  return rewriteForFolderSummary(primaryIssue.reason) || "Det gør svaret mere præcist, mere dækkende og lettere at vurdere fagligt.";
}

function buildFocusLabel(issue: Pick<LearningIssueCard, "label" | "reason" | "repair" | "next_best_action">) {
  const text = `${issue.label} ${issue.reason} ${issue.repair} ${issue.next_best_action ?? ""}`.toLowerCase();
  const mentionsEvaluation = /\b(vurder|vurdering|konsekvens|konsekvenser|valg|vælg|begrund|politisk|politiske)\b/.test(text);
  if (!mentionsEvaluation) return `Fokus: ${issue.label}`;

  const mentionsChoices = /\b(valg|vælg|mulighed|muligheder|løsning|løsninger|retning|retninger)\b/.test(text);
  const mentionsPublicFinance = /\b(offentlige finanser|finanser|offentlige udgifter|indtægter|skatter|besparelser)\b/.test(text);

  if (mentionsChoices) {
    return "Fokus: Gør valget mellem de politiske muligheder tydeligere, og begrund det kort.";
  }

  if (mentionsPublicFinance) {
    return "Fokus: Forklar tydeligere, hvordan de valgte løsninger påvirker de offentlige finanser.";
  }

  return "Fokus: Vurderingen af politiske valg og deres konsekvenser kan gøres tydeligere.";
}

function buildFocusReason(issue: Pick<LearningIssueCard, "label" | "reason" | "evidence_specificity">) {
  const issueText = `${issue.label} ${issue.reason}`.toLowerCase();
  const mentionsEvaluation = /\b(vurder|vurdering|konsekvens|konsekvenser|valg|vælg|begrund|politisk|politiske)\b/.test(issueText);
  const mentionsChoices = /\b(valg|vælg|mulighed|muligheder|løsning|løsninger|retning|retninger)\b/.test(issueText);
  const mentionsPublicFinance = /\b(offentlige finanser|finanser|offentlige udgifter|indtægter|skatter|besparelser)\b/.test(issueText);

  if (mentionsEvaluation && mentionsChoices) {
    const base = "På tværs af de seneste vurderinger kan du gøre det tydeligere, hvilket politisk valg du hælder til, og hvorfor.";
    if (issue.evidence_specificity === "specific") return base;
    return `${base} Kilderne peger mest på temaet, så du skal selv gøre vurderingen klar i svaret.`;
  }

  if (mentionsEvaluation && mentionsPublicFinance) {
    const base = "I dine seneste svar kan du tydeligere forklare, hvordan de valgte løsninger påvirker de offentlige finanser.";
    if (issue.evidence_specificity === "specific") return base;
    return `${base} Kilderne peger mest på temaet, så du skal selv udfolde vurderingen i svaret.`;
  }

  if (mentionsEvaluation) {
    const base = "Et gennemgående mønster er, at vurderingen af politiske valg og deres konsekvenser kan gøres tydeligere.";
    if (issue.evidence_specificity === "specific") return base;
    return `${base} Kilderne peger mest på det overordnede tema, så du skal selv gøre vurderingen tydelig i svaret.`;
  }

  const base =
    rewriteForFolderSummary(issue.reason) ||
    "Et gennemgående mønster er, at dette fokus stadig trækker ned i dine seneste svar.";
  if (issue.evidence_specificity === "specific") return base;
  return `${base} Kilderne peger mest på det overordnede tema, så du skal selv gøre vurderingen tydelig i svaret.`;
}

function enrichIssueForUi(issue: LearningIssueCard): LearningIssueCard {
  const evidence_specificity = inferEvidenceSpecificity(issue);
  const enrichedBase = { ...issue, evidence_specificity } as LearningIssueCard;
  return {
    ...enrichedBase,
    repair: buildIssueRepair(enrichedBase) || enrichedBase.repair,
    next_best_action: buildIssueNextBestAction(enrichedBase),
    evidence_bridge: buildEvidenceBridge(enrichedBase),
  };
}

function toKey(value: unknown, fallback: string) {
  const normalized = asText(value)
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 80);
  return normalized || fallback;
}

function normalizeSourceType(raw: unknown): LearningSourceType {
  const value = asText(raw).toLowerCase();
  return value === "simulator" || value === "oral" ? value : "trainer";
}

function recencyWeight(index: number): number {
  if (index <= 1) return 3.2;
  if (index <= 4) return 2.5;
  if (index <= 9) return 1.75;
  if (index <= 19) return 1.15;
  return 0.8;
}

function taskCoverageMissingWeight(raw: unknown): number {
  const coverage = asRecord(raw);
  if (!coverage) return 0;

  const expected = Number(coverage.expected_count ?? coverage.expectedCount);
  const answered = Number(coverage.answered_count ?? coverage.answeredCount);
  const ratio = Number(coverage.ratio);

  const missingCount =
    Number.isFinite(expected) && Number.isFinite(answered) ? Math.max(0, Math.round(expected - answered)) : 0;
  const missingRatio = Number.isFinite(ratio) ? Math.max(0, 1 - Math.max(0, Math.min(1, ratio))) : 0;

  if (missingCount >= 2 || missingRatio >= 0.45) return 2.4;
  if (missingCount >= 1 || missingRatio >= 0.2) return 1.4;
  return 0;
}

function normalizeReadingRef(raw: unknown): LearningReadingRef | null {
  const obj = asRecord(raw);
  if (!obj) return null;

  const chunkId = asText(obj.chunk_id ?? obj.chunkId);
  const title = asText(obj.title) || null;
  if (!chunkId && !title) return null;

  const fileId = asText(obj.file_id ?? obj.fileId) || null;
  const url = asText(obj.url) || null;
  const snippet = clampText(obj.snippet ?? obj.excerpt, 280) || null;
  const why = clampText(obj.why, 220) || null;
  const practicePrompt = clampText(obj.practice_prompt ?? obj.practicePrompt, 220) || null;
  const countRaw = Number(obj.count);
  const count = Number.isFinite(countRaw) && countRaw > 0 ? Math.floor(countRaw) : 1;
  const tags = Array.isArray(obj.tags)
    ? obj.tags.map((tag) => clampText(tag, 40)).filter(Boolean).slice(0, 5)
    : [];

  return {
    chunk_id: chunkId || `title:${toKey(title ?? "citation", "citation")}`,
    file_id: fileId,
    title,
    url,
    snippet,
    why,
    practice_prompt: practicePrompt,
    count,
    tags,
    ...(obj.page != null ? { page: obj.page as string | number | null } : {}),
    ...(obj.page_from != null || obj.pageFrom != null
      ? { page_from: (obj.page_from ?? obj.pageFrom) as string | number | null }
      : {}),
    ...(obj.page_to != null || obj.pageTo != null
      ? { page_to: (obj.page_to ?? obj.pageTo) as string | number | null }
      : {}),
    ...(obj.source_page != null || obj.sourcePage != null
      ? { source_page: (obj.source_page ?? obj.sourcePage) as string | number | null }
      : {}),
    ...(obj.page_label != null || obj.pageLabel != null
      ? { page_label: asText(obj.page_label ?? obj.pageLabel) || null }
      : {}),
    ...(obj.source_page_label != null || obj.sourcePageLabel != null
      ? { source_page_label: asText(obj.source_page_label ?? obj.sourcePageLabel) || null }
      : {}),
    ...(obj.printed_page != null || obj.printedPage != null
      ? { printed_page: (obj.printed_page ?? obj.printedPage) as string | number | null }
      : {}),
    ...(obj.printed_page_from != null || obj.printedPageFrom != null
      ? { printed_page_from: (obj.printed_page_from ?? obj.printedPageFrom) as string | number | null }
      : {}),
    ...(obj.printed_page_to != null || obj.printedPageTo != null
      ? { printed_page_to: (obj.printed_page_to ?? obj.printedPageTo) as string | number | null }
      : {}),
    ...(obj.printed_page_label != null || obj.printedPageLabel != null
      ? { printed_page_label: asText(obj.printed_page_label ?? obj.printedPageLabel) || null }
      : {}),
    ...(obj.position != null ? { position: asText(obj.position) || null } : {}),
  };
}

function citationsToRefs(citations: LearningCitation[] | undefined): LearningReadingRef[] {
  return (citations ?? [])
    .map((citation) =>
      normalizeReadingRef({
        ...citation,
        practice_prompt: citation.why || null,
      }),
    )
    .filter((citation): citation is LearningReadingRef => !!citation);
}

function collectReadingRefs(session: LearningSessionLike, preferred: LearningReadingRef[] = []): LearningReadingRef[] {
  const refs = [...preferred];
  const seen = new Set(refs.map((ref) => ref.chunk_id));

  const containers = [session.metadata, session.feedback_structured, session.meta, session.evaluation_meta, session.feedback_meta];
  for (const container of containers) {
    const obj = asRecord(container);
    const rawList = Array.isArray(obj?.citations)
      ? (obj.citations as unknown[])
      : Array.isArray(obj?.reading_refs)
        ? (obj.reading_refs as unknown[])
        : Array.isArray(obj?.readingRefs)
          ? (obj.readingRefs as unknown[])
          : Array.isArray(obj?.read_here)
            ? (obj.read_here as unknown[])
            : [];

    for (const raw of rawList) {
      const normalized = normalizeReadingRef(raw);
      if (!normalized || seen.has(normalized.chunk_id)) continue;
      seen.add(normalized.chunk_id);
      refs.push(normalized);
      if (refs.length >= 5) return refs;
    }
  }

  return refs;
}

function pushReadingRef(acc: Map<string, LearningReadingRef>, ref: LearningReadingRef) {
  const existing = acc.get(ref.chunk_id);
  if (existing) {
    existing.count += ref.count || 1;
    if (!existing.snippet && ref.snippet) existing.snippet = ref.snippet;
    if (!existing.why && ref.why) existing.why = ref.why;
    if (!existing.practice_prompt && ref.practice_prompt) existing.practice_prompt = ref.practice_prompt;
    return;
  }
  acc.set(ref.chunk_id, { ...ref });
}

function pushIssue(acc: Map<string, AccIssue>, issue: LearningIssueCard, weight: number) {
  const key = toKey(issue.key || issue.label, "issue");
  if (!key) return;

  const existing = acc.get(key);
  if (existing) {
    existing.issue.weight += weight;
    existing.issue.count += 1;
    if (issue.severity === "high" || (issue.severity === "medium" && existing.issue.severity === "low")) {
      existing.issue.severity = issue.severity;
    }
    if (!existing.issue.reason && issue.reason) existing.issue.reason = issue.reason;
    if (!existing.issue.repair && issue.repair) existing.issue.repair = issue.repair;
    if (!existing.issue.example && issue.example) existing.issue.example = issue.example;
    const evidence = [...existing.issue.evidence];
    for (const item of issue.evidence) {
      const text = clampText(item, 220);
      if (!text) continue;
      if (evidence.some((existingItem) => existingItem.toLowerCase() === text.toLowerCase())) continue;
      evidence.push(text);
      if (evidence.length >= 3) break;
    }
    existing.issue.evidence = evidence;
    const citations = [...existing.issue.citations];
    for (const citation of issue.citations) {
      if (citations.some((existingCitation) => existingCitation.chunk_id === citation.chunk_id)) continue;
      citations.push(citation);
      if (citations.length >= 2) break;
    }
    existing.issue.citations = citations;
    if (!existing.issue.next_best_action && issue.next_best_action) {
      existing.issue.next_best_action = issue.next_best_action;
    }
    if (!existing.issue.evidence_bridge && issue.evidence_bridge) {
      existing.issue.evidence_bridge = issue.evidence_bridge;
    }
    if (existing.issue.evidence_specificity !== "general" && issue.evidence_specificity === "general") {
      existing.issue.evidence_specificity = "general";
    }
    if (issue.source !== "legacy_weak_point") existing.issue.source = issue.source;
    return;
  }

  acc.set(key, {
    issue: {
      ...issue,
      key,
      weight,
      count: 1,
      evidence: issue.evidence.slice(0, 3),
      citations: issue.citations.slice(0, 2),
      evidence_specificity: issue.evidence_specificity,
      evidence_bridge: issue.evidence_bridge,
    },
  });
}

function fallbackFocusLabel(options?: FolderSummaryOptions): string {
  const attempts = options?.attemptsTotal ?? 0;
  const avg = options?.avgLast5 ?? null;
  if (attempts === 0) return "Ikke startet endnu";
  if (avg == null) return "Ikke startet endnu";
  if (avg < 40) return "Fokus: grundforståelse";
  if (avg < 60) return "Fokus: struktur og begreber";
  if (avg < 75) return "Fokus: tekstnær dokumentation";
  return "Fokus: finpudsning";
}

function fallbackNextTrainingText(options?: FolderSummaryOptions): string {
  const attempts = options?.attemptsTotal ?? 0;
  const avg = options?.avgLast5 ?? null;
  if (attempts === 0) return "Start med 1 kort træning (10-15 min).";
  if (avg == null || avg < 50) return "Lav 1 træning med fokus på disposition og nøglebegreber.";
  if (avg < 70) return "Lav 1 træning med fokus på tekstbelæg og citater.";
  return "Lav 1 træning og fokuser på præcision og konklusion.";
}

export function buildFolderLearningSummary(
  sessions: LearningSessionLike[],
  options?: FolderSummaryOptions,
): FolderLearningSummary {
  const issueAcc = new Map<string, AccIssue>();
  const readingRefAcc = new Map<string, LearningReadingRef>();
  let structuredSessionCount = 0;
  let legacySessionCount = 0;
  let sessionsWithFocus = 0;

  for (let index = 0; index < sessions.length; index += 1) {
    const session = sessions[index];
    const sourceType = normalizeSourceType(session.source_type);
    const structured =
      readFeedbackV2FromContainer(session.metadata, sourceType) ??
      readFeedbackV2FromContainer(session.feedback_structured, sourceType) ??
      readFeedbackV2FromContainer(session.meta, sourceType) ??
      readFeedbackV2FromContainer(session.evaluation_meta, sourceType) ??
      readFeedbackV2FromContainer(session.feedback_meta, sourceType);

    if (structured) {
      structuredSessionCount += 1;
      const sessionRefs = collectReadingRefs(session, citationsToRefs(structured.citations));
      for (const ref of sessionRefs) {
        pushReadingRef(readingRefAcc, ref);
      }

      let contributed = false;
      for (const issue of structured.issues) {
        const weight =
          (SEVERITY_WEIGHT[issue.severity] ?? SEVERITY_WEIGHT.medium) * recencyWeight(index) +
          (structured.next_best_action ? 0.35 : 0);
        pushIssue(issueAcc, {
          key: issue.code,
          label: issue.title,
          severity: issue.severity,
          count: 0,
          weight: 0,
          reason: issue.diagnosis || issue.why_it_matters,
          repair: issue.repair || structured.next_best_action,
          example: issue.example || issue.evidence[0] || null,
          evidence: issue.evidence.slice(0, 3),
          citations: sessionRefs.slice(0, 2),
          next_best_action: structured.next_best_action || null,
          evidence_specificity: "specific",
          evidence_bridge: null,
          source: "issue",
        }, weight);
        contributed = true;
      }

      const coverageWeight = taskCoverageMissingWeight(structured.task_coverage);
      if (coverageWeight > 0) {
        pushIssue(issueAcc, {
          key: "task_coverage_missing",
          label: "Dæk hele spørgsmålet",
          severity: coverageWeight >= 2 ? "high" : "medium",
          count: 0,
          weight: 0,
          reason:
            clampText(structured.task_coverage?.summary, 220) ||
            "Tidligere svar dækkede ikke alle dele af spørgsmålet tydeligt nok.",
          repair:
            structured.next_best_action || "Svar kort på alle dele af spørgsmålet, før du finpudser detaljer.",
          example: null,
          evidence: [],
          citations: sessionRefs.slice(0, 1),
          next_best_action: structured.next_best_action || null,
          evidence_specificity: "general",
          evidence_bridge: null,
          source: "task_coverage",
        }, recencyWeight(index) * coverageWeight);
        contributed = true;
      }

      if (contributed) sessionsWithFocus += 1;
      continue;
    }

    const legacyTargets = [
      ...deriveWeakPointTargetsFromContainer(session.metadata),
      ...deriveWeakPointTargetsFromContainer(session.feedback_structured),
      ...deriveWeakPointTargetsFromContainer(session.meta),
      ...deriveWeakPointTargetsFromContainer(session.evaluation_meta),
      ...deriveWeakPointTargetsFromContainer(session.feedback_meta),
    ].filter((target, targetIndex, arr) => arr.findIndex((item) => item.key === target.key) === targetIndex);

    if (!legacyTargets.length) continue;
    legacySessionCount += 1;
    sessionsWithFocus += 1;
    const sessionRefs = collectReadingRefs(session);
    for (const ref of sessionRefs) {
      pushReadingRef(readingRefAcc, ref);
    }

    for (const target of legacyTargets) {
      pushIssue(issueAcc, {
        key: target.key,
        label: target.label,
        severity: "medium",
        count: 0,
        weight: 0,
        reason: `${target.label} går igen i tidligere vurderinger.`,
        repair: target.action || `Arbejd målrettet med ${target.label.toLowerCase()} i næste svar.`,
        example: null,
        evidence: [],
        citations: sessionRefs.slice(0, 1),
        next_best_action: target.action || null,
        evidence_specificity: "general",
        evidence_bridge: null,
        source: "legacy_weak_point",
      }, recencyWeight(index) * (target.action ? 1.25 : 1));
    }
  }

  const topIssues = Array.from(issueAcc.values())
    .map(({ issue }) =>
      enrichIssueForUi({
        ...issue,
        weight: Number((issue.weight + Math.max(0, issue.count - 1) * 1.35).toFixed(2)),
      }),
    )
    .sort((a, b) => b.weight - a.weight || b.count - a.count || a.label.localeCompare(b.label, "da"))
    .slice(0, 3);

  const readingRefs = Array.from(readingRefAcc.values())
    .sort((a, b) => b.count - a.count || (a.title ?? "").localeCompare(b.title ?? "", "da"))
    .slice(0, 4);

  const primaryIssue = topIssues[0] ?? null;
  const focusLabel = primaryIssue ? buildFocusLabel(primaryIssue) : fallbackFocusLabel(options);
  const focusReason = primaryIssue ? buildFocusReason(primaryIssue) : null;
  const nextTrainingText =
    firstWholeSentence(primaryIssue?.repair) ||
    ensureSentence(primaryIssue?.repair) ||
    fallbackNextTrainingText(options);
  const nextStepText =
    firstWholeSentence(primaryIssue?.next_best_action || primaryIssue?.repair) ||
    primaryIssue?.repair ||
    primaryIssue?.next_best_action ||
    fallbackNextTrainingText(options);

  const writingTips = buildWritingTips(primaryIssue, topIssues[1] ?? null)
    .map((tip) => firstWholeSentence(tip))
    .filter(Boolean);

  const fallbackExample =
    primaryIssue?.example ||
    primaryIssue?.evidence[0] ||
    primaryIssue?.citations[0]?.snippet ||
    "Jeg underbygger pointen med et konkret tekstbelæg.";

  return {
    structured_session_count: structuredSessionCount,
    legacy_session_count: legacySessionCount,
    sessions_with_focus: sessionsWithFocus,
    focus_label: focusLabel,
    focus_reason: focusReason,
    next_training_text: nextTrainingText,
    next_step_text: nextStepText,
    badge_tone: primaryIssue?.severity ?? "neutral",
    top_issues: topIssues,
    reading_refs: readingRefs,
    writing_tips:
      writingTips.length > 0
        ? Array.from(new Set(writingTips)).slice(0, 2)
        : [
            "Vælg ét tydeligt fokuspunkt i næste svar.",
            "Underbyg din pointe med et konkret tekstbelæg.",
            "Afslut delsvaret med en kort delkonklusion.",
          ],
    suggestion_prefill: {
      improvement:
        firstWholeSentence(primaryIssue?.repair) ||
        ensureSentence(primaryIssue?.repair) ||
        "Jeg vil gøre min hovedpointe tydeligere i næste svar.",
      example: firstWholeSentence(buildSuggestionExample(primaryIssue, fallbackExample), buildSuggestionExample(primaryIssue, fallbackExample)),
      shortExplanation: firstWholeSentence(
        buildSuggestionShortExplanation(primaryIssue),
        "Det gør svaret mere præcist og lettere at vurdere fagligt.",
      ),
    },
  };
}
