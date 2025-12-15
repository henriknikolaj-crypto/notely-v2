import { NextResponse } from "next/server";
import { z } from "zod";
import { supabaseServerRoute } from "@/lib/supabase/server-route";

function isAdmin(email?: string | null) {
  const admins = (process.env.ADMIN_EMAILS ?? "")
    .split(",").map(s => s.trim().toLowerCase()).filter(Boolean);
  return !!email && admins.includes(email.toLowerCase());
}

function normalizeWeight(input: unknown): number {
  if (input === undefined || input === null) return 0;
  const rawStr = typeof input === "string" ? input.trim() : String(input);
  // gør komma til punktum for numerisk parse
  const num = Number(rawStr.replace(",", "."));
  let n = isFinite(num) ? num : 0;
  const hasDecimalSep = /[.,]/.test(rawStr); // brugerens input havde decimal?
  // Skaler KUN hvis det ligner fraktion (0<n<1) ELLER der var decimal-separator
  if ((n > 0 && n < 1) || hasDecimalSep) n = n * 100;
  n = Math.round(n);
  if (n < 0) n = 0;
  if (n > 100) n = 100;
  return n;
}

const schema = z.object({
  domain: z.string().trim().min(3),
  display_name: z.string().trim().optional(),
  country: z.enum(["DK","EU","INT"]).optional().default("INT"),
  subject: z.string().trim().optional(),
  tier: z.enum(["A","B","C"]).optional().default("B"),
  weight: z.union([z.number(), z.string()]).optional().default(0.6),
});

export async function POST(req: Request) {
  const supabase = await supabaseServerRoute();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user || !isAdmin(user.email)) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const json = await req.json().catch(() => ({}));
  const parsed = schema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json({ error: "validation_error", issues: parsed.error.flatten() }, { status: 400 });
  }

  const p = parsed.data;
  const weight = normalizeWeight(p.weight);

  const { error } = await supabase
    .from("verified_sources")
    .upsert({ domain: p.domain.toLowerCase(), weight }, { onConflict: "domain" });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  await supabase.from("candidate_sources").delete().eq("domain", p.domain.toLowerCase());
  return NextResponse.json({ ok: true }, { status: 200 });
}



