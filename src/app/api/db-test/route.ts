// src/app/api/db-test/route.ts
import { NextResponse } from "next/server";
// VIGTIGT: relativ sti fra db-test/route.ts -> src/lib/supabase/server.ts
import { createServerClient } from "../../../lib/supabase/server";

export const runtime = "nodejs";

export async function GET() {
  try {
    const supabase = await await await createServerClient();

    const { count: courses, error: cErr } = await supabase
      .from("courses")
      .select("*", { count: "exact", head: true });
    if (cErr) throw cErr;

    const { count: notes, error: nErr } = await supabase
      .from("notes")
      .select("*", { count: "exact", head: true });
    if (nErr) throw nErr;

    return NextResponse.json({
      ok: true,
      courses: courses ?? 0,
      notes: notes ?? 0,
      ts: Date.now(),
    });
  } catch (err: any) {
    return NextResponse.json(
      { ok: false, error: err?.message ?? "Unknown error" },
      { status: 500 }
    );
  }
}

