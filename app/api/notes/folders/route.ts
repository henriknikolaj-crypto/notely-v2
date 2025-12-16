import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

function getSB() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY!;
  if (!url || !key) throw new Error("Supabase env missing");
  return createClient(url, key);
}

/** I dev: brug DEV_USER_ID uden headers. I prod: afvis. */
async function getUserIdDev(req: Request): Promise<string | null> {
  void req;
  if (process.env.NODE_ENV !== "production") {
    return process.env.DEV_USER_ID ?? null;
  }
  return null;
}

export async function GET(req: Request) {
  const userId = await getUserIdDev(req);
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const sb = getSB();
  const { data, error } = await sb
    .from("note_folders")
    .select("id,name,parent_id,created_at")
    .eq("owner_id", userId)
    .order("name", { ascending: true });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true, folders: data ?? [] });
}

export async function POST(req: Request) {
  const userId = await getUserIdDev(req);
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await req.json().catch(() => ({}));
  const name = (body?.name ?? "").toString().trim();
  const parent_id = (body?.parent_id ?? null) || null;

  if (!name || name.length < 2) {
    return NextResponse.json({ error: "Ugyldigt mappenavn" }, { status: 400 });
  }

  const sb = getSB();
  const { data, error } = await sb
    .from("note_folders")
    .insert({ name, parent_id, owner_id: userId })
    .select("id")
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true, id: data?.id ?? null });
}




