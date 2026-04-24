// app/notes/[id]/page.tsx
import "server-only";
import Link from "next/link";
import FocusNoteContent from "@/app/notes/ui/FocusNoteContent";
import ResumeNoteContent from "@/app/notes/ui/ResumeNoteContent";
import { supabaseServerRSC } from "@/lib/supabase/server-rsc";
import { assertCanAccessVisibleNoteCategory, FREEMIUM_NOTE_LOCKED_MESSAGE } from "@/lib/notes/entitlements";
import { trackProductEvent } from "@/lib/server/trackProductEvent";
import { getTrainerSession } from "@/lib/auth/trainer-session";

export const dynamic = "force-dynamic";

type NoteRow = {
  id: string;
  title: string | null;
  content: string | null;
  created_at: string | null;
  note_type: string | null;
  metadata?: unknown;
};

function formatDT(iso: string | null | undefined) {
  if (!iso) return "";
  const d = new Date(iso);
  return d
    .toLocaleString("da-DK", {
      day: "2-digit",
      month: "short",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    })
    .replace(/\.$/, "");
}

function classifyDetailNote(note: Pick<NoteRow, "title" | "note_type">): "resume" | "focus" | "other" {
  const type = String(note.note_type ?? "").trim().toLowerCase();
  const title = String(note.title ?? "").trim().toLowerCase();
  if (type === "resume") return "resume";
  if (type === "summary") return "resume";
  if (type === "focus") return "focus";
  if (title.startsWith("resumé") || title.startsWith("resume")) return "resume";
  if (title.startsWith("fokus-noter") || title.startsWith("fokusnoter")) return "focus";
  return "other";
}

type PageProps = {
  params: Promise<{ id: string }>;
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
};

async function loadNoteWithOptionalMetadata(sb: any, ownerId: string, noteId: string) {
  const attempts = [
    "id,title,content,created_at,note_type,metadata",
    "id,title,content,created_at,note_type",
  ];

  let lastError: any = null;
  for (const select of attempts) {
    const { data, error } = await sb
      .from("notes")
      .select(select)
      .eq("owner_id", ownerId)
      .eq("id", noteId)
      .maybeSingle<NoteRow>();

    if (!error) {
      return {
        ...(data ?? null),
        metadata: data?.metadata ?? null,
      } as NoteRow | null;
    }
    lastError = error;
  }

  if (lastError) throw lastError;
  return null;
}

