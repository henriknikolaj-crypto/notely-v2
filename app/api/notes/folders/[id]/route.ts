// app/api/notes/folders/[id]/route.ts
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

async function readJson(req: NextRequest) {
  const raw = (await req.text()).trim();
  if (!raw) return { ok: true as const, value: {} as any };
  try {
    return { ok: true as const, value: JSON.parse(raw) as any };
  } catch {
    return { ok: false as const, error: "Ugyldigt JSON-body." };
  }
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
  if (!id) return NextResponse.json({ ok: false, error: "Missing id" }, { status: 400 });

  const sb = await supabaseServerRoute();
  const owner = await getOwnerCtx(req, sb);
  if (!owner) return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });

  const parsed = await readJson(req);
  if (!parsed.ok) return NextResponse.json(parsed, { status: 400 });

  const body = parsed.value ?? {};
  const name = normStr(body.name);
  const start_date = normDate(body.start_date);
  const end_date = normDate(body.end_date);

  if (!name) {
    return NextResponse.json({ ok: false, error: "Navn må ikke være tomt." }, { status: 400 });
  }

  const patch: Record<string, any> = { name };
  if ("start_date" in body) patch.start_date = start_date;
  if ("end_date" in body) patch.end_date = end_date;

  const { data, error } = await sb
    .from("folders")
    .update(patch)
    .eq("id", id)
    .eq("owner_id", owner.ownerId)
    .is("archived_at", null)
    .select("id,name,parent_id,start_date,end_date,archived_at")
    .maybeSingle();

  if (error) {
    console.error("[folders/:id PATCH] error:", error);
    return NextResponse.json({ ok: false, error: "DB update fejlede." }, { status: 500 });
  }
  if (!data) return NextResponse.json({ ok: false, error: "Not found" }, { status: 404 });

  return NextResponse.json({ ok: true, folder: data }, { status: 200 });
}

export async function DELETE(req: NextRequest, ctx: Ctx) {
  const { id } = await ctx.params;
  if (!id) return NextResponse.json({ ok: false, error: "Missing id" }, { status: 400 });

  const sb = await supabaseServerRoute();
  const owner = await getOwnerCtx(req, sb);
  if (!owner) return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });

  const ownerId = owner.ownerId;
  const force = req.nextUrl.searchParams.get("force") === "1";

  const { data: folder, error: fErr } = await sb
    .from("folders")
    .select("id,owner_id,archived_at,parent_id")
    .eq("id", id)
    .maybeSingle();

  if (fErr) {
    console.error("[folders/:id DELETE] folder lookup error:", fErr);
    return NextResponse.json({ ok: false, error: "DB fejl." }, { status: 500 });
  }

  if (!folder || folder.archived_at) {
    return NextResponse.json({ ok: true, alreadyDeleted: true }, { status: 200 });
  }

  if (folder.owner_id !== ownerId) {
    return NextResponse.json({ ok: false, error: "Forbidden" }, { status: 403 });
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
      console.error("[folders/:id DELETE force] files lookup error:", frErr);
      return NextResponse.json({ ok: false, error: "DB fejl." }, { status: 500 });
    }

    const fileIds = (fileRows ?? []).map((r: any) => r.id).filter(Boolean);

    if (fileIds.length > 0) {
      const { error: dcErr } = await sb
        .from("doc_chunks")
        .delete()
        .eq("owner_id", ownerId)
        .in("file_id", fileIds);

      if (dcErr) {
        console.error("[folders/:id DELETE force] doc_chunks delete error:", dcErr);
        return NextResponse.json({ ok: false, error: "Kunne ikke slette doc_chunks." }, { status: 500 });
      }

      const { error: filesErr } = await sb
        .from("files")
        .delete()
        .eq("owner_id", ownerId)
        .in("id", fileIds);

      if (filesErr) {
        console.error("[folders/:id DELETE force] files delete error:", filesErr);
        return NextResponse.json({ ok: false, error: "Kunne ikke slette filer." }, { status: 500 });
      }
    }

    const { error: archChildrenErr } = await sb
      .from("folders")
      .update({ archived_at: new Date().toISOString() })
      .eq("owner_id", ownerId)
      .eq("parent_id", id)
      .is("archived_at", null);

    if (archChildrenErr) {
      console.error("[folders/:id DELETE force] archive children error:", archChildrenErr);
      return NextResponse.json({ ok: false, error: "Kunne ikke arkivere under-mapper." }, { status: 500 });
    }
  } else {
    if (filesCount > 0) {
      const { error: mvErr } = await sb
        .from("files")
        .update({ folder_id: null })
        .eq("owner_id", ownerId)
        .eq("folder_id", id);

      if (mvErr) {
        console.error("[folders/:id DELETE safe] move files error:", mvErr);
        return NextResponse.json({ ok: false, error: "Kunne ikke flytte filer ud af mappen." }, { status: 500 });
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
        console.error("[folders/:id DELETE safe] lift children error:", liftErr);
        return NextResponse.json({ ok: false, error: "Kunne ikke flytte under-mapper." }, { status: 500 });
      }
    }
  }

  const { error: uErr } = await sb
    .from("folders")
    .update({ archived_at: new Date().toISOString(), parent_id: null })
    .eq("owner_id", ownerId)
    .eq("id", id);

  if (uErr) {
    console.error("[folders/:id DELETE] folder update error:", uErr);
    return NextResponse.json({ ok: false, error: "Kunne ikke slette mappen." }, { status: 500 });
  }

  return NextResponse.json(
    { ok: true, mode: force ? "purge" : "safe", meta: { filesCount, childFoldersCount } },
    { status: 200 },
  );
}
