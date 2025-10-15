export async function GET() {
  return new Response(JSON.stringify({ ok: true, route: "ping" }), {
    headers: { "content-type": "application/json" },
  });
}
