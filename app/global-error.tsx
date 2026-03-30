"use client";

import { useEffect } from "react";

import { captureException } from "@/lib/monitoring/error";

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    captureException(error, {
      flow: "app_global_error",
      route: "/app/global-error",
      code: error.digest ?? "GLOBAL_ERROR",
    });
  }, [error]);

  return (
    <html lang="da">
      <body className="min-h-screen bg-[#fffef9] text-zinc-900 antialiased">
        <main className="mx-auto flex min-h-screen max-w-xl flex-col items-start justify-center gap-4 px-6">
          <p className="text-sm font-semibold uppercase tracking-[0.22em] text-zinc-500">
            Notely
          </p>
          <h1 className="text-3xl font-semibold text-zinc-950">
            Der opstod en fejl.
          </h1>
          <p className="text-sm leading-6 text-zinc-600">
            Prøv igen. Hvis fejlen fortsætter, er den nu klar til at blive undersøgt.
          </p>
          <button
            type="button"
            onClick={() => reset()}
            className="rounded-full bg-zinc-950 px-5 py-2 text-sm font-medium text-white transition hover:bg-zinc-800"
          >
            Prøv igen
          </button>
        </main>
      </body>
    </html>
  );
}
