import { NextRequest, NextResponse } from "next/server";
import { supaRls } from "../../../../../lib/supa";

type Item = { source_type: "file" | "note"; source_id: string };

export async function POST(req: NextRequest, { params }: { params: { id: string }}) {
  const sb = await supaRls();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json() as { add?: Item[]; remove?: Item[] };

  if (body?.add?.length) {
    const rows = body.add.map(i => ({ set_id: params.id, ...i }));
    const { error } = await sb.from("study_set_items").upsert(rows);
    if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  }

  if (body?.remove?.length) {
    for (const i of body.remove) {
      const { error } = await sb.from("study_set_items")
        .delete()
        .eq("set_id", params.id)
        .eq("source_type", i.source_type)
        .eq("source_id", i.source_id);
      if (error) return NextResponse.json({ error: error.message }, { status: 400 });
    }
  }

  const { data: items, error: e2 } = await sb.from("study_set_items")
    .select("source_type, source_id, added_at")
    .eq("set_id", params.id);
  if (e2) return NextResponse.json({ error: e2.message }, { status: 400 });

  return NextResponse.json({ ok: true, items });
}
