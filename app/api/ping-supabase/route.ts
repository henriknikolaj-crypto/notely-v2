/* eslint-disable @typescript-eslint/no-explicit-any */
export const runtime = 'edge';
import { NextResponse } from "next/server";

export async function GET() {
  const base = (process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL)!;
  const key  = process.env.SUPABASE_SERVICE_ROLE_KEY!;
  const url  = `${base}/rest/v1/plan_limits?select=plan&limit=1`;
  try {
    const r = await fetch(url, { headers: { apikey: key, Authorization: `Bearer ${key}` }, cache: "no-store" });
    const text = await r.text();
    return NextResponse.json({ ok: r.ok, status: r.status, text: text.slice(0,500) });
  } catch (e:any) {
    return NextResponse.json({ ok:false, name:e?.name, message:e?.message, stack:e?.stack }, { status: 500 });
  }
}

