"use client";

import Link from "next/link";

type Props = {
  userEmail: string | null;
};

export default function HeaderClient({ userEmail }: Props) {
  return (
    <div className="flex items-center gap-3">
      {userEmail ? (
        <>
          <span className="text-sm text-neutral-600">{userEmail}</span>

          {/* Antager du har /auth/logout som POST-route (typisk i Supabase setup) */}
          <form action="/auth/logout" method="post">
            <button
              type="submit"
              className="rounded-md border px-3 py-1.5 text-sm hover:bg-neutral-50"
            >
              Log ud
            </button>
          </form>
        </>
      ) : (
        <Link
          href="/auth/login"
          className="rounded-md border px-3 py-1.5 text-sm hover:bg-neutral-50"
        >
          Log ind
        </Link>
      )}
    </div>
  );
}
