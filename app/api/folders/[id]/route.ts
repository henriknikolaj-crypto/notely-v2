// app/api/folders/[id]/route.ts
import "server-only";

import { revalidatePath } from "next/cache";
import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { supabaseServerRouteReadOnly } from "@/lib/supabase/server-route-readonly";
import { getOwnerCtx } from "@/lib/auth/owner";
import { purgeFilesInFolders } from "@/lib/server/file-purge";

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

function supabaseAdminOrThrow() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}

async function listActiveDescendantFolderIds(admin: any, ownerId: string, rootId: string): Promise<string[]> {
  const { data, error } = await admin
    .from("folders")
    .select("id,parent_id")
    .eq("owner_id", ownerId)
    .is("archived_at", null);

  if (error) throw error;

  const childrenByParent = new Map<string, string[]>();
  for (const row of data ?? []) {
    const id = normStr((row as any)?.id);
    const parentId = normStr((row as any)?.parent_id);
    if (!id || !parentId) continue;
    const bucket = childrenByParent.get(parentId) ?? [];
    bucket.push(id);
    childrenByParent.set(parentId, bucket);
  }

  const descendants: string[] = [];
  const stack = [...(childrenByParent.get(rootId) ?? [])];
  while (stack.length > 0) {
    const nextId = stack.pop();
    if (!nextId) continue;
    descendants.push(nextId);
    const children = childrenByParent.get(nextId);
    if (children?.length) stack.push(...children);
  }

  return descendants;
}

export async function PATCH(req: NextRequest, ctx: Ctx) {
  const { id } = await ctx.params;

  const sb = supabaseServerRouteReadOnly(req);
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

  revalidatePath("/traener", "layout");
  revalidatePath("/traener/upload");

  return NextResponse.json({ ok: true, folder: updated }, { status: 200 });
}

export async function DELETE(req: NextRequest, ctx: Ctx) {
  const { id } = await ctx.params;

  const sb = supabaseServerRouteReadOnly(req);
  const ownerId = await resolveOwnerId(req, sb);
  if (!ownerId) {
    return NextResponse.json({ ok: false, code: "UNAUTHORIZED", error: "Login kræves." }, { status: 401 });
  }
  if (!id) return NextResponse.json({ ok: false, code: "MISSING_ID", error: "Mangler id." }, { status: 400 });

  let admin: any;
  try {
    admin = supabaseAdminOrThrow();
  } catch (error) {
    console.error("[folders/:id DELETE] admin init error", error);
    return NextResponse.json({ ok: false, code: "SERVER_CONFIG_MISSING", error: "Server config mangler." }, { status: 500 });
  }

  const force = req.nextUrl.searchParams.get("force") === "1";

  const { data: folder, error: fErr } = await admin
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

  const filesCount = await countInTable(admin, "files", { owner_id: ownerId, folder_id: id });
  const childFoldersCount = await countInTable(admin, "folders", {
    owner_id: ownerId,
    parent_id: id,
    archived_at: null,
  });

  let descendantFolderIds: string[] = [];
  if (force) {
    try {
      descendantFolderIds = await listActiveDescendantFolderIds(admin, ownerId, id);
    } catch (error) {
      console.error("[folders/:id DELETE] descendant lookup error", error);
      return NextResponse.json({ ok: false, code: "DB_ERROR", error: "Kunne ikke læse under-mapper." }, { status: 500 });
    }
  }
  const folderIdsToPurge = force ? [id, ...descendantFolderIds] : [id];

  try {
    await purgeFilesInFolders(admin, { ownerId, folderIds: folderIdsToPurge });
  } catch (error) {
    console.error("[folders/:id DELETE] file purge error", error);
    return NextResponse.json({ ok: false, code: "DB_DELETE_FAILED", error: "Kunne ikke slette filer." }, { status: 500 });
  }

  if (force) {
    if (descendantFolderIds.length > 0) {
      const { error: archChildrenErr } = await admin
        .from("folders")
        .update({ archived_at: new Date().toISOString() })
        .eq("owner_id", ownerId)
        .in("id", descendantFolderIds)
        .is("archived_at", null);

      if (archChildrenErr) {
        console.error("[folders/:id DELETE force] archive children error", archChildrenErr);
        return NextResponse.json({ ok: false, code: "DB_UPDATE_FAILED", error: "Kunne ikke arkivere under-mapper." }, { status: 500 });
      }
    }
  } else {
    if (childFoldersCount > 0) {
      const { error: liftErr } = await admin
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

  const { error: archErr } = await admin
    .from("folders")
    .update({ archived_at: new Date().toISOString(), parent_id: null })
    .eq("owner_id", ownerId)
    .eq("id", id);

  if (archErr) {
    console.error("[folders/:id DELETE] archive error", archErr);
    return NextResponse.json({ ok: false, code: "DB_UPDATE_FAILED", error: "Kunne ikke slette mappen." }, { status: 500 });
  }

  revalidatePath("/traener", "layout");
  revalidatePath("/traener/upload");

  return NextResponse.json(
    {
      ok: true,
      mode: force ? "purge" : "safe",
      meta: {
        filesCount,
        childFoldersCount,
        purgedFolderIds: folderIdsToPurge,
      },
    },
    { status: 200 },
  );
}
