import "server-only";

import { getCanonicalUserPlan, normalizePlanCode, type PlanCode } from "@/lib/plan/limits";

export const FREEMIUM_NOTES_STORAGE_LIMIT = 50;
export const FREEMIUM_NOTES_VISIBLE_LIMIT = 5;
export const FREEMIUM_MONTHLY_SUMMARY_GENERATIONS_LIMIT = 3;
export const FREEMIUM_MONTHLY_FOCUS_GENERATIONS_LIMIT = 3;
export const USER_FACING_NOTE_TYPES = ["resume", "summary", "focus"] as const;
export const RESUME_NOTE_TYPES = ["resume", "summary"] as const;
export const FOCUS_NOTE_TYPES = ["focus"] as const;
export const FREEMIUM_NOTES_LIMIT_MESSAGE =
  "Du har nået loftet på 50 gemte noter i Freemium. Kun dine 5 nyeste noter er synlige. Slet en note for at gemme en ny, eller opgradér for fuld adgang til hele historikken.";
export const FREEMIUM_NOTE_LOCKED_MESSAGE =
  "Denne note er skjult på Freemium. Opgradér for at få adgang til ældre noter.";
export const FREEMIUM_SUMMARY_MONTHLY_LIMIT_MESSAGE =
  "Du har brugt dine gratis resuméer denne måned.";
export const FREEMIUM_FOCUS_MONTHLY_LIMIT_MESSAGE =
  "Du har brugt dine gratis fokus-noter denne måned.";

export type NoteVisibilityCategory = "resume" | "focus";

const NOTE_TYPES_BY_CATEGORY: Record<NoteVisibilityCategory, readonly string[]> = {
  resume: RESUME_NOTE_TYPES,
  focus: FOCUS_NOTE_TYPES,
};

export type NoteEntitlement = {
  plan: PlanCode;
  normalizedPlan: PlanCode;
  totalNotes: number;
  maxStoredNotes: number | null;
  visibleNotesLimit: number | null;
  visibleNoteIds: string[] | null;
  canCreate: boolean;
};

export type MonthlyNoteGenerationUsage = {
  plan: PlanCode;
  normalizedPlan: PlanCode;
  isFreemium: boolean;
  summary: {
    usedThisMonth: number;
    limitPerMonth: number | null;
  };
  focus: {
    usedThisMonth: number;
    limitPerMonth: number | null;
  };
};

function getCurrentMonthBoundsUtc(now = new Date()) {
  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1, 0, 0, 0, 0));
  const end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1, 0, 0, 0, 0));
  return {
    startIso: start.toISOString(),
    endIso: end.toISOString(),
  };
}

function noteTypesForCategory(category: NoteVisibilityCategory) {
  return [...NOTE_TYPES_BY_CATEGORY[category]];
}

export function resolveNoteVisibilityCategory(noteType: string | null | undefined): NoteVisibilityCategory | null {
  const normalized = String(noteType ?? "").trim().toLowerCase();
  if (RESUME_NOTE_TYPES.includes(normalized as (typeof RESUME_NOTE_TYPES)[number])) return "resume";
  if (FOCUS_NOTE_TYPES.includes(normalized as (typeof FOCUS_NOTE_TYPES)[number])) return "focus";
  return null;
}

export async function getTotalNotesCount(sb: any, ownerId: string): Promise<number> {
  const { count, error } = await sb
    .from("notes")
    .select("id", { count: "exact", head: true })
    .eq("owner_id", ownerId)
    .in("note_type", [...USER_FACING_NOTE_TYPES]);

  if (error) {
    console.error("[notes] count error:", error);
    throw new Error("NOTES_COUNT_FAILED");
  }

  return typeof count === "number" ? count : 0;
}

async function getVisibleNoteIds(sb: any, ownerId: string, limit: number): Promise<string[]> {
  const ids = new Set<string>();

  for (const category of Object.keys(NOTE_TYPES_BY_CATEGORY) as NoteVisibilityCategory[]) {
    const { data, error } = await sb
      .from("notes")
      .select("id")
      .eq("owner_id", ownerId)
      .in("note_type", noteTypesForCategory(category))
      .order("created_at", { ascending: false })
      .limit(limit);

    if (error) {
      console.error("[notes] visible ids error:", error);
      throw new Error("NOTES_VISIBLE_IDS_FAILED");
    }

    for (const row of data ?? []) {
      const id = String((row as any)?.id ?? "").trim();
      if (id) ids.add(id);
    }
  }

  return Array.from(ids);
}

export async function getMonthlyGeneratedNotesCount(
  sb: any,
  ownerId: string,
  category: NoteVisibilityCategory,
): Promise<number> {
  const { startIso, endIso } = getCurrentMonthBoundsUtc();
  const { count, error } = await sb
    .from("notes")
    .select("id", { count: "exact", head: true })
    .eq("owner_id", ownerId)
    .in("note_type", noteTypesForCategory(category))
    .gte("created_at", startIso)
    .lt("created_at", endIso);

  if (error) {
    console.error("[notes] monthly generated count error:", error);
    throw new Error("NOTES_MONTHLY_COUNT_FAILED");
  }

  return typeof count === "number" ? count : 0;
}

