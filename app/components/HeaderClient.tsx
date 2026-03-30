"use client";

import Link from "next/link";

type Props = {
  userEmail: string | null;
  loginHref?: string;
  logoutHref?: string;
};

export default function HeaderClient({
  userEmail,
  loginHref = "/auth/login",
  logoutHref = "/auth/logout",
}: Props) {
  return (
    <div className="flex items-center gap-3">
      {userEmail ? (
        <>
          <span className="hidden text-sm text-neutral-600 sm:inline">{userEmail}</span>
          <Link href={logoutHref} className="rounded-md border px-3 py-1.5 text-sm hover:bg-neutral-50">
            Log ud
          </Link>
        </>
      ) : (
        <Link
          href={loginHref}
          className="rounded-md border px-3 py-1.5 text-sm hover:bg-neutral-50"
        >
          Log ind
        </Link>
      )}
    </div>
  );
}
