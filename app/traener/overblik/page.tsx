import { supabaseServerRSC } from "@/lib/supabase/server-rsc";
import AuthStateNotice from "@/components/ui/AuthStateNotice";
import OverblikClient from "./OverblikClient";

export const dynamic = "force-dynamic";

export default async function TrainerOverviewPage() {
  const sb = await supabaseServerRSC();
  const { data } = await sb.auth.getUser().catch(() => ({ data: { user: null } }));
  if (!data?.user?.id) {
    return (
      <AuthStateNotice message="Overblik kraever en rigtig login-session i denne browser. I LAN-dev kan serversiden godt kende DEV_USER_ID, men klientdata til overblik henter ikke uden login-cookie." />
    );
  }
  return <OverblikClient />;
}
