"use client";
import { usePathname } from "next/navigation";

export default function HeaderClient({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  return <div data-pathname={pathname}>{children}</div>;
}

