"use client";

import { useEffect, useState } from "react";
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
  const [liveFolders, setLiveFolders] = useState<FolderRow[]>(folders);

  useEffect(() => {
    setLiveFolders(folders);
  }, [folders]);

  useEffect(() => {
    function handleFoldersChanged(event: Event) {
      const detail = (event as CustomEvent<{ folders?: FolderRow[] }>).detail;
      if (Array.isArray(detail?.folders)) {
        setLiveFolders(detail.folders);
      }
    }

    window.addEventListener("notely-folders-changed", handleFoldersChanged);
    return () => {
      window.removeEventListener("notely-folders-changed", handleFoldersChanged);
    };
  }, []);

  const hideOnThisRoute =
    pathname.startsWith("/traener/konto") ||
    pathname === "/traener/overblik" ||
    pathname.startsWith("/traener/upload");

  if (hideOnThisRoute) return null;

  return (
    <>
      <div className="px-4 pt-2 font-semibold text-zinc-800">Dine fag</div>
      <TrainingSidebarFolders folders={liveFolders} />
    </>
  );
}
