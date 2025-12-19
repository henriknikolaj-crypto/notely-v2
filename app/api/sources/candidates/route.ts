import { NextResponse } from "next/server";
import { supabaseServerRoute } from "@/lib/supabase/server-route";

function isAdmin(email?: string | null) {
  const admins = (process.env.ADMIN_EMAILS ?? "")
    .split(",").map(s => s.trim().toLowerCase()).filter(Boolean);
  return !!email && admins.includes(email.toLowerCase());
}

export async function GET() {
  const supabase = await supabaseServerRoute();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user || !isAdmin(user.email)) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const { data, error } = await supabase
    .from("candidate_sources")
    .select("domain, first_seen, last_seen, hit_count")
    .order("hit_count", { ascending: false })
    .order("last_seen", { ascending: false })
    .limit(200);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ items: data ?? [] }, { status: 200 });
}



