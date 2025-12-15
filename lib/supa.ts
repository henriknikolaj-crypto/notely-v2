// lib/supa.ts
import "server-only";

export { supabaseServerRSC } from "@/lib/supabase/server-rsc";
export { supabaseServerRoute } from "@/lib/supabase/server-route";

// Hvis du stadig bruger disse aliaser et sted:
export { supabaseServerRSC as supaRsc } from "@/lib/supabase/server-rsc";
export { supabaseServerRoute as supaRls } from "@/lib/supabase/server-route";
