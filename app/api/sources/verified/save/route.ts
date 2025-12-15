import { NextResponse } from "next/server";
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

export async function POST(req: Request) {
  const supabase = await supabaseServerRoute();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user || !isAdmin(user.email)) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  let body: any = {};
  try { body = await req.json(); } catch { body = {}; }

  const domain = String(body?.domain ?? "").trim().toLowerCase();
  const weight = normalizeWeight(body?.weight);
  const language = body?.language === undefined || body?.language === null
    ? null
    : String(body.language).trim() || null;
  const note = body?.note === undefined || body?.note === null
    ? null
    : String(body.note).trim() || null;

  if (!domain || domain.length < 3 || !domain.includes(".")) {
    return NextResponse.json(
      { error: "validation_error", detail: "Ugyldigt domæne (fx b.dk)" },
      { status: 400 }
    );
  }

  const { error } = await supabase
    .from("verified_sources")
    .upsert({ domain, weight, language, note }, { onConflict: "domain" });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true }, { status: 200 });
}



