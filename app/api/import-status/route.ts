// app/api/import-status/route.ts
import "server-only";

import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { requireUser } from "@/lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function n0(x: any): number {
  const v = typeof x === "number" ? x : Number(x);
  return Number.isFinite(v) ? v : 0;
}

function isUuidLike(s: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(s);
}

function supabaseAdmin() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}

function formatDa(iso: string) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return new Intl.DateTimeFormat("da-DK", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(d);
}

function daysInMonthUTC(year: number, month0: number) {
  // month0: 0..11
  return new Date(Date.UTC(year, month0 + 1, 0, 0, 0, 0, 0)).getUTCDate();
}

function addMonthsClampedUTC(d: Date, deltaMonths: number) {
  const y0 = d.getUTCFullYear();
  const m0 = d.getUTCMonth();
  const day0 = d.getUTCDate();

  const hh = d.getUTCHours();
  const mm = d.getUTCMinutes();
  const ss = d.getUTCSeconds();
  const ms = d.getUTCMilliseconds();

  const mAbs = m0 + deltaMonths;
  const y = y0 + Math.floor(mAbs / 12);
  const m = ((mAbs % 12) + 12) % 12;

  const dim = daysInMonthUTC(y, m);
  const day = Math.min(day0, dim);

  return new Date(Date.UTC(y, m, day, hh, mm, ss, ms));
}

function getCalendarMonthBoundsUTC(now: Date) {
  const y = now.getUTCFullYear();
  const m = now.getUTCMonth();
  const start = new Date(Date.UTC(y, m, 1, 0, 0, 0, 0));
  const resetAt = new Date(Date.UTC(y, m + 1, 1, 0, 0, 0, 0));
  const monthEnd = new Date(resetAt.getTime() - 1);
  return {
    monthStart: start.toISOString(),
    resetAt: resetAt.toISOString(),
    monthEnd: monthEnd.toISOString(),
    mode: "calendar" as const,
  };
}

function getAnchoredCycleBoundsUTC(now: Date, quotaRenewAtIso: string | null) {
  if (!quotaRenewAtIso) return getCalendarMonthBoundsUTC(now);

  const base = new Date(quotaRenewAtIso);
  if (Number.isNaN(base.getTime())) return getCalendarMonthBoundsUTC(now);

  // quota_renew_at kan ligge i fortiden (fx konto oprettet i 2025),
  // så vi ruller frem til næste fornyelse > now
  let end = base;
  let guard = 0;
  while (end.getTime() <= now.getTime() && guard < 120) {
    end = addMonthsClampedUTC(end, 1);
    guard++;
  }

  const start = addMonthsClampedUTC(end, -1);
  const monthEnd = new Date(end.getTime() - 1);

  return {
    monthStart: start.toISOString(),
    resetAt: end.toISOString(),
    monthEnd: monthEnd.toISOString(),
    mode: "anchor" as const,
  };
}

async function sumQuotaUsage(opts: {
  admin: any;
  ownerId: string;
  feature: string;
  fromIso: string;
  toIso: string;
}) {
  const { admin, ownerId, feature, fromIso, toIso } = opts;

  // Vi summerer i JS for robusthed ift. schema-varianter.
  // Forbrug er små tal (fx 0-100 sider), så det er OK.
  const colsToTry = ["amount", "units", "delta", "qty", "count"] as const;

  for (const col of colsToTry) {
    const r = await admin
      .from("quota_usage")
      .select(col)
      .eq("owner_id", ownerId)
      .eq("feature", feature)
      .gte("created_at", fromIso)
      .lt("created_at", toIso)
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
    if (hits > 0 || r.data.length === 0) {
      return { sum, meta: { col, hits } };
    }
  }

  return { sum: 0, meta: null as any };
}

async function getMonthlyLimit(opts: { admin: any; plan: string; feature: string }) {
  const { admin, plan, feature } = opts;
  const r = await admin
    .from("plan_limits")
    .select("monthly_limit")
    .eq("plan", plan)
    .eq("feature", feature)
    .maybeSingle();

  const v = (r.data as any)?.monthly_limit;
  return typeof v === "number" && Number.isFinite(v) ? Math.round(v) : null;
}

function normalizePlan(raw: any) {
  const p = String(raw ?? "").trim().toLowerCase();
  if (!p) return "freemium";
  if (p === "free") return "freemium";
  if (p === "basic") return "basis";
  return p;
}

