import MobileStudyMenu from "@/components/mobile/MobileStudyMenu";
import MobileBackToMenu from "@/components/mobile/MobileBackToMenu";
import MobileHubHeader from "@/components/mobile/MobileHubHeader";
import { getTrainerSession } from "@/lib/auth/trainer-session";
import { supabaseServerRSC } from "@/lib/supabase/server-rsc";
import { hasOwnUsableMaterial } from "@/lib/trainer/hasOwnUsableMaterial";

export const dynamic = "force-dynamic";

export default async function MobileTrainingMenuPage() {
  let userEmail: string | null = null;
  let showDemoBadge = false;
  try {
    const sb = await supabaseServerRSC();
    const { ownerId, email } = await getTrainerSession();
    userEmail = email;
    showDemoBadge = !!ownerId && !(await hasOwnUsableMaterial(sb, ownerId));
  } catch {
    userEmail = null;
    showDemoBadge = false;
  }

  return (
    <main className="min-h-screen bg-[#fffef9] px-4 py-6 md:px-6 md:py-10">
      <div className="mx-auto max-w-3xl space-y-4">
        <MobileHubHeader userEmail={userEmail} />
        <MobileBackToMenu href="/m" label="← Tilbage til hovedmenu" />
        <MobileStudyMenu showDemoBadge={showDemoBadge} />
      </div>
    </main>
  );
}
