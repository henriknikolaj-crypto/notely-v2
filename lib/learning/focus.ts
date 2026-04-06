import "server-only";

import {
  deriveWeakPointTargetsFromContainer,
  type LearningIssueSeverity,
  readFeedbackV2FromContainer,
  type FeedbackV2,
  type LearningIssue,
  type LearningTaskCoverage,
  type WeakPointTarget,
} from "@/lib/learning/feedback";
import type { LearningSourceType } from "@/lib/learning/evaluator-registry";

export type LearningFocusSessionRow = {
  created_at?: string | null;
  source_type?: string | null;
  metadata?: unknown;
  meta?: unknown;
  score?: number | null;
};

export type LearningFocusTargetSource = "issue" | "task_coverage" | "legacy_weak_point";

export type LearningFocusTarget = {
  key: string;
  label: string;
  reason: string;
  suggested_action: string;
  severity: LearningIssueSeverity;
  weight: number;
  source: LearningFocusTargetSource;
  count: number;
  source_types: string[];
  action?: string;
};

export type DerivedFocusTargetsResult = {
  targets: LearningFocusTarget[];
  contributing_session_count: number;
  structured_session_count: number;
  legacy_session_count: number;
};

type AccumulatedFocusTarget = {
  target: LearningFocusTarget;
  sourceTypes: Set<string>;
};

const SEVERITY_WEIGHT: Record<LearningIssue["severity"], number> = {
  low: 1,
  medium: 2,
  high: 3.25,
};

function asText(value: unknown): string {
  return String(value ?? "").trim();
}

