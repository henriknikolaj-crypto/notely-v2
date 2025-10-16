/* eslint-disable @typescript-eslint/no-explicit-any */
import { NextResponse } from "next/server";
export function GET() {
  return NextResponse.json({ ok: true, ts: Date.now() });
}

