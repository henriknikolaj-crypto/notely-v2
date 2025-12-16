import "server-only";
import { NextResponse } from "next/server";
import { supabaseServerRoute } from "@/lib/supabase/server-route";
import { CourseCreateSchema } from "@/lib/validation/courses";

export async function GET() {
  try {
    const supabase = await supabaseServerRoute();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
    }

    const { data, error } = await supabase
      .from("courses")
      .select("id, owner_id, title, description, created_at")
      .eq("owner_id", user.id)
      .order("created_at", { ascending: false });

    if (error) throw error;

    return NextResponse.json({ ok: true, courses: data }, { status: 200 });
  } catch (err: any) {
    return NextResponse.json(
      { ok: false, error: err?.message ?? "Server error" },
      { status: 500 }
    );
  }
}

export async function POST(req: Request) {
  try {
    const supabase = await supabaseServerRoute();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
    }

    const body = await req.json().catch(() => ({}));
    const parsed = CourseCreateSchema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json(
        { ok: false, error: "Invalid input", issues: parsed.error.flatten() },
        { status: 400 }
      );
    }

    const title = parsed.data.title?.trim();
    const description = (parsed.data as any)?.description?.trim?.() ?? null;

    if (!title) {
      return NextResponse.json({ ok: false, error: "Title required" }, { status: 400 });
    }

    const { data, error } = await supabase
      .from("courses")
      .insert({
        owner_id: user.id,
        title,
        description,
      })
      .select("id")
      .single();

    if (error) throw error;

    return NextResponse.json({ ok: true, id: data.id }, { status: 201 });
  } catch (err: any) {
    return NextResponse.json(
      { ok: false, error: err?.message ?? "Server error" },
      { status: 500 }
    );
  }
}
