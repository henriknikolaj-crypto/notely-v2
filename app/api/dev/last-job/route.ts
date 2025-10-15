import { headers, cookies } from "next/headers";
import { createClient } from "@supabase/supabase-js";
import type { NextRequest } from "next/server";

function supaWithBearer(token: string) {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { global: { headers: { Authorization: `Bearer ${token}` } } }
  );
}
function supaService() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
}

export async function GET(_req: NextRequest) {
  const hdrs = await headers(); // ← VIGTIGT

  const auth = hdrs.get("authorization") || "";
  const token = auth.toLowerCase().startsWith("bearer ") ? auth.slice(7) : "";
  if (token) {
    const supa = supaWithBearer(token);
    const { data: userInfo } = await supa.auth.getUser();
    if (!userInfo?.user) return new Response("Unauthorized", { status: 401 });

    const { data, error } = await supa
      .from("jobs").select("id, status, created_at")
      .eq("owner_id", userInfo.user.id)
      .order("created_at", { ascending: false }).limit(1).maybeSingle();

    if (error) return new Response(error.message, { status: 400 });
    return Response.json(data ?? {});
  }

  const ok = hdrs.get("x-shared-secret") === process.env.IMPORT_SHARED_SECRET;
  if (ok) {
    const supaSrv = supaService();
    const { data, error } = await supaSrv
      .from("jobs").select("id, status, created_at")
      .order("created_at", { ascending: false }).limit(1).maybeSingle();

    if (error) return new Response(error.message, { status: 400 });
    return Response.json(data ?? {});
  }

  const cookieStore = await cookies(); // ← VIGTIGT
  const supaCookie = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { cookies: { get(name: string) { return cookieStore.get(name)?.value; } } }
  );
  const { data: u } = await supaCookie.auth.getUser();
  if (!u?.user) return new Response("Unauthorized", { status: 401 });

  const { data, error } = await supaCookie
    .from("jobs").select("id, status, created_at")
    .eq("owner_id", u.user.id)
    .order("created_at", { ascending: false }).limit(1).maybeSingle();

  if (error) return new Response(error.message, { status: 400 });
  return Response.json(data ?? {});
}
