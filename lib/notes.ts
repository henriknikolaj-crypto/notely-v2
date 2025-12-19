import 'server-only';
import { createClient } from '@supabase/supabase-js';

export async function listNotesForOwner(ownerId: string, limit = 20) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY!;
  const sb = createClient(url, key);

  const { data, error } = await sb
    .from('notes')
    .select('id,title,source_url,created_at')
    .eq('owner_id', ownerId)
    .order('created_at', { ascending: false })
    .limit(limit);

  if (error) throw new Error(error.message);
  return data ?? [];
}

