// app/api/notes/folders/[id]/rename/route.ts
import "server-only";

import { NextRequest, NextResponse } from "next/server";
import { supabaseServerRoute } from "@/lib/supabase/server-route";
import { getOwnerCtx } from "@/lib/auth/owner";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteCtx = { params: Promise<{ id: string }> };

function normStr(v: any): string | null {
  if (v == null) return null;
  const s = String(v).trim();
  return s.length ? s : null;
}

async function readJson(req: NextRequest): Promise<any | null> {
  const raw = (await req.text()).trim();
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

async function doRename(req: NextRequest, ctx: RouteCtx) {
  const { id } = await ctx.params;
  if (!id) {
    return NextResponse.json(
      { ok: false, code: "MISSING_ID", error: "Mangler folder-id." },
      { status: 400 },
    );
  }

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

  const name = normStr(body.name);
  if (!name) {
    return NextResponse.json(
      { ok: false, code: "INVALID_NAME", error: "Navn må ikke være tomt." },
      { status: 400 },
    );
  }

  const { data, error } = await sb
    .from("notes_folders")
    .update({ name })
    .eq("id", id)
    .eq("owner_id", owner.ownerId)
    .select("id, name, parent_id")
    .maybeSingle();

  if (error) {
    console.error("[notes_folders/:id/rename] db error", error);
    return NextResponse.json(
      { ok: false, code: "DB_UPDATE_FAILED", error: "Kunne ikke omdøbe folderen." },
      { status: 500 },
    );
  }

  if (!data) {
    return NextResponse.json(
      { ok: false, code: "NOT_FOUND", error: "Folderen findes ikke." },
      { status: 404 },
    );
  }

  return NextResponse.json({ ok: true, folder: data }, { status: 200 });
}

export async function POST(req: NextRequest, ctx: RouteCtx) {
  return doRename(req, ctx);
}

export async function PATCH(req: NextRequest, ctx: RouteCtx) {
  return doRename(req, ctx);
}
