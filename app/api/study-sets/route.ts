import { NextRequest, NextResponse } from "next/server";
import { supabaseServerRoute } from "@/lib/supabase/server";
import { supaRls } from "@/lib/supa";

type Item = { source_type: "file" | "note"; source_id: string };

export async function POST(req: NextRequest) {
    const supabase = await supabaseServerRoute(); const { data: { user } } = await supabase.auth.getUser(); if(!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 }); const sb = await supaRls();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json() as { name: string; items?: Item[] };
  if (!body?.name) return NextResponse.json({ error: "Missing name" }, { status: 400 });

  const { data: set, error } = await sb.from("study_sets")
    .insert({ owner_id: user.id,  name: body.name, owner_id: user.id })
    .select("id, name, created_at, last_used_at")
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });

  if (body.items?.length) {
    const rows = body.items.map(i => ({ set_id: set.id, ...i }));
    const { error: e2 } = await sb.from("study_set_items").upsert(rows);
    if (e2) return NextResponse.json({ error: e2.message }, { status: 400 });
  }
  return NextResponse.json({ ok: true, set });
}

export async function GET() {
    const supabase = await supabaseServerRoute(); const { data: { user } } = await supabase.auth.getUser(); if(!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 }); const sb = await supaRls();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { data, error } = await sb.from("study_sets")
    .select("id, name, created_at, last_used_at")
    .order("last_used_at", { ascending: false, nullsFirst: false })
    .order("created_at", { ascending: false })
    .limit(50);
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });

  return NextResponse.json({ sets: data ?? [] });
}




