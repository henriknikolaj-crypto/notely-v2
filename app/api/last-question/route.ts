/* eslint-disable @typescript-eslint/no-explicit-any */
import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { requireUser } from "@/app/(lib)/requireUser";

function makeDb() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const key = (process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY)!;
  return createClient(url, key, { auth: { persistSession: false } });
}

export async function GET() {
  const db = makeDb();
  try {
    let ownerId: string | null;
    try {
      const u = await requireUser();
      ownerId = u?.id ?? process.env.DEV_USER_ID ?? null;
    } catch {
      ownerId = process.env.DEV_USER_ID ?? null;
    }
    if (!ownerId) return NextResponse.json({ question: null });

    const { data, error } = await db
      .from("ai_questions")
      .select("id, question, created_at")
      .eq("owner_id", ownerId)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (error) return NextResponse.json({ question: null });
    return NextResponse.json({ question: data?.question ?? null });
  } catch {
    return NextResponse.json({ question: null });
  }
}


