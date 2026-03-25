import Link from "next/link";

export default function NotFound() {
  return (
    <main className="mx-auto flex min-h-screen max-w-3xl flex-col items-start justify-center gap-4 px-6 py-16">
      <div>
        <h1 className="text-2xl font-semibold text-zinc-900">Siden blev ikke fundet</h1>
        <p className="mt-2 text-sm text-zinc-600">
          Linket findes ikke eller indholdet er ikke tilgaengeligt laengere.
        </p>
      </div>

      <Link
        href="/"
        className="text-sm text-zinc-500 underline underline-offset-4 hover:text-zinc-700"
      >
        Gaa til forsiden
      </Link>
    </main>
  );
}
