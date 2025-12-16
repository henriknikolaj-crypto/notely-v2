import Link from "next/link";

export default function SidebarRecent({
  ownerId,
  folderId,
}: {
  ownerId: string;
  folderId?: string | null;
}) {
  // bruges “stille” så ESLint er glad, uden at vi viser det i UI
  const q = new URLSearchParams({
    owner: ownerId,
    ...(folderId ? { folder: folderId } : {}),
  }).toString();

  return (
    <section
      data-owner={ownerId}
      data-folder={folderId ?? ""}
      style={{
        border: "1px solid #0002",
        borderRadius: 8,
        padding: 12,
        background: "#fff",
      }}
    >
      <div style={{ fontSize: 13, fontWeight: 600, opacity: 0.7, marginBottom: 8 }}>
        Seneste
      </div>
      <ul style={{ lineHeight: 1.4, fontSize: 13, margin: 0, paddingLeft: 16 }}>
        <li>
          <Link href={`/notes?${q}`}>Dummy note A</Link>
        </li>
        <li>
          <Link href={`/notes?${q}`}>Dummy note B</Link>
        </li>
      </ul>
    </section>
  );
}