export async function GET(req: NextRequest) {
  const requestId = crypto.randomUUID();

  let ownerId = "";
  let mode: "auth" | "dev" = "auth";

  try {
    const u = await requireUser(req);
    ownerId = u.id;
    mode = u.mode;
  } catch {
    return NextResponse.json({ ok: false, error: "Unauthorized", requestId }, { status: 401 });
  }

  let admin: any;
  try {
    admin = supabaseAdmin();
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: "Server config mangler.", details: String(e?.message ?? e), requestId },
      { status: 500 },
    );
  }

  const url = new URL(req.url);
  const folderParam = (url.searchParams.get("folder_id") ?? url.searchParams.get("folderId") ?? "").trim();
  let folderId: string | null = folderParam && isUuidLike(folderParam) ? folderParam : null;

  const now = new Date();

  // Profile (plan + quota_renew_at)
  const pr = await admin.from("profiles").select("id, plan, quota_renew_at").eq("id", ownerId).maybeSingle();
  const plan = normalizePlan((pr.data as any)?.plan ?? "freemium");
  const quotaRenewAtIso = (pr.data as any)?.quota_renew_at ? String((pr.data as any).quota_renew_at) : null;

  // Hvis folderId er sat: valider at folderen findes og ejes af user (ellers null)
  if (folderId) {
    const fr = await admin.from("folders").select("id").eq("owner_id", ownerId).eq("id", folderId).maybeSingle();
    if (fr.error || !fr.data?.id) folderId = null;
  }

  // ✅ Brug anchored cycle hvis quota_renew_at findes (ellers kalender-måned)
  const bounds = getAnchoredCycleBoundsUTC(now, quotaRenewAtIso);
  const monthStart = bounds.monthStart;
  const resetAt = bounds.resetAt;
  const monthEnd = bounds.monthEnd;

  // Limit for import
  const monthlyLimit = await getMonthlyLimit({ admin, plan, feature: "import" });

  // Usage for import i den aktive “periode”
  const usedRes = await sumQuotaUsage({
    admin,
    ownerId,
    feature: "import",
    fromIso: monthStart,
    toIso: resetAt,
  });

  const usedThisMonth = n0(usedRes.sum);
  const reservedThisMonth = 0; // hvis du senere reserverer sider, kan du udfylde her

  const quotaReached = typeof monthlyLimit === "number" && Number.isFinite(monthlyLimit)
    ? usedThisMonth >= monthlyLimit
    : false;

  // Files meta (total + latest)
  let filesTotal = 0;
  {
    let q = admin.from("files").select("id", { count: "exact", head: true }).eq("owner_id", ownerId);
    if (folderId) q = q.eq("folder_id", folderId);
    const r = await q;
    filesTotal = n0(r.count);
  }

  let latest: any = null;
  {
    let q = admin
      .from("files")
      .select("id, name, folder_id, updated_at, uploaded_at, created_at")
      .eq("owner_id", ownerId);

    if (folderId) q = q.eq("folder_id", folderId);

    // robust: prøv updated_at først, ellers uploaded_at/created_at
    const r = await q.order("updated_at", { ascending: false, nullsFirst: false }).limit(1);

    if (!r.error && Array.isArray(r.data) && r.data.length) {
      latest = r.data[0];
    } else {
      const r2 = await q.order("uploaded_at", { ascending: false, nullsFirst: false }).limit(1);
      if (!r2.error && Array.isArray(r2.data) && r2.data.length) latest = r2.data[0];
      else {
        const r3 = await q.order("created_at", { ascending: false, nullsFirst: false }).limit(1);
        if (!r3.error && Array.isArray(r3.data) && r3.data.length) latest = r3.data[0];
      }
    }
  }

  // Orphaned debug (best-effort)
  let orphanedTotal = 0;
  try {
    const r = await admin
      .from("doc_chunks")
      .select("id", { count: "exact", head: true })
      .eq("owner_id", ownerId)
      .is("folder_id", null);
    orphanedTotal = n0(r.count);
  } catch {
    orphanedTotal = 0;
  }

  const latestUploadedAt =
    (latest?.updated_at ?? latest?.uploaded_at ?? latest?.created_at) ? String(latest.updated_at ?? latest.uploaded_at ?? latest.created_at) : null;

  return NextResponse.json({
    ok: true,
    requestId,

    folderId,
    plan,

    usedThisMonth,
    reservedThisMonth,
    monthlyLimit,

    resetAt,
    resetAtNice: formatDa(resetAt),
    monthStart,
    monthEnd,

    quotaReached,

    used: usedThisMonth,
    limit: monthlyLimit,

    month: { used: usedThisMonth, limit: monthlyLimit },

    quota: {
      usedThisMonth,
      limitPerMonth: monthlyLimit,
      monthStart,
      monthEnd,
      resetAt,
      plan,
    },

    files: {
      total: filesTotal,
      hasFile: filesTotal > 0,
      latest: latest
        ? {
            id: String(latest.id),
            name: String(latest.name ?? ""),
            folder_id: latest.folder_id ? String(latest.folder_id) : null,
            updated_at: latestUploadedAt,
          }
        : null,
    },

    filesTotal,
    latestFile: latest
      ? {
          name: String(latest.name ?? ""),
          uploadedAt: latestUploadedAt,
        }
      : null,

    debug: { orphanedTotal },

    message: null,

    ...(process.env.NODE_ENV !== "production"
      ? {
          _debug: {
            cycleMode: bounds.mode,
            profileQuotaRenewAt: quotaRenewAtIso,
            usageMeta: usedRes.meta ?? null,
          },
        }
      : {}),
  });
}
