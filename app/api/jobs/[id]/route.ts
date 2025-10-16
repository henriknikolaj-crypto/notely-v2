import { headers, cookies } from "next/headers";
import { createClient } from "@supabase/supabase-js";
import type { NextRequest } from "next/server";
import { createServerClient } from "@supabase/ssr";
import type { CookieOptions } from "@supabase/ssr";

export async function GET(
  _req: NextRequest,
  ctx: { params: Promise<{ id: string }> }   // Next 15: params er en Promise
) {
  const { id } = await ctx.params;           // await params
  const hdrs = await headers();              // await headers()

  // Bearer fra scripts
  const auth = hdrs.get("authorization") || "";
  const token = auth.toLowerCase().startsWith("bearer ") ? auth.slice(7) : "";

  const supaWithBearer = (t: string) =>
    createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      { global: { headers: { Authorization: `Bearer ${t}` } } }
    );

  const supaService = () =>
    createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    );

  // 1) Bearer (fra PowerShell-scripts)
  if (token) {
    const supa = supaWithBearer(token);
    const { data: u } = await supa.auth.getUser();
    if (!u?.user) return new Response("Unauthorized", { status: 401 });

    const { data, error } = await supa
      .from("jobs").select("*")
      .eq("id", id).eq("owner_id", u.user.id).single();

    if (error) return new Response(error.message, { status: 404 });
    return Response.json(data);
  }

  // 2) Dev fallback (x-shared-secret)
  if (hdrs.get("x-shared-secret") === process.env.IMPORT_SHARED_SECRET) {
    const supa = supaService();
    const { data, error } = await supa
      .from("jobs").select("*")
      .eq("id", id).single();

    if (error) return new Response(error.message, { status: 404 });
    return Response.json(data);
  }

  // 3) Cookie-session (UI)
  const cookieStore = await cookies();  // await cookies()
  const supaCookie = createServerClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, { cookies: { getAll() { return cookieStore.getAll(); }, setAll(cookiesToSet) { try { cookiesToSet.forEach(({ name, value, options }) => { cookieStore.set(name, value, options as CookieOptions); }); } catch {} } } });

  const { data: u } = await supaCookie.auth.getUser();
  if (!u?.user) return new Response("Unauthorized", { status: 401 });

  const { data, error } = await supaCookie
    .from("jobs").select("*")
    .eq("id", id).eq("owner_id", u.user.id).single();

  if (error) return new Response(error.message, { status: 404 });
  return Response.json(data);
}


