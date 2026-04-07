"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { buildFolderLearningSummary } from "@/lib/learning/ui-selectors";

const SOURCE_TYPES = "trainer,simulator,oral";
const FOCUS_WINDOW_SIZE = 25;

const COPY = {
  backToOverview: "← Tilbage til Overblik",
  pageTitleFallback: "Mappe",
  subtitle: "Her får du et roligt overblik over, hvad der løfter dine næste svar mest.",
  repeatedTitle: "Det her går igen i dine svar",
  readTitle: "Læs dette før næste træning",
  nextStepTitle: "Næste skridt",
  writingTipsTitle: "Når du skriver",
  sourceLabel: " ",
  chartEmpty: "Der er for få vurderinger til at vise en udviklingskurve endnu.",
  chartHint: "Kurven viser de seneste vurderinger med score.",
} as const;

type OverviewItem = {
  folder_id: string | null;
  folder_title: string;
  folderName?: string;
  folder_name?: string;
  attempts_total: number;
  avg_last5: number | null;
  last_trained_at: string | null;
  focus_label?: string | null;
  focus_reason?: string | null;
  next_training_text?: string | null;
  next_step_text?: string | null;
  focus_badge_tone?: "neutral" | "low" | "medium" | "high";
};

type OverviewResponse = {
  items?: OverviewItem[];
  error?: string;
};

type SessionRow = {
  id: string;
  score: number | null;
  feedback?: string | null;
  created_at: string | null;
  folder_id: string | null;
  source_type: string | null;
  metadata?: unknown;
  feedback_structured?: unknown;
  meta?: unknown;
  evaluation_meta?: unknown;
  feedback_meta?: unknown;
};

type SessionsResponse = {
  ok?: boolean;
  sessions?: SessionRow[];
  repeat_errors?: unknown;
  reading_refs?: unknown;
  error?: string;
};

type ChunkSnippetItem = {
  chunkId: string;
  title?: string | null;
  url?: string | null;
  snippetShort?: string | null;
  snippetLong?: string | null;
  hitCount?: number;
  matchIndex?: number;
  page?: number | string | null;
  pageFrom?: number | string | null;
  pageTo?: number | string | null;
  sourcePage?: number | string | null;
  pageLabel?: string | null;
  sourcePageLabel?: string | null;
  printedPage?: number | string | null;
  printedPageFrom?: number | string | null;
  printedPageTo?: number | string | null;
  printedPageLabel?: string | null;
  position?: string | null;
};

type ChunkSnippetResponse = {
  ok?: boolean;
  items?: ChunkSnippetItem[];
  error?: string;
};

type WeakPointItem = {
  key: string;
  label: string;
  action: string | null;
  count: number;
};

type ReadingRefItem = {
  chunk_id: string;
  file_id: string | null;
  title: string | null;
  url: string | null;
  snippet: string | null;
  why: string | null;
  practice_prompt: string | null;
  count: number;
  tags: string[];
  page?: number | string | null;
  page_from?: number | string | null;
  page_to?: number | string | null;
  source_page?: number | string | null;
  page_label?: string | null;
  source_page_label?: string | null;
  printed_page?: number | string | null;
  printed_page_from?: number | string | null;
  printed_page_to?: number | string | null;
  printed_page_label?: string | null;
  position?: string | null;
};

type FolderStats = {
  attempts_total: number;
  avg_last5: number | null;
  last_trained_at: string | null;
};

type ScorePoint = {
  id: string;
  score: number;
  created_at: string;
};

type FocusUiGuide = {
  doNow: [string, string];
  templatePrefill: {
    improvement: string;
    example: string;
    shortExplanation: string;
  };
};

type FocusEvidenceText = {
  title: string;
  snippet: string;
  page?: string;
  url?: string | null;
};

type FocusInsight = {
  key: string;
  title: string;
  description: string;
  count: number;
  evidenceFeedback: string[];
  evidenceText: FocusEvidenceText | null;
  evidenceBridge: string | null;
  evidenceSpecificity: "general" | "specific";
  actions: string[];
  templatePrefill: {
    improvement: string;
    example: string;
    shortExplanation: string;
  };
};

type FocusSeed = {
  key: string;
  title: string;
  description: string;
  count: number;
  evidenceFeedback: string[];
  actions: [string, string];
  templatePrefill: FocusUiGuide["templatePrefill"];
  citation: ReadingRefItem | null;
  snippetKeywordsCsv: string;
};

type QuoteCandidate = {
  chunkId?: string | null;
  title: string;
  text: string;
  page?: string;
  pageFrom?: string | null;
  pageTo?: string | null;
  url?: string | null;
  pageLabel?: string | null;
  sourcePageLabel?: string | null;
  printedPage?: string | null;
  printedPageLabel?: string | null;
  position?: string | null;
};

type QuotePick = {
  chunkId?: string | null;
  snippet: string;
  title: string;
  page?: string;
  pageFrom?: string | null;
  pageTo?: string | null;
  url?: string | null;
  pageLabel?: string | null;
  sourcePageLabel?: string | null;
  printedPage?: string | null;
  printedPageLabel?: string | null;
  position?: string | null;
  chosenScore: number;
  matchedKeywords: string[];
};

function asRecord(v: unknown): Record<string, unknown> | null {
  if (!v || typeof v !== "object" || Array.isArray(v)) return null;
  return v as Record<string, unknown>;
}

function asText(v: unknown): string {
  return String(v ?? "").trim();
}

function asStringOrNumber(v: unknown): string | number | null {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string") {
    const s = v.trim();
    return s ? s : null;
  }
  return null;
}

function clampWithEllipsis(raw: string, maxLen: number): string {
  const text = String(raw ?? "").trim();
  if (!text || text.length <= maxLen) return text;
  const sliced = text.slice(0, maxLen);
  const lastSpace = sliced.lastIndexOf(" ");
  const safe = lastSpace > Math.floor(maxLen * 0.6) ? sliced.slice(0, lastSpace) : sliced;
  return `${safe.trim()}...`;
}

function normalizeSentenceWhitespace(raw: unknown): string {
  return String(raw ?? "")
    .replace(/\s+/g, " ")
    .trim();
}

function wholeSentenceOrEmpty(raw: unknown, maxLen = 220): string {
  const text = normalizeSentenceWhitespace(raw);
  if (!text) return "";
  const match = text.match(/.+?[.!?](?=\s|$)/);
  if (match?.[0]) {
    const sentence = match[0].trim();
    if (/\.\.\.\s*$/.test(sentence)) return "";
    if (/\b(?!fx|osv|ca|bl.a|mfl)[a-zæøå]{1,3}\.\s*$/i.test(sentence)) return "";
    return sentence.length <= maxLen ? sentence : "";
  }
  if (text.length <= maxLen && !/\.\.\.\s*$/.test(text)) {
    const trimmed = text.replace(/\.\.\.\s*$/, "").trim();
    const words = trimmed.split(/\s+/).filter(Boolean);
    if (/\b(?!fx|osv|ca|bl.a|mfl)[a-zæøå]{1,3}\.\s*$/i.test(trimmed)) return "";
    if (/^[a-zæøå-]{1,8}$/i.test(trimmed)) return "";
    if (words.length < 4) return "";
    if ((words[words.length - 1] ?? "").length < 4) return "";
    return /[.!?]\s*$/.test(trimmed) ? trimmed : `${trimmed}.`;
  }
  return "";
}

function normalizedCopyKey(raw: unknown): string {
  return normalizeSentenceWhitespace(raw)
    .toLowerCase()
    .replace(/[^a-z0-9æøå]+/gi, " ")
    .trim();
}

const COPY_DEDUPE_STOPWORDS = new Set([
  "dine",
  "dette",
  "dette",
  "denne",
  "dine",
  "næste",
  "svar",
  "svaret",
  "teksten",
  "fokus",
  "gøre",
  "tydeligere",
  "kort",
  "bruge",
  "brug",
  "aktivt",
  "forsøg",
]);

function copyTokens(raw: unknown): string[] {
  return normalizedCopyKey(raw)
    .split(" ")
    .filter((token) => token.length >= 4 && !COPY_DEDUPE_STOPWORDS.has(token));
}

function copyOverlapRatio(a: unknown, b: unknown): number {
  const aTokens = copyTokens(a);
  const bTokens = copyTokens(b);
  if (!aTokens.length || !bTokens.length) return 0;
  const bSet = new Set(bTokens);
  let overlap = 0;
  for (const token of aTokens) {
    if (bSet.has(token)) overlap += 1;
  }
  return overlap / Math.max(1, Math.min(aTokens.length, bTokens.length));
}

function isDuplicateishCopy(candidate: string, blockers: Array<string | null | undefined>) {
  const normalizedCandidate = normalizedCopyKey(candidate);
  if (!normalizedCandidate) return true;
  return blockers.some((blocker) => {
    const normalizedBlocker = normalizedCopyKey(blocker);
    if (!normalizedBlocker) return false;
    return (
      normalizedCandidate === normalizedBlocker ||
      normalizedCandidate.includes(normalizedBlocker) ||
      normalizedBlocker.includes(normalizedCandidate) ||
      copyOverlapRatio(normalizedCandidate, normalizedBlocker) >= 0.72
    );
  });
}

function asWeakPointRawList(v: unknown): unknown[] {
  return Array.isArray(v) ? v : [];
}

function isUuidLike(s: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(s);
}

function getFocusUiGuide(key: string | null, label: string | null): FocusUiGuide {
  const needle = `${String(key ?? "").toLowerCase()} ${String(label ?? "").toLowerCase()}`;

  if (needle.includes("begreb")) {
    return {
      doNow: [
        "Vælg 3 nøglebegreber i dit næste svar.",
        "Skriv 1 sætning definition + 1 sætning anvendelse for hver.",
      ],
      templatePrefill: {
        improvement: "Jeg vil definere de centrale begreber, før jeg argumenterer videre.",
        example: "Fx: Jeg bruger begrebet direkte på casen i mit svar.",
        shortExplanation: "Det gør min forklaring mere præcis og faglig.",
      },
    };
  }

  if (needle.includes("eksempel")) {
    return {
      doNow: [
        "Tilføj 2 konkrete eksempler (navn + situation).",
        "Forklar mekanismen: hvorfor viser eksemplet din pointe?",
      ],
      templatePrefill: {
        improvement: "Jeg vil underbygge min pointe med et konkret eksempel fra materialet.",
        example: "Fx: Jeg navngiver situationen og forklarer hvad den viser.",
        shortExplanation: "Eksemplet gør argumentet tydeligt og troværdigt.",
      },
    };
  }

  if (needle.includes("tekstnær") || needle.includes("dokumentation")) {
    return {
      doNow: [
        "Find 1 kort citat (1–2 linjer) fra materialet.",
        "Forklar i 1 sætning, hvordan citatet understøtter din pointe.",
      ],
      templatePrefill: {
        improvement: "Jeg vil indsætte et kort citat og knytte det direkte til min pointe.",
        example: "Fx: Jeg vælger en linje, der dokumenterer hovedargumentet.",
        shortExplanation: "Det løfter både tekstnærhed og præcision.",
      },
    };
  }

  return {
    doNow: [
      "Gør 1 forbedring tydelig i næste svar.",
      "Tilføj 1 konkret eksempel som belæg.",
    ],
    templatePrefill: {
      improvement: "Jeg vil gøre min hovedpointe tydeligere i første del af svaret.",
      example: "Fx: Jeg tilføjer et konkret tekstbelæg til påstanden.",
      shortExplanation: "Det gør argumentet lettere at følge.",
    },
  };
}

