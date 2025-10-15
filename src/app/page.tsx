import Link from "next/link";
import { createServerClient } from "@/lib/supabase/server";

export default async function Page() {
  const supabase = await createServerClient();
  const { data: { user } } = await supabase.auth.getUser();

  if (!user) {
    return (
      <div className="p-6">
        <p>Du er ikke logget ind.</p>
        <Link className="underline" href="/auth/login">Log ind</Link>
      </div>
    );
  }

  const [{ data: notes }, { data: courses }] = await Promise.all([
    supabase.from("notes")
      .select("id,title,created_at")
      .eq("owner_id", user.id)
      .order("created_at", { ascending: false })
      .limit(3),
    supabase.from("courses")
      .select("id,title,created_at")
      .eq("owner_id", user.id)
      .order("created_at", { ascending: false })
      .limit(3),
  ]);

  return (
    <div className="p-6 space-y-8">
      <h1 className="text-2xl font-semibold">Dashboard</h1>

      <section className="space-y-2">
        <h2 className="font-medium">Seneste kurser</h2>
        {(!courses || courses.length===0) ? (
          <p className="text-sm text-gray-600">Ingen endnu. <Link className="underline" href="/courses">Gå til Courses</Link></p>
        ) : (
          <ul className="list-disc list-inside space-y-1">
            {courses.map(c => (
              <li key={c.id}><Link className="underline" href={`/courses/${c.id}`}>{c.title}</Link></li>
            ))}
          </ul>
        )}
      </section>

      <section className="space-y-2">
        <h2 className="font-medium">Seneste noter</h2>
        {(!notes || notes.length===0) ? (
          <p className="text-sm text-gray-600">Ingen endnu. <Link className="underline" href="/notes">Gå til Notes</Link></p>
        ) : (
          <ul className="list-disc list-inside space-y-1">
            {notes.map(n => (
              <li key={n.id}><Link className="underline" href={`/notes/${n.id}`}>{n.title}</Link></li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}