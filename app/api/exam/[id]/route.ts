import { NextResponse } from "next/server";
import { supabaseServerRoute } from "@/lib/supabase/server";

export async function DELETE(_: Request, { params }: { params: { id: string } }) {
  const supabase = await supabaseServerRoute();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { error } = await supabase
    .from("exam_sessions")
    .delete()
    .eq("id", params.id)
    .eq("owner_id", user.id);

  if (error) {
    console.error("delete exam_session error", error);
    return NextResponse.json({ error: error.message || "Delete failed" }, { status: 500 });
  }
  return NextResponse.json({ ok: true });
}