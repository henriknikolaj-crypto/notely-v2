/* eslint-disable @typescript-eslint/no-explicit-any */
import { NextResponse } from "next/server";
import { supabaseServerRoute } from "@/lib/supabase/server";

export async function POST(req: Request) {
  try {
    const supabase = await supabaseServerRoute();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ ok:false, error:"Unauthorized" }, { status:401 });

    const { title, content } = await req.json();
    if (!title?.trim()) {
      return NextResponse.json({ ok:false, error:"Title required" }, { status:400 });
    }

    const { data, error } = await supabase
      .from("notes")
      .insert({ owner_id: user.id, title: title.trim(), content: content?.trim?.() || null })
      .select("id")
      .single();

    if (error) throw error;
    return NextResponse.json({ ok:true, id: data.id }, { status:201 });
  } catch (err:any) {
    return NextResponse.json({ ok:false, error: err.message ?? "Server error" }, { status:500 });
  }
}



