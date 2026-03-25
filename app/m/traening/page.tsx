import MobileStudyMenu from "@/components/mobile/MobileStudyMenu";
import MobileBackToMenu from "@/components/mobile/MobileBackToMenu";
import MobileHubHeader from "@/components/mobile/MobileHubHeader";
import { supabaseServerRSC } from "@/lib/supabase/server-rsc";

export const dynamic = "force-dynamic";

export default async function MobileTrainingMenuPage() {
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
        <MobileBackToMenu href="/m" label="← Tilbage til hovedmenu" />
        <MobileStudyMenu />
      </div>
    </main>
  );
}
