import "server-only";

import { NextRequest, NextResponse } from "next/server";
import { supabaseServerRoute } from "@/lib/supabase/server-route";
import { getOwnerCtx } from "@/lib/auth/owner";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

export async function GET(req: NextRequest, ctx: Ctx) {
  const { id } = await ctx.params;
  if (!id) return NextResponse.json({ ok: false, error: "Missing id" }, { status: 400 });

  const sb = await supabaseServerRoute();
  const owner = await getOwnerCtx(req, sb);
  if (!owner) return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });

  const { data: set, error } = await sb
    .from("study_sets")
    .select("id, name, created_at, last_used_at")
    .eq("id", id)
    .eq("owner_id", owner.ownerId)
    .maybeSingle();

  if (error) {
    console.error("[study-sets/:id GET] set error", error);
    return NextResponse.json({ ok: false, error: "DB error" }, { status: 500 });
  }
  if (!set) return NextResponse.json({ ok: false, error: "Not found" }, { status: 404 });

  const { data: items, error: e2 } = await sb
    .from("study_set_items")
    .select("source_type, source_id")
    .eq("set_id", id);

  if (e2) {
    console.error("[study-sets/:id GET] items error", e2);
    return NextResponse.json({ ok: false, error: e2.message }, { status: 400 });
  }

  return NextResponse.json({ ok: true, set, items: items ?? [] }, { status: 200 });
}
