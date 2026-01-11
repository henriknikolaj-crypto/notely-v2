import "server-only";

import { NextRequest, NextResponse } from "next/server";
import { supabaseServerRoute } from "@/lib/supabase/server-route";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function json(status: number, payload: any) {
  return NextResponse.json(payload, { status });
}

async function getOwnerId(req: NextRequest, sb: any): Promise<string | null> {
  // 1) Real auth
  try {
    const { data } = await sb.auth.getUser();
    if (data?.user?.id) return data.user.id as string;
  } catch {}

  // 2) Dev fallback for browser (ingen headers)
  if (process.env.NODE_ENV !== "production" && process.env.DEV_USER_ID) {
    return process.env.DEV_USER_ID;
  }

  // 3) Header bypass (PowerShell)
  const expected = process.env.DEV_BYPASS_SECRET;
  const h = req.headers.get("x-dev-secret") || req.headers.get("x-shared-secret");
  if (expected && h && h === expected) return process.env.DEV_USER_ID ?? null;

  return null;
}

function parseScope(req: NextRequest): string[] {
  const url = new URL(req.url);
  const a = url.searchParams.getAll("scopeFolderIds[]").filter(Boolean);
  if (a.length > 0) return a;

  return (url.searchParams.get("scopeFolderIds") ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

export async function GET(req: NextRequest) {
  const sb = await supabaseServerRoute(); // ✅ vigtig
  const ownerId = await getOwnerId(req, sb);

  if (!ownerId) {
    return json(401, { ok: false, error: "Unauthorized (mangler login eller dev-bypass)." });
  }

  const url = new URL(req.url);
  const limitRaw = Number(url.searchParams.get("limit") ?? 5);
  const limit = Math.max(1, Math.min(50, Number.isFinite(limitRaw) ? limitRaw : 5));

  const scopeFolderIds = parseScope(req);

  let q = sb
    .from("flashcard_sessions")
    .select("id,scope_folder_ids,difficulty,requested,returned,created_at")
    .eq("owner_id", ownerId)
    .order("created_at", { ascending: false })
    .limit(limit);

  if (scopeFolderIds.length > 0) q = q.overlaps("scope_folder_ids", scopeFolderIds);

  const { data, error } = await q;

  if (error) {
    return json(500, { ok: false, error: "Kunne ikke hente sessions.", detail: String(error.message ?? error) });
  }

  return json(200, { ok: true, sessions: data ?? [] });
}
