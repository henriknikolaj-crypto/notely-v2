import { NextResponse } from "next/server";
import { supabaseServerRoute } from "@/lib/supabase/server";
import { createClient } from "../../../utils/supabase/server";
export async function GET(req: Request) {
    const supabase = await supabaseServerRoute(); const { data: { user } } = await supabase.auth.getUser(); if(!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 }); const url = new URL(req.url);
  const limit = parseInt(url.searchParams.get("limit") || "5", 10);
  try {
    const supabase = await createClient();
    let ownerId: string | null = null;
    try { const { data:{ user } } = await supabase.auth.getUser(); ownerId = user?.id ?? null; } catch {}
    if (!ownerId && process.env.NODE_ENV !== "production") ownerId = process.env.user.id || null;
    if (!ownerId) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
    const { data, error } = await supabase.from("exam_sessions").select("*")
      .eq("owner_id", ownerId).order("created_at", { ascending: false }).limit(limit);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ sessions: data ?? [] });
  } catch (e:any) { return NextResponse.json({ error: String(e?.message||e) }, { status: 500 }); }
}


