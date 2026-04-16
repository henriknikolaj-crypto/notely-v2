import "server-only";

import { cache } from "react";
import { supabaseServerRSC } from "@/lib/supabase/server-rsc";

export type TrainerSession = {
  ownerId: string | null;
  email: string | null;
};

export const getTrainerSession = cache(async (): Promise<TrainerSession> => {
  const sb = await supabaseServerRSC();

  try {
    const { data, error } = await sb.auth.getUser();
    if (!error && data?.user?.id) {
      return {
        ownerId: String(data.user.id),
        email: data.user.email ?? null,
      };
    }
  } catch {
    // ignore
  }

  return {
    ownerId: null,
    email: null,
  };
});
