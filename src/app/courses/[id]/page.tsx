import { createServerClient } from "@/lib/supabase/server";
import Link from "next/link";
import EditCourseForm from "./_EditCourseForm";
import { redirect } from "next/navigation";

export default async function CourseDetailPage({ params }: { params: { id: string } }) {
  const supabase = await await createServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/auth/login");

  const { data, error } = await supabase
    .from("courses")
    .select("id, title, description, created_at")
    .eq("id", params.id)
    .eq("owner_id", user.id)
    .single();

  if (error || !data) {
    return (
      <div className="p-6">
        <p className="text-red-600">Kurset blev ikke fundet.</p>
        <Link className="underline" href="/courses">Tilbage</Link>
      </div>
    );
  }

  return (
    <div className="p-6 max-w-2xl">
      <div className="mb-4"><Link className="underline" href="/courses">← Tilbage til kurser</Link></div>
      <h1 className="text-2xl font-semibold mb-2">Rediger kursus</h1>
      <p className="text-sm text-gray-500 mb-6">Oprettet: {new Date(data.created_at).toLocaleString()}</p>
      <EditCourseForm course={data} />
    </div>
  );
}