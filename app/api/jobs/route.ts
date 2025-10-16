/* eslint-disable @typescript-eslint/no-explicit-any */
import { NextRequest, NextResponse } from "next/server";
import { supaRls } from "@/lib/supa";

export async function GET(_req: NextRequest) {
  const sb = await supaRls();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  // Hent de seneste jobs for brugeren. Viser payload.set_id + remaining (hvis kolonne findes).
  const { data, error } = await sb
    .from("jobs")
    .select("id, kind, status, created_at, payload, remaining")
    .eq("owner_id", user.id)
    .order("created_at", { ascending: false })
    .limit(50);

  if (error) return NextResponse.json({ error: error.message }, { status: 400 });

  // Map set_id ud af payload for UI
  const rows = (data ?? []).map((j: any) => ({
    id: j.id,
    kind: j.kind,
    status: j.status,
    created_at: j.created_at,
    remaining: j.remaining ?? null,
    set_id: j?.payload?.set_id ?? null,
  }));

  return NextResponse.json({ jobs: rows });
}



