import { NextResponse } from "next/server";
import { requireFlowModel } from "@/lib/openai/requireModel";

export const dynamic = "force-dynamic";

export async function GET() {
  const hasKey = !!process.env.OPENAI_API_KEY;

  const safe = (fn: () => string) => {
    try { return fn(); } catch { return null; }
  };

  return NextResponse.json({
    ok: hasKey,
    models: {
      trainer: safe(() => requireFlowModel("trainer")),
      simulator: safe(() => requireFlowModel("simulator")),
      oral: safe(() => requireFlowModel("oral")),
    },
  });
}
