/* eslint-disable @typescript-eslint/no-explicit-any */
import { NextRequest, NextResponse } from "next/server";
import { supabaseServerRoute } from "@/lib/supabase/server-route";
import { CourseUpdateSchema } from "@/lib/validation/courses";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

export async function GET(_req: NextRequest, { params }: Ctx) {
  try {
    const { id } = await params;

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
      .eq("id", id)
      .eq("owner_id", user.id)
      .single();

    if (error?.code === "PGRST116") {
      return NextResponse.json({ ok: false, error: "Not found" }, { status: 404 });
    }
    if (error) throw error;

    return NextResponse.json({ ok: true, course: data }, { status: 200 });
  } catch (err: any) {
    return NextResponse.json(
      { ok: false, error: err?.message ?? "Server error" },
      { status: 500 },
    );
  }
}

export async function PATCH(req: NextRequest, { params }: Ctx) {
  try {
    const { id } = await params;

    const supabase = await supabaseServerRoute();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
    }

    const body = await req.json();
    const parsed = CourseUpdateSchema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json(
        { ok: false, error: parsed.error.flatten() },
        { status: 400 },
      );
    }

    const { data, error } = await supabase
      .from("courses")
      .update({ ...parsed.data })
      .eq("id", id)
      .eq("owner_id", user.id)
      .select("id, title, description")
      .single();

    if (error?.code === "PGRST116") {
      return NextResponse.json({ ok: false, error: "Not found" }, { status: 404 });
    }
    if (error) throw error;

    return NextResponse.json({ ok: true, course: data }, { status: 200 });
  } catch (err: any) {
    return NextResponse.json(
      { ok: false, error: err?.message ?? "Server error" },
      { status: 500 },
    );
  }
}

export async function DELETE(_req: NextRequest, { params }: Ctx) {
  try {
    const { id } = await params;

    const supabase = await supabaseServerRoute();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
    }

    const { error } = await supabase
      .from("courses")
      .delete()
      .eq("id", id)
      .eq("owner_id", user.id);

    if (error?.code === "PGRST116") {
      return NextResponse.json({ ok: false, error: "Not found" }, { status: 404 });
    }
    if (error) throw error;

    return NextResponse.json({ ok: true }, { status: 200 });
  } catch (err: any) {
    return NextResponse.json(
      { ok: false, error: err?.message ?? "Server error" },
      { status: 500 },
    );
  }
}
