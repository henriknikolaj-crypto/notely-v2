"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

type MobileBackToMenuProps = {
  href?: string;
  label?: string;
};

const TRAINING_FEATURE_PATHS = new Set(["/traener"]);
const TRAINING_PATH_PREFIXES = [
  "/traener/noter",
  "/traener/mc",
  "/traener/flashcards",
  "/traener/simulator",
  "/traener/mundtlig",
];
const DETAIL_PATH_PREFIXES = ["/traener/mappe/"];

function isTrainingFeaturePath(pathname: string | null) {
  if (!pathname) return false;
  if (TRAINING_FEATURE_PATHS.has(pathname)) return true;
  return TRAINING_PATH_PREFIXES.some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`));
}

export default function MobileBackToMenu({
  href,
  label,
}: MobileBackToMenuProps) {
  const pathname = usePathname();
  const isDetailPage = DETAIL_PATH_PREFIXES.some((prefix) => pathname === prefix || pathname?.startsWith(prefix));
  if (isDetailPage && href == null && label == null) return null;
  const fallbackHref = isTrainingFeaturePath(pathname) ? "/m/traening" : "/m";
  const fallbackLabel = isTrainingFeaturePath(pathname)
    ? "← Tilbage til træning"
    : "← Tilbage til hovedmenu";

  return (
    <div className="md:hidden">
      <Link
        href={href ?? fallbackHref}
        className="inline-flex items-center rounded-full border border-zinc-300 bg-white px-3 py-1.5 text-sm font-medium text-zinc-700 hover:bg-zinc-50"
      >
        {label ?? fallbackLabel}
      </Link>
    </div>
  );
}
