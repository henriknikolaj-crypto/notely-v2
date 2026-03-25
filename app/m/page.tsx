import MobileHomeMenu from "@/components/mobile/MobileHomeMenu";
import MobileHubHeader from "@/components/mobile/MobileHubHeader";
import { supabaseServerRSC } from "@/lib/supabase/server-rsc";
import SidebarQuotaBox from "../traener/ui/SidebarQuotaBox";

export const dynamic = "force-dynamic";

export default async function MobileHubPage() {
  let userEmail: string | null = null;
  try {
    const sb = await supabaseServerRSC();
    const { data } = await sb.auth.getUser();
    userEmail = data?.user?.email ?? null;
  } catch {
    userEmail = null;
  }

  return (
    <main className="min-h-screen bg-[#fffef9] px-4 py-6 md:px-6 md:py-10">
      <div className="mx-auto max-w-3xl space-y-4">
        <MobileHubHeader userEmail={userEmail} />
        <MobileHomeMenu />
        <section className="rounded-2xl border border-zinc-200 bg-white px-4 py-4 shadow-sm">
          <SidebarQuotaBox compact />
        </section>
      </div>
    </main>
  );
}
