import ClientUXShell from "./ClientUXShell";

// Sørger for at siden ikke bliver statisk-optimeret i prod
export const dynamic = "force-dynamic";

export default function Page() {
  const ownerId = process.env.DEV_USER_ID ?? undefined;

  return (
    <main style={{ padding: 24 }}>
      <ClientUXShell ownerId={ownerId} />
    </main>
  );
}
