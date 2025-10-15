import Link from "next/link";
import { createServerClient } from "@/lib/supabase/server";
import Dropdown from "./_ui/Dropdown";

export default async function HeaderBar() {
  const supabase = await createServerClient();
  const { data: { user } } = await supabase.auth.getUser();

  return (
    <nav className="border-b bg-white/80 backdrop-blur supports-[backdrop-filter]:bg-white/60">
      <div className="mx-auto max-w-4xl px-4 py-3 flex items-center justify-between">
        <div className="flex gap-4">
          <Link href="/" className="hover:underline">Dashboard</Link>
          <Link href="/notes" className="hover:underline">Notes</Link>
          <Link href="/courses" className="hover:underline">Courses</Link>
        </div>
        <div className="flex items-center gap-3 text-sm">
          {user ? (
            <Dropdown trigger={user.email ?? "Konto"}>
              <div className="px-2 py-1 text-xs text-gray-500">{user.email}</div>
              <form action="/api/auth/signout" method="post" className="p-1">
                <button className="w-full text-left px-3 py-1.5 rounded hover:bg-gray-50" type="submit">
                  Log ud
                </button>
              </form>
            </Dropdown>
          ) : (
            <Link href="/auth/login" className="underline">Log ind</Link>
          )}
        </div>
      </div>
    </nav>
  );
}