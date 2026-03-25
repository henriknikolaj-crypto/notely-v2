// app/api/import-status/route.ts
import "server-only";

import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { requireUser } from "@/lib/auth";
import { getImportQuotaSnapshot } from "@/lib/quota/importUsage";

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

export async function GET(req: NextRequest) {
  const requestId = crypto.randomUUID();

  let ownerId = "";

  try {
    const u = await requireUser(req);
    ownerId = u.id;
    void u.mode;
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

  // Hvis folderId er sat: valider at folderen findes og ejes af user (ellers null)
  if (folderId) {
    const fr = await admin.from("folders").select("id").eq("owner_id", ownerId).eq("id", folderId).maybeSingle();
    if (fr.error || !fr.data?.id) folderId = null;
  }

  const quota = await getImportQuotaSnapshot({ admin, ownerId });
  const plan = quota.plan;
  const monthStart = quota.monthStart;
  const resetAt = quota.resetAt;
  const monthEnd = quota.monthEnd;
  const monthlyLimit = quota.monthlyLimit;
  const usedThisMonth = quota.usedThisMonth;
  const reservedThisMonth = 0; // hvis du senere reserverer sider, kan du udfylde her
  const quotaReached = quota.quotaReached;

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
            quotaSource: "successful_import_jobs",
          },
        }
      : {}),
  });
}
