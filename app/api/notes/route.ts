import "server-only";

import { NextRequest, NextResponse } from "next/server";
import { supabaseServerRoute } from "@/lib/supabase/server-route";
import { getOwnerCtx } from "@/lib/auth/owner";
import {
  filterVisibleNotes,
  getNoteEntitlement,
} from "@/lib/notes/entitlements";
import { ensureProfile } from "@/lib/server/ensureProfile";
import { supabaseAdminOrNull } from "@/lib/quota/rpc";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function normStr(v: any): string | null {
  if (v == null) return null;
  const s = String(v).trim();
  return s.length ? s : null;
}

async function readJson(req: NextRequest): Promise<any | null> {
  try {
    return await req.json();
  } catch {
    return null;
  }
}

// GET /api/notes?limit=50
export async function GET(req: NextRequest) {
  const sb = await supabaseServerRoute();
  const owner = await getOwnerCtx(req, sb);
  if (!owner) {
    return NextResponse.json(
      { ok: false, code: "UNAUTHORIZED", error: "Login kræves." },
      { status: 401 },
    );
  }

  const limitRaw = Number(req.nextUrl.searchParams.get("limit") ?? "50");
  const limit = Number.isFinite(limitRaw) ? Math.min(Math.max(limitRaw, 1), 200) : 50;
  const entitlement = await getNoteEntitlement(sb, owner.ownerId);

  const { data, error } = await sb
    .from("notes")
    .select("id, title, content, source_title, source_url, created_at")
    .eq("owner_id", owner.ownerId)
    .order("created_at", { ascending: false })
    .limit(entitlement.visibleNotesLimit ?? limit);

  if (error) {
    console.error("[api/notes GET] db error", error);
    return NextResponse.json(
      { ok: false, code: "DB_ERROR", error: "Database-fejl." },
      { status: 500 },
    );
  }

  const visibleNotes = filterVisibleNotes(data ?? [], entitlement).slice(0, limit);

  return NextResponse.json(
    {
      ok: true,
      notes: visibleNotes,
      visible_limit: entitlement.visibleNotesLimit,
      total_notes: entitlement.totalNotes,
    },
    { status: 200 },
  );
}

// POST /api/notes
// Body: { title?: string, content: string, source_title?: string, source_url?: string }
export async function POST(req: NextRequest) {
  const sb = await supabaseServerRoute();
  const owner = await getOwnerCtx(req, sb);
  if (!owner) {
    return NextResponse.json(
      { ok: false, code: "UNAUTHORIZED", error: "Login kræves." },
      { status: 401 },
    );
  }

  const body = await readJson(req);
  if (!body) {
    return NextResponse.json(
      { ok: false, code: "INVALID_JSON", error: "Ugyldigt JSON-body." },
      { status: 400 },
    );
  }

  const title = normStr(body.title);
  const content = normStr(body.content);
  const source_title = normStr(body.source_title);
  const source_url = normStr(body.source_url);

  if (!content) {
    return NextResponse.json(
      { ok: false, code: "INVALID_CONTENT", error: "Indhold må ikke være tomt." },
      { status: 400 },
    );
  }

  try {
    const profileAdmin = supabaseAdminOrNull();
    if (profileAdmin) {
      await ensureProfile(profileAdmin, owner.ownerId);
    }
  } catch (error: any) {
    console.error("[api/notes POST] ensureProfile error", error);
    return NextResponse.json(
      { ok: false, code: "NOTE_PREPARE_FAILED", error: "Kunne ikke klargøre noten." },
      { status: 500 },
    );
  }

  const { data, error } = await sb
    .from("notes")
    .insert({
      owner_id: owner.ownerId,
      title,
      content,
      source_title,
      source_url,
    })
    .select("id, title, content, source_title, source_url, created_at")
    .maybeSingle();

  if (error) {
    console.error("[api/notes POST] db error", error);
    return NextResponse.json(
      { ok: false, code: "DB_INSERT_FAILED", error: "Kunne ikke oprette note." },
      { status: 500 },
    );
  }

  return NextResponse.json({ ok: true, note: data }, { status: 200 });
}
