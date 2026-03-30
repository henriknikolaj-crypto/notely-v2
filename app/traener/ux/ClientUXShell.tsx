"use client";

import ClientTrainer from "./ClientTrainer";

const DEMO_SCOPE_ID = "demo-samfund";
const DEMO_SCOPE_NAME = "Samfund";

export default function ClientUXShell({ ownerId }: { ownerId?: string }) {
  return (
    <ClientTrainer
      ownerId={ownerId ?? ""}
      folders={[{ id: DEMO_SCOPE_ID, name: DEMO_SCOPE_NAME }]}
      activeFolderId={DEMO_SCOPE_ID}
      scopeFolderIds={[DEMO_SCOPE_ID]}
      demoMode
      demoScopeName={DEMO_SCOPE_NAME}
    />
  );
}