export async function getMonthlyNoteGenerationUsage(sb: any, ownerId: string): Promise<MonthlyNoteGenerationUsage> {
  const planInfo = await getCanonicalUserPlan(sb, ownerId);
  const normalizedPlan = normalizePlanCode(planInfo.normalizedPlan);

  if (normalizedPlan !== "freemium") {
    return {
      plan: planInfo.rawPlan ?? normalizedPlan,
      normalizedPlan,
      isFreemium: false,
      summary: { usedThisMonth: 0, limitPerMonth: null },
      focus: { usedThisMonth: 0, limitPerMonth: null },
    };
  }

  const [summaryUsedThisMonth, focusUsedThisMonth] = await Promise.all([
    getMonthlyGeneratedNotesCount(sb, ownerId, "resume"),
    getMonthlyGeneratedNotesCount(sb, ownerId, "focus"),
  ]);

  return {
    plan: planInfo.rawPlan ?? normalizedPlan,
    normalizedPlan,
    isFreemium: true,
    summary: {
      usedThisMonth: summaryUsedThisMonth,
      limitPerMonth: FREEMIUM_MONTHLY_SUMMARY_GENERATIONS_LIMIT,
    },
    focus: {
      usedThisMonth: focusUsedThisMonth,
      limitPerMonth: FREEMIUM_MONTHLY_FOCUS_GENERATIONS_LIMIT,
    },
  };
}

export async function getNoteEntitlement(sb: any, ownerId: string): Promise<NoteEntitlement> {
  const planInfo = await getCanonicalUserPlan(sb, ownerId);
  const normalizedPlan = normalizePlanCode(planInfo.normalizedPlan);
  const totalNotes = await getTotalNotesCount(sb, ownerId);
  const maxStoredNotes = normalizedPlan === "freemium" ? FREEMIUM_NOTES_STORAGE_LIMIT : null;
  const visibleNotesLimit = normalizedPlan === "freemium" ? FREEMIUM_NOTES_VISIBLE_LIMIT : null;
  const visibleNoteIds: string[] | null = visibleNotesLimit
    ? await getVisibleNoteIds(sb, ownerId, visibleNotesLimit)
    : null;

  return {
    plan: planInfo.rawPlan ?? normalizedPlan,
    normalizedPlan,
    totalNotes,
    maxStoredNotes,
    visibleNotesLimit,
    visibleNoteIds,
    canCreate: maxStoredNotes == null ? true : totalNotes < maxStoredNotes,
  };
}

export async function assertCanCreateNote(sb: any, ownerId: string): Promise<NoteEntitlement> {
  const entitlement = await getNoteEntitlement(sb, ownerId);
  if (!entitlement.canCreate) {
    const error = new Error(FREEMIUM_NOTES_LIMIT_MESSAGE);
    (error as any).code = "NOTES_LIMIT_REACHED";
    (error as any).status = 403;
    throw error;
  }
  return entitlement;
}

export async function assertCanGenerateNoteType(
  sb: any,
  ownerId: string,
  noteType: string | null | undefined,
): Promise<NoteEntitlement> {
  const entitlement = await getNoteEntitlement(sb, ownerId);
  const category = resolveNoteVisibilityCategory(noteType);
  const monthlyUsage = await getMonthlyNoteGenerationUsage(sb, ownerId);

  if (!monthlyUsage.isFreemium || !category) {
    return entitlement;
  }

  const bucket = category === "resume" ? monthlyUsage.summary : monthlyUsage.focus;
  if (typeof bucket.limitPerMonth === "number" && bucket.usedThisMonth >= bucket.limitPerMonth) {
    const error = new Error(
      category === "resume" ? FREEMIUM_SUMMARY_MONTHLY_LIMIT_MESSAGE : FREEMIUM_FOCUS_MONTHLY_LIMIT_MESSAGE,
    );
    (error as any).code = category === "resume" ? "NOTES_SUMMARY_MONTHLY_LIMIT_REACHED" : "NOTES_FOCUS_MONTHLY_LIMIT_REACHED";
    (error as any).status = 403;
    throw error;
  }

  return entitlement;
}

export function filterVisibleNotes<T extends { id: string }>(
  notes: T[],
  entitlement: Pick<NoteEntitlement, "visibleNoteIds" | "visibleNotesLimit">,
): T[] {
  if (!entitlement.visibleNoteIds || entitlement.visibleNotesLimit == null) return notes;
  const visibleIdSet = new Set(entitlement.visibleNoteIds);
  return notes.filter((note) => visibleIdSet.has(String(note.id)));
}

export async function assertCanAccessNote(sb: any, ownerId: string, noteId: string): Promise<NoteEntitlement> {
  const entitlement = await getNoteEntitlement(sb, ownerId);
  if (entitlement.visibleNoteIds && !entitlement.visibleNoteIds.includes(noteId)) {
    const error = new Error(FREEMIUM_NOTE_LOCKED_MESSAGE);
    (error as any).code = "NOTE_LOCKED";
    (error as any).status = 403;
    throw error;
  }
  return entitlement;
}

export async function assertCanAccessVisibleNoteCategory(
  sb: any,
  ownerId: string,
  noteId: string,
  noteType: string | null | undefined,
): Promise<NoteEntitlement> {
  const category = resolveNoteVisibilityCategory(noteType);
  if (!category) {
    return getNoteEntitlement(sb, ownerId);
  }
  return assertCanAccessNote(sb, ownerId, noteId);
}
