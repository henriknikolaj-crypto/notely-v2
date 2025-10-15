import { createClient } from "@supabase/supabase-js";

export function sbAdmin() {
  return createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
}

export async function collectContextForUser(ownerId: string, tokenLimit = 32000) {
  const sb = sbAdmin();
  const { data: chunks, error } = await sb
    .from("doc_chunks")
    .select("content, token_count")
    .eq("owner_id", ownerId)
    .order("token_count", { ascending: true })
    .limit(400);
  if (error) throw error;

  let ctx = "";
  let used = 0;
  for (const c of chunks ?? []) {
    const t = c.token_count ?? Math.ceil((c.content?.length ?? 0) / 4);
    if (used + t > tokenLimit) break;
    ctx += (c.content ?? "") + "\n\n";
    used += t;
  }
  return ctx.trim();
}
