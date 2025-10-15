import { NextRequest, NextResponse } from "next/server";
import { supaRls } from "../../../../lib/supa";

export async function GET(_: NextRequest, { params }: { params: { id: string }}) {
  const sb = await supaRls();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const setId = params.id;
  const { data: set, error } = await sb.from("study_sets")
    .select("id, name, created_at, last_used_at")
    .eq("id", setId)
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 404 });

  const { data: items, error: e2 } = await sb.from("study_set_items")
    .select("source_type, source_id, added_at")
    .eq("set_id", setId);
  if (e2) return NextResponse.json({ error: e2.message }, { status: 400 });

  return NextResponse.json({ set, items });
}

export async function PATCH(req: NextRequest, { params }: { params: { id: string }}) {
  const sb = await supaRls();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json() as { name?: string };
  if (!body?.name) return NextResponse.json({ error: "Nothing to update" }, { status: 400 });

  const { data, error } = await sb.from("study_sets")
    .update({ name: body.name })
    .eq("id", params.id)
    .select("id, name, created_at, last_used_at")
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  return NextResponse.json({ ok: true, set: data });
}

export async function DELETE(_: NextRequest, { params }: { params: { id: string }}) {
  const sb = await supaRls();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { error } = await sb.from("study_sets").delete().eq("id", params.id);
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  return NextResponse.json({ ok: true });
}
