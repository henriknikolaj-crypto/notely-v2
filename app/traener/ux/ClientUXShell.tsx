"use client";

import ClientExamUX from "./ClientExamUX";

export default function ClientUXShell({ ownerId }: { ownerId?: string }) {
  return <ClientExamUX ownerId={ownerId ?? ""} />;
}