function getSnippetKeywordsForFocus(focus: { key?: string | null; label?: string | null; action?: string | null }): string[] {
  const needle = `${String(focus.key ?? "").toLowerCase()} ${String(focus.label ?? "").toLowerCase()} ${String(
    focus.action ?? "",
  ).toLowerCase()}`;

  let base: string[] = [];
  if (needle.includes("begreb")) {
    base = [
      "økonomisk",
      "kapital",
      "produktion",
      "lobbyisme",
      "medier",
      "dagsorden",
      "framing",
      "opinion",
      "globalisering",
      "EU",
      "WTO",
      "organisationer",
    ];
  } else if (needle.includes("tekstnær") || needle.includes("dokumentation")) {
    base = ["ifølge", "citat", "fremgår", "tekst", "linje", "belæg"];
  } else if (needle.includes("eksempel")) {
    base = ["eksempel", "konkret", "fx", "for eksempel"];
  } else {
    base = ["britt", "terminal", "lufthavn", "død", "sygdom", "tilbageblik", "fortæller", "symbol", "tema"];
  }

  const extra = `${String(focus.label ?? "")} ${String(focus.action ?? "")}`
    .toLowerCase()
    .split(/[^a-z0-9æøå-]+/i)
    .map((w) => w.trim())
    .filter((w) => w.length >= 4)
    .slice(0, 2);

  const merged = [...base, ...extra];
  const out: string[] = [];
  const seen = new Set<string>();
  for (const k of merged) {
    if (!k || seen.has(k)) continue;
    seen.add(k);
    out.push(k);
    if (out.length >= 10) break;
  }
  return out;
}

function buildTemplateText(prefill: FocusUiGuide["templatePrefill"]): string {
  return [
    `Forbedring: ${prefill.improvement}`,
    `Eksempel: ${prefill.example}`,
    `Kort forklaring: ${prefill.shortExplanation}`,
  ].join("\n");
}

function cleanFeedbackEvidenceText(raw: string): string {
  let text = asText(raw);
  if (!text) return "";

  // Fjern åbenlyse prompt-/rolle-markører.
  text = text
    .replace(/^\s*(?:system|assistant|user|prompt|rolle|instruktion(?:er)?|internal)\s*:\s*/gi, "")
    .replace(/\[\s*(?:internal|prompt|system|meta)[^\]]*]/gi, "")
    .replace(/\b(?:begin|end)\s+(?:prompt|system|instruktion(?:er)?)\b/gi, "");

  // Fjern løse "Del a/b/c/d"-rester (beholdes hvis de tydeligt følges af opgavekontekst).
  text = text
    .replace(/\(\s*(?:jf\.?\s*)?(?:i\s+)?del\s*[abcd]\s*\)/gi, " ")
    .replace(/^\s*(?:jf\.?\s*)?(?:i\s+)?del\s*[abcd]\s*(?:[:\-–]\s*|\s+)/gi, "")
    .replace(/\s*(?:[,;:.]\s*)?(?:jf\.?\s*)?(?:i\s+)?del\s*[abcd]\s*$/gi, "")
    .replace(
      /\b(?:jf\.?\s*)?(?:i\s+)?del\s*[abcd]\b(?!\s+(?:af|i)\s+(?:opgave|spørgsmål|case|teksten|materialet))/gi,
      "",
    );

  text = text
    .replace(/\s{2,}/g, " ")
    .replace(/\s+([,.;:!?])/g, "$1")
    .replace(/^[,.;:!?-]+\s*/g, "")
    .replace(/\s*[,;:!?-]+$/g, "")
    .trim();

  if (/^(?:del\s*[abcd]|jf\.?\s*del\s*[abcd])$/i.test(text)) return "";
  return text;
}

function extractFeedbackBullets(feedbackRaw: unknown): string[] {
  const text = asText(feedbackRaw);
  if (!text) return [];
  const lines = text.split(/\r?\n/).map((line) => line.trim());
  const sectionBullets: string[] = [];
  const allBullets: string[] = [];
  let inRelevantSection = false;

  for (const line of lines) {
    const lower = line.toLowerCase();
    if (lower.startsWith("det kan forbedres")) {
      inRelevantSection = true;
      continue;
    }
    if (lower.startsWith("forslag til næste skridt")) {
      inRelevantSection = true;
      continue;
    }
    if (line.endsWith(":")) {
      inRelevantSection = false;
    }
    if (!line.startsWith("- ")) continue;
    const cleanedRaw = cleanFeedbackEvidenceText(line.slice(2).trim());
    const clean = clampWithEllipsis(cleanedRaw, 160);
    if (!clean) continue;
    allBullets.push(clean);
    if (inRelevantSection) sectionBullets.push(clean);
  }

  const source = sectionBullets.length > 0 ? sectionBullets : allBullets;
  const out: string[] = [];
  const seen = new Set<string>();
  for (const bullet of source) {
    const k = bullet.toLowerCase();
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(bullet);
    if (out.length >= 4) break;
  }
  return out;
}

