// app/admin/layout.tsx
import "server-only";

import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import { createServerClient } from "@supabase/ssr";

export default async function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  // Next 15: cookies() er async
  const cookieStore = await cookies();

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!url || !anon) {
    // Fail closed: ingen env → ingen admin
    redirect("/");
  }

  // Server-side Supabase klient bundet til request-cookies (RSC/layout)
  const supabase = createServerClient(url, anon, {
    cookies: {
      get(name: string) {
        return cookieStore.get(name)?.value;
      },
      // RSC/layout kan læse cookies; set/remove no-ops her
      set() {},
      remove() {},
    },
  });

  const {
    data: { user },
  } = await supabase.auth.getUser();

  // Tillad kun emails på ADMIN_EMAILS (kommasepareret)
  const admins = (process.env.ADMIN_EMAILS || "")
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);

  const email = (user?.email ?? "").toLowerCase();

  if (!user || !admins.includes(email)) {
    redirect("/");
  }

  return <>{children}</>;
}
