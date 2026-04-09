import { resolveEvaluatorDefinition, type EvaluatorDefinition, type LearningSourceType } from "@/lib/learning/evaluator-registry";
import { getDanskIssueDefaults } from "@/lib/dansk/evaluator";
import { getFysikIssueDefaults } from "@/lib/fysik/evaluator";
import { getHistoryIssueDefaults } from "@/lib/history/evaluator";
import { getMatematikIssueDefaults } from "@/lib/matematik/evaluator";
import { getOkonomiIssueDefaults } from "@/lib/okonomi/evaluator";
import { getSamfundIssueDefaults } from "@/lib/samfund/evaluator";

export type LearningIssueSeverity = "low" | "medium" | "high";

export type WeakPointTarget = {
  key: string;
  label: string;
  action?: string;
};

export type LearningIssue = {
  code: string;
  category: string;
  severity: LearningIssueSeverity;
  title: string;
  diagnosis: string;
  why_it_matters: string;
  evidence: string[];
  repair: string;
  example?: string;
};

export type LearningCitation = {
  chunk_id: string;
  file_id: string | null;
  title: string | null;
  url: string | null;
  snippet?: string | null;
  why?: string | null;
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

export type LearningTaskCoverage = {
  answered_count?: number;
  expected_count?: number;
  ratio?: number | null;
  summary?: string;
};

export type FeedbackV2 = {
  version: "feedback_v2";
  evaluator_id: string;
  source_type: LearningSourceType;
  subject_family: string;
  task_type: string;
  assessment_mode: string;
  summary: string;
  strengths: string[];
  issues: LearningIssue[];
  next_best_action: string;
  task_coverage?: LearningTaskCoverage;
  citations?: LearningCitation[];
};

type BuildFeedbackV2Args = {
  evaluator: EvaluatorDefinition;
  sourceType?: LearningSourceType;
  raw?: unknown;
  summary?: unknown;
  strengths?: unknown;
  issues?: unknown;
  nextBestAction?: unknown;
  taskCoverage?: unknown;
  citations?: unknown;
  improvements?: unknown;
  nextSteps?: unknown;
  weakPoints?: unknown;
  fallbackSummary?: string;
  fallbackNextBestAction?: string;
};

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function asText(value: unknown): string {
  return String(value ?? "").trim();
}

function clampText(value: string, maxLen: number) {
  const text = String(value ?? "").trim();
  if (!text) return "";
  return text.length <= maxLen ? text : `${text.slice(0, maxLen - 1).trim()}...`;
}

function toKey(value: string, fallback: string) {
  const normalized = value
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 80);
  return normalized || fallback;
}

function normalizeSeverity(raw: unknown): LearningIssueSeverity {
  const value = asText(raw).toLowerCase();
  if (value === "low" || value === "medium" || value === "high") return value;
  return "medium";
}

function normalizeEvidence(raw: unknown): string[] {
  if (Array.isArray(raw)) {
    return raw
      .map((item) => clampText(asText(item), 240))
      .filter(Boolean)
      .slice(0, 4);
  }

  const text = clampText(asText(raw), 240);
  return text ? [text] : [];
}

function normalizeTaskCoverage(raw: unknown): LearningTaskCoverage | undefined {
  const obj = asRecord(raw);
  if (!obj) return undefined;

  const answeredCount = Number(obj.answered_count ?? obj.answeredCount);
  const expectedCount = Number(obj.expected_count ?? obj.expectedCount);
  const ratioRaw = Number(obj.ratio);
  const summary = clampText(asText(obj.summary), 220);

  const out: LearningTaskCoverage = {};
  if (Number.isFinite(answeredCount) && answeredCount >= 0) out.answered_count = Math.round(answeredCount);
  if (Number.isFinite(expectedCount) && expectedCount >= 0) out.expected_count = Math.round(expectedCount);
  if (Number.isFinite(ratioRaw)) out.ratio = Math.max(0, Math.min(1, ratioRaw));
  if (summary) out.summary = summary;

  return Object.keys(out).length > 0 ? out : undefined;
}

export function ensureStringArray(value: unknown, max = 6): string[] {
  if (!value) return [];
  const values = Array.isArray(value) ? value : [value];
  return values
    .map((item) => clampText(asText(item), 240))
    .filter(Boolean)
    .slice(0, max);
}

export function normalizeWeakPointTargets(value: unknown): WeakPointTarget[] {
  if (!Array.isArray(value)) return [];

  const out: WeakPointTarget[] = [];
  const seen = new Set<string>();

  for (const item of value) {
    if (typeof item === "string") {
      const label = clampText(item.trim(), 120);
      if (!label) continue;
      const key = toKey(label, label.toLowerCase());
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({ key, label });
      continue;
    }

    const obj = asRecord(item);
    if (!obj) continue;

    const label = clampText(asText(obj.label ?? obj.text ?? obj.key), 120);
    const key = toKey(asText(obj.key) || label, "issue");
    const action = clampText(asText(obj.action ?? obj.next_step ?? obj.nextStep), 200);
    if (!label || !key || seen.has(key)) continue;

    seen.add(key);
    out.push(action ? { key, label, action } : { key, label });
  }

  return out;
}