function normalizeFeedbackBullet(raw: string): string {
  return String(raw ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9æøå\s]/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function commonPrefixLenQuote(a: string, b: string): number {
  const max = Math.min(a.length, b.length);
  let i = 0;
  while (i < max && a.charCodeAt(i) === b.charCodeAt(i)) i += 1;
  return i;
}

function dedupeNearFeedbackBullets(bullets: string[]): string[] {
  const kept: Array<{ raw: string; norm: string }> = [];
  const MIN_LONG_SHARED_PREFIX = 40;

  for (const raw of bullets) {
    const norm = normalizeFeedbackBullet(raw);
    if (!norm) continue;

    let shouldSkip = false;
    for (let i = 0; i < kept.length; i += 1) {
      const prev = kept[i];
      const isPrefix = prev.norm.startsWith(norm) || norm.startsWith(prev.norm);
      const hasLongCommonStart = commonPrefixLen(prev.norm, norm) >= MIN_LONG_SHARED_PREFIX;
      if (!isPrefix && !hasLongCommonStart) continue;

      // Samme pointe: behold den mest konkrete/længste, men bevar positionen.
      if (norm.length > prev.norm.length) {
        kept[i] = { raw, norm };
      }
      shouldSkip = true;
      break;
    }

    if (!shouldSkip) {
      kept.push({ raw, norm });
    }
  }

  return kept.map((item) => item.raw);
}

function getWeakPointSeeds(session: SessionRow): Array<{ key: string; label: string; action: string | null }> {
  return getWeakPointListFromSession(session)
    .map((raw) => toWeakPointSeed(raw))
    .filter((point): point is { key: string; label: string; action: string | null } => !!point);
}

function sessionHasWeakPoint(session: SessionRow, focusKey: string): boolean {
  const needle = String(focusKey ?? "").trim().toLowerCase();
  if (!needle) return false;
  return getWeakPointSeeds(session).some((point) => point.key === needle);
}

function deriveFeedbackEvidenceForFocus(sessions: SessionRow[], focus: WeakPointItem): string[] {
  const focusTokens = `${focus.label} ${focus.action ?? ""}`
    .toLowerCase()
    .split(/[^a-z0-9æøå-]+/i)
    .map((t) => t.trim())
    .filter((t) => t.length >= 4)
    .slice(0, 6);

  const relevantCandidates: string[] = [];
  const fallbackCandidates: string[] = [];
  for (const session of sessions) {
    const bullets = extractFeedbackBullets(session.feedback);
    for (const bullet of bullets) {
      const lower = bullet.toLowerCase();
      const isRelevant =
        focusTokens.length === 0 || focusTokens.some((token) => lower.includes(token)) || lower.includes(focus.key);
      if (isRelevant) relevantCandidates.push(bullet);
      fallbackCandidates.push(bullet);
    }
  }

  const relevantDeduped = dedupeNearFeedbackBullets(relevantCandidates);
  if (relevantDeduped.length > 0) return relevantDeduped.slice(0, 2);

  return dedupeNearFeedbackBullets(fallbackCandidates).slice(0, 2);
}

function parsePageFromSource(raw: string | null): string | undefined {
  const text = asText(raw).toLowerCase();
  if (!text) return undefined;
  const m = text.match(/(?:side|s\.|p\.)\s*(\d{1,4})/i);
  return m?.[1];
}

function asFiniteNumber(v: unknown): number | null {
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : null;
}

function parsePageValue(v: unknown): number | null {
  if (typeof v === "number") return Number.isFinite(v) ? Math.floor(v) : null;
  const text = asText(v);
  if (!text) return null;
  const m = text.match(/\d{1,5}/);
  if (!m) return null;
  const n = Number(m[0]);
  return Number.isFinite(n) ? n : null;
}

function normalizePositionLabel(v: unknown): string | null {
  const raw = asText(v).toLowerCase();
  if (!raw) return null;
  if (raw.includes("top") || raw.includes("øver") || raw.includes("ovre")) return "øverst på siden";
  if (raw.includes("bund") || raw.includes("bottom") || raw.includes("neder")) return "nederst på siden";
  if (raw.includes("mid") || raw.includes("middle") || raw.includes("midt")) return "midt på siden";
  const asNum = asFiniteNumber(v);
  if (asNum !== null) {
    if (asNum <= 0.33) return "øverst på siden";
    if (asNum >= 0.67) return "nederst på siden";
    return "midt på siden";
  }
  return null;
}

function formatPageRange(label: string, from: number | null, to: number | null): string | null {
  if (from == null && to == null) return null;
  if (from != null && to != null && from !== to) return `${label} ${from}\u2013${to}`;
  return `${label} ${from ?? to}`;
}

function buildReadLocationLabel(
  snippet: ChunkSnippetItem | null,
  citation: ReadingRefItem | null,
): string | null {
  const pdfFrom = parsePageValue(snippet?.pageFrom ?? snippet?.page ?? snippet?.sourcePage ?? citation?.page_from ?? citation?.page ?? citation?.source_page);
  const pdfTo = parsePageValue(snippet?.pageTo ?? citation?.page_to);
  const printedFrom = parsePageValue(snippet?.printedPageFrom ?? snippet?.printedPage ?? citation?.printed_page_from ?? citation?.printed_page);
  const printedTo = parsePageValue(snippet?.printedPageTo ?? citation?.printed_page_to);

  const printedLabelRaw = asText(snippet?.printedPageLabel ?? citation?.printed_page_label) || null;
  const pdfLabelRaw = asText(snippet?.sourcePageLabel ?? snippet?.pageLabel ?? citation?.source_page_label ?? citation?.page_label) || null;
  const position = normalizePositionLabel(snippet?.position ?? citation?.position);

  const parts: string[] = [];
  if (printedLabelRaw) parts.push(printedLabelRaw);
  else {
    const p = formatPageRange("Trykt side", printedFrom, printedTo);
    if (p) parts.push(p);
  }

  if (pdfLabelRaw) parts.push(pdfLabelRaw);
  else {
    const label = parts.length > 0 ? "PDF-side" : "Side";
    const p = formatPageRange(label, pdfFrom, pdfTo);
    if (p) parts.push(p);
  }

  if (position) parts.push(position);
  if (parts.length === 0) return null;
  return parts.join(" · ");
}

function isGenericActionText(action: string): boolean {
  const n = normalizeFeedbackBullet(action);
  if (!n) return true;
  return (
    n.includes("gør 1 forbedring tydelig") ||
    n.includes("tilføj 1 konkret eksempel som belæg") ||
    n.includes("bygg videre på feedback")
  );
}

function deriveFocusSpecificActionsFromTitle(title: string): [string, string] {
  const n = normalizeFeedbackBullet(title);

  if (n.includes("tekst") || n.includes("citat") || n.includes("dokument") || n.includes("henvis")) {
    return [
      "Indsæt 1 direkte citat og forklar hvad det viser.",
      "Nævn side/linje og bind det til din pointe.",
    ];
  }

  if (n.includes("analyse") || n.includes("dybde") || n.includes("forklar") || n.includes("perspektiv")) {
    return [
      "Forklar hvorfor (årsag -> konsekvens).",
      "Tilføj 1 alternativ forklaring/perspektiv.",
    ];
  }

  if (n.includes("begreb")) {
    return [
      "Definér 2 nøglebegreber.",
      "Anvend dem på casen med 1 sætning hver.",
    ];
  }

  return [
    `Gør "${title}" tydelig i din hovedpointe.`,
    `Tilføj 1 konkret belæg der viser "${title.toLowerCase()}".`,
  ];
}

function resolveFocusActions(title: string, actions: string[]): [string, string] {
  const clean = actions
    .map((action) => asText(action))
    .filter(Boolean)
    .filter((action) => !isGenericActionText(action));
  const deduped: string[] = [];
  const seen = new Set<string>();
  for (const action of clean) {
    const k = normalizeFeedbackBullet(action);
    if (!k || seen.has(k)) continue;
    seen.add(k);
    deduped.push(action);
  }
  if (deduped.length >= 2) return [deduped[0], deduped[1]];
  if (deduped.length === 1) {
    const fallback = deriveFocusSpecificActionsFromTitle(title);
    if (normalizeFeedbackBullet(fallback[0]) !== normalizeFeedbackBullet(deduped[0])) return [deduped[0], fallback[0]];
    return [deduped[0], fallback[1]];
  }
  return deriveFocusSpecificActionsFromTitle(title);
}

function getSuggestionCopy(focusTitle: string | null): {
  improvement: string;
  example: string;
  shortExplanation: string;
} {
  const n = normalizeFeedbackBullet(focusTitle ?? "");

  if (n.includes("teksthenvis") || n.includes("tekst") || n.includes("citat")) {
    return {
      improvement: "Underbyg din pointe med tydelig teksthenvisning tidligt i svaret.",
      example: "Indsæt et kort citat og forklar præcist, hvad det viser.",
      shortExplanation: "Det gør din argumentation mere dokumenteret og troværdig.",
    };
  }

  if (n.includes("analyse") || n.includes("dybde") || n.includes("forklar")) {
    return {
      improvement: "Gå et lag dybere ved at forklare hvorfor, ikke kun hvad.",
      example: "Vis sammenhængen mellem årsag og konsekvens i ét konkret led.",
      shortExplanation: "Det løfter svaret fra observation til egentlig analyse.",
    };
  }

  if (n.includes("begreb")) {
    return {
      improvement: "Brug centrale begreber mere præcist og konsekvent gennem svaret.",
      example: "Definér et nøglebegreb kort og anvend det direkte på teksten.",
      shortExplanation: "Det gør din faglighed tydeligere og mere målbar.",
    };
  }

  return {
    improvement: "Gør din hovedpointe tydeligere i første del af svaret.",
    example: "Tilføj et konkret tekstbelæg til påstanden.",
    shortExplanation: "Det gør argumentet lettere at følge.",
  };
}

function deriveQuoteKeywordsFromFeedback(
  feedbackBullets: string[],
): { keywords: Array<{ term: string; weight: number }>; emotionFocus: boolean } {
  const stopWords = new Set([
    "ikke",
    "eller",
    "fordi",
    "derfor",
    "skal",
    "dette",
    "denne",
    "næste",
    "svar",
    "mere",
    "meget",
    "med",
    "fra",
    "som",
    "for",
    "til",
    "det",
    "de",
    "du",
    "din",
    "dit",
    "af",
    "at",
    "en",
    "et",
    "på",
    "og",
    "i",
  ]);
  const termWeights = new Map<string, number>();
  const emotionTokens = ["følelse", "følelser", "mave", "sygdom", "sorg", "angst", "nervøs"];
  let emotionFocus = false;

  for (let i = 0; i < feedbackBullets.length; i += 1) {
    const bullet = feedbackBullets[i];
    const priorityBoost = i === 0 ? 1.4 : 1;
    const normalized = normalizeFeedbackBullet(bullet);
    if (!normalized) continue;
    const words = normalized.split(" ").filter(Boolean);
    emotionFocus = emotionFocus || emotionTokens.some((t) => normalized.includes(t));

    for (const word of words) {
      if (word.length < 4 || stopWords.has(word)) continue;
      termWeights.set(word, (termWeights.get(word) ?? 0) + 1 * priorityBoost);
    }

    for (let j = 0; j < words.length - 1; j += 1) {
      const a = words[j];
      const b = words[j + 1];
      if (a.length < 4 || b.length < 4 || stopWords.has(a) || stopWords.has(b)) continue;
      const phrase = `${a} ${b}`;
      termWeights.set(phrase, (termWeights.get(phrase) ?? 0) + 1.5 * priorityBoost);
    }
  }

  const keywords = Array.from(termWeights.entries())
    .sort((a, b) => b[1] - a[1] || b[0].length - a[0].length)
    .slice(0, 14)
    .map(([term, weight]) => ({ term, weight }));

  return { keywords, emotionFocus };
}

function deriveFeedbackKeywordCsv(feedbackBullets: string[]): string {
  const { keywords } = deriveQuoteKeywordsFromFeedback(feedbackBullets);
  return keywords
    .map((k) => k.term)
    .filter((term) => term.length >= 4)
    .slice(0, 8)
    .join(",");
}

function normalizeSnippetForCompare(text: string): string {
  return normalizeFeedbackBullet(text).replace(/\s+/g, " ").trim();
}

function commonPrefixLen(a: string, b: string): number {
  const max = Math.min(a.length, b.length);
  let i = 0;
  while (i < max && a[i] === b[i]) i += 1;
  return i;
}

function isQuoteTooSimilar(candidate: QuotePick, selected: QuotePick[]): boolean {
  const candidateChunk = asText(candidate.chunkId);
  const candidateTitle = normalizeFeedbackBullet(candidate.title);
  const candidatePageFrom = asText(candidate.pageFrom ?? candidate.page);
  const candidatePageTo = asText(candidate.pageTo ?? candidate.pageFrom ?? candidate.page);
  const candidateText = normalizeSnippetForCompare(candidate.snippet);

  return selected.some((s) => {
    const selectedChunk = asText(s.chunkId);
    if (candidateChunk && selectedChunk && candidateChunk === selectedChunk) return true;

    const selectedTitle = normalizeFeedbackBullet(s.title);
    const selectedPageFrom = asText(s.pageFrom ?? s.page);
    const selectedPageTo = asText(s.pageTo ?? s.pageFrom ?? s.page);
    if (
      candidateTitle &&
      selectedTitle &&
      candidateTitle === selectedTitle &&
      candidatePageFrom &&
      selectedPageFrom &&
      candidatePageFrom === selectedPageFrom &&
      candidatePageTo === selectedPageTo
    ) {
      return true;
    }

    const selectedText = normalizeSnippetForCompare(s.snippet);
    if (!candidateText || !selectedText) return false;
    if (candidateText === selectedText) return true;
    const prefix = commonPrefixLenQuote(candidateText, selectedText);
    return prefix >= 40;
  });
}

function rankQuotesForFeedback(feedbackBullets: string[], candidateSnippets: QuoteCandidate[]): QuotePick[] {
  if (!candidateSnippets.length) return [];
  const { keywords, emotionFocus } = deriveQuoteKeywordsFromFeedback(feedbackBullets);
  if (keywords.length === 0) return [];

  const strongContrast = ["ville have", "kunne have", "hvad hvis", "alternativt", "i stedet"];
  const bodilyWords = ["mave", "sygdom", "følelser"];
  const ranked: QuotePick[] = [];

  for (const candidate of candidateSnippets) {
    const text = asText(candidate.text);
    if (!text) continue;
    const normText = normalizeFeedbackBullet(text);
    if (!normText) continue;

    let score = 0;
    const matchedKeywords: string[] = [];
    for (const keyword of keywords) {
      const nk = normalizeFeedbackBullet(keyword.term);
      if (!nk || !normText.includes(nk)) continue;
      matchedKeywords.push(keyword.term);
      score += nk.includes(" ") ? 2.4 * keyword.weight : 1.2 * keyword.weight;
    }

    if (text.includes("?")) score += 1.5;
    if (strongContrast.some((kw) => normText.includes(normalizeFeedbackBullet(kw)))) score += 1.5;
    if (!emotionFocus && bodilyWords.some((w) => normText.includes(normalizeFeedbackBullet(w)))) score -= 2;

    const snippet = clampWithEllipsis(text, 180);
    ranked.push({
      chunkId: candidate.chunkId ?? null,
      snippet,
      title: candidate.title,
      ...(candidate.page ? { page: candidate.page } : {}),
      pageFrom: candidate.pageFrom ?? null,
      pageTo: candidate.pageTo ?? null,
      url: candidate.url ?? null,
      pageLabel: candidate.pageLabel ?? null,
      sourcePageLabel: candidate.sourcePageLabel ?? null,
      printedPage: candidate.printedPage ?? null,
      printedPageLabel: candidate.printedPageLabel ?? null,
      position: candidate.position ?? null,
      chosenScore: score,
      matchedKeywords,
    });
  }

  return ranked.sort((a, b) => b.chosenScore - a.chosenScore || b.snippet.length - a.snippet.length);
}

function pickQuoteForFeedback(
  feedbackBullets: string[],
  candidateSnippets: QuoteCandidate[],
  selectedQuotes: QuotePick[] = [],
): QuotePick | null {
  const ranked = rankQuotesForFeedback(feedbackBullets, candidateSnippets);
  if (!ranked.length) return null;

  const MIN_SCORE = 2.2;
  const preferredDistinct = ranked.find((r) => r.chosenScore >= MIN_SCORE && !isQuoteTooSimilar(r, selectedQuotes));
  if (preferredDistinct) return preferredDistinct;

  const bestDistinct = ranked.find((r) => !isQuoteTooSimilar(r, selectedQuotes));
  if (bestDistinct) return bestDistinct;

  return ranked[0];
}

function daysSince(iso: string | null): number | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return Math.max(0, Math.floor((Date.now() - d.getTime()) / 86_400_000));
}

