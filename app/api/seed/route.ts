import { NextRequest, NextResponse } from "next/server";
import { supabaseServerRoute } from "@/lib/supabase/server-route";
import { requireDevSecret } from "@/lib/dev/guard";

export async function GET(req: NextRequest) {
  try {
    const guard = requireDevSecret(req);
    if (!guard.ok) {
      return NextResponse.json({ ok: false, error: guard.message }, { status: guard.status });
    }

    const url = new URL(req.url);
    const doReset = url.searchParams.get("reset") === "1";

    const supabase = await supabaseServerRoute();
    const { data: { user } } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ ok:false, error:"Unauthorized" }, { status:401 });
    }
    const ownerId = user.id;

    if (doReset) {
      await supabase.from("notes").delete().eq("owner_id", ownerId);
      await supabase.from("courses").delete().eq("owner_id", ownerId);
    }

    const { error: e1 } = await supabase.from("courses").insert([
      { owner_id: ownerId, title: "Seed: Studieteknik", description: "Grundlæggende studieteknik." },
      { owner_id: ownerId, title: "Seed: Notatteknik", description: "Sådan tager du bedre noter." },
    ]);
    if (e1) return NextResponse.json({ ok:false, error: e1.message }, { status:500 });

    const { error: e2 } = await supabase.from("notes").insert([
      { owner_id: ownerId, title: "Seed: Første note", content: "Hej verden 👋" },
      { owner_id: ownerId, title: "Seed: Anden note", content: "Mere indhold..." },
    ]);
    if (e2) return NextResponse.json({ ok:false, error: e2.message }, { status:500 });

    return NextResponse.json({ ok:true, ownerId }, { status:200 });
  } catch (err:any) {
    return NextResponse.json({ ok:false, error: err.message ?? "Server error" }, { status:500 });
  }
}
