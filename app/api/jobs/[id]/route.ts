// app/api/jobs/[id]/route.ts
import "server-only";

import { NextRequest, NextResponse } from "next/server";
import { supabaseServerRoute } from "@/lib/supabase/server-route";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

// GET /api/jobs/:id  (read job status)
export async function GET(_req: NextRequest, ctx: Ctx) {
  const { id } = await ctx.params;
  if (!id) return NextResponse.json({ ok: false, error: "Missing id" }, { status: 400 });

  const sb = await supabaseServerRoute();
  const { data: userRes } = await sb.auth.getUser();
  const userId = userRes?.user?.id ?? null;

  if (!userId) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }

  const { data, error } = await sb
    .from("jobs")
    .select("*")
    .eq("id", id)
    .eq("owner_id", userId)
    .maybeSingle();

  if (error) {
    console.error("[jobs/:id GET] db error", error);
    return NextResponse.json({ ok: false, error: "DB error" }, { status: 500 });
  }

  if (!data) {
    return NextResponse.json({ ok: false, error: "Not found" }, { status: 404 });
  }

  return NextResponse.json({ ok: true, job: data }, { status: 200 });
}
