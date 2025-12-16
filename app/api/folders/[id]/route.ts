// app/api/notes/folders/[id]/move/route.ts
 
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
  } catch {
    // ignore
  }
  return process.env.DEV_USER_ID ?? null;
}

function normStr(v: any): string | null {
  if (v == null) return null;
  const s = String(v).trim();
  return s.length ? s : null;
}

/**
 * Flyt en note-folder (notes_folders) under en anden folder (parent_id)
 * Body: { "parent_id": "<uuid|null>" }
 */
export async function POST(req: NextRequest, ctx: RouteCtx) {
  const { id } = await ctx.params;

  const sb = await supabaseServerRoute();
  const ownerId = await getOwnerId(sb);

  if (!ownerId) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }
  if (!id) {
    return NextResponse.json({ ok: false, error: "Missing id" }, { status: 400 });
  }

  const body = (await req.json().catch(() => null)) as any;
  if (!body) {
    return NextResponse.json({ ok: false, error: "Invalid JSON" }, { status: 400 });
  }

  const parent_id = body.parent_id === null ? null : normStr(body.parent_id);

  if (parent_id === id) {
    return NextResponse.json({ ok: false, error: "parent_id cannot equal id" }, { status: 400 });
  }

  // 1) hent folderen der flyttes + ejertjek
  const { data: folder, error: fErr } = await sb
    .from("notes_folders")
    .select("id, owner_id, parent_id")
    .eq("id", id)
    .maybeSingle();

  if (fErr) return NextResponse.json({ ok: false, error: "DB error" }, { status: 500 });
  if (!folder) return NextResponse.json({ ok: false, error: "Not found" }, { status: 404 });
  if (folder.owner_id !== ownerId) return NextResponse.json({ ok: false, error: "Forbidden" }, { status: 403 });

  // 2) parent validering + max 1 nesting
  if (parent_id) {
    const { data: parent, error: pErr } = await sb
      .from("notes_folders")
      .select("id, owner_id, parent_id")
      .eq("id", parent_id)
      .maybeSingle();

    if (pErr) return NextResponse.json({ ok: false, error: "DB error" }, { status: 500 });
    if (!parent) return NextResponse.json({ ok: false, error: "Invalid parent_id" }, { status: 400 });
    if (parent.owner_id !== ownerId) return NextResponse.json({ ok: false, error: "Forbidden" }, { status: 403 });

    // parent må ikke selv ligge under noget (kun 1 niveau)
    if (parent.parent_id) {
      return NextResponse.json({ ok: false, error: "Only one nesting level is allowed" }, { status: 400 });
    }

    // 3) undgå cyklus: kan ikke flytte ind under eget barn (direkte børn)
    const { data: child, error: cErr } = await sb
      .from("notes_folders")
      .select("id")
      .eq("owner_id", ownerId)
      .eq("parent_id", id)
      .eq("id", parent_id)
      .maybeSingle();

    if (cErr) return NextResponse.json({ ok: false, error: "DB error" }, { status: 500 });
    if (child) {
      return NextResponse.json({ ok: false, error: "Cannot move folder under its own child" }, { status: 400 });
    }
  }

  // 4) udfør flyt
  const { data: updated, error: uErr } = await sb
    .from("notes_folders")
    .update({ parent_id })
    .eq("id", id)
    .eq("owner_id", ownerId)
    .select("id, parent_id")
    .maybeSingle();

  if (uErr) return NextResponse.json({ ok: false, error: "DB update failed" }, { status: 500 });
  if (!updated) return NextResponse.json({ ok: false, error: "Not found" }, { status: 404 });

  return NextResponse.json({ ok: true, folder: updated }, { status: 200 });
}
