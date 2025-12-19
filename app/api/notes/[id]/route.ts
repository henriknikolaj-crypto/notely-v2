// app/api/notes/[id]/route.ts
import "server-only";

import { NextRequest, NextResponse } from "next/server";
import { supabaseServerRoute } from "@/lib/supabase/server-route";
import { getOwnerCtx } from "@/lib/auth/owner";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

async function deleteNote(sb: any, noteId: string, ownerId: string) {
  const { data, error } = await sb
    .from("notes")
    .delete()
    .eq("id", noteId)
    .eq("owner_id", ownerId)
    .select("id")
    .maybeSingle();

  if (error) {
    console.error("[notes/:id] delete error", { noteId, error });
    throw new Error("DB delete failed");
  }

  // idempotent: 0 rækker = OK
  return !!data;
}

export async function DELETE(req: NextRequest, ctx: Ctx) {
  const { id: noteId } = await ctx.params;
  if (!noteId) {
    return NextResponse.json(
      { ok: false, code: "MISSING_ID", error: "Missing note id" },
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

  try {
    await deleteNote(sb, noteId, owner.ownerId);
    return NextResponse.json({ ok: true, id: noteId }, { status: 200 });
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, code: "DB_DELETE_FAILED", error: e?.message ?? "DB delete failed" },
      { status: 500 },
    );
  }
}

// POST /api/notes/:id med _method=DELETE (HTML form)
export async function POST(req: NextRequest, ctx: Ctx) {
  const { id: noteId } = await ctx.params;
  if (!noteId) {
    return NextResponse.json(
      { ok: false, code: "MISSING_ID", error: "Missing note id" },
      { status: 400 },
    );
  }

  const form = await req.formData().catch(() => null);
  const methodOverride = String(form?.get("_method") || "").toUpperCase();

  if (methodOverride !== "DELETE") {
    return NextResponse.json(
      { ok: false, code: "METHOD_NOT_ALLOWED", error: "Method not allowed" },
      { status: 405 },
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

  try {
    await deleteNote(sb, noteId, owner.ownerId);
    return NextResponse.redirect(new URL("/traener/noter/historik", req.url), 303);
  } catch (e: any) {
    console.error("[notes/:id POST _method=DELETE] error", e);
    return NextResponse.json(
      { ok: false, code: "DB_DELETE_FAILED", error: e?.message ?? "DB delete failed" },
      { status: 500 },
    );
  }
}
