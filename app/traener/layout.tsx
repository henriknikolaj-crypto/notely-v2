// app/traener/layout.tsx
import "server-only";

import Link from "next/link";
import { redirect } from "next/navigation";
import { supabaseServerRSC } from "@/lib/supabase/server-rsc";
import TrainingSidebarMainNav from "./ui/TrainingSidebarMainNav";
import TrainingSidebarFolders from "./ui/TrainingSidebarFolders";
import TrainingSidebarStats from "./ui/TrainingSidebarStats";
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

async function getOwnerCtx(sb: any): Promise<{ id: string; email: string | null } | null> {
  try {
    const { data } = await sb.auth.getUser();
    if (data?.user?.id) {
      return {
        id: String(data.user.id),
        email: (data.user.email as string | null | undefined) ?? null,
      };
    }
  } catch {
    // ignore
  }
  return null;
}

const TRAINER_NOTE_TYPES = ["feedback", "trainer", "trainer_feedback"];

export default async function TraenerLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const sb = await supabaseServerRSC();
  const owner = await getOwnerCtx(sb);

  if (!owner?.id) {
    redirect("/auth/login");
  }
  const ownerId = owner.id;

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

  // ---- Seneste noter (alle typer) til sidebar (max 50) ----
  const { data: latestNotesData, error: latestNotesError } = await sb
    .from("notes")
    .select("id,title,note_type,created_at")
    .eq("owner_id", ownerId)
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

  // ---- Counts (Træner-noter / resuméer / fokus-noter / Træner-evalueringer) ----

  // Træner-noter count
  const { count: trainerNotesCountRaw, error: trainerNotesCountError } = await sb
    .from("notes")
    .select("id", { count: "exact", head: true })
    .eq("owner_id", ownerId)
    .in("note_type", TRAINER_NOTE_TYPES);

  const trainerNotesCount = trainerNotesCountRaw ?? 0;

  if (trainerNotesCountError) {
    console.error(
      "TRÆNER layout trainerNotesCount error:",
      trainerNotesCountError
    );
  }

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
          <Link href="/traener" className="logo-script text-4xl leading-none">
            Notely.
          </Link>
          <div className="flex items-center gap-3">
            <span className="text-xs text-zinc-700">
              {owner.email ?? ""}
            </span>
            <Link
              href="/auth/logout"
              className="rounded-lg border border-zinc-300 px-3 py-1 text-xs hover:bg-zinc-50"
            >
              Log ud
            </Link>
          </div>
        </div>
      </header>

      {/* 2-kolonne layout */}
      <div className="mx-auto flex max-w-6xl gap-6 px-4 py-6 md:px-6">
        {/* VENSTRE SIDEBAR */}
        <aside className="w-64 shrink-0">
          <div className="space-y-3 rounded-2xl border border-zinc-200 bg-white p-3 text-sm shadow-sm">
            <div className="px-2 pt-1 pb-1 font-semibold text-zinc-800">
              Mit Notely
            </div>

            <TrainingSidebarMainNav />

            <div className="px-2 pt-2 font-semibold text-zinc-800">
              Dine fag
            </div>
            <TrainingSidebarFolders folders={folders} />

            <TrainingSidebarStats
              latestNotes={latestNotes}
              latestEvals={latestEvals}
              notesCount={trainerNotesCount}
              evalCount={evalCount}
              resumeCount={resumeCount}
              focusCount={focusCount}
            />
          </div>
        </aside>

        {/* HØJRE KOLONNE */}
        <section className="min-w-0 flex-1 bg-transparent">
          <TrainingTabs />
          {children}
        </section>
      </div>
    </main>
  );
}
