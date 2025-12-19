// app/api/last-question/route.ts
import "server-only";

import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  try {
    const { sb, id: ownerId } = await requireUser(req);

    const { data, error } = await sb
      .from("ai_questions")
      .select("id, question, created_at")
      .eq("owner_id", ownerId)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (error) {
      console.error("[last-question] db error", error);
      return NextResponse.json({ ok: true, question: null }, { status: 200 });
    }

    return NextResponse.json({ ok: true, question: data?.question ?? null }, { status: 200 });
  } catch (err: any) {
    // Ikke logget ind (eller dev-bypass ikke opfyldt) => bare null
    const msg = String(err?.message ?? "");
    const isAuth = msg.toLowerCase().includes("unauthorized");
    if (!isAuth) console.error("[last-question] handler crash:", err);

    return NextResponse.json({ ok: true, question: null }, { status: 200 });
  }
}
