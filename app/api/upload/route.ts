// app/api/upload/route.ts
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

// Legacy endpoint – bruges ikke længere.
// Beholdes kun for at undgå byg-fejl.
export async function POST() {
  return NextResponse.json(
    {
      ok: false,
      error: "Denne endpoint er udfaset. Brug /api/trainer/upload i stedet.",
    },
    { status: 410 }
  );
}
