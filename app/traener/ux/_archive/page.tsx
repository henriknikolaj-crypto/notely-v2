export const dynamic = 'force-dynamic';

export default function Page() {
  return (
    <main className="p-6">
      <h1>Træner – SSR OK</h1>
      <p>Hvis du ser denne tekst, virker server-rendering.</p>
      <a href="/traener/ux">Åbn Client-UI test</a>
    </main>
  );
}
