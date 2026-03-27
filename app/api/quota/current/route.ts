// app/api/quota/current/route.ts
import "server-only";

import { NextRequest, NextResponse } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { createClient } from "@supabase/supabase-js";
import { getMonthlyNoteGenerationUsage } from "@/lib/notes/entitlements";
import { quotaTryConsume } from "@/lib/quota/rpc";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const FLASHCARDS_PER_GENERATION = 10;
const NO_STORE_HEADERS = {
  "Cache-Control": "no-store, max-age=0",
  Pragma: "no-cache",
  Vary: "Cookie",
};

function jsonNoStore(body: any, status = 200) {
  return NextResponse.json(body, { status, headers: NO_STORE_HEADERS });
}

function n0(x: number | null | undefined) {
  return typeof x === "number" && Number.isFinite(x) ? x : 0;
}

function isFiniteNum(x: any): x is number {
  return typeof x === "number" && Number.isFinite(x);
}

function capUsed(used: number, limit: number | null): number {
  return isFiniteNum(limit) && limit > 0 ? Math.min(used, limit) : used;
}

function normalizePlan(raw: any) {
  const p = String(raw ?? "").trim().toLowerCase();
  if (!p) return "freemium";
  if (p === "free") return "freemium";
  if (p === "basic") return "basis";
  return p;
}

function getMonthBoundsUTC(now = new Date()) {
  const y = now.getUTCFullYear();
  const m = now.getUTCMonth();

  const start = new Date(Date.UTC(y, m, 1, 0, 0, 0, 0));
  const resetAt = new Date(Date.UTC(y, m + 1, 1, 0, 0, 0, 0));
  const monthEnd = new Date(resetAt.getTime() - 1);

  return {
    monthStart: start.toISOString(),
    resetAt: resetAt.toISOString(),
    monthEnd: monthEnd.toISOString(),
  };
}

function rollForwardMonthly(resetAt: Date, now: Date) {
  const r = new Date(resetAt.getTime());
  while (r.getTime() <= now.getTime()) {
    r.setUTCMonth(r.getUTCMonth() + 1);
  }
  return r;
}

function getCycleBoundsFromRenewAtUTC(quotaRenewAtIso: string | null, now = new Date()) {
  if (!quotaRenewAtIso) return null;
  const d = new Date(quotaRenewAtIso);
  if (Number.isNaN(d.getTime())) return null;

  const reset = rollForwardMonthly(d, now);
  const start = new Date(reset.getTime());
  start.setUTCMonth(start.getUTCMonth() - 1);

  const end = new Date(reset.getTime() - 1);

  return {
    monthStart: start.toISOString(),
    resetAt: reset.toISOString(),
    monthEnd: end.toISOString(),
  };
}

function supabaseAdmin() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !key) {
    throw new Error("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
  }

  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

function supabaseAuthReadOnly(req: NextRequest) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!url || !anon) {
    throw new Error("Missing NEXT_PUBLIC_SUPABASE_URL or NEXT_PUBLIC_SUPABASE_ANON_KEY");
  }

  return createServerClient(url, anon, {
    cookies: {
      getAll() {
        return req.cookies.getAll();
      },
      setAll() {
        // Read-only auth lookup: quota/current må ikke cleare eller rotere auth-cookies.
      },
    },
  });
}

async function countJobs(opts: {
  admin: any;
  ownerId: string;
  kind: string;
  from?: string;
  to?: string;
  statuses?: string[];
}) {
  const { admin, ownerId, kind, from, to, statuses } = opts;

  const tsCols = from && to ? (["queued_at", "created_at"] as const) : ([null] as const);
  let lastErr: any = null;

  for (const tsCol of tsCols) {
    if (statuses?.length) {
      let q1 = admin
        .from("jobs")
        .select("id", { count: "exact", head: true })
        .eq("owner_id", ownerId)
        .eq("kind", kind)
        .in("status", statuses);

      if (tsCol && from && to) q1 = q1.gte(tsCol, from).lt(tsCol, to);

      const r1 = await q1;
      if (!r1.error && r1.count != null) {
        return { count: n0(r1.count), used: { tsCol, withStatus: true } };
      }
      lastErr = r1.error ?? lastErr;
    }

    let q2 = admin
      .from("jobs")
      .select("id", { count: "exact", head: true })
      .eq("owner_id", ownerId)
      .eq("kind", kind);

    if (tsCol && from && to) q2 = q2.gte(tsCol, from).lt(tsCol, to);

    const r2 = await q2;
    if (!r2.error && r2.count != null) {
      return { count: n0(r2.count), used: { tsCol, withStatus: false } };
    }
    lastErr = r2.error ?? lastErr;
  }

  return { count: 0, used: null as any, error: lastErr };
}

