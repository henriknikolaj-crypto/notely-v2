// app/courses/[id]/page.tsx
import "server-only";

import Link from "next/link";
import { notFound } from "next/navigation";
import { supabaseServerRSC } from "@/lib/supabase/server-rsc";

export const dynamic = "force-dynamic";

type PageProps = {
  params: Promise<{ id: string }>;
};

async function getOwnerId(sb: any): Promise<string | null> {
  try {
    if (sb?.auth?.getUser) {
      const { data } = await sb.auth.getUser();
      if (data?.user?.id) return data.user.id as string;
    }
  } catch {}

  const dev = (process.env.DEV_USER_ID ?? "").trim();
  if (process.env.NODE_ENV !== "production" && dev) return dev;

  return null;
}

export default async function CoursePage({ params }: PageProps) {
  const { id } = await params;

  const sb = await supabaseServerRSC();
  const ownerId = await getOwnerId(sb);

  if (!ownerId) {
    return (
      <main className="min-h-screen bg-[#fffef9] p-6 text-sm text-red-600">
        Mangler bruger-id (hverken login eller DEV_USER_ID sat).
      </main>
    );
  }

  const { data: course, error } = await sb
    .from("courses")
    .select("id, owner_id, title, description, created_at")
    .eq("id", id)
    .eq("owner_id", ownerId)
    .maybeSingle();

  if (error) {
    console.error("[courses/[id]] load error:", error);
  }

  if (!course) notFound();

  return (
    <main className="min-h-screen bg-[#fffef9]">
      <div className="mx-auto max-w-3xl space-y-4 px-4 py-6 md:px-6">
        <div className="flex items-center justify-between">
          <Link
            href="/courses"
            className="text-sm font-medium text-zinc-700 hover:underline"
          >
            ← Tilbage
          </Link>
        </div>

        <section className="rounded-2xl border border-zinc-200 bg-white px-6 py-5 shadow-sm">
          <h1 className="text-lg font-semibold text-zinc-900">
            {course.title ?? "Kursus"}
          </h1>
          {course.description ? (
            <p className="mt-2 text-sm text-zinc-700">{course.description}</p>
          ) : (
            <p className="mt-2 text-sm text-zinc-500">Ingen beskrivelse.</p>
          )}
        </section>
      </div>
    </main>
  );
}
