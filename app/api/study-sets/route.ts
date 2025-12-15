/* eslint-disable @typescript-eslint/no-explicit-any */
import { NextRequest, NextResponse } from "next/server";
import { supabaseServerRoute } from "@/lib/supabase/server-route";
import { supaRls } from "@/lib/supa";

type Item = { source_type: "file" | "note"; source_id: string };

export async function POST(req: NextRequest) {
  // Tjek login via server-route klienten (cookies)
  const supabase = await supabaseServerRoute();
  const {
    data: { user: currentUser },
  } = await supabase.auth.getUser();

  if (!currentUser) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const sb = await supaRls(); // RLS-klient til DB-arbejde

  const body = (await req.json()) as { name: string; items?: Item[] };
  if (!body?.name) {
    return NextResponse.json({ error: "Missing name" }, { status: 400 });
  }

  // Opret sæt
  const { data: set, error } = await sb
    .from("study_sets")
    .insert({ owner_id: currentUser.id, name: body.name })
    .select("id, name, created_at, last_used_at")
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 400 });
  }

  // (Valgfrit) tilføj items til sættet
  if (body.items?.length) {
    const rows = body.items.map((i) => ({
      set_id: set.id,
      source_type: i.source_type,
      source_id: i.source_id,
    }));
    const { error: e2 } = await sb.from("study_set_items").upsert(rows);
    if (e2) {
      return NextResponse.json({ error: e2.message }, { status: 400 });
    }
  }

  return NextResponse.json({ ok: true, set });
}

export async function GET() {
  // Tjek login
  const supabase = await supabaseServerRoute();
  const {
    data: { user: currentUser },
  } = await supabase.auth.getUser();

  if (!currentUser) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const sb = await supaRls();

  // Hent KUN brugerens egne sæt
  const { data, error } = await sb
    .from("study_sets")
    .select("id, name, created_at, last_used_at")
    .eq("owner_id", currentUser.id)
    .order("last_used_at", { ascending: false, nullsFirst: false })
    .order("created_at", { ascending: false })
    .limit(50);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 400 });
  }

  return NextResponse.json({ sets: data ?? [] });
}




