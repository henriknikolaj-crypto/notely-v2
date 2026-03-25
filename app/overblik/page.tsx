import { supabaseServerRSC } from "@/lib/supabase/server-rsc";
import AuthStateNotice from "@/components/ui/AuthStateNotice";
import OverblikClient from "../traener/overblik/OverblikClient";

export const dynamic = "force-dynamic";

export default async function OverviewPage() {
  const sb = await supabaseServerRSC();
  const { data } = await sb.auth.getUser().catch(() => ({ data: { user: null } }));

  if (!data?.user?.id) {
    return (
      <AuthStateNotice message="Overblik kræver en rigtig login-session i denne browser. I LAN-dev kan serversiden godt kende DEV_USER_ID, men klientdata til overblik henter ikke uden login-cookie." />
    );
  }

  return <OverblikClient />;
}