function normalizeKey(value: string): string {
  return String(value ?? "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 80);
}

function normalizeSourceType(raw: unknown): LearningSourceType {
  const value = asText(raw).toLowerCase();
  return value === "simulator" || value === "oral" ? value : "trainer";
}

function tokenize(value: string): string[] {
  return String(value ?? "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .split(/[^a-z0-9]+/g)
    .map((token) => token.trim())
    .filter((token) => token.length >= 4)
    .slice(0, 24);
}

function overlapCount(a: string, b: string): number {
  const aTokens = new Set(tokenize(a));
  if (!aTokens.size) return 0;

  let hits = 0;
  for (const token of tokenize(b)) {
    if (aTokens.has(token)) hits += 1;
  }
  return hits;
}

function recencyWeight(index: number): number {
  if (index <= 1) return 3.2;
  if (index <= 4) return 2.5;
  if (index <= 9) return 1.75;
  if (index <= 19) return 1.15;
  return 0.8;
}

function taskCoverageMissingWeight(taskCoverage: LearningTaskCoverage | undefined): number {
  if (!taskCoverage) return 0;

  const expected = Number(taskCoverage.expected_count);
  const answered = Number(taskCoverage.answered_count);
  const ratio =
    typeof taskCoverage.ratio === "number" && Number.isFinite(taskCoverage.ratio) ? taskCoverage.ratio : null;

  const missingCount =
    Number.isFinite(expected) && Number.isFinite(answered) ? Math.max(0, Math.round(expected - answered)) : 0;
  const missingRatio = ratio != null ? Math.max(0, 1 - Math.max(0, Math.min(1, ratio))) : 0;

  if (missingCount >= 2 || missingRatio >= 0.45) return 2.4;
  if (missingCount >= 1 || missingRatio >= 0.2) return 1.4;
  return 0;
}

function createCoverageTarget(signals: FeedbackV2): WeakPointTarget | null {
  const boost = taskCoverageMissingWeight(signals.task_coverage);
  if (boost <= 0) return null;

  return {
    key: "task_coverage_missing",
    label: "Dæk hele spørgsmålet",
    action: signals.next_best_action || "Svar på alle dele af spørgsmålet, før du finpudser detaljer.",
  };
}

function buildIssueTarget(issue: LearningIssue, signals: FeedbackV2): WeakPointTarget {
  return {
    key: normalizeKey(issue.code || issue.title) || "issue",
    label: asText(issue.title) || asText(issue.code).replace(/_/g, " "),
    action: asText(issue.repair) || asText(signals.next_best_action) || undefined,
  };
}

function issueScore(issue: LearningIssue, signals: FeedbackV2, sessionIndex: number): number {
  const severityScore = SEVERITY_WEIGHT[issue.severity] ?? SEVERITY_WEIGHT.medium;
  const recencyScore = recencyWeight(sessionIndex);
  const nextAction = asText(signals.next_best_action);
  const actionBoost = nextAction
    ? Math.min(1.4, overlapCount(`${issue.title} ${issue.diagnosis} ${issue.repair}`, nextAction) * 0.45 + 0.25)
    : 0;
  const coverageBoost = taskCoverageMissingWeight(signals.task_coverage) * 0.35;
  return severityScore * recencyScore + actionBoost + coverageBoost;
}

function legacyScore(sessionIndex: number, target: WeakPointTarget): number {
  return recencyWeight(sessionIndex) * (target.action ? 1.25 : 1);
}

function pushTarget(
  acc: Map<string, AccumulatedFocusTarget>,
  target: LearningFocusTarget,
  weight: number,
  sourceType: LearningSourceType,
) {
  const key = normalizeKey(target.key || target.label);
  if (!key || !target.label) return;

  const existing = acc.get(key);
  if (existing) {
    existing.target.weight += weight;
    existing.target.count += 1;
    if (!existing.target.suggested_action && target.suggested_action) {
      existing.target.suggested_action = target.suggested_action;
      existing.target.action = target.suggested_action;
    }
    if (
      target.severity === "high" ||
      (target.severity === "medium" && existing.target.severity === "low")
    ) {
      existing.target.severity = target.severity;
    }
    if (target.source !== "legacy_weak_point") existing.target.source = target.source;
    existing.sourceTypes.add(sourceType);
    existing.target.source_types = Array.from(existing.sourceTypes);
    return;
  }

  const sourceTypes = new Set<string>([sourceType]);
  acc.set(key, {
    target: {
      key,
      label: target.label,
      reason: target.reason,
      suggested_action: target.suggested_action,
      severity: target.severity,
      weight,
      source: target.source,
      count: 1,
      source_types: [sourceType],
      action: target.suggested_action,
    },
    sourceTypes,
  });
}

export function deriveFocusTargetsFromLearningSignals(
  rows: LearningFocusSessionRow[],
  limit = 2,
): DerivedFocusTargetsResult {
  const acc = new Map<string, AccumulatedFocusTarget>();
  let contributingSessionCount = 0;
  let structuredSessionCount = 0;
  let legacySessionCount = 0;

  for (let i = 0; i < rows.length; i += 1) {
    const row = rows[i];
    const sourceType = normalizeSourceType(row?.source_type);
    const signals =
      readFeedbackV2FromContainer(row?.metadata, sourceType) ?? readFeedbackV2FromContainer(row?.meta, sourceType);

    if (signals) {
      const issueTargets = signals.issues.map((issue) => ({
        target: {
          ...buildIssueTarget(issue, signals),
          reason: asText(issue.diagnosis) || asText(issue.why_it_matters) || `Fokusér på ${issue.title.toLowerCase()}.`,
          suggested_action:
            asText(issue.repair) || asText(signals.next_best_action) || `Forbedr ${issue.title.toLowerCase()} i næste svar.`,
          severity: issue.severity,
          weight: 0,
          source: "issue" as LearningFocusTargetSource,
          count: 0,
          source_types: [],
          action: asText(issue.repair) || asText(signals.next_best_action) || undefined,
        },
        weight: issueScore(issue, signals, i),
      }));
      const coverageTarget = createCoverageTarget(signals);
      if (coverageTarget) {
        issueTargets.push({
          target: {
            key: coverageTarget.key,
            label: coverageTarget.label,
            reason:
              asText(signals.task_coverage?.summary) ||
              "Tidligere forsøg viser, at dele af spørgsmålet ikke blev dækket fuldt ud.",
            suggested_action:
              coverageTarget.action ||
              asText(signals.next_best_action) ||
              "Svar på alle dele af spørgsmålet, før du finpudser detaljer.",
            severity: "medium",
            weight: 0,
            source: "task_coverage",
            count: 0,
            source_types: [],
            action:
              coverageTarget.action ||
              asText(signals.next_best_action) ||
              "Svar på alle dele af spørgsmålet, før du finpudser detaljer.",
          },
          weight: recencyWeight(i) * taskCoverageMissingWeight(signals.task_coverage),
        });
      }

      if (issueTargets.length > 0) {
        contributingSessionCount += 1;
        structuredSessionCount += 1;
        for (const item of issueTargets) {
          pushTarget(acc, item.target, item.weight, sourceType);
        }
        continue;
      }
    }

    const legacyTargets = [
      ...deriveWeakPointTargetsFromContainer(row?.metadata),
      ...deriveWeakPointTargetsFromContainer(row?.meta),
    ].filter((target, index, arr) => arr.findIndex((item) => item.key === target.key) === index);
    if (!legacyTargets.length) continue;

    contributingSessionCount += 1;
    legacySessionCount += 1;
    for (const target of legacyTargets) {
      pushTarget(
        acc,
        {
          key: target.key,
          label: target.label,
          reason: `Legacy weak-point fra tidligere vurdering: ${target.label}.`,
          suggested_action:
            target.action || `Arbejd målrettet med ${target.label.toLowerCase()} i næste svar.`,
          severity: "medium",
          weight: 0,
          source: "legacy_weak_point",
          count: 0,
          source_types: [],
          action: target.action || `Arbejd målrettet med ${target.label.toLowerCase()} i næste svar.`,
        },
        legacyScore(i, target),
        sourceType,
      );
    }
  }

  const targets = Array.from(acc.values())
    .map((entry) => {
      const repetitionBoost = Math.max(0, entry.target.count - 1) * 1.35;
      return {
        ...entry.target,
        weight: Number((entry.target.weight + repetitionBoost).toFixed(2)),
        source_types: Array.from(entry.sourceTypes).sort(),
      };
    })
    .sort((a, b) => b.weight - a.weight || b.count - a.count || a.label.localeCompare(b.label, "da"))
    .slice(0, Math.max(1, limit));

  return {
    targets,
    contributing_session_count: contributingSessionCount,
    structured_session_count: structuredSessionCount,
    legacy_session_count: legacySessionCount,
  };
}
