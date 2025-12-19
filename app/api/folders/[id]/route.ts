// app/api/folders/[id]/route.ts
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

function normDate(v: any): string | null {
  const s = normStr(v);
  if (!s) return null;
  const d = s.slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(d) ? d : null;
}

async function resolveOwnerId(req: NextRequest, sb: any): Promise<string | null> {
  const owner = await getOwnerCtx(req, sb);
  return owner?.ownerId ?? null; // ingen silent DEV fallback her
}

async function countInTable(sb: any, table: string, where: Record<string, any>): Promise<number> {
  let q = sb.from(table).select("id", { count: "exact", head: true });
  for (const [k, v] of Object.entries(where)) {
    if (v === null) q = q.is(k, null);
    else q = q.eq(k, v);
  }
  const { count } = await q;
  return typeof count === "number" ? count : 0;
}

export async function PATCH(req: NextRequest, ctx: Ctx) {
  const { id } = await ctx.params;

  const sb = await supabaseServerRoute();
  const ownerId = await resolveOwnerId(req, sb);
  if (!ownerId) {
    return NextResponse.json({ ok: false, code: "UNAUTHORIZED", error: "Login kræves." }, { status: 401 });
  }
  if (!id) return NextResponse.json({ ok: false, code: "MISSING_ID", error: "Mangler id." }, { status: 400 });

  const body = (await req.json().catch(() => null)) as any;
  if (!body) return NextResponse.json({ ok: false, code: "INVALID_JSON", error: "Ugyldigt JSON." }, { status: 400 });

  const name = normStr(body.name);
  const start_date = "start_date" in body ? normDate(body.start_date) : undefined;
  const end_date = "end_date" in body ? normDate(body.end_date) : undefined;

  if (!name) {
    return NextResponse.json({ ok: false, code: "INVALID_NAME", error: "Navn må ikke være tomt." }, { status: 400 });
  }

  const patch: Record<string, any> = { name };
  if (start_date !== undefined) patch.start_date = start_date;
  if (end_date !== undefined) patch.end_date = end_date;

  const { data: updated, error } = await sb
    .from("folders")
    .update(patch)
    .eq("owner_id", ownerId)
    .eq("id", id)
    .is("archived_at", null)
    .select("id,name,parent_id,start_date,end_date,archived_at")
    .maybeSingle();

  if (error) {
    console.error("[folders/:id PATCH] db error", error);
    return NextResponse.json({ ok: false, code: "DB_UPDATE_FAILED", error: "Kunne ikke gemme ændringer." }, { status: 500 });
  }
  if (!updated) return NextResponse.json({ ok: false, code: "NOT_FOUND", error: "Folderen findes ikke." }, { status: 404 });

  return NextResponse.json({ ok: true, folder: updated }, { status: 200 });
}

