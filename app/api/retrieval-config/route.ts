import { NextRequest, NextResponse } from "next/server";
import { supabaseServerRoute } from "@/lib/supabase/server-route";
import { z } from "zod";

type Weights = {
  alpha: number;   // α
  beta: number;    // β
  m_lang: number;  // language boost
  m_domain: number;// domain/source boost
};

const DEFAULTS: Weights = {
  alpha: 0.35,
  beta: 0.20,
  m_lang: 0.15,
  m_domain: 0.20,
};

const schema = z.object({
  alpha: z.number().min(0).max(1).optional(),
  beta: z.number().min(0).max(1).optional(),
  m_lang: z.number().min(0).max(1).optional(),
  m_domain: z.number().min(0).max(1).optional(),
  // NOTE: “reset” bliver brugt i næste iteration til egentlig DELETE – pt. overskriver vi blot med defaults.
  reset: z.boolean().optional(),
});

export async function GET() {
  const supabase = await supabaseServerRoute(); // ⬅️ vigtig ændring
  const { data: auth } = await supabase.auth.getUser();
  const user = auth?.user;
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { data, error } = await supabase
    .from("retrieval_config")
    .select("alpha,beta,m_lang,m_domain,updated_at")
    .eq("owner_id", user.id)
    .maybeSingle();

  if (error || !data) {
    // Ved RLS-fejl/ingen række → fallback
    return NextResponse.json(
      { ...DEFAULTS, source: "default", updated_at: null },
      { status: 200 }
    );
  }

  return NextResponse.json({ ...data, source: "db" }, { status: 200 });
}

export async function POST(req: NextRequest) {
  void req;
  const supabase = await supabaseServerRoute(); // ⬅️ vigtig ændring
  const { data: auth } = await supabase.auth.getUser();
  const user = auth?.user;
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const json = await req.json().catch(() => ({}));
  const parsed = schema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "ValidationError", issues: parsed.error.flatten() },
      { status: 400 }
    );
  }

  const body = parsed.data;

  // Midlertidig “reset”: overskriv med defaults (næste session: egentlig DELETE)
  const nextValues: Weights = body.reset
    ? { ...DEFAULTS }
    : {
        alpha: body.alpha ?? DEFAULTS.alpha,
        beta: body.beta ?? DEFAULTS.beta,
        m_lang: body.m_lang ?? DEFAULTS.m_lang,
        m_domain: body.m_domain ?? DEFAULTS.m_domain,
      };

  const { data, error } = await supabase
    .from("retrieval_config")
    .upsert(
      { owner_id: user.id, ...nextValues },
      { onConflict: "owner_id" }
    )
    .select("alpha,beta,m_lang,m_domain,updated_at")
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ ...data, source: "db" }, { status: 200 });
}


export async function DELETE() {
  const supabase = await supabaseServerRoute();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { error } = await supabase
    .from("retrieval_config")
    .delete()
    .eq("owner_id", user.id);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}