async function countFlashcardUnitsThisMonth(opts: {
  admin: any;
  ownerId: string;
  from: string;
  to: string;
  unitsPerSession: number;
}) {
  const { admin, ownerId, from, to, unitsPerSession } = opts;

  const cols = ["requested", "returned", "cards_returned", "cards_count", "card_count", "count"] as const;
  const tsCols = ["created_at"] as const;

  for (const tsCol of tsCols) {
    for (const col of cols) {
      const r = await admin
        .from("flashcard_sessions")
        .select(col)
        .eq("owner_id", ownerId)
        .gte(tsCol, from)
        .lt(tsCol, to)
        .limit(5000);

      if (r.error || !Array.isArray(r.data)) continue;

      let sum = 0;
      let hits = 0;

      for (const row of r.data as any[]) {
        const v = Number((row as any)?.[col]);
        if (Number.isFinite(v)) {
          sum += v;
          hits++;
        }
      }

      if (hits > 0) {
        return { units: sum, meta: { mode: "sum", tsCol, col, hits } };
      }
    }
  }

  const r2 = await admin
    .from("flashcard_sessions")
    .select("id", { count: "exact", head: true })
    .eq("owner_id", ownerId)
    .gte("created_at", from)
    .lt("created_at", to);

  if (!r2.error && r2.count != null) {
    const cnt = Number(r2.count ?? 0) || 0;
    return { units: cnt * unitsPerSession, meta: { mode: "rowCount", cnt, unitsPerSession } };
  }

  return { units: 0, meta: { mode: "unknown" } };
}

function pickLimit(planLimits: any[] | null | undefined, feature: string): number | null {
  const row = (planLimits ?? []).find((r: any) => r.feature === feature);
  if (!row || row?.is_unlimited === true) return null;
  const v = row?.monthly_limit ?? null;

  return isFiniteNum(v) ? Math.round(v) : null;
}

function pickUnlimited(planLimits: any[] | null | undefined, feature: string): boolean {
  const row = (planLimits ?? []).find((r: any) => r.feature === feature);
  return row?.is_unlimited === true;
}

