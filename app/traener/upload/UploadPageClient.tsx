"use client";

import { useEffect, useState } from "react";
import UploadClient from "./UploadClient";
import FolderManagerClient from "./FolderManagerClient";

type FolderRow = {
  id: string;
  name: string;
  parent_id?: string | null;
  archived_at?: string | null;
  start_date?: string | null;
  end_date?: string | null;
};

type Props = {
  ownerId: string;
  initialFolderId: string | null;
  initialFolders: FolderRow[];
};

export default function UploadPageClient({ ownerId, initialFolderId, initialFolders }: Props) {
  const [folders, setFolders] = useState<FolderRow[]>(initialFolders);

  useEffect(() => {
    setFolders(initialFolders);
  }, [initialFolders]);

  return (
    <>
      <section>
        <UploadClient
          folders={folders.map((f) => ({ id: f.id, name: f.name }))}
          initialFolderId={initialFolderId}
          ownerId={ownerId}
          onFoldersChange={setFolders}
        />
      </section>

      <section>
        <FolderManagerClient ownerId={ownerId} initialFolders={folders} onFoldersChange={setFolders} />
      </section>
    </>
  );
}