function sinceLabel(iso: string | null): string {
  const d = daysSince(iso);
  if (d === null) return "Aldrig";
  if (d === 0) return "I dag";
  if (d === 1) return "For 1 dag siden";
  return `For ${d} dage siden`;
}

function formatDate(iso: string | null): string {
  if (!iso) return "Ukendt dato";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "Ukendt dato";
  return d.toLocaleDateString("da-DK", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  });
}

function focusText(item: FolderStats): string {
  if (item.attempts_total === 0) return "Ikke startet endnu";
  const avg = item.avg_last5;
  if (avg === null) return "Ikke startet endnu";
  if (avg < 40) return "Fokus: grundforståelse";
  if (avg < 60) return "Fokus: struktur og begreber";
  if (avg < 75) return "Fokus: tekstnær dokumentation";
  return "Fokus: finpudsning";
}

function focusBadgeClass(item: FolderStats, tone?: "neutral" | "low" | "medium" | "high"): string {
  if (tone === "high") return "bg-red-50 text-red-700 border-red-200";
  if (tone === "medium") return "bg-amber-50 text-amber-700 border-amber-200";
  if (tone === "low") return "bg-yellow-50 text-yellow-700 border-yellow-200";
  if (tone === "neutral") return "bg-zinc-100 text-zinc-700 border-zinc-200";
  if (item.attempts_total === 0 || item.avg_last5 === null) {
    return "bg-zinc-100 text-zinc-700 border-zinc-200";
  }
  if (item.avg_last5 < 40) return "bg-red-50 text-red-700 border-red-200";
  if (item.avg_last5 < 60) return "bg-amber-50 text-amber-700 border-amber-200";
  if (item.avg_last5 < 75) return "bg-yellow-50 text-yellow-700 border-yellow-200";
  return "bg-emerald-50 text-emerald-700 border-emerald-200";
}

function nextExerciseText(item: FolderStats): string {
  if (item.attempts_total === 0) return "Start med 1 kort træning (10-15 min)";
  const avg = item.avg_last5;
  if (avg === null || avg < 50) {
    return "Lav 1 træning med fokus på disposition + nøglebegreber";
  }
  if (avg < 70) return "Lav 1 træning med fokus på tekstbelæg/citater";
  return "Lav 1 træning og fokuser på præcision + konklusion";
}

function toWeakPointSeed(raw: unknown): { key: string; label: string; action: string | null } | null {
  if (typeof raw === "string") {
    const label = raw.trim();
    if (!label) return null;
    return { key: label.toLowerCase(), label, action: null };
  }

  const obj = asRecord(raw);
  if (!obj) return null;
  const keyRaw = String(obj.key ?? "").trim();
  const labelRaw = String(obj.label ?? obj.text ?? obj.key ?? "").trim();
  const actionRaw = String(obj.action ?? "").trim();
  const label = labelRaw || keyRaw;
  if (!label) return null;

  return {
    key: (keyRaw || label).toLowerCase(),
    label,
    action: actionRaw || null,
  };
}

function getWeakPointListFromSession(session: SessionRow): unknown[] {
  const metadata = asRecord(session.metadata);
  const structured = asRecord(session.feedback_structured);
  const meta = asRecord(session.meta);
  const evaluationMeta = asRecord(session.evaluation_meta);
  const feedbackMeta = asRecord(session.feedback_meta);

  const candidates = [
    metadata?.weak_points,
    structured?.weak_points,
    meta?.weak_points,
    evaluationMeta?.weak_points,
    feedbackMeta?.weak_points,
  ];

  for (const candidate of candidates) {
    const list = asWeakPointRawList(candidate);
    if (list.length > 0) return list;
  }
  return [];
}

function normalizeReadingRef(raw: unknown): ReadingRefItem | null {
  const obj = asRecord(raw);
  if (!obj) return null;

  const chunkId = asText(obj.chunk_id ?? obj.chunkId);
  const fileId = asText(obj.file_id ?? obj.fileId) || null;
  const title = asText(obj.title) || null;
  if (!chunkId && !title) return null;

  const url = asText(obj.url) || null;
  const snippet = asText(obj.snippet ?? obj.excerpt) || null;
  const why = asText(obj.why) || null;
  const practicePrompt = asText(obj.practice_prompt) || null;
  const countRaw = Number(obj.count);
  const count = Number.isFinite(countRaw) && countRaw > 0 ? Math.floor(countRaw) : 1;
  const tags = Array.isArray(obj.tags)
    ? obj.tags.map((tag) => asText(tag)).filter(Boolean).slice(0, 5)
    : [];

  return {
    chunk_id: chunkId || `title:${(title ?? "").toLowerCase()}`,
    file_id: fileId,
    title,
    url,
    snippet,
    why,
    practice_prompt: practicePrompt,
    count,
    tags,
    page: asStringOrNumber(obj.page),
    page_from: asStringOrNumber(obj.page_from ?? obj.pageFrom),
    page_to: asStringOrNumber(obj.page_to ?? obj.pageTo),
    source_page: asStringOrNumber(obj.source_page ?? obj.sourcePage),
    page_label: asText(obj.page_label ?? obj.pageLabel) || null,
    source_page_label: asText(obj.source_page_label ?? obj.sourcePageLabel) || null,
    printed_page: asStringOrNumber(obj.printed_page ?? obj.printedPage),
    printed_page_from: asStringOrNumber(obj.printed_page_from ?? obj.printedPageFrom),
    printed_page_to: asStringOrNumber(obj.printed_page_to ?? obj.printedPageTo),
    printed_page_label: asText(obj.printed_page_label ?? obj.printedPageLabel) || null,
    position: asText(obj.position ?? obj.page_position ?? obj.pagePosition) || null,
  };
}

function deriveRepeatedWeakPoints(sessions: SessionRow[]): WeakPointItem[] {
  const acc = new Map<string, WeakPointItem>();

  for (const session of sessions) {
    const rawPoints = getWeakPointListFromSession(session);
    for (const raw of rawPoints) {
      const parsed = toWeakPointSeed(raw);
      if (!parsed) continue;
      const existing = acc.get(parsed.key);
      if (existing) {
        existing.count += 1;
        if (!existing.action && parsed.action) {
          existing.action = parsed.action;
        }
      } else {
        acc.set(parsed.key, {
          key: parsed.key,
          label: parsed.label,
          action: parsed.action,
          count: 1,
        });
      }
    }
  }

  return Array.from(acc.values()).sort(
    (a, b) => b.count - a.count || a.label.localeCompare(b.label, "da"),
  );
}

function getCitationRawListFromSession(session: SessionRow): unknown[] {
  const metadata = asRecord(session.metadata);
  const meta = asRecord(session.meta);
  if (Array.isArray(metadata?.citations)) return metadata.citations as unknown[];
  if (Array.isArray(meta?.citations)) return meta.citations as unknown[];
  return [];
}

function deriveReadingRefsFromSessions(sessions: SessionRow[]): ReadingRefItem[] {
  const acc = new Map<string, ReadingRefItem>();

  for (const session of sessions) {
    const refsRaw = getCitationRawListFromSession(session);

    for (const raw of refsRaw) {
      const normalized = normalizeReadingRef(raw);
      if (!normalized) continue;
      const existing = acc.get(normalized.chunk_id);
      if (existing) {
        existing.count += 1;
        if (!existing.snippet && normalized.snippet) existing.snippet = normalized.snippet;
        if (!existing.file_id && normalized.file_id) existing.file_id = normalized.file_id;
        if (!existing.page && normalized.page) existing.page = normalized.page;
        if (!existing.page_from && normalized.page_from) existing.page_from = normalized.page_from;
        if (!existing.page_to && normalized.page_to) existing.page_to = normalized.page_to;
        if (!existing.source_page && normalized.source_page) existing.source_page = normalized.source_page;
        if (!existing.page_label && normalized.page_label) existing.page_label = normalized.page_label;
        if (!existing.source_page_label && normalized.source_page_label) existing.source_page_label = normalized.source_page_label;
        if (!existing.printed_page && normalized.printed_page) existing.printed_page = normalized.printed_page;
        if (!existing.printed_page_from && normalized.printed_page_from) existing.printed_page_from = normalized.printed_page_from;
        if (!existing.printed_page_to && normalized.printed_page_to) existing.printed_page_to = normalized.printed_page_to;
        if (!existing.printed_page_label && normalized.printed_page_label) existing.printed_page_label = normalized.printed_page_label;
        if (!existing.position && normalized.position) existing.position = normalized.position;
      } else {
        acc.set(normalized.chunk_id, normalized);
      }
    }
  }

  return Array.from(acc.values()).sort((a, b) => b.count - a.count);
}

function deriveTrendDelta(sessions: SessionRow[]): number | null {
  const points = sessions
    .filter(
      (s): s is SessionRow & { score: number; created_at: string } =>
        typeof s.score === "number" &&
        Number.isFinite(s.score) &&
        typeof s.created_at === "string" &&
        !Number.isNaN(new Date(s.created_at).getTime()),
    )
    .slice()
    .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());

  if (points.length < 2) return null;

  if (points.length >= 10) {
    const recent = points.slice(0, 5).map((p) => p.score);
    const prev = points.slice(5, 10).map((p) => p.score);
    const avgRecent = recent.reduce((sum, n) => sum + n, 0) / recent.length;
    const avgPrev = prev.reduce((sum, n) => sum + n, 0) / prev.length;
    return Math.round(avgRecent - avgPrev);
  }

  return Math.round(points[0].score - points[points.length - 1].score);
}

function buildScorePoints(sessions: SessionRow[], limit = 20): ScorePoint[] {
  return sessions
    .filter(
      (s): s is SessionRow & { score: number; created_at: string } =>
        typeof s.score === "number" && Number.isFinite(s.score) && typeof s.created_at === "string",
    )
    .slice(0, limit)
    .reverse()
    .map((s) => ({
      id: s.id,
      score: Math.max(0, Math.min(100, s.score)),
      created_at: s.created_at,
    }));
}

