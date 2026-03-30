import { supabaseServerRSC } from "@/lib/supabase/server-rsc";
import OverblikClient from "./OverblikClient";

export const dynamic = "force-dynamic";

export default async function TrainerOverviewPage() {
  const sb = await supabaseServerRSC();
  await sb.auth.getUser().catch(() => ({ data: { user: null } }));
  return <OverblikClient />;
}
