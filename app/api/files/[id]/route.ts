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

function isUuidLike(s: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(s);
}

async function resolveOwnerId(req: NextRequest, sb: any): Promise<string | null> {
  const owner = await getOwnerCtx(req, sb);
  return owner?.ownerId ?? null;
}

async function readJson(req: NextRequest): Promise<any | null> {
  try {
    const raw = (await req.text()).trim();
    if (!raw) return null;
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function isMissingTableErr(err: any) {
  const code = String(err?.code ?? "");
  const msg = String(err?.message ?? "").toLowerCase();
  return code === "42P01" || msg.includes('relation "training_files" does not exist');
}

// Flyt fil til anden mappe (bruges af dropdownen i UI)
// Body: { folder_id: "<uuid|null>" }  (accepter også folderId)
export async function PUT(req: NextRequest, ctx: Ctx) {
  const { id: fileId } = await ctx.params;

  if (!fileId || !isUuidLike(fileId)) {
    return NextResponse.json({ ok: false, code: "INVALID_ID", error: "Ugyldigt fil-id." }, { status: 400 });
  }

  const sb = await supabaseServerRoute();
  const ownerId = await resolveOwnerId(req, sb);

  if (!ownerId) {
    return NextResponse.json({ ok: false, code: "UNAUTHORIZED", error: "Login kræves." }, { status: 401 });
  }

  const body = await readJson(req);
  const hasFolderId = !!body && ("folder_id" in body || "folderId" in body);
  if (!hasFolderId) {
    return NextResponse.json({ ok: false, code: "MISSING_FOLDER_ID", error: "Mangler folder_id." }, { status: 400 });
  }

  const raw = ("folder_id" in body ? body.folder_id : body.folderId) as any;

  // Tillad null (flyt ud af mappe) eller string uuid
  const folderId = raw === null ? null : normStr(raw);

  if (folderId !== null && (!folderId || !isUuidLike(folderId))) {
    return NextResponse.json(
      { ok: false, code: "INVALID_FOLDER_ID", error: "folder_id skal være uuid eller null." },
      { status: 400 },
    );
  }

  // Hvis folderId != null → valider folderen findes og ejes af user (KORREKT tabel: folders)
  if (folderId !== null) {
    const rFolder = await sb
      .from("folders")
      .select("id")
      .eq("owner_id", ownerId)
      .eq("id", folderId)
      .maybeSingle();

    if (rFolder.error) {
      console.error("/api/files/[id] PUT folder lookup fejl", rFolder.error);
      return NextResponse.json(
        { ok: false, code: "FOLDER_LOOKUP_FAILED", error: "Kunne ikke validere mappen." },
        { status: 500 },
      );
    }
    if (!rFolder.data?.id) {
      return NextResponse.json(
        { ok: false, code: "FOLDER_NOT_FOUND", error: "Mappen findes ikke." },
        { status: 400 },
      );
    }
  }

  const updates = { folder_id: folderId };

  // 1) Canonical: files
  const rFiles = await sb
    .from("files")
    .update(updates)
    .eq("owner_id", ownerId)
    .eq("id", fileId)
    .select("id, folder_id")
    .maybeSingle();

  // 2) Hold doc_chunks i sync (vigtigt for folder-scope i træning)
  const rChunks = await sb
    .from("doc_chunks")
    .update(updates)
    .eq("owner_id", ownerId)
    .eq("file_id", fileId);

  // 3) Legacy: training_files (best effort)
  const rTraining = await sb
    .from("training_files")
    .update(updates)
    .eq("owner_id", ownerId)
    .eq("id", fileId);

  const trainingOk = !rTraining.error || isMissingTableErr(rTraining.error);

  if (rFiles.error) {
    console.error("/api/files/[id] PUT files update fejl", rFiles.error, rTraining.error);
    return NextResponse.json(
      { ok: false, code: "DB_UPDATE_FAILED", error: "Kunne ikke opdatere filens mappe." },
      { status: 500 },
    );
  }

  if (rChunks.error) {
    console.error("/api/files/[id] PUT doc_chunks update fejl", rChunks.error);
    return NextResponse.json(
      { ok: false, code: "CHUNKS_UPDATE_FAILED", error: "Kunne ikke opdatere doc_chunks til ny mappe." },
      { status: 500 },
    );
  }

  if (!rFiles.data?.id && !trainingOk) {
    return NextResponse.json({ ok: false, code: "NOT_FOUND", error: "Filen blev ikke fundet." }, { status: 404 });
  }

  return NextResponse.json({ ok: true, file_id: fileId, folder_id: folderId }, { status: 200 });
}

// Slet fil (brugt af Slet-knappen)
export async function DELETE(req: NextRequest, ctx: Ctx) {
  const { id: fileId } = await ctx.params;

  if (!fileId || !isUuidLike(fileId)) {
    return NextResponse.json({ ok: false, code: "INVALID_ID", error: "Ugyldigt fil-id." }, { status: 400 });
  }

  const sb = await supabaseServerRoute();
  const ownerId = await resolveOwnerId(req, sb);

  if (!ownerId) {
    return NextResponse.json({ ok: false, code: "UNAUTHORIZED", error: "Login kræves." }, { status: 401 });
  }

  // 1) hent storage_path (best effort)
  const rFile = await sb
    .from("files")
    .select("id, storage_path")
    .eq("owner_id", ownerId)
    .eq("id", fileId)
    .maybeSingle();

  if (rFile.error) {
    console.error("/api/files/[id] DELETE file lookup fejl", rFile.error);
    return NextResponse.json({ ok: false, code: "DB_READ_FAILED", error: "Kunne ikke læse filen." }, { status: 500 });
  }

  // 2) slet i files (doc_chunks ryger via FK ON DELETE CASCADE)
  const rDelFiles = await sb.from("files").delete().eq("owner_id", ownerId).eq("id", fileId);

  // 3) slet i training_files (legacy) — best effort
  const rDelTraining = await sb.from("training_files").delete().eq("owner_id", ownerId).eq("id", fileId);

  const legacyOk = !rDelTraining.error || isMissingTableErr(rDelTraining.error);

  if (rDelFiles.error) {
    console.error("/api/files/[id] DELETE files fejl", rDelFiles.error, rDelTraining.error);
    return NextResponse.json({ ok: false, code: "DB_DELETE_FAILED", error: "Kunne ikke slette filen." }, { status: 500 });
  }

  if (rFile.data?.storage_path) {
    try {
      await sb.storage.from("trainer_uploads").remove([String(rFile.data.storage_path)]);
    } catch (e) {
      console.warn("/api/files/[id] DELETE storage cleanup warning", e);
    }
  }

  if (!legacyOk) {
    console.warn("/api/files/[id] DELETE legacy training_files fejl", rDelTraining.error);
  }

  return NextResponse.json({ ok: true, file_id: fileId }, { status: 200 });
}
