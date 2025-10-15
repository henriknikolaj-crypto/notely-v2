export async function GET() {
  return Response.json({
    DEV_USER_ID: process.env.DEV_USER_ID ?? null,
    HAS_SERVICE_ROLE: !!process.env.SUPABASE_SERVICE_ROLE_KEY,
    HAS_SECRET: !!process.env.IMPORT_SHARED_SECRET
  });
}
