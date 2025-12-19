// app/api/study-sets/[id]/items/route.ts
import "server-only";

import { NextRequest, NextResponse } from "next/server";
import { supabaseServerRoute } from "@/lib/supabase/server-route";
import { getOwnerCtx } from "@/lib/auth/owner";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };
type Item = { source_type: "file" | "note"; source_id: string };

function normStr(v: any): string | null {
  if (v == null) return null;
  const s = String(v).trim();
  return s.length ? s : null;
}

function normalizeItem(x: any): Item | null {
  const st = x?.source_type;
  const sid = normStr(x?.source_id);
  if ((st !== "file" && st !== "note") || !sid) return null;
  return { source_type: st, source_id: sid };
}

async function readJson(req: NextRequest): Promise<{ ok: true; value: any } | { ok: false; error: string }> {
  const raw = (await req.text()).trim();
  if (!raw) return { ok: true, value: {} };
  try {
    return { ok: true, value: JSON.parse(raw) };
  } catch {
    return { ok: false, error: "Ugyldigt JSON-body." };
  }
}

export async function POST(req: NextRequest, ctx: Ctx) {
  const { id } = await ctx.params;
  if (!id) return NextResponse.json({ ok: false, error: "Missing id" }, { status: 400 });

  const sb = await supabaseServerRoute();
  const owner = await getOwnerCtx(req, sb);
  if (!owner) return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });

  // Verify set ownership (så vi ikke skriver til andres set_id)
  const { data: set, error: sErr } = await sb
    .from("study_sets")
    .select("id")
    .eq("id", id)
    .eq("owner_id", owner.ownerId)
    .maybeSingle();

  if (sErr) {
    console.error("[study-sets/:id/items] set lookup error", sErr);
    return NextResponse.json({ ok: false, error: "DB error" }, { status: 500 });
  }
  if (!set) return NextResponse.json({ ok: false, error: "Not found" }, { status: 404 });

  const parsed = await readJson(req);
  if (!parsed.ok) return NextResponse.json({ ok: false, error: parsed.error }, { status: 400 });

  const body = parsed.value ?? {};

  const add: Item[] = Array.isArray(body?.add)
    ? (body.add.map(normalizeItem).filter(Boolean) as Item[])
    : [];

  const remove: Item[] = Array.isArray(body?.remove)
    ? (body.remove.map(normalizeItem).filter(Boolean) as Item[])
    : [];

  if (add.length) {
    const rows = add.map((i: Item) => ({ set_id: id, ...i }));
    const { error } = await sb.from("study_set_items").upsert(rows);
    if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 400 });
  }

  if (remove.length) {
    for (const i of remove) {
      const { error } = await sb
        .from("study_set_items")
        .delete()
        .eq("set_id", id)
        .eq("source_type", i.source_type)
        .eq("source_id", i.source_id);

      if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 400 });
    }
  }

  const { data: items, error: e2 } = await sb
    .from("study_set_items")
    .select("source_type, source_id, added_at")
    .eq("set_id", id);

  if (e2) return NextResponse.json({ ok: false, error: e2.message }, { status: 400 });

  return NextResponse.json({ ok: true, items: items ?? [] }, { status: 200 });
}
