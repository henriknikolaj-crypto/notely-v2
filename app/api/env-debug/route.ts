/* eslint-disable @typescript-eslint/no-explicit-any */
import { NextResponse } from "next/server";
export async function GET() {
  return NextResponse.json({
    node_env: process.env.NODE_ENV,
    has_openai_key: Boolean(process.env.OPENAI_API_KEY),
    dev_user_id: process.env.DEV_USER_ID || null,
    supa_url: process.env.NEXT_PUBLIC_SUPABASE_URL || null,
  });
}

