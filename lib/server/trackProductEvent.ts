import { createClient } from "@supabase/supabase-js";
import { ensureProfile } from "@/lib/server/ensureProfile";

type TrackProductEventArgs = {
  admin?: any;
  ownerId: string;
  eventName: string;
  metadata?: Record<string, unknown>;
};

function createAdminOrNull() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;
  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

export async function trackProductEvent(args: TrackProductEventArgs) {
  const ownerId = String(args.ownerId ?? "").trim();
  const eventName = String(args.eventName ?? "").trim();
  if (!ownerId || !eventName) return false;

  const admin = args.admin ?? createAdminOrNull();
  if (!admin) return false;

  try {
    await ensureProfile(admin, ownerId);

    const { error } = await admin.from("product_events").insert({
      owner_id: ownerId,
      event_name: eventName,
      metadata: args.metadata ?? {},
    });

    if (error) throw error;
    return true;
  } catch (error) {
    console.warn("[trackProductEvent] insert failed:", {
      ownerId,
      eventName,
      error,
    });
    return false;
  }
}
