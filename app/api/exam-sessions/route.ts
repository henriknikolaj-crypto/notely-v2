import "server-only";

import { NextRequest, NextResponse } from "next/server";
import { supabaseServerRouteReadOnly } from "@/lib/supabase/server-route-readonly";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type ExamSessionRow = {
  id: string;
  score: number | null;
  feedback?: string | null;
  created_at: string | null;
  folder_id: string | null;
  source_type: string | null;
  meta?: unknown;
  metadata?: unknown;
};

type OverviewItem = {
  folderId: string;
  folderName: string;
  attemptsWritten: number;
  lastTrainedAt: string | null;
  avgLast5: number | null;

  folder_id: string;
  folder_title: string;
  attempts_total: number;
  avg_last5: number | null;
  last_trained_at: string | null;
};

const ALLOWED_SOURCE_TYPES = new Set([
  "trainer",
  "mc",
  "flashcards",
  "simulator",
  "oral",
  "notes",
  "import",
]);

const OVERVIEW_ALLOWED_SOURCE_TYPES = new Set(["trainer", "simulator", "oral"]);

function clampInt(raw: string | null, def: number, min: number, max: number) {
  const n = raw ? Number(raw) : def;
  if (!Number.isFinite(n)) return def;
  const i = Math.floor(n);
  return Math.max(min, Math.min(max, i));
}

function asNonEmpty(s: string | null): string | null {
  const v = (s ?? "").trim();
  return v.length ? v : null;
}

function asIsoDate(s: string | null): string | null {
  const v = asNonEmpty(s);
  if (!v) return null;
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString();
}

function asBool(raw: string | null): boolean {
  const v = (raw ?? "").trim().toLowerCase();
  return v === "1" || v === "true" || v === "yes" || v === "on";
}

function asFolderId(v: unknown): string | null {
  const s = String(v ?? "").trim();
  return s || null;
}

function parseSourceTypesCsv(raw: string | null): string[] {
  const v = (raw ?? "").trim();
  if (!v) return [];

  const out: string[] = [];
  const seen = new Set<string>();
  for (const part of v.split(",")) {
    const s = part.trim();
    if (!s || seen.has(s)) continue;
    seen.add(s);
    out.push(s);
  }
  return out;
}

function meanRounded(nums: number[]): number | null {
  if (!nums.length) return null;
  const avg = nums.reduce((sum, n) => sum + n, 0) / nums.length;
  return Math.round(avg);
}

async function getOverview(req: NextRequest, sb: any, ownerId: string) {
  const sp = req.nextUrl.searchParams;
  const requested = parseSourceTypesCsv(sp.get("source_types") ?? sp.get("sourceTypes"));
  const sourceTypes = requested.length ? requested : ["trainer", "simulator", "oral"];

  const invalid = sourceTypes.find((s) => !OVERVIEW_ALLOWED_SOURCE_TYPES.has(s));
  if (invalid) {
    return NextResponse.json(
      { ok: false, error: `Invalid source_type for overview: ${invalid}` },
      { status: 400 },
    );
  }

  const { data: foldersData, error: foldersError } = await sb
    .from("folders")
    .select("id,name,archived_at")
    .eq("owner_id", ownerId)
    .is("archived_at", null)
    .order("name", { ascending: true });

  if (foldersError) {
    console.error("[exam-sessions] overview folders error:", foldersError);
    return NextResponse.json({ ok: false, error: "DB error" }, { status: 500 });
  }

  const folders = (foldersData ?? []) as Array<{ id: string; name: string | null }>;

  const { data, error } = await sb
    .from("exam_sessions")
    .select("id, score, created_at, folder_id, source_type")
    .eq("owner_id", ownerId)
    .not("folder_id", "is", null)
    .in("source_type", sourceTypes)
    .order("created_at", { ascending: false })
    .limit(5000);

  if (error) {
    console.error("[exam-sessions] overview select error:", error);
    return NextResponse.json({ ok: false, error: "DB error" }, { status: 500 });
  }

  const rows = ((data ?? []) as ExamSessionRow[]).filter((r) => !!asFolderId(r.folder_id));
  const byFolder = new Map<string, ExamSessionRow[]>();

  for (const row of rows) {
    const folderId = asFolderId(row.folder_id);
    if (!folderId) continue;
    if (!byFolder.has(folderId)) byFolder.set(folderId, []);
    byFolder.get(folderId)!.push(row);
  }

  const items: OverviewItem[] = [];

  for (const folder of folders) {
    const folderId = asFolderId((folder as any)?.id);
    if (!folderId) continue;

    const sessions = byFolder.get(folderId) ?? [];
    const scores = sessions
      .map((s) => s.score)
      .filter((n): n is number => typeof n === "number" && Number.isFinite(n));

    const avg_last5 = meanRounded(scores.slice(0, 5));
    const last_trained_at =
      sessions
        .map((s) => s.created_at)
        .filter((d): d is string => typeof d === "string" && d.trim().length > 0)
        .sort((a, b) => Date.parse(b) - Date.parse(a))[0] ?? null;

    const folderTitle = asNonEmpty((folder as any)?.name ?? null) ?? "Ukendt mappe";
    const attemptsWritten = sessions.length;

    items.push({
      folderId,
      folderName: folderTitle,
      attemptsWritten,
      lastTrainedAt: last_trained_at,
      avgLast5: avg_last5,

      folder_id: folderId,
      folder_title: folderTitle,
      attempts_total: attemptsWritten,
      avg_last5,
      last_trained_at,
    });
  }

  items.sort((a, b) => {
    if (b.attemptsWritten !== a.attemptsWritten) return b.attemptsWritten - a.attemptsWritten;
    const aTs = a.lastTrainedAt ? Date.parse(a.lastTrainedAt) : 0;
    const bTs = b.lastTrainedAt ? Date.parse(b.lastTrainedAt) : 0;
    if (bTs !== aTs) return bTs - aTs;
    return a.folderName.localeCompare(b.folderName, "da");
  });

  return NextResponse.json({ ok: true, items }, { status: 200 });
}

