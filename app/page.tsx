import Link from "next/link";

export const dynamic = "force-dynamic";

export default function Home() {
  return (
    <main className="min-h-screen bg-[#fffef9] px-4 py-10">
      <div className="mx-auto max-w-3xl">
        <h1 className="text-2xl font-semibold text-zinc-900">Notely</h1>
        <p className="mt-2 text-sm text-zinc-600">
          Vælg hvor du vil starte.
        </p>

        <div className="mt-6 flex flex-wrap gap-3">
          <Link
            href="/overblik"
            className="rounded-full bg-black px-5 py-2 text-sm font-semibold text-white"
          >
            Gå til Overblik
          </Link>

          <Link
            href="/traener/upload"
            className="rounded-full border border-zinc-300 bg-white px-5 py-2 text-sm font-semibold text-zinc-900"
          >
            Upload / ret materiale
          </Link>
        </div>
      </div>
    </main>
  );
}
