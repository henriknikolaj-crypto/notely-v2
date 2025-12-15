/* eslint-disable @typescript-eslint/no-explicit-any */
import { NextRequest, NextResponse } from "next/server";

export async function GET(req: NextRequest) {
  const hdr = req.headers.get("authorization") || "";
  const token = hdr.startsWith("Bearer ") ? hdr.slice(7).trim() : hdr.trim();
  const expected = process.env.IMPORT_SHARED_SECRET || "";

  const safe = (s: string) => {
    if (!s) return "(empty)";
    if (s.length <= 6) return s[0] + "***";
    return s.slice(0,3) + "…" + s.slice(-3);
  };

  return NextResponse.json({
    receivedAuthHeaderRaw: hdr || "(none)",
    receivedTokenMasked: safe(token),
    expectedFromEnvMasked: safe(expected),
    tokenLength: token?.length ?? 0,
    expectedLength: expected?.length ?? 0,
    envPresent: !!expected,
    match: !!token && !!expected && token === expected,
  });
}



