import "server-only";

import type { NextRequest } from "next/server";
import { supabaseServerRoute } from "@/lib/supabase/server-route";
import { getOwnerCtx } from "@/lib/auth/owner";

export type RequireUserResult = {
  sb: any;
  id: string;
  mode: "auth" | "dev";
  user: { id: string; email: string | null } | null;
};

/**
 * Brug i Route Handlers:
 * - med req: auth cookie OR dev-bypass (via getOwnerCtx)
 * - uden req: KUN auth cookie (ingen dev-bypass)
 */
export async function requireUser(req?: NextRequest): Promise<RequireUserResult> {
  const sb = await supabaseServerRoute();

  if (req) {
    const owner = await getOwnerCtx(req, sb);
    if (!owner) throw new Error("Unauthorized");
    return { sb, id: owner.ownerId, mode: owner.mode, user: owner.user };
  }

  // Kun auth cookie
  const { data, error } = await sb.auth.getUser();
  if (!error && data?.user?.id) {
    return {
      sb,
      id: String(data.user.id),
      mode: "auth",
      user: { id: String(data.user.id), email: (data.user.email as any) ?? null },
    };
  }

  throw new Error("Unauthorized");
}
