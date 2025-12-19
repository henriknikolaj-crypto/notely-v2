import "server-only";
import { supabaseServerRSC } from "@/lib/supabase/server-rsc";
import TrainingScopeBoxClient, { TrainingFile } from "./TrainingScopeBoxClient";

async function getOwnerId(sb: any): Promise<string | null> {
  try {
    if (sb?.auth?.getUser) {
      const { data } = await sb.auth.getUser();
      if (data?.user?.id) return data.user.id as string;
    }
  } catch {}
  return process.env.DEV_USER_ID ?? null;
}

async function loadTrainingFiles(ownerId: string): Promise<TrainingFile[]> {
  const sb = await supabaseServerRSC();
  const { data, error } = await sb
    .from("files")
    .select("id,name,created_at,owner_id")
    .eq("owner_id", ownerId)
    .order("created_at", { ascending: false })
    .limit(50);

  if (error) {
    console.warn("loadTrainingFiles error", error);
    return [];
  }

  return (data ?? []).map((f: any) => ({
    id: String(f.id),
    name: String(f.name ?? ""),
  }));
}

export default async function TrainingScopeBox() {
  const sb = await supabaseServerRSC();
  const ownerId = await getOwnerId(sb);
  if (!ownerId) return null;

  const files = await loadTrainingFiles(ownerId);
  return <TrainingScopeBoxClient initialFiles={files} />;
}
