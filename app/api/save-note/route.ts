import { NextResponse } from "next/server";
import { cookies as nextCookies } from "next/headers";
import { createServerClient } from "@supabase/ssr";

async function getDevUserId(req: Request): Promise<string | null> {
  if (process.env.NODE_ENV === "production") return null;
  try {
    const secret = req.headers.get("x-shared-secret") ?? req.headers.get("x-dev-secret");
    if (secret && secret === process.env.IMPORT_SHARED_SECRET) {
      return process.env.DEV_USER_ID ?? null;
    }
  } catch {}
  return null;
}

export async function POST(req: Request) {
  const body = await req.json().catch(()=>({}));
  const text = String(body?.text ?? "").trim();
  const source = String(body?.source ?? "manual");

  if (!text) return NextResponse.json({ ok:false, error:"empty" }, { status:400 });

  try {
    const cookieStore = await nextCookies();
    const supabase = createServerClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      {
        cookies: {
          get: (name: string) => cookieStore.get(name)?.value,
          set() {},
          remove() {}
        }
      }
    );

    const {
  data: { user },
} = await supabase.auth.getUser();

let userId: string | null = user?.id ?? null;

if (!userId) {
  const devId = await getDevUserId(req as any);
  if (devId) userId = devId;
}

if (!userId) {
  return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
}

    // Prøv at skrive til user_notes (valgfri tabel)
    // Skema-antagelse: id uuid default gen_random_uuid(), owner_id uuid, content text, source text, created_at timestamptz default now()
    const ins = await supabase
      .from("user_notes")
      .insert({ owner_id: userId, content: text, source })
      .select("id")
      .maybeSingle();

    if ((ins as any)?.error && String((ins as any).error?.message ?? "").includes("does not exist")) {
      // Tabel findes ikke -> svar OK (stub)
      return NextResponse.json({ ok:true, saved:false, warn:"no_table" }, { status:200 });
    }

    if ((ins as any)?.error) {
      // Anden fejl -> returnér stadig OK, men som stub
      return NextResponse.json({ ok:true, saved:false, warn:"insert_failed" }, { status:200 });
    }

    return NextResponse.json({ ok:true, saved:true, id: (ins as any)?.data?.id ?? null }, { status:200 });
  } catch {
    return NextResponse.json({ ok:true, saved:false, warn:"server_stub" }, { status:200 });
  }
}