function normalizeLearningIssue(raw: unknown, index: number): LearningIssue | null {
  const obj = asRecord(raw);
  if (!obj) return null;

  const code = toKey(asText(obj.code) || asText(obj.title ?? obj.label) || `issue_${index + 1}`, `issue_${index + 1}`);
  const defaults =
    getSamfundIssueDefaults(code) ??
    getDanskIssueDefaults(code) ??
    getHistoryIssueDefaults(code) ??
    getFysikIssueDefaults(code) ??
    getMatematikIssueDefaults(code) ??
    getOkonomiIssueDefaults(code);
  const title = clampText(asText(obj.title ?? obj.label ?? defaults?.title ?? obj.code), 140);
  const category = toKey(asText(obj.category ?? defaults?.category) || "general", "general");
  const diagnosis = clampText(asText(obj.diagnosis ?? obj.summary ?? obj.title ?? defaults?.diagnosis), 260);
  const whyItMatters = clampText(asText(obj.why_it_matters ?? obj.whyItMatters ?? defaults?.why_it_matters), 260);
  const repair = clampText(asText(obj.repair ?? obj.action ?? obj.next_step ?? obj.nextStep ?? defaults?.repair), 220);
  const example = clampText(asText(obj.example ?? defaults?.example), 220);
  const evidence = normalizeEvidence(obj.evidence);

  if (!title && !diagnosis && !repair) return null;

  return {
    code,
    category,
    severity: normalizeSeverity(obj.severity),
    title: title || clampText(code.replace(/_/g, " "), 140),
    diagnosis: diagnosis || title || defaults?.diagnosis || "Der er et tydeligt forbedringspunkt.",
    why_it_matters:
      whyItMatters ||
      defaults?.why_it_matters ||
      "Det har betydning for kvaliteten af besvarelsen og hvor præcist spørgsmålet bliver besvaret.",
    evidence,
    repair: repair || defaults?.repair || diagnosis || "Forbedr dette punkt i næste forsøg.",
    ...(example ? { example } : {}),
  };
}

function normalizeLearningIssues(value: unknown): LearningIssue[] {
  if (!Array.isArray(value)) return [];

  const out: LearningIssue[] = [];
  const seen = new Set<string>();

  for (let i = 0; i < value.length; i += 1) {
    const normalized = normalizeLearningIssue(value[i], i);
    if (!normalized) continue;
    if (seen.has(normalized.code)) continue;
    seen.add(normalized.code);
    out.push(normalized);
    if (out.length >= 6) break;
  }

  return out;
}

function issueFromWeakPoint(point: WeakPointTarget, index: number): LearningIssue {
  const action = clampText(asText(point.action), 220);
  return {
    code: toKey(point.key || point.label, `issue_${index + 1}`),
    category: "focus_area",
    severity: "medium",
    title: clampText(point.label, 140) || `Fokuspunkt ${index + 1}`,
    diagnosis: action || `${point.label} er et gennemgående forbedringspunkt.`,
    why_it_matters: "Når dette punkt styrkes, bliver svaret mere præcist, mere dækkende og lettere at vurdere fagligt.",
    evidence: [],
    repair: action || `Træn ${point.label.toLowerCase()} i næste svar.`,
  };
}

function issueFromImprovement(text: string, index: number): LearningIssue {
  const clean = clampText(text, 220);
  const title = clampText(clean.split(/[.!?]/)[0] || clean, 140);
  return {
    code: toKey(title || `issue_${index + 1}`, `issue_${index + 1}`),
    category: "improvement_area",
    severity: index === 0 ? "high" : "medium",
    title: title || `Forbedringspunkt ${index + 1}`,
    diagnosis: clean || "Der er et tydeligt forbedringspunkt.",
    why_it_matters: "Dette punkt påvirker, hvor klart og fagligt dækkende besvarelsen fremstår.",
    evidence: [],
    repair: clean || "Arbejd målrettet med dette punkt i næste forsøg.",
  };
}

