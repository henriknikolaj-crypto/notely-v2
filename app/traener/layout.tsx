// app/traener/layout.tsx
import "server-only";

import Link from "next/link";
import { unstable_noStore as noStore } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@supabase/supabase-js";
import { getTrainerSession } from "@/lib/auth/trainer-session";
import { supabaseServerRSC } from "@/lib/supabase/server-rsc";
import MobileBackToMenu from "@/components/mobile/MobileBackToMenu";
import DesktopSidebarShell from "./ui/DesktopSidebarShell";
import TrainingSidebarMainNav from "./ui/TrainingSidebarMainNav";
import TrainingSidebarStats from "./ui/TrainingSidebarStats";
import TrainingSidebarFolderSection from "./ui/TrainingSidebarFolderSection";
import TrainingTabs from "./ui/TrainingTabs";

export const dynamic = "force-dynamic";

type FolderRow = {
  id: string;
  name: string;
  parent_id: string | null; // ikke optional
  start_date: string | null;
  end_date: string | null;
  archived_at: string | null;
};

type LatestNoteRow = {
  id: string;
  title: string | null;
  note_type: string | null;
  created_at: string | null;
};

function normalizePlan(raw: unknown) {
  const p = String(raw ?? "").trim().toLowerCase();
  if (!p) return "freemium";
  if (p === "free") return "freemium";
  if (p === "basic") return "basis";
  return p;
}

function supabaseAdmin() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    throw new Error("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
  }
  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

export default async function TraenerLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  noStore();
  const sb = await supabaseServerRSC();
  const { ownerId, email: currentUserEmail } = await getTrainerSession();

  if (!ownerId) redirect("/auth/login");

  let isPro = false;
  let planLabel: string | null = null;
  try {
    const admin = supabaseAdmin();
    const { data: profileData, error: profileError } = await admin
      .from("profiles")
      .select("plan")
      .eq("id", ownerId)
      .maybeSingle();
    if (profileError) throw profileError;
    const planNorm = normalizePlan((profileData as any)?.plan ?? null);
    isPro = planNorm === "pro";
    planLabel =
      planNorm === "pro" ? "Pro" : planNorm === "basis" ? "Basis" : planNorm === "freemium" ? "Freemium" : null;
  } catch (e) {
    console.error("TRÆNER layout pro lookup error:", e);
    isPro = false;
    planLabel = null;
  }

  const disableLiveQuotaFetch = false;

  // ---- Mapper i venstre træ ----
  const { data: foldersData, error: foldersError } = await sb
    .from("folders")
    .select("id,name,parent_id,start_date,end_date,archived_at")
    .eq("owner_id", ownerId)
    .is("archived_at", null)
    .order("name", { ascending: true });

  if (foldersError) {
    console.error("TRÆNER layout folders error:", foldersError);
  }

  const folders: FolderRow[] = (foldersData ?? []).map((f: any) => ({
    id: String(f.id),
    name: String(f.name ?? ""),
    parent_id: f.parent_id ?? null,
    start_date: f.start_date ?? null,
    end_date: f.end_date ?? null,
    archived_at: f.archived_at ?? null,
  }));

  // ---- Seneste resuméer/fokus-noter til notes-fanen (max 50) ----
  const { data: latestNotesData, error: latestNotesError } = await sb
    .from("notes")
    .select("id,title,note_type,created_at")
    .eq("owner_id", ownerId)
    .in("note_type", ["resume", "summary", "focus"])
    .order("created_at", { ascending: false })
    .limit(50);

  if (latestNotesError) {
    console.error("TRÆNER layout latest notes error:", latestNotesError);
  }

  const latestNotes: LatestNoteRow[] = (latestNotesData ?? []).map((n: any) => ({
    id: String(n.id),
    title: (n.title ?? null) as string | null,
    note_type: (n.note_type ?? null) as string | null,
    created_at: (n.created_at ?? null) as string | null,
  }));

  // ---- Seneste evalueringer (KUN Træner) ----
  const { data: latestEvalsData, error: latestEvalsError } = await sb
    .from("exam_sessions")
    .select("id,score,created_at")
    .eq("owner_id", ownerId)
    .eq("source_type", "trainer")
    .order("created_at", { ascending: false })
    .limit(50);

  if (latestEvalsError) {
    console.error("TRÆNER layout latest evals error:", latestEvalsError);
  }

  const latestEvals =
    (latestEvalsData as {
      id: string;
      score: number | null;
      created_at: string | null;
    }[]) ?? [];

  // ---- Counts (resuméer / fokus-noter / Træner-evalueringer) ----

  // Træner-evalueringer count
  const { count: evalCountRaw, error: evalCountError } = await sb
    .from("exam_sessions")
    .select("id", { count: "exact", head: true })
    .eq("owner_id", ownerId)
    .eq("source_type", "trainer");

  const evalCount = evalCountRaw ?? 0;

  if (evalCountError) {
    console.error("TRÆNER layout evalCount error:", evalCountError);
  }

  // Resumé count
  const { count: resumeCountRaw, error: resumeCountError } = await sb
    .from("notes")
    .select("id", { count: "exact", head: true })
    .eq("owner_id", ownerId)
    .eq("note_type", "resume");

  const resumeCount = resumeCountRaw ?? 0;

  if (resumeCountError) {
    console.error("TRÆNER layout resumeCount error:", resumeCountError);
  }

  // Fokus-noter count
  const { count: focusCountRaw, error: focusCountError } = await sb
    .from("notes")
    .select("id", { count: "exact", head: true })
    .eq("owner_id", ownerId)
    .eq("note_type", "focus");

  const focusCount = focusCountRaw ?? 0;

  if (focusCountError) {
    console.error("TRÆNER layout focusCount error:", focusCountError);
  }

  return (
    <main className="min-h-screen bg-[#fffef9]">
      {/* Topbar */}
      <header className="border-b border-zinc-200 bg-white">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-4 py-4 md:px-6">
          <Link href="/traener/overblik" className="logo-script [font-family:var(--font-logo)] font-normal text-4xl leading-none">
            Notely.
          </Link>
          <div className="flex items-center gap-3">
            <span className="text-xs text-zinc-700">{currentUserEmail ?? ""}</span>
            <Link
              href="/auth/logout"
              className="rounded-lg border border-zinc-300 px-3 py-1 text-xs hover:bg-zinc-50"
            >
              Log ud
            </Link>
          </div>
        </div>
      </header>

      <div className="mx-auto max-w-6xl px-4 py-6 md:px-6">
        <DesktopSidebarShell
          mobileTop={<MobileBackToMenu />}
          desktopTop={<TrainingTabs isPro={isPro} disableLiveFetch={disableLiveQuotaFetch} />}
          sidebar={
            <>
              <div className="px-2 pb-1 pt-1 font-semibold text-zinc-800">Mit Notely</div>

              <TrainingSidebarMainNav />

              <TrainingSidebarFolderSection folders={folders} />

              <TrainingSidebarStats
                latestNotes={latestNotes}
                latestEvals={latestEvals}
                evalCount={evalCount}
                resumeCount={resumeCount}
                focusCount={focusCount}
                planLabel={planLabel}
                disableLiveQuotaFetch={disableLiveQuotaFetch}
              />
            </>
          }
        >
          {children}
        </DesktopSidebarShell>
      </div>
    </main>
  );
}
