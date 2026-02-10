"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";

function cn(...xs: Array<string | false | null | undefined>) {
  return xs.filter(Boolean).join(" ");
}

export default function ExamModeSwitch() {
  const pathname = usePathname() || "";
  const sp = useSearchParams();

  const qs = new URLSearchParams(sp.toString()).toString();
  const withQs = (href: string) => (qs ? `${href}?${qs}` : href);

  const onOral = pathname.startsWith("/traener/mundtlig");
  const onWritten = !onOral; // default = skrift (simulator)

  return (
    <div className="mt-3 mb-4 inline-flex overflow-hidden rounded-xl border border-zinc-200 bg-white shadow-sm">
      <Link
        href={withQs("/traener/simulator")}
        className={cn(
          "px-4 py-2 text-sm",
          "border-r border-zinc-200",
          onWritten ? "bg-black text-white" : "bg-white text-zinc-900 hover:bg-zinc-50"
        )}
      >
        Skrift
      </Link>

      <Link
        href={withQs("/traener/mundtlig")}
        className={cn(
          "px-4 py-2 text-sm",
          onOral ? "bg-black text-white" : "bg-white text-zinc-900 hover:bg-zinc-50"
        )}
      >
        Mundtlig
      </Link>
    </div>
  );
}