function deriveStatsFromSessions(sessions: SessionRow[]): FolderStats {
  const nonNullScores = sessions
    .map((s) => s.score)
    .filter((n): n is number => typeof n === "number" && Number.isFinite(n))
    .slice(0, 5);
  const avg_last5 =
    nonNullScores.length > 0
      ? nonNullScores.reduce((sum, n) => sum + n, 0) / nonNullScores.length
      : null;

  return {
    attempts_total: sessions.length,
    avg_last5,
    last_trained_at: sessions[0]?.created_at ?? null,
  };
}

function FolderProgressChart({ points }: { points: ScorePoint[] }) {
  if (points.length < 2) {
    return (
      <div className="rounded-lg border border-dashed border-zinc-300 bg-zinc-50 px-3 py-4 text-xs text-zinc-600">
        {COPY.chartEmpty}
      </div>
    );
  }

  const width = 720;
  const height = 220;
  const padX = 30;
  const padY = 22;
  const innerW = width - padX * 2;
  const innerH = height - padY * 2;
  const min = Math.min(...points.map((p) => p.score));
  const max = Math.max(...points.map((p) => p.score));
  const range = Math.max(1, max - min);

  const toX = (index: number) =>
    points.length === 1 ? padX : padX + (index / (points.length - 1)) * innerW;
  const toY = (score: number) => padY + (1 - (score - min) / range) * innerH;

  const polyline = points.map((p, i) => `${toX(i)},${toY(p.score)}`).join(" ");

  return (
    <div className="rounded-lg border border-zinc-200 bg-white p-3">
      <svg viewBox={`0 0 ${width} ${height}`} className="h-52 w-full min-w-0" role="img" aria-label="Score over tid">
        <line x1={padX} y1={height - padY} x2={width - padX} y2={height - padY} stroke="#d4d4d8" />
        <line x1={padX} y1={padY} x2={padX} y2={height - padY} stroke="#d4d4d8" />
        <polyline fill="none" stroke="#18181b" strokeWidth="2.5" points={polyline} />
        {points.map((p, i) => (
          <g key={p.id}>
            <circle cx={toX(i)} cy={toY(p.score)} r="3.5" fill="#18181b">
              <title>{`${formatDate(p.created_at)}: ${Math.round(p.score)}`}</title>
            </circle>
          </g>
        ))}
        <text x={padX} y={padY - 6} fontSize="11" fill="#71717a">
          {Math.round(max)}
        </text>
        <text x={padX} y={height - padY + 14} fontSize="11" fill="#71717a">
          {Math.round(min)}
        </text>
      </svg>
      <p className="mt-2 text-xs text-zinc-500">{COPY.chartHint}</p>
    </div>
  );
}

type MappeIndsigtClientProps = {
  folderId: string;
};

