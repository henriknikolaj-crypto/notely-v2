"use client";
import { useRouter } from "next/navigation";

export default function RefreshButton({ className="" }: { className?: string }) {
  const router = useRouter();
  return (
    <button
      onClick={() => router.refresh()}
      className={`px-3 py-2 border border-neutral-300 text-neutral-800 hover:bg-neutral-50 ${className}`}
      title="Opdater listen"
    >
      Opdater
    </button>
  );
}