// GET /api/exam-sessions?limit=5&folder_id=...&source_type=trainer|mc|...&before=ISO
export async function GET(req: NextRequest) {
  const cookieNames = req.cookies.getAll().map((cookie) => cookie.name);
  try {
    const sb = supabaseServerRouteReadOnly(req);
    const { data: sessionData, error: sessionError } = await sb.auth.getSession();
    const sessionUserId = sessionData?.session?.user?.id ? String(sessionData.session.user.id) : null;

    let ownerId = sessionUserId;
    let getUserError: string | null = null;

    if (!ownerId) {
      const { data: authData, error: authError } = await sb.auth.getUser();
      getUserError = authError?.message ?? null;
      ownerId = authData?.user?.id ? String(authData.user.id) : null;
    }

    if (!ownerId) {
      return NextResponse.json(
        {
          ok: false,
          error: "Unauthorized",
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
        { status: 401 },
      );
    }

    const sp = req.nextUrl.searchParams;
    const mode = asNonEmpty(sp.get("mode"));

    if (mode === "overview") {
      return getOverview(req, sb, ownerId);
    }

    const limit = clampInt(sp.get("limit"), 10, 1, 50);

    const folderFilter = asNonEmpty(sp.get("folder_id") ?? sp.get("folderId"));
    const sourceType = asNonEmpty(sp.get("source_type") ?? sp.get("sourceType"));
    const sourceTypes = parseSourceTypesCsv(sp.get("source_types") ?? sp.get("sourceTypes"));
    const before = asIsoDate(sp.get("before"));
    const includeMeta = asBool(sp.get("include_meta") ?? sp.get("includeMeta"));

    if (sourceTypes.length) {
      const invalid = sourceTypes.find((s) => !ALLOWED_SOURCE_TYPES.has(s));
      if (invalid) {
        return NextResponse.json(
          { ok: false, error: `Invalid source_type: ${invalid}` },
          { status: 400 },
        );
      }
    } else if (sourceType && !ALLOWED_SOURCE_TYPES.has(sourceType)) {
      return NextResponse.json(
        { ok: false, error: "Invalid source_type" },
        { status: 400 },
      );
    }

    let q = sb
      .from("exam_sessions")
      .select(
        includeMeta
          ? "id, score, feedback, created_at, folder_id, source_type, meta, metadata"
          : "id, score, created_at, folder_id, source_type",
      )
      .eq("owner_id", ownerId)
      .order("created_at", { ascending: false })
      .limit(limit);

    if (folderFilter) q = q.eq("folder_id", folderFilter);
    if (sourceTypes.length) q = q.in("source_type", sourceTypes);
    else if (sourceType) q = q.eq("source_type", sourceType);
    if (before) q = q.lt("created_at", before);

    const { data, error } = await q;

    if (error) {
      console.error("[exam-sessions] select error:", error);
      return NextResponse.json({ ok: false, error: "DB error" }, { status: 500 });
    }

    return NextResponse.json(
      { ok: true, sessions: (data ?? []) as ExamSessionRow[] },
      { status: 200 },
    );
  } catch (err: any) {
    const msg = String(err?.message ?? "");
    const isAuth = msg.toLowerCase().includes("unauthorized");
    if (!isAuth) console.error("[exam-sessions] route error:", err);

    return NextResponse.json(
      { ok: false, error: isAuth ? "Unauthorized" : (err?.message ?? "Unknown error") },
      { status: isAuth ? 401 : 500 },
    );
  }
}
