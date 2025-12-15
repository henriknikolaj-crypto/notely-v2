import Link from "next/link";

export default function SidebarRecent({ ownerId, folderId }:{ ownerId: string; folderId?: string | null }) {
  return (
    <section style={{ border: "1px solid #0002", borderRadius: 8, padding: 12, background: "#fff" }}>
      <div style={{ fontSize: 13, fontWeight: 600, opacity: .7, marginBottom: 8 }}>Seneste</div>
      <ul style={{ lineHeight: 1.4, fontSize: 13, margin: 0, paddingLeft: 16 }}>
        <li><Link href="#">Dummy note A</Link></li>
        <li><Link href="#">Dummy note B</Link></li>
      </ul>
    </section>
  );
}
