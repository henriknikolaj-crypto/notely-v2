import Link from "next/link";
import HeaderClient from "@/app/components/HeaderClient";

type MobileHubHeaderProps = {
  userEmail: string | null;
};

export default function MobileHubHeader({ userEmail }: MobileHubHeaderProps) {
  return (
    <header className="flex items-center justify-between gap-3 border-b border-zinc-200 pb-3 md:hidden">
      <Link href="/" className="logo-script [font-family:var(--font-logo)] text-3xl leading-none text-zinc-900">
        Notely.
      </Link>
      <HeaderClient
        userEmail={userEmail}
        loginHref="/auth/login?next=%2Fm"
        logoutHref="/auth/logout?next=%2Fm"
      />
    </header>
  );
}
