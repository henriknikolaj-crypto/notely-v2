// app/api/exam-sessions/route.ts
import "server-only";

import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type ExamSessionRow = {
  id: string;
  score: number | null;
  created_at: string | null;
  folder_id: string | null;
  source_type: string | null;
};

const ALLOWED_SOURCE_TYPES = new Set([
  "trainer",
  "mc",
  "flashcards",
  "simulator",
  "notes",
  "import",
]);

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

// GET /api/exam-sessions?limit=5&folder_id=...&source_type=trainer|mc|...&before=ISO
export async function GET(req: NextRequest) {
  try {
    const { sb, id: ownerId } = await requireUser(req);

    const sp = req.nextUrl.searchParams;

    const limit = clampInt(sp.get("limit"), 10, 1, 50);

    const folderFilter = asNonEmpty(sp.get("folder_id") ?? sp.get("folderId"));
    const sourceType = asNonEmpty(sp.get("source_type") ?? sp.get("sourceType"));
    const before = asIsoDate(sp.get("before"));

    if (sourceType && !ALLOWED_SOURCE_TYPES.has(sourceType)) {
      return NextResponse.json(
        { ok: false, error: "Invalid source_type" },
        { status: 400 },
      );
    }

    let q = sb
      .from("exam_sessions")
      .select("id, score, created_at, folder_id, source_type")
      .eq("owner_id", ownerId)
      .order("created_at", { ascending: false })
      .limit(limit);

    if (folderFilter) q = q.eq("folder_id", folderFilter);
    if (sourceType) q = q.eq("source_type", sourceType);
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