function safeIso(x: any): string | null {
  const s = String(x ?? "").trim();
  if (!s) return null;
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

async function tryQuotaCheck(admin: any, ownerId: string, feature: string) {
  const r = await quotaTryConsume({
    admin,
    ownerId,
    feature: feature as any,
    amount: 0,
    exceededMessage: "quota exceeded",
  });

  if (!r.ok && r.status === 503) return { ok: false as const, error: r.raw };

  return {
    ok: true as const,
    allowed: r.ok,
    used: Number(r.used ?? 0) || 0,
    limit: r.limitPerMonth == null ? null : Number(r.limitPerMonth),
    resetAt: safeIso(r.resetAt),
    raw: r.raw,
  };
}

export async function GET(req: NextRequest) {
  let ownerId = "";
  let mode: "auth" | "dev" = "auth";
  const cookieNames = req.cookies.getAll().map((cookie) => cookie.name);

  try {
    const sb = supabaseAuthReadOnly(req);
    const { data: sessionData, error: sessionError } = await sb.auth.getSession();
    const sessionUserId = sessionData?.session?.user?.id ? String(sessionData.session.user.id) : null;

    let resolvedUserId = sessionUserId;
    let getUserError: string | null = null;

    if (!resolvedUserId) {
      const { data: authData, error: authError } = await sb.auth.getUser();
      getUserError = authError?.message ?? null;
      resolvedUserId = authData?.user?.id ? String(authData.user.id) : null;
    }

    if (!resolvedUserId) {
      return jsonNoStore(
        {
          ok: false,
          error: "unauthorized",
          ...(process.env.VERCEL_ENV === "preview"
            ? {
                debug: {
                  hasSession: !!sessionData?.session,
                  sessionUserId,
                  sessionError: sessionError?.message ?? null,
                  getUserError,
                  cookieNames,
                },
              }
            : {}),
        },
        401,
      );
    }
    ownerId = resolvedUserId;
    mode = "auth";
  } catch (error: any) {
    return jsonNoStore(
      {
        ok: false,
        error: "unauthorized",
        ...(process.env.VERCEL_ENV === "preview"
          ? {
              debug: {
                hasSession: null,
                sessionUserId: null,
                sessionError: error?.message ?? null,
                getUserError: null,
                cookieNames,
              },
            }
          : {}),
      },
      401,
    );
  }

  let admin: any;
  try {
    admin = supabaseAdmin();
  } catch (e: any) {
    return jsonNoStore(
      { ok: false, error: "Server config mangler.", details: String(e?.message ?? e) },
      500,
    );
  }

  const now = new Date();

  // Profile (plan + quota_renew_at anchor)
  const { data: profile } = await admin
    .from("profiles")
    .select("id, plan, quota_renew_at, created_at")
    .eq("id", ownerId)
    .maybeSingle();

  const plan = normalizePlan((profile as any)?.plan ?? "freemium");
  const isPaid = plan === "basis" || plan === "pro";

  // bounds: prøv at bruge quota_renew_at (anchor). fallback: kalender måned.
  const anchoredBounds =
    getCycleBoundsFromRenewAtUTC((profile as any)?.quota_renew_at ?? null, now) ?? null;

  // plan limits (bruges som fallback/debug)
  const { data: planLimitRows } = await admin
    .from("plan_limits")
    .select("plan, feature, monthly_limit, is_unlimited")
    .eq("plan", plan);

  const planLimits = planLimitRows ?? [];

  const importLimit = pickLimit(planLimits, "import");
  const trainerRoundLimit = pickLimit(planLimits, "trainer_round");
  const mcLimit = pickLimit(planLimits, "mc_generate");
  const flashLimit = pickLimit(planLimits, "flashcards_generate");

  const importUnlimited = pickUnlimited(planLimits, "import");
  const trainerRoundUnlimited = pickUnlimited(planLimits, "trainer_round");
  const mcUnlimited = pickUnlimited(planLimits, "mc_generate");
  const flashUnlimited = pickUnlimited(planLimits, "flashcards_generate");

  // ✅ SMART: Basis/Pro skal kun have upload i UI -> vi laver kun 1 RPC og returnerer kun import
  if (isPaid) {
    const qImport = await tryQuotaCheck(admin, ownerId, "import");

    const boundsFromRpc =
      qImport.ok && qImport.resetAt
        ? (() => {
            const reset = new Date(qImport.resetAt as string);
            if (Number.isNaN(reset.getTime())) return null;
            const start = new Date(reset.getTime());
            start.setUTCMonth(start.getUTCMonth() - 1);
            const end = new Date(reset.getTime() - 1);
            return {
              monthStart: start.toISOString(),
              resetAt: reset.toISOString(),
              monthEnd: end.toISOString(),
            };
          })()
        : null;

    const bounds = boundsFromRpc ?? anchoredBounds ?? getMonthBoundsUTC(now);
    const { monthStart, resetAt, monthEnd } = bounds;

    if (qImport.ok) {
      const limit = importUnlimited ? null : (qImport.limit ?? importLimit);
      const used = capUsed(n0(qImport.used), limit);

      return jsonNoStore({
        ok: true,
        mode,
        ownerId,
        now: now.toISOString(),
        monthStart,
        monthEnd,
        resetAt,
        plan,
        // kun upload for Basis/Pro:
        import: { usedThisMonth: used, limitPerMonth: limit },

        ...(process.env.NODE_ENV !== "production"
          ? {
              _debug: {
                paidSlimResponse: true,
                boundsMode: boundsFromRpc ? "rpc" : anchoredBounds ? "quota_renew_at" : "calendar_month",
                profile: {
                  plan,
                  quota_renew_at: (profile as any)?.quota_renew_at ?? null,
                  created_at: (profile as any)?.created_at ?? null,
                },
                rpc: { import: qImport.raw ?? null },
              },
            }
          : {}),
      });
    }

    // Fallback hvis RPC fejler: count kun import-jobs i perioden
    const importMonth = await countJobs({
      admin,
      ownerId,
      kind: "import",
      from: monthStart,
      to: resetAt,
      statuses: ["succeeded"],
    });

    const usedRaw = n0(importMonth.count);
    const used = capUsed(usedRaw, importUnlimited ? null : importLimit);

    return jsonNoStore({
      ok: true,
      mode,
      ownerId,
      now: now.toISOString(),
      monthStart,
      monthEnd,
      resetAt,
      plan,
      import: { usedThisMonth: used, limitPerMonth: importUnlimited ? null : importLimit },

      ...(process.env.NODE_ENV !== "production"
        ? {
            _debug: {
              paidSlimResponse: true,
              boundsMode: anchoredBounds ? "quota_renew_at" : "calendar_month",
              quotaRpcError: qImport.error ?? null,
              raw: { import_jobs: usedRaw },
              jobsTs: { import: importMonth.used ?? null },
              profile: {
                plan,
                quota_renew_at: (profile as any)?.quota_renew_at ?? null,
                created_at: (profile as any)?.created_at ?? null,
              },
            },
          }
        : {}),
    });
  }

  // ✅ Freemium: behold den eksisterende “fulde” respons som før
  let quotaErr: any = null;

  const qImport = await tryQuotaCheck(admin, ownerId, "import");
  const qTrainer = await tryQuotaCheck(admin, ownerId, "trainer_round");
  const qMc = await tryQuotaCheck(admin, ownerId, "mc_generate");
  const qFlash = await tryQuotaCheck(admin, ownerId, "flashcards_generate");

  const allQuotaOk = qImport.ok && qTrainer.ok && qMc.ok && qFlash.ok;

  const boundsFromRpc =
    allQuotaOk && (qImport.resetAt || qTrainer.resetAt || qMc.resetAt || qFlash.resetAt)
      ? (() => {
          const resetAtIso = qImport.resetAt || qTrainer.resetAt || qMc.resetAt || qFlash.resetAt;
          if (!resetAtIso) return null;
          const reset = new Date(resetAtIso);
          if (Number.isNaN(reset.getTime())) return null;
          const start = new Date(reset.getTime());
          start.setUTCMonth(start.getUTCMonth() - 1);
          const end = new Date(reset.getTime() - 1);
          return {
            monthStart: start.toISOString(),
            resetAt: reset.toISOString(),
            monthEnd: end.toISOString(),
          };
        })()
      : null;

  const bounds = boundsFromRpc ?? anchoredBounds ?? getMonthBoundsUTC(now);
  const { monthStart, resetAt, monthEnd } = bounds;

  if (!allQuotaOk) {
    quotaErr = {
      import: qImport.ok ? null : qImport.error,
      trainer_round: qTrainer.ok ? null : qTrainer.error,
      mc_generate: qMc.ok ? null : qMc.error,
      flashcards_generate: qFlash.ok ? null : qFlash.error,
    };
  }

  if (allQuotaOk) {
    const importUsed = capUsed(n0(qImport.used), importUnlimited ? null : (qImport.limit ?? importLimit));
    const trainerUsed = capUsed(n0(qTrainer.used), trainerRoundUnlimited ? null : (qTrainer.limit ?? trainerRoundLimit));
    const mcUsed = capUsed(n0(qMc.used), mcUnlimited ? null : (qMc.limit ?? mcLimit));
    const flashUsed = capUsed(n0(qFlash.used), flashUnlimited ? null : (qFlash.limit ?? flashLimit));
    let noteUsage = {
      summary: { usedThisMonth: 0, limitPerMonth: null as number | null },
      focus: { usedThisMonth: 0, limitPerMonth: null as number | null },
    };

    try {
      const usage = await getMonthlyNoteGenerationUsage(admin, ownerId);
      if (usage.isFreemium) {
        noteUsage = { summary: usage.summary, focus: usage.focus };
      }
    } catch (error) {
      console.error("[quota/current] monthly notes usage error:", error);
    }

    return jsonNoStore({
      ok: true,
      mode,
      ownerId,
      now: now.toISOString(),
      monthStart,
      monthEnd,
      resetAt,
      plan,

      import: { usedThisMonth: importUsed, limitPerMonth: importUnlimited ? null : (qImport.limit ?? importLimit) },
      trainer_round: { usedThisMonth: trainerUsed, limitPerMonth: trainerRoundUnlimited ? null : (qTrainer.limit ?? trainerRoundLimit) },
      mc_generate: { usedThisMonth: mcUsed, limitPerMonth: mcUnlimited ? null : (qMc.limit ?? mcLimit) },
      flashcards_generate: { usedThisMonth: flashUsed, limitPerMonth: flashUnlimited ? null : (qFlash.limit ?? flashLimit) },
      notes_summary_generate: noteUsage.summary,
      notes_focus_generate: noteUsage.focus,

      ...(process.env.NODE_ENV !== "production"
        ? {
            _debug: {
              boundsMode: boundsFromRpc ? "rpc" : anchoredBounds ? "quota_renew_at" : "calendar_month",
              profile: {
                plan: plan,
                quota_renew_at: (profile as any)?.quota_renew_at ?? null,
                created_at: (profile as any)?.created_at ?? null,
              },
              rpc: {
                import: qImport.raw ?? null,
                trainer_round: qTrainer.raw ?? null,
                mc_generate: qMc.raw ?? null,
                flashcards_generate: qFlash.raw ?? null,
                notes_summary_generate: noteUsage.summary,
                notes_focus_generate: noteUsage.focus,
              },
            },
          }
        : {}),
    });
  }

  const importMonth = await countJobs({
    admin,
    ownerId,
    kind: "import",
    from: monthStart,
    to: resetAt,
    statuses: ["succeeded"],
  });

  const trainerRoundMonth = await countJobs({
    admin,
    ownerId,
    kind: "trainer_round",
    from: monthStart,
    to: resetAt,
    statuses: ["succeeded"],
  });

  const mcMonth = await countJobs({
    admin,
    ownerId,
    kind: "mc_generate",
    from: monthStart,
    to: resetAt,
    statuses: ["succeeded"],
  });

  const flashUnitsRes = await countFlashcardUnitsThisMonth({
    admin,
    ownerId,
    from: monthStart,
    to: resetAt,
    unitsPerSession: FLASHCARDS_PER_GENERATION,
  });

  const importMonthUsedRaw = n0(importMonth.count);
  const trainerRoundUsedRaw = n0(trainerRoundMonth.count);
  const mcMonthUsedRaw = n0(mcMonth.count);
  const flashMonthUsedRaw = Number(flashUnitsRes.units ?? 0) || 0;
  let noteUsage = {
    summary: { usedThisMonth: 0, limitPerMonth: null as number | null },
    focus: { usedThisMonth: 0, limitPerMonth: null as number | null },
  };

  try {
    const usage = await getMonthlyNoteGenerationUsage(admin, ownerId);
    if (usage.isFreemium) {
      noteUsage = { summary: usage.summary, focus: usage.focus };
    }
  } catch (error) {
    console.error("[quota/current] monthly notes usage error:", error);
  }

  const importMonthUsed = capUsed(importMonthUsedRaw, importLimit);
  const trainerRoundUsed = capUsed(trainerRoundUsedRaw, trainerRoundLimit);
  const mcMonthUsed = capUsed(mcMonthUsedRaw, mcLimit);
  const flashMonthUsed = capUsed(n0(flashMonthUsedRaw), flashLimit);

  return jsonNoStore({
    ok: true,
    mode,
    ownerId,
    now: now.toISOString(),
    monthStart,
    monthEnd,
    resetAt,
    plan,

    import: { usedThisMonth: importMonthUsed, limitPerMonth: importLimit },
    trainer_round: { usedThisMonth: trainerRoundUsed, limitPerMonth: trainerRoundLimit },
    mc_generate: { usedThisMonth: mcMonthUsed, limitPerMonth: mcLimit },
    flashcards_generate: { usedThisMonth: flashMonthUsed, limitPerMonth: flashLimit },
    notes_summary_generate: noteUsage.summary,
    notes_focus_generate: noteUsage.focus,

    ...(process.env.NODE_ENV !== "production"
      ? {
          _debug: {
            boundsMode: anchoredBounds ? "quota_renew_at" : "calendar_month",
            quotaRpcError: quotaErr,
            raw: {
              import_jobs: importMonthUsedRaw,
              trainer_round_jobs: trainerRoundUsedRaw,
              mc_generate_jobs: mcMonthUsedRaw,
              flashcards_units: n0(flashMonthUsedRaw),
              notes_summary_generate: noteUsage.summary.usedThisMonth,
              notes_focus_generate: noteUsage.focus.usedThisMonth,
            },
            flashcards: { meta: flashUnitsRes.meta ?? null },
            jobsTs: {
              import: importMonth.used ?? null,
              trainer_round: trainerRoundMonth.used ?? null,
              mc_generate: mcMonth.used ?? null,
            },
            profile: {
              plan: plan,
              quota_renew_at: (profile as any)?.quota_renew_at ?? null,
              created_at: (profile as any)?.created_at ?? null,
            },
          },
        }
      : {}),
  });
}
