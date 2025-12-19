import "server-only";
import type { NextRequest } from "next/server";

export type OwnerCtx = {
  ownerId: string;
  mode: "auth" | "dev";
  user: { id: string; email: string | null } | null;
};

function isUuid(v: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(v);
}

/**
 * Owner-resolve:
 * 1) Supabase auth cookie (rigtig bruger)
 * 2) Dev-bypass: KUN i non-prod + KUN hvis secret er sat + matcher header
 *    (ingen silent DEV_USER_ID)
 */
export async function getOwnerCtx(req: NextRequest, sb: any): Promise<OwnerCtx | null> {
  // 1) Auth først
  try {
    if (sb?.auth?.getUser) {
      const { data, error } = await sb.auth.getUser();
      if (!error && data?.user?.id) {
        return {
          ownerId: String(data.user.id),
          mode: "auth",
          user: { id: String(data.user.id), email: (data.user.email as any) ?? null },
        };
      }
    }
  } catch {
    // ignore
  }

  // 2) Prod: aldrig dev-bypass
  if (process.env.NODE_ENV === "production") return null;

  // Dev-bypass kræver DEV_USER_ID + secret + header match
  const devId = String(process.env.DEV_USER_ID ?? "").trim();
  if (!devId || !isUuid(devId)) return null;

  const expected = String(process.env.DEV_BYPASS_SECRET ?? process.env.DEV_SECRET ?? "").trim();
  if (!expected) return null;

  const presented = String(
    req.headers.get("x-dev-secret") ||
      req.headers.get("x-shared-secret") ||
      "",
  ).trim();

  if (presented !== expected) return null;

  return {
    ownerId: devId,
    mode: "dev",
    user: { id: devId, email: null },
  };
}
