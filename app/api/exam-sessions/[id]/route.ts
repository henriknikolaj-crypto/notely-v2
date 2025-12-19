import "server-only";

import { NextRequest, NextResponse } from "next/server";
import { supabaseServerRoute } from "@/lib/supabase/server-route";
import { getOwnerCtx } from "@/lib/auth/owner";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

async function deleteExamSession(sb: any, id: string, ownerId: string) {
  // 1) find row (idempotent-ish)
  const { data: row, error: fetchError } = await sb
    .from("exam_sessions")
    .select("id, owner_id")
    .eq("id", id)
    .maybeSingle();

  if (fetchError) {
    console.error("[exam-sessions/:id] fetch error", { id, fetchError });
    return { ok: false as const, status: 500 as const, error: "DB error" };
  }

  if (!row) {
    // idempotent: already gone
    return { ok: true as const, status: 200 as const, alreadyDeleted: true as const };
  }

  if (row.owner_id !== ownerId) {
    return { ok: false as const, status: 403 as const, error: "Forbidden" };
  }

  // 2) delete with owner filter (extra safety)
  const { error: deleteError } = await sb
    .from("exam_sessions")
    .delete()
    .eq("id", id)
    .eq("owner_id", ownerId);

  if (deleteError) {
    console.error("[exam-sessions/:id] delete error", { id, deleteError });
    return { ok: false as const, status: 500 as const, error: "DB delete failed" };
  }

  return { ok: true as const, status: 200 as const };
}

// Direkte DELETE (fetch)
export async function DELETE(req: NextRequest, ctx: Ctx) {
  const { id } = await ctx.params;

  if (!id) {
    return NextResponse.json({ ok: false, error: "Missing id" }, { status: 400 });
  }

  const sb = await supabaseServerRoute();
  const owner = await getOwnerCtx(req, sb);
  if (!owner) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }

  const result = await deleteExamSession(sb, id, owner.ownerId);

  if (!result.ok) {
    return NextResponse.json({ ok: false, error: result.error }, { status: result.status });
  }

  return NextResponse.json(
    { ok: true, id, ...(result as any).alreadyDeleted ? { alreadyDeleted: true } : {} },
    { status: 200 },
  );
}

// POST med _method=DELETE (HTML form)
export async function POST(req: NextRequest, ctx: Ctx) {
  const { id } = await ctx.params;

  if (!id) {
    return NextResponse.json({ ok: false, error: "Missing id" }, { status: 400 });
  }

  const formData = await req.formData().catch(() => null);
  const methodOverride = String(formData?.get("_method") || "").toUpperCase();

  if (methodOverride !== "DELETE") {
    return NextResponse.json({ ok: false, error: "Unsupported method" }, { status: 405 });
  }

  const sb = await supabaseServerRoute();
  const owner = await getOwnerCtx(req, sb);
  if (!owner) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }

  const result = await deleteExamSession(sb, id, owner.ownerId);

  if (!result.ok) {
    return NextResponse.json({ ok: false, error: result.error }, { status: result.status });
  }

  return NextResponse.redirect(new URL("/traener/evalueringer", req.url), 303);
}