function normalizeCitation(raw: unknown): LearningCitation | null {
  const obj = asRecord(raw);
  if (!obj) return null;

  const chunkId = asText(obj.chunk_id ?? obj.chunkId);
  const title = asText(obj.title) || null;
  if (!chunkId && !title) return null;

  const fileId = asText(obj.file_id ?? obj.fileId) || null;
  const url = asText(obj.url) || null;
  const snippet = clampText(asText(obj.snippet ?? obj.excerpt), 280) || null;
  const why = clampText(asText(obj.why), 220) || null;

  return {
    chunk_id: chunkId || `title:${toKey(title ?? "citation", "citation")}`,
    file_id: fileId,
    title,
    url,
    ...(snippet ? { snippet } : {}),
    ...(why ? { why } : {}),
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

function normalizeCitations(value: unknown): LearningCitation[] {
  if (!Array.isArray(value)) return [];

  const out: LearningCitation[] = [];
  const seen = new Set<string>();

  for (const item of value) {
    const citation = normalizeCitation(item);
    if (!citation) continue;
    if (seen.has(citation.chunk_id)) continue;
    seen.add(citation.chunk_id);
    out.push(citation);
    if (out.length >= 8) break;
  }

  return out;
}

export function getStructuredFeedbackSource(raw: unknown): Record<string, unknown> | null {
  const obj = asRecord(raw);
  if (!obj) return null;

  const nested =
    asRecord(obj.feedback_v2) ??
    asRecord(obj.feedbackV2) ??
    asRecord(obj.learning_signals) ??
    asRecord(obj.learningSignals);

  if (nested) return nested;

  if (typeof obj.summary === "string" || Array.isArray(obj.issues) || obj.version === "feedback_v2") {
    return obj;
  }

  return null;
}

export function buildFeedbackV2(args: BuildFeedbackV2Args): FeedbackV2 {
  const rawSignals = getStructuredFeedbackSource(args.raw);
  const strengths = ensureStringArray(rawSignals?.strengths ?? args.strengths);
  const improvements = ensureStringArray(rawSignals?.improvements ?? args.improvements);
  const nextSteps = ensureStringArray(rawSignals?.next_steps ?? rawSignals?.nextSteps ?? args.nextSteps);
  const explicitWeakPoints = normalizeWeakPointTargets(rawSignals?.weak_points ?? rawSignals?.weakPoints ?? args.weakPoints);
  let issues = normalizeLearningIssues(rawSignals?.issues ?? args.issues);

  if (!issues.length && explicitWeakPoints.length) {
    issues = explicitWeakPoints.map((point, index) => issueFromWeakPoint(point, index));
  }
  if (!issues.length && improvements.length) {
    issues = improvements.map((text, index) => issueFromImprovement(text, index));
  }

  const summary =
    clampText(asText(rawSignals?.summary ?? rawSignals?.overall ?? args.summary), 320) ||
    clampText(args.fallbackSummary ?? "", 320) ||
    "Besvarelsen har tydelige styrker, men også konkrete områder der kan løftes i næste forsøg.";

  const nextBestAction =
    clampText(asText(rawSignals?.next_best_action ?? rawSignals?.nextBestAction ?? args.nextBestAction), 220) ||
    clampText(args.fallbackNextBestAction ?? "", 220) ||
    issues[0]?.repair ||
    nextSteps[0] ||
    improvements[0] ||
    "Brug feedbacken aktivt i dit næste forsøg og forbedr det mest presserende punkt først.";

  const taskCoverage = normalizeTaskCoverage(rawSignals?.task_coverage ?? rawSignals?.taskCoverage ?? args.taskCoverage);
  const citations = normalizeCitations(rawSignals?.citations ?? args.citations);

  return {
    version: "feedback_v2",
    evaluator_id: args.evaluator.id,
    source_type: args.sourceType ?? args.evaluator.source_type,
    subject_family: asText(rawSignals?.subject_family) || args.evaluator.subject_family,
    task_type: asText(rawSignals?.task_type) || args.evaluator.task_type,
    assessment_mode: asText(rawSignals?.assessment_mode) || args.evaluator.assessment_mode,
    summary,
    strengths: strengths.length ? strengths : ["Besvarelsen rammer noget af det centrale, men kan blive mere præcis og dækkende."],
    issues,
    next_best_action: nextBestAction,
    ...(taskCoverage ? { task_coverage: taskCoverage } : {}),
    ...(citations.length ? { citations } : {}),
  };
}

export function deriveWeakPointTargetsFromFeedbackV2(signals: FeedbackV2 | null | undefined): WeakPointTarget[] {
  if (!signals) return [];

  const out: WeakPointTarget[] = [];
  const seen = new Set<string>();

  for (const issue of signals.issues) {
    const key = toKey(issue.code || issue.title, "issue");
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push({
      key,
      label: clampText(issue.title, 120) || clampText(issue.code.replace(/_/g, " "), 120),
      action: clampText(issue.repair, 200) || undefined,
    });
    if (out.length >= 3) break;
  }

  return out;
}

export function readFeedbackV2FromContainer(
  raw: unknown,
  sourceType: LearningSourceType = "trainer",
): FeedbackV2 | null {
  const structuredSource = getStructuredFeedbackSource(raw);
  if (!structuredSource) return null;

  const evaluator = resolveEvaluatorDefinition(sourceType);
  return buildFeedbackV2({
    evaluator,
    sourceType,
    raw: structuredSource,
  });
}

export function deriveWeakPointTargetsFromContainer(raw: unknown): WeakPointTarget[] {
  const direct = normalizeWeakPointTargets(asRecord(raw)?.weak_points ?? asRecord(raw)?.weakPoints);
  if (direct.length) return direct;

  return deriveWeakPointTargetsFromFeedbackV2(readFeedbackV2FromContainer(raw, "trainer"));
}
