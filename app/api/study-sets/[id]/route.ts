import { NextRequest, NextResponse } from "next/server";
import { supabaseServerRoute } from "@/lib/supabase/server-route";
import { supaRls } from "@/lib/supa";

export async function GET(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;

  const supabase = await supabaseServerRoute();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const sb = await supaRls();

  const { data: set, error } = await sb
    .from("study_sets")
    .select("id, name, created_at, last_used_at")
    .eq("id", id)
    .eq("owner_id", user.id)
    .single();

  if (error || !set) {
    return NextResponse.json({ error: error?.message ?? "Not found" }, { status: 404 });
  }

  const { data: items, error: e2 } = await sb
    .from("study_set_items")
    .select("source_type, source_id")
    .eq("set_id", id);

  if (e2) return NextResponse.json({ error: e2.message }, { status: 400 });

  return NextResponse.json({ set, items: items ?? [] });
}

