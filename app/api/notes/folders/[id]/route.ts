// app/api/notes/folders/[id]/route.ts
 
import "server-only";
import { NextRequest, NextResponse } from "next/server";
import { supabaseServerRoute } from "@/lib/supabase/server-route";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteCtx = { params: Promise<{ id: string }> };

async function getOwnerId(sb: any): Promise<string | null> {
  try {
    const { data } = await sb.auth.getUser?.();
    if (data?.user?.id) return data.user.id as string;
  } catch {}

  const dev = (process.env.DEV_USER_ID ?? "").trim();
  if (process.env.NODE_ENV !== "production" && dev) return dev;

  return null;
}

function normStr(v: any): string | null {
  if (v == null) return null;
  const s = String(v).trim();
  return s.length ? s : null;
}

// GET /api/notes/folders/:id
export async function GET(_req: NextRequest, ctx: RouteCtx) {
  const { id } = await ctx.params;

  const sb = await supabaseServerRoute();
  const ownerId = await getOwnerId(sb);

  if (!ownerId) return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  if (!id) return NextResponse.json({ ok: false, error: "Missing id" }, { status: 400 });

  const { data, error } = await sb
    .from("notes_folders")
    .select("id, owner_id, name, parent_id, created_at")
    .eq("id", id)
    .maybeSingle();

  if (error) return NextResponse.json({ ok: false, error: "DB error" }, { status: 500 });
  if (!data) return NextResponse.json({ ok: false, error: "Not found" }, { status: 404 });
  if (data.owner_id !== ownerId) return NextResponse.json({ ok: false, error: "Forbidden" }, { status: 403 });

  return NextResponse.json({ ok: true, folder: data }, { status: 200 });
}

/**
 * PATCH /api/notes/folders/:id
 * (valgfri fallback hvis du senere vil opdatere flere felter ét sted)
 * Body: { name?: string }
 */
export async function PATCH(req: NextRequest, ctx: RouteCtx) {
  const { id } = await ctx.params;

  const sb = await supabaseServerRoute();
  const ownerId = await getOwnerId(sb);

  if (!ownerId) return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  if (!id) return NextResponse.json({ ok: false, error: "Missing id" }, { status: 400 });

  const body = (await req.json().catch(() => null)) as any;
  if (!body) return NextResponse.json({ ok: false, error: "Invalid JSON" }, { status: 400 });

  const patch: any = {};
  if ("name" in body) {
    const name = normStr(body.name);
    if (!name) return NextResponse.json({ ok: false, error: "Missing name" }, { status: 400 });
    if (name.length > 80) return NextResponse.json({ ok: false, error: "Name too long" }, { status: 400 });
    patch.name = name;
  }

  if (Object.keys(patch).length === 0) {
    return NextResponse.json({ ok: false, error: "No changes" }, { status: 400 });
  }

  // ejertjek + update
  const { data: updated, error: uErr } = await sb
    .from("notes_folders")
    .update(patch)
    .eq("id", id)
    .eq("owner_id", ownerId)
    .select("id, name, parent_id")
    .maybeSingle();

  if (uErr) return NextResponse.json({ ok: false, error: "DB update failed" }, { status: 500 });
  if (!updated) return NextResponse.json({ ok: false, error: "Not found" }, { status: 404 });

  return NextResponse.json({ ok: true, folder: updated }, { status: 200 });
}

// DELETE /api/notes/folders/:id
export async function DELETE(_req: NextRequest, ctx: RouteCtx) {
  const { id } = await ctx.params;

  const sb = await supabaseServerRoute();
  const ownerId = await getOwnerId(sb);

  if (!ownerId) return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  if (!id) return NextResponse.json({ ok: false, error: "Missing id" }, { status: 400 });

  // 1) find folder + ejertjek
  const { data: folder, error: fErr } = await sb
    .from("notes_folders")
    .select("id, owner_id")
    .eq("id", id)
    .maybeSingle();

  if (fErr) return NextResponse.json({ ok: false, error: "DB error" }, { status: 500 });
  if (!folder) return NextResponse.json({ ok: false, error: "Not found" }, { status: 404 });
  if (folder.owner_id !== ownerId) return NextResponse.json({ ok: false, error: "Forbidden" }, { status: 403 });

  // 2) stop hvis der er børn (max 1 nesting)
  const { count: childCount, error: cErr } = await sb
    .from("notes_folders")
    .select("id", { count: "exact", head: true })
    .eq("owner_id", ownerId)
    .eq("parent_id", id);

  if (cErr) return NextResponse.json({ ok: false, error: "DB error" }, { status: 500 });
  if ((childCount ?? 0) > 0) {
    return NextResponse.json(
      { ok: false, error: "Folder has children. Move/delete children first." },
      { status: 400 },
    );
  }

  // 3) frakobl noter fra folderen (så FK ikke spænder ben)
  await sb.from("notes").update({ folder_id: null }).eq("owner_id", ownerId).eq("folder_id", id);

  // 4) slet folder
  const { error: dErr } = await sb.from("notes_folders").delete().eq("id", id).eq("owner_id", ownerId);
  if (dErr) return NextResponse.json({ ok: false, error: "DB delete failed" }, { status: 500 });

  return NextResponse.json({ ok: true }, { status: 200 });
}
