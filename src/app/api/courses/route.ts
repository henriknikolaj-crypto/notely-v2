import { NextResponse } from "next/server";
import { createServerClient } from "@/lib/supabase/server";import { CourseCreateSchema } from "@/lib/validation/courses";
export async function GET() {
  try {
    const supabase = await await await createServerClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });

    const { data, error } = await supabase
      .from("courses")
      .select("id, owner_id, title, description, created_at")
      .eq("owner_id", user.id)
      .order("created_at", { ascending: false });

    if (error) throw error;
    return NextResponse.json({ ok: true, courses: data }, { status: 200 });
  } catch (err: any) {
    return NextResponse.json({ ok: false, error: err.message ?? "Server error" }, { status: 500 });
  }
}

export async function POST(req: Request) {
  try {
    const supabase = await await await createServerClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });

    const body = await req.json();
    const { title, description } = body ?? {};
    if (!title?.trim()) return NextResponse.json({ ok:false, error:"Title required" }, { status:400 });

    const { data, error } = await supabase
      .from("courses")
      .insert({ owner_id: user.id, title: title.trim(), description: description?.trim() ?? null })
      .select("id")
      .single();

    if (error) throw error;
    return NextResponse.json({ ok: true, id: data.id }, { status: 201 });
  } catch (err: any) {
    return NextResponse.json({ ok: false, error: err.message ?? "Server error" }, { status: 500 });
  }
}
