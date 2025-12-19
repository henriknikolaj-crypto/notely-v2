// app/api/files/[id]/route.ts
import "server-only";

import { NextRequest, NextResponse } from "next/server";
import { supabaseServerRoute } from "@/lib/supabase/server-route";
import { getOwnerCtx } from "@/lib/auth/owner";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

function normStr(v: any): string | null {
  if (v == null) return null;
  const s = String(v).trim();
  return s.length ? s : null;
}

async function resolveOwnerId(req: NextRequest, sb: any): Promise<string | null> {
  const owner = await getOwnerCtx(req, sb);
  return owner?.ownerId ?? null;
}

// Flyt fil til anden mappe (bruges af dropdownen i UI)
// Body: { folder_id: "<uuid|null>" }
export async function PUT(req: NextRequest, ctx: Ctx) {
  const { id: fileId } = await ctx.params;
  if (!fileId) {
    return NextResponse.json({ ok: false, error: "Missing id" }, { status: 400 });
  }

  const sb = await supabaseServerRoute();
  const ownerId = await resolveOwnerId(req, sb);

  if (!ownerId) {
    return NextResponse.json(
      { ok: false, code: "UNAUTHORIZED", error: "Login kræves." },
      { status: 401 },
    );
  }

  const body = (await req.json().catch(() => null)) as any;
  if (!body || !("folder_id" in body)) {
    return NextResponse.json(
      { ok: false, code: "MISSING_FOLDER_ID", error: "Mangler folder_id." },
      { status: 400 },
    );
  }

  // Tillad null (flyt ud af mappe) eller string uuid
  const folderId = body.folder_id === null ? null : normStr(body.folder_id);

  const updates = { folder_id: folderId };

  // Opdater files
  const rFiles = await sb
    .from("files")
    .update(updates)
    .eq("owner_id", ownerId)
    .eq("id", fileId);

  // Opdater training_files (legacy) — OK hvis table/row ikke findes
  const rTraining = await sb
    .from("training_files")
    .update(updates)
    .eq("owner_id", ownerId)
    .eq("id", fileId);

  if (rFiles.error && rTraining.error) {
    console.error("/api/files/[id] PUT fejl", rFiles.error, rTraining.error);
    return NextResponse.json(
      { ok: false, code: "DB_UPDATE_FAILED", error: "Kunne ikke opdatere filens mappe." },
      { status: 500 },
    );
  }

  return NextResponse.json(
    { ok: true, file_id: fileId, folder_id: folderId },
    { status: 200 },
  );
}

// Slet fil (brugt af Slet-knappen)
export async function DELETE(req: NextRequest, ctx: Ctx) {
  void req;

  const { id: fileId } = await ctx.params;
  if (!fileId) {
    return NextResponse.json({ ok: false, error: "Missing id" }, { status: 400 });
  }

  const sb = await supabaseServerRoute();
  const ownerId = await resolveOwnerId(req, sb);

  if (!ownerId) {
    return NextResponse.json(
      { ok: false, code: "UNAUTHORIZED", error: "Login kræves." },
      { status: 401 },
    );
  }

  // 1) Slet relaterede doc_chunks først (idempotent-ish)
  const rChunks = await sb
    .from("doc_chunks")
    .delete()
    .eq("owner_id", ownerId)
    .eq("file_id", fileId);

  if (rChunks.error) {
    console.error("/api/files/[id] DELETE doc_chunks fejl", rChunks.error);
    // fortsæt alligevel
  }

  // 2) Slet i files
  const rFiles = await sb
    .from("files")
    .delete()
    .eq("owner_id", ownerId)
    .eq("id", fileId);

  // 3) Slet i training_files (legacy)
  const rTraining = await sb
    .from("training_files")
    .delete()
    .eq("owner_id", ownerId)
    .eq("id", fileId);

  if (rFiles.error && rTraining.error) {
    console.error("/api/files/[id] DELETE fejl", rFiles.error, rTraining.error);
    return NextResponse.json(
      { ok: false, code: "DB_DELETE_FAILED", error: "Kunne ikke slette filen." },
      { status: 500 },
    );
  }

  return NextResponse.json({ ok: true, file_id: fileId }, { status: 200 });
}
