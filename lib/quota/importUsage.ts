import "server-only";

type ImportQuotaSnapshot = {
  plan: string;
  monthStart: string;
  monthEnd: string;
  resetAt: string;
  monthlyLimit: number | null;
  usedThisMonth: number;
  quotaReached: boolean;
};

function n0(x: any): number {
  const v = typeof x === "number" ? x : Number(x);
  return Number.isFinite(v) ? v : 0;
}

function normalizePlan(raw: any) {
  const p = String(raw ?? "").trim().toLowerCase();
  if (!p) return "freemium";
  if (p === "free") return "freemium";
  if (p === "basic") return "basis";
  return p;
}

function daysInMonthUTC(year: number, month0: number) {
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
  };
}

function getAnchoredCycleBoundsUTC(now: Date, quotaRenewAtIso: string | null) {
  if (!quotaRenewAtIso) return getCalendarMonthBoundsUTC(now);

  const base = new Date(quotaRenewAtIso);
  if (Number.isNaN(base.getTime())) return getCalendarMonthBoundsUTC(now);

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
  };
}

function extractPagesFromJob(row: any) {
  const payload = row?.payload ?? null;
  const direct =
    payload?.pages ??
    payload?.page_count ??
    payload?.pageCount ??
    payload?.p_amount ??
    null;
  const pages = n0(direct);
  return pages > 0 ? pages : 1;
}

async function getMonthlyLimit(opts: { admin: any; plan: string; feature: string }) {
  const { admin, plan, feature } = opts;
  const r = await admin
    .from("plan_limits")
    .select("monthly_limit, is_unlimited")
    .eq("plan", plan)
    .eq("feature", feature)
    .maybeSingle();

  if ((r.data as any)?.is_unlimited === true) return null;

  const v = (r.data as any)?.monthly_limit;
  return typeof v === "number" && Number.isFinite(v) ? Math.round(v) : null;
}

async function sumSuccessfulImportPages(opts: {
  admin: any;
  ownerId: string;
  fromIso: string;
  toIso: string;
}) {
  const { admin, ownerId, fromIso, toIso } = opts;
  const tsCols = ["queued_at", "created_at", "inserted_at"] as const;

  for (const tsCol of tsCols) {
    const r = await admin
      .from("jobs")
      .select("payload")
      .eq("owner_id", ownerId)
      .eq("kind", "import")
      .in("status", ["succeeded", "finished", "completed"])
      .gte(tsCol, fromIso)
      .lt(tsCol, toIso)
      .limit(5000);

    if (r.error || !Array.isArray(r.data)) continue;
    const sum = (r.data as any[]).reduce((acc, row) => acc + extractPagesFromJob(row), 0);
    return sum;
  }

  return 0;
}

export async function getImportQuotaSnapshot(opts: {
  admin: any;
  ownerId: string;
  now?: Date;
}): Promise<ImportQuotaSnapshot> {
  const { admin, ownerId, now = new Date() } = opts;
  const pr = await admin.from("profiles").select("id, plan, quota_renew_at").eq("id", ownerId).maybeSingle();
  const plan = normalizePlan((pr.data as any)?.plan ?? "freemium");
  const quotaRenewAtIso = (pr.data as any)?.quota_renew_at ? String((pr.data as any).quota_renew_at) : null;

  const bounds = getAnchoredCycleBoundsUTC(now, quotaRenewAtIso);
  const monthlyLimit = await getMonthlyLimit({ admin, plan, feature: "import" });
  const usedThisMonth = await sumSuccessfulImportPages({
    admin,
    ownerId,
    fromIso: bounds.monthStart,
    toIso: bounds.resetAt,
  });

  return {
    plan,
    monthStart: bounds.monthStart,
    monthEnd: bounds.monthEnd,
    resetAt: bounds.resetAt,
    monthlyLimit,
    usedThisMonth,
    quotaReached: typeof monthlyLimit === "number" ? usedThisMonth >= monthlyLimit : false,
  };
}