export default function MappeIndsigtClient({ folderId }: MappeIndsigtClientProps) {
  const [overviewItem, setOverviewItem] = useState<OverviewItem | null>(null);
  const [sessions, setSessions] = useState<SessionRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [chunkSnippet, setChunkSnippet] = useState<ChunkSnippetItem | null>(null);
  const [snippetLoading, setSnippetLoading] = useState(false);
  const [snippetError, setSnippetError] = useState<string | null>(null);
  const [showLongSnippet, setShowLongSnippet] = useState(false);
  const [longSnippetItems, setLongSnippetItems] = useState<ChunkSnippetItem[]>([]);
  const [longSnippetLoading, setLongSnippetLoading] = useState(false);
  const [longSnippetError, setLongSnippetError] = useState<string | null>(null);
  const [longSnippetCopied, setLongSnippetCopied] = useState(false);
  const [focusEvidenceByKey, setFocusEvidenceByKey] = useState<Record<string, FocusEvidenceText>>({});
  const longCopyResetTimerRef = useRef<number | null>(null);

  useEffect(() => {
    let active = true;

    async function run() {
      setLoading(true);
      setError(null);

      try {
        const [overviewRes, sessionsRes] = await Promise.all([
          fetch(`/api/exam-sessions?mode=overview&source_types=${SOURCE_TYPES}`, {
            method: "GET",
            cache: "no-store",
          }),
          fetch(
            `/api/exam-sessions?source_types=${SOURCE_TYPES}&include_meta=1&folder_id=${encodeURIComponent(folderId)}&limit=50`,
            {
              method: "GET",
              cache: "no-store",
            },
          ),
        ]);

        const overviewPayload = (await overviewRes.json().catch(() => ({}))) as OverviewResponse;
        const sessionPayload = (await sessionsRes.json().catch(() => ({}))) as SessionsResponse;

        if (!overviewRes.ok) {
          throw new Error(overviewPayload?.error || "Kunne ikke hente mappeoverblik.");
        }
        if (!sessionsRes.ok) {
          throw new Error(sessionPayload?.error || "Kunne ikke hente mappedetaljer.");
        }

        if (!active) return;

        const overviewItems = Array.isArray(overviewPayload.items) ? overviewPayload.items : [];
        const match = overviewItems.find((item) => item.folder_id === folderId) ?? null;
        setOverviewItem(match);

        const loadedSessions = Array.isArray(sessionPayload.sessions) ? sessionPayload.sessions : [];
        setSessions(loadedSessions);
      } catch (err: any) {
        if (!active) return;
        setOverviewItem(null);
        setSessions([]);
        setError(err?.message || "Ukendt fejl");
      } finally {
        if (active) setLoading(false);
      }
    }

    void run();
    return () => {
      active = false;
    };
  }, [folderId]);

  const fallbackStats = useMemo(() => deriveStatsFromSessions(sessions), [sessions]);
  const stats = useMemo<FolderStats>(() => {
    if (overviewItem) {
      return {
        attempts_total: overviewItem.attempts_total,
        avg_last5: overviewItem.avg_last5,
        last_trained_at: overviewItem.last_trained_at,
      };
    }
    return fallbackStats;
  }, [overviewItem, fallbackStats]);

  const title =
    overviewItem?.folder_title ||
    overviewItem?.folderName ||
    overviewItem?.folder_name ||
    COPY.pageTitleFallback;
  const trendDelta = useMemo(() => deriveTrendDelta(sessions), [sessions]);
  const scorePoints = useMemo(() => buildScorePoints(sessions, 20), [sessions]);
  const recent3 = useMemo(() => sessions.slice(0, 3), [sessions]);
  const focusWindowSessions = useMemo(() => sessions.slice(0, FOCUS_WINDOW_SIZE), [sessions]);
  const learningSummary = useMemo(
    () =>
      buildFolderLearningSummary(focusWindowSessions, {
        avgLast5: stats.avg_last5,
        attemptsTotal: stats.attempts_total,
      }),
    [focusWindowSessions, stats.avg_last5, stats.attempts_total],
  );
  const hasStructuredFocus = learningSummary.structured_session_count > 0 && learningSummary.top_issues.length > 0;
  const focus = useMemo(
    () => overviewItem?.focus_label || learningSummary.focus_label || focusText(stats),
    [overviewItem?.focus_label, learningSummary.focus_label, stats],
  );
  const nextStep = useMemo(
    () => overviewItem?.next_step_text || learningSummary.next_step_text || nextExerciseText(stats),
    [overviewItem?.next_step_text, learningSummary.next_step_text, stats],
  );
  const badgeTone = overviewItem?.focus_badge_tone || learningSummary.badge_tone;
  const canStartTargetedTraining = stats.attempts_total >= 2;
  const sessionsWithWeakPoints = useMemo(
    () =>
      hasStructuredFocus
        ? learningSummary.sessions_with_focus
        : focusWindowSessions.filter((s) => getWeakPointListFromSession(s).length > 0).length,
    [focusWindowSessions, hasStructuredFocus, learningSummary.sessions_with_focus],
  );
  const repeatedWeakPoints = useMemo(() => deriveRepeatedWeakPoints(focusWindowSessions), [focusWindowSessions]);
  const topTwoWeakPoints = useMemo(() => repeatedWeakPoints.slice(0, 2), [repeatedWeakPoints]);
  const topWeakPoint = topTwoWeakPoints[0] ?? null;
  const focusSeeds = useMemo<FocusSeed[]>(() => {
    return topTwoWeakPoints.map((focusItem) => {
      const relevantSessions = focusWindowSessions
        .filter((session) => sessionHasWeakPoint(session, focusItem.key))
        .slice(0, 8);
      const focusGuide = getFocusUiGuide(focusItem.key, focusItem.label);
      const citation = deriveReadingRefsFromSessions(relevantSessions)[0] ?? null;
      const titleKeywords = String(citation?.title ?? "")
        .toLowerCase()
        .split(/[^a-z0-9æøå-]+/i)
        .map((w) => w.trim())
        .filter((w) => w.length >= 4)
        .slice(0, 2);
      const merged = [...getSnippetKeywordsForFocus(focusItem), ...titleKeywords];
      const mergedKeywords: string[] = [];
      const seen = new Set<string>();
      for (const kw of merged) {
        if (!kw || seen.has(kw)) continue;
        seen.add(kw);
        mergedKeywords.push(kw);
        if (mergedKeywords.length >= 10) break;
      }

      const feedbackEvidence = deriveFeedbackEvidenceForFocus(relevantSessions, focusItem);
      const description = focusItem.action || `Fokusér på ${focusItem.label.toLowerCase()} i dit næste svar.`;
      return {
        key: focusItem.key,
        title: focusItem.label,
        description,
        count: focusItem.count,
        evidenceFeedback:
          feedbackEvidence.length > 0 ? feedbackEvidence : ["Byg videre på feedback fra de seneste vurderinger i mappen."],
        actions: focusGuide.doNow,
        templatePrefill: focusGuide.templatePrefill,
        citation,
        snippetKeywordsCsv: mergedKeywords.join(","),
      };
    });
  }, [topTwoWeakPoints, focusWindowSessions]);
  const citationRefs = useMemo(
    () => (hasStructuredFocus ? learningSummary.reading_refs : deriveReadingRefsFromSessions(focusWindowSessions)),
    [focusWindowSessions, hasStructuredFocus, learningSummary.reading_refs],
  );
  const topCitation = citationRefs[0] ?? null;
  const structuredFocusInsights = useMemo<FocusInsight[]>(() => {
    return learningSummary.top_issues.slice(0, 2).map((issue) => {
      const primaryCitation = issue.citations[0] ?? topCitation ?? null;
      const citationSnippet = wholeSentenceOrEmpty(
        asText(primaryCitation?.snippet) || asText(primaryCitation?.why) || issue.evidence[0] || issue.reason,
        220,
      );
      const page =
        asText(primaryCitation?.page_from ?? primaryCitation?.page ?? primaryCitation?.source_page) ||
        parsePageFromSource(primaryCitation?.title ?? null);
      const actions = resolveFocusActions(issue.label, [
        wholeSentenceOrEmpty(issue.repair, 180) || issue.repair,
        issue.evidence_specificity === "general"
          ? wholeSentenceOrEmpty(issue.next_best_action || learningSummary.next_training_text || "", 180) ||
            issue.next_best_action ||
            learningSummary.next_training_text ||
            ""
          : wholeSentenceOrEmpty(issue.example || issue.next_best_action || learningSummary.next_training_text || "", 180) ||
            issue.example ||
            issue.next_best_action ||
            learningSummary.next_training_text ||
            "",
      ]);

      return {
        key: issue.key,
        title: issue.label,
        description:
          wholeSentenceOrEmpty(issue.reason, 220) ||
          wholeSentenceOrEmpty(issue.repair, 220) ||
          wholeSentenceOrEmpty(issue.evidence_bridge, 220) ||
          `Fokusér på ${issue.label.toLowerCase()} i dit næste svar.`,
        count: issue.count,
        evidenceFeedback: issue.evidence.length > 0 ? issue.evidence : [issue.reason],
        evidenceBridge: issue.evidence_bridge ?? null,
        evidenceSpecificity: issue.evidence_specificity,
        evidenceText: primaryCitation && citationSnippet
          ? {
              title: primaryCitation.title || "Kilde",
              snippet: citationSnippet,
              ...(page ? { page } : {}),
              url: primaryCitation.url ?? null,
            }
          : null,
        actions,
        templatePrefill: {
          improvement:
            wholeSentenceOrEmpty(issue.repair, 180) ||
            learningSummary.suggestion_prefill.improvement,
          example:
            wholeSentenceOrEmpty(issue.example, 180) ||
            (issue.evidence_specificity === "general"
              ? wholeSentenceOrEmpty(issue.evidence_bridge, 180)
              : "") ||
            learningSummary.suggestion_prefill.example,
          shortExplanation:
            wholeSentenceOrEmpty(issue.reason, 180) ||
            learningSummary.suggestion_prefill.shortExplanation,
        },
      };
    });
  }, [learningSummary, topCitation]);
  const legacyTopFocusInsights = useMemo<FocusInsight[]>(() => {
    return focusSeeds.map((seed) => ({
      key: seed.key,
      title: seed.title,
      description: seed.description,
      count: seed.count,
      evidenceFeedback: seed.evidenceFeedback,
      evidenceBridge: null,
      evidenceSpecificity: "general",
      evidenceText: focusEvidenceByKey[seed.key] ?? null,
      actions: (() => {
        const resolved = resolveFocusActions(seed.title, [seed.actions[0], seed.actions[1]]);
        return [resolved[0], resolved[1]];
      })(),
      templatePrefill: seed.templatePrefill,
    }));
  }, [focusSeeds, focusEvidenceByKey]);
  const topFocusInsights = hasStructuredFocus ? structuredFocusInsights : legacyTopFocusInsights;
  const primaryFocusInsight = topFocusInsights[0] ?? null;
  const suggestionCopy = useMemo(
    () => (hasStructuredFocus ? learningSummary.suggestion_prefill : getSuggestionCopy(topFocusInsights[0]?.title ?? null)),
    [hasStructuredFocus, learningSummary.suggestion_prefill, topFocusInsights],
  );
  const focusReasonText = useMemo(
    () => wholeSentenceOrEmpty(learningSummary.focus_reason, 220) || learningSummary.focus_reason || "",
    [learningSummary.focus_reason],
  );
  const compactSuggestionCopy = useMemo(
    () => ({
      improvement:
        wholeSentenceOrEmpty(suggestionCopy.improvement, 180) ||
        "Gør din hovedpointe tydeligere i næste svar.",
      example:
        wholeSentenceOrEmpty(suggestionCopy.example, 180) ||
        "Underbyg din pointe med et kort tekstbelæg og forklar, hvad det viser.",
      shortExplanation:
        wholeSentenceOrEmpty(suggestionCopy.shortExplanation, 180) ||
        "Det gør svaret mere præcist og lettere at vurdere fagligt.",
    }),
    [suggestionCopy],
  );
  const trainingLead = useMemo(() => {
    const candidates = [
      wholeSentenceOrEmpty(primaryFocusInsight?.description, 200),
      wholeSentenceOrEmpty(learningSummary.next_training_text, 200),
      "Arbejd videre med dette fokus i dit næste svar.",
    ].filter(Boolean);
    return candidates.find((candidate) => !isDuplicateishCopy(candidate, [focusReasonText])) || candidates[0] || "";
  }, [focusReasonText, learningSummary.next_training_text, primaryFocusInsight?.description]);
  const trainingActions = useMemo(() => {
    const seen = new Set<string>();
    const blockers = [focusReasonText, trainingLead, primaryFocusInsight?.evidenceBridge];
    const filtered = (primaryFocusInsight?.actions ?? [])
      .map((action) => wholeSentenceOrEmpty(action, 180) || action)
      .filter(Boolean)
      .filter((action) => {
        const key = normalizedCopyKey(action);
        if (!key || seen.has(key)) return false;
        seen.add(key);
        return !isDuplicateishCopy(action, blockers);
      });
    return filtered.slice(0, 2);
  }, [focusReasonText, primaryFocusInsight?.actions, primaryFocusInsight?.evidenceBridge, trainingLead]);
  const visibleSuggestionLines = useMemo(() => {
    const blockers = [focusReasonText, trainingLead, ...trainingActions];
    const lines = [
      { label: "Forbedring", text: compactSuggestionCopy.improvement },
      { label: "Eksempel", text: compactSuggestionCopy.example },
      { label: "Kort forklaring", text: compactSuggestionCopy.shortExplanation },
    ];
    const seen = new Set<string>();
    return lines.filter((line) => {
      const text = wholeSentenceOrEmpty(line.text, 180) || line.text;
      const key = normalizedCopyKey(text);
      if (!key || seen.has(key)) return false;
      seen.add(key);
      return !isDuplicateishCopy(text, blockers);
    });
  }, [compactSuggestionCopy.example, compactSuggestionCopy.improvement, compactSuggestionCopy.shortExplanation, focusReasonText, trainingActions, trainingLead]);
  const visibleWritingTips = useMemo(() => {
    const blockers = [
      focusReasonText,
      trainingLead,
      primaryFocusInsight?.evidenceBridge,
      ...trainingActions,
      ...visibleSuggestionLines.map((line) => line.text),
      nextStep,
    ];
    const seen = new Set<string>();
    return learningSummary.writing_tips
      .map((tip) => wholeSentenceOrEmpty(tip, 180))
      .filter(Boolean)
      .filter((tip) => {
        const key = normalizedCopyKey(tip);
        if (!key || seen.has(key)) return false;
        seen.add(key);
        return !isDuplicateishCopy(tip, blockers);
      })
      .slice(0, 2);
  }, [focusReasonText, learningSummary.writing_tips, nextStep, primaryFocusInsight?.evidenceBridge, trainingActions, trainingLead, visibleSuggestionLines]);
  const nextStepChecklist = useMemo(() => {
    const blockers = [focusReasonText, trainingLead, primaryFocusInsight?.evidenceBridge, ...trainingActions, ...visibleSuggestionLines.map((line) => line.text)];
    const seen = new Set<string>();
    return [wholeSentenceOrEmpty(nextStep, 180) || nextStep, "Brug feedbacken aktivt i næste forsøg."]
      .filter(Boolean)
      .filter((item) => !isDuplicateishCopy(item, blockers))
      .filter((item) => {
        const key = normalizedCopyKey(item);
        if (!key || seen.has(key)) return false;
        seen.add(key);
        return true;
      });
  }, [focusReasonText, nextStep, primaryFocusInsight?.evidenceBridge, trainingActions, trainingLead, visibleSuggestionLines]);
  const topChunkId = useMemo(() => {
    const cid = String(topCitation?.chunk_id ?? "").trim();
    return isUuidLike(cid) ? cid : null;
  }, [topCitation]);
  const topFileId = useMemo(() => {
    const fid = String(topCitation?.file_id ?? "").trim();
    return isUuidLike(fid) ? fid : null;
  }, [topCitation]);
  const topTitleKeywords = useMemo(() => {
    const title = String(topCitation?.title ?? "")
      .toLowerCase()
      .split(/[^a-z0-9æøå-]+/i)
      .map((w) => w.trim())
      .filter((w) => w.length >= 4);
    return Array.from(new Set(title)).slice(0, 2);
  }, [topCitation?.title]);
  const snippetKeywordsCsv = useMemo(() => {
    const primaryStructuredIssue = learningSummary.top_issues[0] ?? null;
    const kws = getSnippetKeywordsForFocus({
      key: primaryStructuredIssue?.key ?? topWeakPoint?.key ?? null,
      label: primaryStructuredIssue?.label ?? topWeakPoint?.label ?? null,
      action: primaryStructuredIssue?.repair ?? topWeakPoint?.action ?? null,
    });
    const merged = [...kws, ...topTitleKeywords];
    const out: string[] = [];
    const seen = new Set<string>();
    for (const k of merged) {
      if (!k || seen.has(k)) continue;
      seen.add(k);
      out.push(k);
      if (out.length >= 10) break;
    }
    return out.join(",");
  }, [
    learningSummary.top_issues,
    topWeakPoint?.key,
    topWeakPoint?.label,
    topWeakPoint?.action,
    topTitleKeywords,
  ]);
  const readLocationLabel = useMemo(() => buildReadLocationLabel(chunkSnippet, topCitation), [chunkSnippet, topCitation]);
  useEffect(() => {
    let active = true;

    async function run() {
      if (hasStructuredFocus) {
        if (!active) return;
        setFocusEvidenceByKey({});
        return;
      }

      if (focusSeeds.length === 0) {
        if (!active) return;
        setFocusEvidenceByKey({});
        return;
      }

      const entries: Array<readonly [string, FocusEvidenceText]> = [];
      const selectedQuotes: QuotePick[] = [];

      for (const seed of focusSeeds) {
        if (!active) return;

        const fallbackSnippet = wholeSentenceOrEmpty(asText(seed.citation?.snippet), 220);
        const fallbackTitle = asText(seed.citation?.title) || "Kilde";
        const fallbackPage = parsePageFromSource(seed.citation?.title ?? null);
        const fallback: FocusEvidenceText = {
          title: fallbackTitle,
              snippet: fallbackSnippet || "Find et kort tekststed i kilden og knyt det til din pointe.",
          ...(fallbackPage ? { page: fallbackPage } : {}),
          url: seed.citation?.url ?? null,
        };

        const chunkId = asText(seed.citation?.chunk_id);
        const fileId = asText(seed.citation?.file_id);
        if (!folderId && !isUuidLike(fileId) && !isUuidLike(chunkId)) {
          entries.push([seed.key, fallback] as const);
          continue;
        }

        try {
          const qs = new URLSearchParams();
          if (folderId) qs.set("folderId", folderId);
          if (isUuidLike(fileId)) qs.set("fileId", fileId);
          if (isUuidLike(chunkId)) qs.set("chunkId", chunkId);
          const citationTitle = asText(seed.citation?.title);
          if (citationTitle) qs.set("title", citationTitle);
          const feedbackKeywordCsv = deriveFeedbackKeywordCsv(seed.evidenceFeedback);
          const mergedKeywordCsv = [feedbackKeywordCsv, seed.snippetKeywordsCsv].filter(Boolean).join(",");
          if (mergedKeywordCsv) qs.set("keywords", mergedKeywordCsv);
          qs.set("topK", "3");
          const res = await fetch(`/api/doc-chunk-snippet?${qs.toString()}`, {
            method: "GET",
            cache: "no-store",
          });
          const payload = (await res.json().catch(() => ({}))) as ChunkSnippetResponse;
          if (!res.ok || !payload?.ok) {
            entries.push([seed.key, fallback] as const);
            continue;
          }
          const items = Array.isArray(payload.items) ? payload.items : [];
          const item = items[0] ?? null;
          if (!item) {
            entries.push([seed.key, fallback] as const);
            continue;
          }
          const candidates = items.reduce<QuoteCandidate[]>((acc, entry) => {
            const titleRaw = asText(entry.title) || fallback.title;
            const textRaw = asText(entry.snippetShort);
            if (!textRaw) return acc;
            acc.push({
              chunkId: asText(entry.chunkId) || null,
              title: titleRaw,
              text: textRaw,
              page: parsePageFromSource(titleRaw) ?? fallback.page,
              pageFrom: asText(entry.pageFrom ?? entry.page ?? entry.sourcePage) || null,
              pageTo: asText(entry.pageTo ?? entry.pageFrom ?? entry.page ?? entry.sourcePage) || null,
              url: entry.url ?? fallback.url ?? null,
              pageLabel: asText(entry.pageLabel) || null,
              sourcePageLabel: asText(entry.sourcePageLabel) || null,
              printedPage: asText(entry.printedPage) || null,
              printedPageLabel: asText(entry.printedPageLabel) || null,
              position: asText(entry.position) || null,
            });
            return acc;
          }, []);

          const picked = pickQuoteForFeedback(seed.evidenceFeedback, candidates, selectedQuotes);
          if (picked) selectedQuotes.push(picked);
          if (process.env.NODE_ENV !== "production" && picked) {
            console.debug("[quote-picker]", {
              focusKey: seed.key,
              chosenScore: picked.chosenScore,
              matchedKeywords: picked.matchedKeywords,
            });
          }

          const titleRaw = picked?.title || asText(item.title) || fallback.title;
          const snippetRaw =
            wholeSentenceOrEmpty(picked?.snippet, 220) ||
            wholeSentenceOrEmpty(asText(item.snippetShort), 220) ||
            fallback.snippet;
          const page =
            picked?.page ||
            asText(item.pageFrom ?? item.page ?? item.sourcePage) ||
            parsePageFromSource(titleRaw) ||
            fallback.page;
          const url = picked?.url ?? item.url ?? fallback.url ?? null;
          entries.push([
            seed.key,
            {
              title: titleRaw,
              snippet: snippetRaw,
              ...(page ? { page } : {}),
              url,
            } as FocusEvidenceText,
          ] as const);
        } catch {
          entries.push([seed.key, fallback] as const);
        }
      }

      if (!active) return;
      setFocusEvidenceByKey(Object.fromEntries(entries));
    }

    void run();
    return () => {
      active = false;
    };
  }, [focusSeeds, folderId, hasStructuredFocus]);
  useEffect(() => {
    let active = true;

    async function run() {
      if (!folderId && !topFileId && !topChunkId) {
        if (!active) return;
        setChunkSnippet(null);
        setSnippetError(null);
        setSnippetLoading(false);
        return;
      }

      const qs = new URLSearchParams();
      if (folderId) qs.set("folderId", folderId);
      if (topFileId) qs.set("fileId", topFileId);
      if (topChunkId) qs.set("chunkId", topChunkId);
      const topTitle = asText(topCitation?.title);
      if (topTitle) qs.set("title", topTitle);
      if (snippetKeywordsCsv) qs.set("keywords", snippetKeywordsCsv);

      setSnippetLoading(true);
      setSnippetError(null);

      try {
        const res = await fetch(`/api/doc-chunk-snippet?${qs.toString()}`, {
          method: "GET",
          cache: "no-store",
        });
        const payload = (await res.json().catch(() => ({}))) as ChunkSnippetResponse;
        if (!res.ok || !payload?.ok) {
          throw new Error(payload?.error || "Kunne ikke hente snippet.");
        }
        if (!active) return;
        setChunkSnippet(Array.isArray(payload?.items) ? payload.items[0] ?? null : null);
      } catch (err: any) {
        if (!active) return;
        setChunkSnippet(null);
        setSnippetError(err?.message || "Ukendt fejl");
      } finally {
        if (active) setSnippetLoading(false);
      }
    }

    void run();
    return () => {
      active = false;
    };
  }, [folderId, topChunkId, topCitation?.title, topFileId, snippetKeywordsCsv]);

  useEffect(() => {
    if (!showLongSnippet) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setShowLongSnippet(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [showLongSnippet]);

  useEffect(() => {
    return () => {
      if (longCopyResetTimerRef.current) {
        window.clearTimeout(longCopyResetTimerRef.current);
      }
    };
  }, []);

  const handleOpenLongSnippet = async () => {
    setShowLongSnippet(true);
    if (!folderId && !topFileId && !topChunkId) {
      setLongSnippetItems([]);
      setLongSnippetError(null);
      setLongSnippetLoading(false);
      return;
    }

    const qs = new URLSearchParams();
    if (folderId) qs.set("folderId", folderId);
    if (topFileId) qs.set("fileId", topFileId);
    if (topChunkId) qs.set("chunkId", topChunkId);
    const topTitle = asText(topCitation?.title);
    if (topTitle) qs.set("title", topTitle);
    if (snippetKeywordsCsv) qs.set("keywords", snippetKeywordsCsv);
    qs.set("topK", "3");

    setLongSnippetLoading(true);
    setLongSnippetError(null);
    try {
      const res = await fetch(`/api/doc-chunk-snippet?${qs.toString()}`, {
        method: "GET",
        cache: "no-store",
      });
      const payload = (await res.json().catch(() => ({}))) as ChunkSnippetResponse;
      if (!res.ok || !payload?.ok) {
        throw new Error(payload?.error || "Kunne ikke hente længere uddrag.");
      }
      setLongSnippetItems(Array.isArray(payload.items) ? payload.items.slice(0, 3) : []);
    } catch (err: any) {
      setLongSnippetItems([]);
      setLongSnippetError(err?.message || "Ukendt fejl");
    } finally {
      setLongSnippetLoading(false);
    }
  };

  const handleCopyAllLongSnippets = async () => {
    const text = longSnippetItems
      .map((item, idx) => {
        const body = clampWithEllipsis(String(item.snippetLong ?? item.snippetShort ?? "").trim(), 850);
        if (!body) return "";
        return `Uddrag ${idx + 1}\n${body}`;
      })
      .filter(Boolean)
      .join("\n\n");
    if (!text) return;
    try {
      await navigator.clipboard.writeText(text);
      setLongSnippetCopied(true);
      if (longCopyResetTimerRef.current) {
        window.clearTimeout(longCopyResetTimerRef.current);
      }
      longCopyResetTimerRef.current = window.setTimeout(() => {
        setLongSnippetCopied(false);
      }, 1500);
    } catch {
      setLongSnippetCopied(false);
    }
  };

  return (
    <main className="mx-auto max-w-7xl p-6">
      <Link href="/traener/overblik" className="text-sm text-zinc-600 hover:text-zinc-900">
        {COPY.backToOverview}
      </Link>

      <section className="mt-3 rounded-2xl border border-neutral-200 bg-white p-5 shadow-sm min-w-0">
        <h1 className="text-2xl font-semibold break-words">{title}</h1>
        <p className="mt-1 text-sm text-zinc-600">{COPY.subtitle}</p>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <span
            className={`inline-flex rounded-full border px-2 py-1 text-[11px] font-medium ${focusBadgeClass(stats, badgeTone)}`}
          >
            {focus}
          </span>
        </div>

        <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-3">
          <div className="rounded-xl border border-neutral-200 p-3 text-center">
            <div className="text-lg font-semibold tracking-tight">
              {stats.avg_last5 == null ? "-" : Math.round(stats.avg_last5)}
            </div>
            <div className="mt-1 text-[10px] uppercase tracking-wider text-black/50">Snit (seneste 5)</div>
          </div>
          <div className="rounded-xl border border-neutral-200 p-3 text-center">
            <div className="text-lg font-semibold tracking-tight">{stats.attempts_total}</div>
            <div className="mt-1 text-[10px] uppercase tracking-wider text-black/50">Forsøg</div>
          </div>
          <div className="rounded-xl border border-neutral-200 p-3 text-center">
            <div className="text-sm font-semibold tracking-tight">{sinceLabel(stats.last_trained_at)}</div>
            <div className="mt-1 text-[10px] uppercase tracking-wider text-black/50">Sidst trænet</div>
          </div>
        </div>

        <div className="mt-4 flex flex-wrap gap-2">
          <Link
            href={`/traener?scope=${encodeURIComponent(folderId)}`}
            className="inline-flex items-center justify-center rounded-full border border-neutral-300 px-4 py-2 text-sm font-medium text-black hover:bg-neutral-50"
          >
            Start træning
          </Link>
          <Link
            href="/traener/overblik"
            className="inline-flex items-center justify-center rounded-full border border-neutral-200 px-4 py-2 text-sm text-zinc-700 hover:bg-neutral-50"
          >
            Tilbage til overblik
          </Link>
        </div>
      </section>

      {loading ? <p className="mt-6 text-sm text-zinc-600">Henter mappeindsigt...</p> : null}

      {!loading && error ? (
        <div className="mt-6 rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">
          Fejl ved hentning af mappeindsigt: {error}
        </div>
      ) : null}

      {!loading && !error ? (
        <div className="mt-6 grid grid-cols-1 gap-6 lg:grid-cols-3 min-w-0">
          <div className="space-y-4 min-w-0 lg:col-span-2">
            <section className="rounded-2xl border border-neutral-200 bg-white p-4 shadow-sm min-w-0">
              <h2 className="text-base font-semibold">Udvikling</h2>
              <div className="mt-2 text-xs text-zinc-500">{COPY.sourceLabel}</div>
              <div className="mt-3 text-sm font-medium">
                Trend (seneste 5):{" "}
                {trendDelta == null
                  ? "—"
                  : trendDelta > 0
                    ? `↑ +${trendDelta}`
                    : trendDelta < 0
                      ? `↓ ${trendDelta}`
                      : "→ 0"}
              </div>
              <div className="mt-3 min-w-0">
                <FolderProgressChart points={scorePoints} />
              </div>
              <div className="mt-3">
                <div className="mb-1 text-[11px] uppercase tracking-wider text-black/50">Seneste 3 vurderinger</div>
                {recent3.length === 0 ? (
                  <p className="text-sm text-zinc-600">Ingen vurderinger endnu.</p>
                ) : (
                  <ul className="space-y-2">
                    {recent3.map((s) => (
                      <li
                        key={s.id}
                        className="flex min-w-0 items-center justify-between rounded border border-neutral-200 bg-neutral-50 px-3 py-2 text-sm"
                      >
                        <span className="text-zinc-700">{formatDate(s.created_at)}</span>
                        <span className="font-medium">{s.score == null ? "—" : Math.round(s.score)}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </section>

            <section className="rounded-2xl border border-neutral-200 bg-white p-4 shadow-sm min-w-0">
              <div className="flex items-start justify-between gap-2">
                <h2 className="text-base font-semibold">Næste træning</h2>
              </div>

              <div className="mt-3">
                <p className="text-xs font-semibold text-zinc-700">Dit fokus</p>
                {sessionsWithWeakPoints < 2 || !primaryFocusInsight ? (
                  <p className="mt-1 text-sm text-zinc-600">
                    Lav 2–3 træninger i denne mappe for et mere stabilt fokus.
                  </p>
                ) : (
                  <div className="mt-2 rounded-xl border border-zinc-200 bg-zinc-50">
                    {topFocusInsights.slice(0, 1).map((focusItem) => {
                      const evidenceText = focusItem.evidenceText;
                      const quoteProof = wholeSentenceOrEmpty(evidenceText?.snippet, 180);
                      return (
                        <div key={focusItem.key} className="p-3">
                          <p className="font-medium text-zinc-800">
                            {focusItem.title}
                          </p>
                          <p className="mt-1 text-sm leading-relaxed text-zinc-700">
                            {trainingLead || focusItem.description || `Fokusér på ${focusItem.title.toLowerCase()} i næste svar.`}
                          </p>
                          <p className="mt-0.5 text-[10px] text-zinc-400">{focusItem.count} vurderinger</p>

	                        {trainingActions.length > 0 ? (
	                          <div className="mt-3">
	                            <p className="text-xs font-semibold text-zinc-700">Næste skridt</p>
	                            <ul className="mt-1 list-disc space-y-1 pl-5 text-sm text-zinc-700">
	                              {trainingActions.map((action) => (
	                                <li key={action}>{action}</li>
	                              ))}
	                            </ul>
	                          </div>
	                        ) : null}

                          {focusItem.evidenceBridge || quoteProof ? (
                            <div className="mt-3">
                              <p className="text-xs font-semibold text-zinc-700">Det bygger på</p>
                              {focusItem.evidenceBridge ? (
                                <p className="mt-1 text-sm leading-relaxed text-zinc-700">
                                  {wholeSentenceOrEmpty(focusItem.evidenceBridge, 200) || focusItem.evidenceBridge}
                                </p>
                              ) : null}
                              {!focusItem.evidenceBridge && quoteProof ? (
                                <>
                                  <p className="mt-1 text-sm italic leading-relaxed text-zinc-700">
                                    &ldquo;{quoteProof}&rdquo;
                                  </p>
                                  <p className="mt-1 text-[11px] text-zinc-500">
                                    {evidenceText?.title}
                                    {evidenceText?.page ? `, side ${evidenceText.page}` : ""}
                                  </p>
                                </>
                              ) : null}
                            </div>
                          ) : null}

                        </div>
                      );
                    })}
	                    {visibleSuggestionLines.length > 0 ? (
	                      <div className="border-t border-zinc-300 p-3">
	                        <p className="text-xs font-semibold text-zinc-700">Forslag til næste svar</p>
	                        <div className="mt-2 space-y-1 text-sm leading-relaxed text-zinc-700">
	                          {visibleSuggestionLines.map((line) => (
	                            <p key={line.label}>
	                              {line.label}: {line.text}
	                            </p>
	                          ))}
	                        </div>
	                      </div>
	                    ) : null}
                  </div>
                )}
              </div>

              <div className="my-4 border-t border-neutral-200" />

              <div>
                <p className="text-xs font-semibold text-zinc-700">Læs</p>
                {!topCitation ? (
                  <p className="mt-1 text-sm text-zinc-600">
                    Lav 2–3 træninger i denne mappe for at få et læse-fokus.
                  </p>
                ) : (
                  <div className="mt-2">
                    <p className="font-medium text-zinc-800 break-words whitespace-normal">
                      {chunkSnippet?.title || topCitation.title || "Kilde"}
                    </p>
                    {readLocationLabel ? <p className="mt-1 text-[11px] text-zinc-500">{readLocationLabel}</p> : null}
                    <p className="mt-1 text-[11px] text-zinc-500">Brugt i {topCitation.count} vurderinger.</p>
                    {snippetLoading ? (
                      <p className="mt-2 text-xs text-zinc-500">Henter uddrag...</p>
                    ) : wholeSentenceOrEmpty(chunkSnippet?.snippetShort, 220) ? (
                      <p className="mt-2 max-h-24 overflow-hidden text-xs leading-relaxed text-zinc-700">
                        {wholeSentenceOrEmpty(chunkSnippet?.snippetShort, 220)}
                      </p>
                    ) : wholeSentenceOrEmpty(topCitation?.snippet, 220) ? (
                      <p className="mt-2 max-h-24 overflow-hidden text-xs leading-relaxed text-zinc-700">
                        {wholeSentenceOrEmpty(topCitation?.snippet, 220)}
                      </p>
                    ) : snippetError ? (
                      <p className="mt-2 text-xs text-zinc-500">Kunne ikke hente uddrag.</p>
                    ) : null}
                    {chunkSnippet?.snippetLong ? (
                      <button
                        type="button"
                        onClick={() => void handleOpenLongSnippet()}
                        className="mt-2 text-xs text-zinc-700 underline"
                      >
                        Vis længere uddrag
                      </button>
                    ) : null}
                    {(chunkSnippet?.url || topCitation.url) ? (
                      <a
                        href={chunkSnippet?.url || topCitation.url || "#"}
                        target="_blank"
                        rel="noreferrer"
                        className="mt-2 block text-xs text-zinc-700 underline"
                      >
                        Åbn kilde
                      </a>
                    ) : null}
                  </div>
                )}
              </div>
            </section>

          </div>

          <aside className="space-y-4 min-w-0 lg:sticky lg:top-6 lg:self-start">
            <section className="rounded-2xl border border-neutral-200 bg-white p-4 shadow-sm min-w-0">
              <h2 className="text-base font-semibold">Fokus nu</h2>
              <div className="mt-2">
                <span
                  className={`inline-flex rounded-full border px-2 py-1 text-[11px] font-medium ${focusBadgeClass(stats, badgeTone)}`}
                >
                  {focus}
                </span>
              </div>
              <p className="mt-2 text-sm leading-relaxed text-zinc-700 break-words whitespace-normal">
                {learningSummary.focus_reason ||
                  "Vælg dette fokus i de næste 1-2 svar, så du løfter både klarhed og faglig præcision."}
              </p>
            </section>

            {visibleWritingTips.length > 0 ? (
              <section className="rounded-2xl border border-neutral-200 bg-white p-4 shadow-sm min-w-0">
                <h2 className="text-base font-semibold">{COPY.writingTipsTitle}</h2>
                <ul className="mt-3 list-disc space-y-1 pl-5 text-sm text-zinc-700">
                  {visibleWritingTips.map((tip, index) => (
                    <li key={`${index}-${tip}`}>{tip}</li>
                  ))}
                </ul>
              </section>
            ) : null}

            <section className="rounded-2xl border border-neutral-200 bg-white p-4 shadow-sm min-w-0">
              <h2 className="text-base font-semibold">{COPY.nextStepTitle}</h2>
              <ul className="mt-3 space-y-2 text-sm text-zinc-700">
                {nextStepChecklist.map((item) => (
                  <li key={item} className="flex items-start gap-2">
                    <span className="mt-[2px] text-zinc-500">✓</span>
                    <span>{item}</span>
                  </li>
                ))}
              </ul>
              {canStartTargetedTraining ? (
                <div className="mt-3">
                  <Link
                    href={`/traener?folder=${encodeURIComponent(folderId)}&focus=weakest`}
                    className="inline-flex items-center justify-center rounded-full border border-neutral-300 px-4 py-2 text-sm font-medium text-black hover:bg-neutral-50"
                  >
                    Start målrettet træning
                  </Link>
                </div>
              ) : (
                <p className="mt-3 text-xs text-zinc-500">Låses op efter 2 træninger i denne mappe.</p>
              )}
            </section>
          </aside>
        </div>
      ) : null}

      {showLongSnippet ? (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
          role="dialog"
          aria-modal="true"
        >
          <div
            className="w-full max-w-2xl rounded-2xl border border-zinc-200 bg-white p-4 shadow-xl"
            style={{ maxHeight: longSnippetItems.length <= 1 ? "85vh" : "80vh" }}
          >
            <div className="flex items-start justify-between gap-3">
              <h3 className="text-base font-semibold">Længere uddrag</h3>
              <div className="flex items-center gap-2">
                {longSnippetCopied ? <span className="text-[11px] text-emerald-700">Kopieret</span> : null}
                <button
                  type="button"
                  onClick={() => void handleCopyAllLongSnippets()}
                  className="rounded border border-zinc-300 bg-white px-2 py-1 text-xs text-zinc-700 hover:bg-zinc-50"
                >
                  Kopiér alt
                </button>
                <button
                  type="button"
                  onClick={() => setShowLongSnippet(false)}
                  className="rounded border border-zinc-200 px-2 py-1 text-xs text-zinc-700 hover:bg-zinc-50"
                  aria-label="Luk"
                >
                  X
                </button>
              </div>
            </div>
            <div className="mt-3 overflow-y-auto pr-1" style={{ maxHeight: longSnippetItems.length <= 1 ? "74vh" : "69vh" }}>
              {longSnippetLoading ? (
                <p className="text-sm text-zinc-500">Henter uddrag...</p>
              ) : longSnippetError ? (
                <p className="text-sm text-zinc-500">Kunne ikke hente uddrag.</p>
              ) : longSnippetItems.length ? (
                <div className="rounded-xl border border-zinc-200 bg-zinc-50 p-3">
                  {longSnippetItems.map((item, idx) => (
                    <div key={item.chunkId} className={idx > 0 ? "mt-4" : ""}>
                      <p className="text-xs font-semibold text-zinc-700">Uddrag {idx + 1}</p>
                      <p className="mt-1 whitespace-pre-wrap text-sm leading-relaxed text-zinc-700">
                        {clampWithEllipsis(String(item.snippetLong ?? item.snippetShort ?? "").trim(), 850)}
                      </p>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-sm text-zinc-500">Ingen uddrag fundet.</p>
              )}
            </div>
          </div>
        </div>
      ) : null}
    </main>
  );
}
