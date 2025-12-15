// lib/plan/importQuota.ts
// Kvote-check til import (/api/import): maks. antal filer pr. bruger/plan.

/* eslint-disable @typescript-eslint/no-explicit-any */

import {
  getPlanAndLimitsForOwner,
  type PlanCode,
  type PlanLimits,
} from "@/lib/plan/limits";

export type ImportQuotaReason = "maxFiles";

export class ImportQuotaError extends Error {
  reason: ImportQuotaReason;
  plan: PlanCode;
  limits: PlanLimits;
  totalFiles: number;
  allowed: number;

  constructor(opts: {
    message: string;
    reason: ImportQuotaReason;
    plan: PlanCode;
    limits: PlanLimits;
    totalFiles: number;
    allowed: number;
  }) {
    super(opts.message);
    this.name = "ImportQuotaError";
    this.reason = opts.reason;
    this.plan = opts.plan;
    this.limits = opts.limits;
    this.totalFiles = opts.totalFiles;
    this.allowed = opts.allowed;
  }
}

/**
 * Tjekker om brugeren må importere en fil med det givne md5.
 *
 * Logik:
 * - Hvis fil med samme md5 allerede findes for owner_id → altid OK
 *   (idempotent re-import må ikke blokere kvoten).
 * - Ellers: tæl antal filer for owner_id og sammenlign med planens maxFiles.
 *
 * Returnerer:
 *   { plan, limits, isNewFile, totalFilesBefore }
 *
 * Kaster ImportQuotaError hvis kvoten er nået.
 */
export async function checkImportQuotaOrThrow(opts: {
  sb: any;
  ownerId: string;
  fileMd5: string;
}): Promise<{
  plan: PlanCode;
  limits: PlanLimits;
  isNewFile: boolean;
  totalFilesBefore: number;
}> {
  const { sb, ownerId, fileMd5 } = opts;

  // 1) Hent plan + limits
  const { plan, limits } = await getPlanAndLimitsForOwner(sb, ownerId);

  // 2) Find ud af om denne fil allerede findes (samme md5)
  const { data: existingFile, error: existingErr } = await sb
    .from("files")
    .select("id")
    .eq("owner_id", ownerId)
    .eq("md5", fileMd5)
    .maybeSingle();

  if (existingErr) {
    console.error("[importQuota] existing file lookup error:", existingErr);
    // Vi lader det falde igennem til kvote-check nedenfor.
  }

  if (existingFile) {
    // Idempotent re-import → tæller ikke som ny fil
    return {
      plan,
      limits,
      isNewFile: false,
      totalFilesBefore: NaN, // ikke relevant her
    };
  }

  // 3) Tæl filer for brugeren
  const { count, error: countErr } = await sb
    .from("files")
    .select("id", { count: "exact", head: true })
    .eq("owner_id", ownerId);

  if (countErr) {
    console.error("[importQuota] file count error:", countErr);
    // Konservativ: hvis vi ikke kan læse, så stopper vi import
    throw new ImportQuotaError({
      message:
        "Kunne ikke kontrollere din import-kvote lige nu. Prøv igen lidt senere.",
      reason: "maxFiles",
      plan,
      limits,
      totalFiles: -1,
      allowed: limits.maxFiles,
    });
  }

  const totalFilesBefore = count ?? 0;

  if (totalFilesBefore >= limits.maxFiles) {
    throw new ImportQuotaError({
      message:
        "Du har nået grænsen for, hvor mange dokumenter du kan have liggende i denne plan.",
      reason: "maxFiles",
      plan,
      limits,
      totalFiles: totalFilesBefore,
      allowed: limits.maxFiles,
    });
  }

  // OK – der er plads til at oprette en ny fil
  return {
    plan,
    limits,
    isNewFile: true,
    totalFilesBefore,
  };
}
