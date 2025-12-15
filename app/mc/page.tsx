import "server-only";
import ClientMC from "./ClientMC";

export const dynamic = "force-dynamic";

export default async function Page() {
  return (
    <main className="mx-auto max-w-4xl p-6">
      <ClientMC />
    </main>
  );
}
