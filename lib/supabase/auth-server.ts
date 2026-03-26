import "server-only";

export type SupabaseServerAuthResult = {
  userId: string | null;
  email: string | null;
  authError: string | null;
};

export async function resolveSupabaseServerUser(supabase: any): Promise<SupabaseServerAuthResult> {
  const authApi = supabase?.auth as
    | {
        getClaims?: () => Promise<any>;
        getUser?: () => Promise<any>;
      }
    | undefined;

  if (!authApi) {
    return { userId: null, email: null, authError: "Missing auth API" };
  }

  if (typeof authApi.getClaims === "function") {
    try {
      const claimsResult = await authApi.getClaims();
      const claims = claimsResult?.data?.claims ?? claimsResult?.claims ?? null;
      const userId = claims?.sub ? String(claims.sub) : null;
      const email = claims?.email ? String(claims.email) : null;
      if (userId) {
        return { userId, email, authError: null };
      }
    } catch {
      // fall through to getUser
    }
  }

  if (typeof authApi.getUser === "function") {
    try {
      const { data, error } = await authApi.getUser();
      return {
        userId: data?.user?.id ? String(data.user.id) : null,
        email: data?.user?.email ? String(data.user.email) : null,
        authError: error?.message ?? null,
      };
    } catch (error: any) {
      return {
        userId: null,
        email: null,
        authError: error?.message ?? "Unknown auth error",
      };
    }
  }

  return { userId: null, email: null, authError: "No supported auth lookup" };
}
