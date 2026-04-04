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
    if (typeof window !== "undefined") {
      try {
        window.sessionStorage.setItem("notely:folders", JSON.stringify(folders));
      } catch {}
    }
  }, [folders]);

  useEffect(() => {
    if (typeof window === "undefined") return;

    try {
      const raw = window.sessionStorage.getItem("notely:folders");
      if (raw) {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed) && parsed.length > 0) {
          setLiveFolders(parsed);
        }
      }
    } catch {}

    const handleFoldersChanged = (event: Event) => {
      const detail = (event as CustomEvent<{ folders?: FolderRow[] }>).detail;
      if (!Array.isArray(detail?.folders)) return;
      setLiveFolders(detail.folders);
      try {
        window.sessionStorage.setItem("notely:folders", JSON.stringify(detail.folders));
      } catch {}
    };

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
