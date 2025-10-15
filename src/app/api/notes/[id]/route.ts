import { NextResponse } from "next/server";
import { createServerClient } from "@/lib/supabase/server";

export async function DELETE(
  _req: Request,
  { params }: { params: { id: string } }
) {
  try {
    const supabase = await createServerClient();
    const { data: { user } } = await supabase.auth.getUser();

    if (!user)
      return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });

    const { error } = await supabase
      .from("notes")
      .delete()
      .eq("id", params.id)
      .eq("owner_id", user.id);

    if (error?.code === "PGRST116") {
      return NextResponse.json({ ok: false, error: "Not found" }, { status: 404 });
    }
    if (error) throw error;

    return NextResponse.json({ ok: true }, { status: 200 });
  } catch (err: any) {
    return NextResponse.json(
      { ok: false, error: err.message ?? "Server error" },
      { status: 500 }
    );
  }
}