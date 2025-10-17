import PageShell from "@/app/_ui/PageShell";
import { getSupabaseServer } from "@/lib/supabase/server";
import { NewCourseForm, DeleteCourseBtn } from "./_actions";
import Link from "next/link";

export default async function CoursesPage() {
  const supabase = await await getSupabaseServer();
  const { data: { user } } = await supabase.auth.getUser();

  if (!user) {
    return (
      <div className="p-6">
        <p>Du er ikke logget ind.</p>
        <Link className="underline" href="/auth/login">Log ind</Link>
      </div>
    );
  }

  const { data: courses, error } = await supabase
    .from("courses")
    .select("id, title, description, created_at")
    .eq("owner_id", user.id)
    .order("created_at", { ascending: false });

  if (error) return <div className="p-6 text-red-600">Kunne ikke hente kurser.</div>;

  const isEmpty = !courses || courses.length === 0;

  return (
    <PageShell title="Kurser">
      <NewCourseForm />
      {isEmpty ? (
        <div className="border rounded-md p-6 text-sm text-gray-600">
          Ingen kurser endnu. Opret dit første kursus ovenfor.
        </div>
      ) : (
        <ul className="list-none divide-y">
          {courses.map((c) => (
            <li key={c.id} className="py-3 space-y-2">
              <div className="flex items-center justify-between gap-4">
                <Link href={`/courses/${c.id}`} className="font-medium underline">
                  {c.title}
                </Link>
                <DeleteCourseBtn id={c.id} />
              </div>
              {c.description && <p className="text-sm text-gray-700 line-clamp-3">{c.description}</p>}
              <p className="text-xs text-gray-500">Oprettet: {new Date(c.created_at).toLocaleString()}</p>
            </li>
          ))}
        </ul>
      )}
    </PageShell>
  );
}



