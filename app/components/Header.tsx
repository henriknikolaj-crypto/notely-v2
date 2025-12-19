// app/components/Header.tsx
import Link from "next/link";
import HeaderClient from "./HeaderClient";
import { supabaseServerRSC } from "@/lib/supabase/server-rsc";

export default async function ServerHeader() {
  const supabase = await supabaseServerRSC();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  return (
    <header className="w-full border-b bg-white">
      <div className="mx-auto flex max-w-6xl items-center justify-between px-4 py-3">
        <Link href="/" className="font-semibold">
          Notely
        </Link>

        <HeaderClient userEmail={user?.email ?? null} />
      </div>
    </header>
  );
}