export async function DELETE(req: NextRequest, ctx: Ctx) {
  const { id } = await ctx.params;

  const sb = await supabaseServerRoute();
  const ownerId = await resolveOwnerId(req, sb);
  if (!ownerId) {
    return NextResponse.json({ ok: false, code: "UNAUTHORIZED", error: "Login kræves." }, { status: 401 });
  }
  if (!id) return NextResponse.json({ ok: false, code: "MISSING_ID", error: "Mangler id." }, { status: 400 });

  const force = req.nextUrl.searchParams.get("force") === "1";

  const { data: folder, error: fErr } = await sb
    .from("folders")
    .select("id,owner_id,archived_at,parent_id")
    .eq("id", id)
    .maybeSingle();

  if (fErr) {
    console.error("[folders/:id DELETE] db error", fErr);
    return NextResponse.json({ ok: false, code: "DB_ERROR", error: "Database-fejl." }, { status: 500 });
  }

  if (!folder || folder.archived_at) {
    return NextResponse.json({ ok: true, alreadyDeleted: true }, { status: 200 });
  }

  if (folder.owner_id !== ownerId) {
    return NextResponse.json({ ok: false, code: "FORBIDDEN", error: "Ingen adgang." }, { status: 403 });
  }

  const filesCount = await countInTable(sb, "files", { owner_id: ownerId, folder_id: id });
  const childFoldersCount = await countInTable(sb, "folders", {
    owner_id: ownerId,
    parent_id: id,
    archived_at: null,
  });

  if (force) {
    const { data: fileRows, error: frErr } = await sb
      .from("files")
      .select("id")
      .eq("owner_id", ownerId)
      .eq("folder_id", id);

    if (frErr) {
      console.error("[folders/:id DELETE force] files lookup error", frErr);
      return NextResponse.json({ ok: false, code: "DB_ERROR", error: "Database-fejl." }, { status: 500 });
    }

    const fileIds = (fileRows ?? []).map((r: any) => r.id).filter(Boolean);

    if (fileIds.length > 0) {
      const { error: dcErr } = await sb
        .from("doc_chunks")
        .delete()
        .eq("owner_id", ownerId)
        .in("file_id", fileIds);

      if (dcErr) {
        console.error("[folders/:id DELETE force] doc_chunks delete error", dcErr);
        return NextResponse.json({ ok: false, code: "DB_DELETE_FAILED", error: "Kunne ikke slette doc_chunks." }, { status: 500 });
      }
    }

    const { error: delFilesErr } = await sb
      .from("files")
      .delete()
      .eq("owner_id", ownerId)
      .eq("folder_id", id);

    if (delFilesErr) {
      console.error("[folders/:id DELETE force] files delete error", delFilesErr);
      return NextResponse.json({ ok: false, code: "DB_DELETE_FAILED", error: "Kunne ikke slette filer." }, { status: 500 });
    }

    const { error: archChildrenErr } = await sb
      .from("folders")
      .update({ archived_at: new Date().toISOString() })
      .eq("owner_id", ownerId)
      .eq("parent_id", id)
      .is("archived_at", null);

    if (archChildrenErr) {
      console.error("[folders/:id DELETE force] archive children error", archChildrenErr);
      return NextResponse.json({ ok: false, code: "DB_UPDATE_FAILED", error: "Kunne ikke arkivere under-mapper." }, { status: 500 });
    }
  } else {
    if (filesCount > 0) {
      const { error: mvErr } = await sb
        .from("files")
        .update({ folder_id: null })
        .eq("owner_id", ownerId)
        .eq("folder_id", id);

      if (mvErr) {
        console.error("[folders/:id DELETE safe] move files error", mvErr);
        return NextResponse.json({ ok: false, code: "MOVE_FILES_FAILED", error: "Kunne ikke flytte filer ud af mappen." }, { status: 500 });
      }
    }

    if (childFoldersCount > 0) {
      const { error: liftErr } = await sb
        .from("folders")
        .update({ parent_id: null })
        .eq("owner_id", ownerId)
        .eq("parent_id", id)
        .is("archived_at", null);

      if (liftErr) {
        console.error("[folders/:id DELETE safe] lift children error", liftErr);
        return NextResponse.json({ ok: false, code: "MOVE_CHILD_FOLDERS_FAILED", error: "Kunne ikke flytte under-mapper." }, { status: 500 });
      }
    }
  }

  const { error: archErr } = await sb
    .from("folders")
    .update({ archived_at: new Date().toISOString(), parent_id: null })
    .eq("owner_id", ownerId)
    .eq("id", id);

  if (archErr) {
    console.error("[folders/:id DELETE] archive error", archErr);
    return NextResponse.json({ ok: false, code: "DB_UPDATE_FAILED", error: "Kunne ikke slette mappen." }, { status: 500 });
  }

  return NextResponse.json({ ok: true, mode: force ? "purge" : "safe", meta: { filesCount, childFoldersCount } }, { status: 200 });
}