export default async function NoteDetailPage({ params, searchParams }: PageProps) {
  const { id } = await params;
  const sp = (await searchParams) ?? {};
  const backParam = typeof sp.back === "string" ? sp.back : undefined;

  const scopeParam = typeof sp.scope === "string" ? sp.scope : undefined;
  const trainerScopeParam = typeof sp.tscope === "string" ? sp.tscope : undefined;

  function safeBackHref(raw: string | undefined): string | null {
    const s = String(raw ?? "").trim();
    if (!s.startsWith("/") || s.startsWith("//")) return null;
    if (s.startsWith("/_next") || s.includes("_rsc=")) return null;
    if (!s.startsWith("/notes") && !s.startsWith("/traener/noter") && !s.startsWith("/m/noter")) return null;
    return s;
  }

  function backLabelForHref(href: string): string {
    if (href.startsWith("/traener/noter")) return "← Tilbage til Noter";
    if (href.startsWith("/notes?scope=resume")) return "← Tilbage til Resuméer";
    if (href.startsWith("/notes?scope=focus")) return "← Tilbage til Fokus-noter";
    return "← Tilbage til Noter";
  }

  let backHref = safeBackHref(backParam);
  let backLabel = backHref ? backLabelForHref(backHref) : "← Tilbage til Noter";

  if (!backHref) {
    const backParams = new URLSearchParams();
    switch (scopeParam) {
      case "resume":
        backParams.set("scope", "resume");
        backLabel = "← Tilbage til Resuméer";
        break;
      case "focus":
        backParams.set("scope", "focus");
        if (trainerScopeParam) backParams.set("tscope", trainerScopeParam);
        backLabel = "← Tilbage til Fokus-noter";
        break;
      default:
        backLabel = "← Tilbage til Noter";
        break;
    }
    backHref = backParams.toString() ? `/notes?${backParams.toString()}` : "/notes";
  }

  const sb = await supabaseServerRSC();
  const { ownerId } = await getTrainerSession();

  if (!ownerId) {
    return (
      <main className="mx-auto max-w-3xl p-6">
        <p className="text-sm text-red-600">Du skal være logget ind for at åbne noten.</p>
      </main>
    );
  }

  let data: NoteRow | null = null;
  let error: any = null;
  try {
    data = await loadNoteWithOptionalMetadata(sb, ownerId, id);
  } catch (loadError) {
    error = loadError;
  }

  if (error || !data) {
    if (error) console.error("NOTE detail error:", error);
    return (
      <main className="mx-auto max-w-3xl p-6">
        <p className="text-sm text-red-600">Note ikke fundet.</p>
        <Link href={backHref} className="mt-3 inline-block text-xs text-zinc-600 hover:underline">
          {backLabel}
        </Link>
      </main>
    );
  }
  try {
    await assertCanAccessVisibleNoteCategory(sb, ownerId, id, data.note_type);
  } catch (accessError: any) {
    if (String(accessError?.code ?? "") === "NOTE_LOCKED") {
      return (
        <main className="mx-auto max-w-3xl p-6">
          <p className="text-sm text-zinc-700">{FREEMIUM_NOTE_LOCKED_MESSAGE}</p>
          <Link href={backHref} className="mt-3 inline-block text-xs text-zinc-600 hover:underline">
            {backLabel}
          </Link>
        </main>
      );
    }
    throw accessError;
  }

  const titlePrefix =
    data.note_type === "feedback" ||
    data.note_type === "trainer" ||
    data.note_type === "trainer_feedback"
      ? "Træner: "
      : "";
  const noteKind = classifyDetailNote(data);
  const isResume = noteKind === "resume";

  await trackProductEvent({
    ownerId,
    eventName: "note_opened",
    metadata: {
      note_id: id,
      feature: "notes",
      scope: noteKind,
    },
  });

  if (process.env.NODE_ENV !== "production") {
    const metadataRecord =
      data.metadata && typeof data.metadata === "object" && !Array.isArray(data.metadata)
        ? (data.metadata as Record<string, unknown>)
        : null;
    console.info("[notes/detail]", {
      noteId: data.id,
      noteType: data.note_type ?? null,
      hasMetadata: Boolean(metadataRecord),
      metadataKeys: metadataRecord ? Object.keys(metadataRecord).sort() : [],
      hasMathRenderedNote: Boolean(metadataRecord?.mathRenderedNote ?? metadataRecord?.math_rendered_note),
    });
  }

  return (
    <main className="mx-auto max-w-3xl px-6 py-7">
      <div className="space-y-5">
        <Link href={backHref} className="inline-block text-xs text-zinc-500 hover:text-zinc-700 hover:underline">
        {backLabel}
        </Link>

        <header className="space-y-2">
          <h1 className="text-xl font-semibold tracking-tight text-zinc-900">
            {titlePrefix}
            {data.title || "Uden titel"}
          </h1>
          <p className="text-xs text-zinc-500">{formatDT(data.created_at)}</p>
        </header>

        <section
          className={
            isResume
              ? "rounded-xl border border-zinc-200/90 bg-white px-5 py-4"
              : "rounded-2xl border border-zinc-200 bg-white p-4 shadow-sm"
          }
        >
          {isResume ? (
            <ResumeNoteContent content={data.content ?? ""} />
          ) : (
            <FocusNoteContent
              content={data.content ?? ""}
              metadata={data.metadata ?? null}
              renderContext="saved_note_detail"
              noteId={data.id}
              noteType={data.note_type ?? null}
            />
          )}
        </section>
      </div>
    </main>
  );
}
