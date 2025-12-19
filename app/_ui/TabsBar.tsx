import Link from "next/link";

function tabCls(active: boolean) {
  return [
    "px-3 py-1.5 rounded text-sm font-medium leading-tight border",
    active ? "bg-black text-white border-black" : "bg-white text-black/80 hover:bg-neutral-100 border-black/10",
  ].join(" ");
}

export default function TabsBar({ active }: { active: "noter"|"mc"|"flash"|"traener"|"sim" }) {
  return (
    <div className="sticky top-0 z-10 -mx-2 px-2 py-2 bg-white/80 backdrop-blur border-b">
      <div className="flex gap-2">
        <Link className={tabCls(active==="noter")}   href="/app/noter">Noter</Link>
        <Link className={tabCls(active==="mc")}      href="/app/mc">Multiple Choice</Link>
        <Link className={tabCls(active==="flash")}   href="/app/flashcards">Flashcards</Link>
        <Link className={tabCls(active==="traener")} href="/app/traener">Træner</Link>
        <Link className={tabCls(active==="sim")}     href="/app/simulator">Simulator</Link>
      </div>
    </div>
  );
}
