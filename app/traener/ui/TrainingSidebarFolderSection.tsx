"use client";

import { usePathname } from "next/navigation";
import TrainingSidebarFolders from "./TrainingSidebarFolders";

type FolderRow = {
  id: string;
  name: string;
  parent_id: string | null;
  start_date: string | null;
  end_date: string | null;
  archived_at: string | null;
};

export default function TrainingSidebarFolderSection({ folders }: { folders: FolderRow[] }) {
  const pathname = usePathname() || "";
  const hideOnThisRoute =
    pathname.startsWith("/traener/konto") ||
    pathname === "/traener/overblik" ||
    pathname.startsWith("/traener/upload");

  if (hideOnThisRoute) return null;

  return (
    <>
      <div className="px-4 pt-2 font-semibold text-zinc-800">Dine fag</div>
      <TrainingSidebarFolders folders={folders} />
    </>
  );
}
