/* eslint-disable @typescript-eslint/no-explicit-any */
import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { createServerClient, type CookieOptions } from "@supabase/ssr";

export async function GET() {
  const cookieStore = await cookies(); // ⬅️ vigtigt i Next 15

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }) => {
              cookieStore.set(name, value, options as CookieOptions);
            });
          } catch {}
        },
      },
    }
  );

  const { data: { user }, error: uerr } = await supabase.auth.getUser();
  if (uerr || !user) return NextResponse.json({ items: [] });

  const { data, error } = await supabase
    .from("exam_sessions")
    .select("id, question, score, created_at")
    .eq("owner_id", user.id)
    .order("created_at", { ascending: false })
    .limit(5);

  if (error) return NextResponse.json({ items: [], error: error.message }, { status: 200 });
  return NextResponse.json({ items: data ?? [] });
}


