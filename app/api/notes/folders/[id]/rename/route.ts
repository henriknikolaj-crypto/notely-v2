// app/api/notes/folders/[id]/rename/route.ts
/* eslint-disable @typescript-eslint/no-explicit-any */
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
  return process.env.DEV_USER_ID ?? null;
}

function normStr(v: any): string | null {
  if (v == null) return null;
  const s = String(v).trim();
  return s.length ? s : null;
}

/**
 * Rename note-folder (notes_folders)
 * Body: { "name": "<string>" }
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

  const name = normStr(body.name);
  if (!name) {
    return NextResponse.json({ ok: false, error: "Missing name" }, { status: 400 });
  }
  if (name.length > 80) {
    return NextResponse.json({ ok: false, error: "Name too long" }, { status: 400 });
  }

  // ejertjek + findes?
  const { data: folder, error: fErr } = await sb
    .from("notes_folders")
    .select("id, owner_id")
    .eq("id", id)
    .maybeSingle();

  if (fErr) return NextResponse.json({ ok: false, error: "DB error" }, { status: 500 });
  if (!folder) return NextResponse.json({ ok: false, error: "Not found" }, { status: 404 });
  if (folder.owner_id !== ownerId) return NextResponse.json({ ok: false, error: "Forbidden" }, { status: 403 });

  const { data: updated, error: uErr } = await sb
    .from("notes_folders")
    .update({ name })
    .eq("id", id)
    .eq("owner_id", ownerId)
    .select("id, name")
    .maybeSingle();

  if (uErr) return NextResponse.json({ ok: false, error: "DB update failed" }, { status: 500 });
  if (!updated) return NextResponse.json({ ok: false, error: "Not found" }, { status: 404 });

  return NextResponse.json({ ok: true, folder: updated }, { status: 200 });
}
