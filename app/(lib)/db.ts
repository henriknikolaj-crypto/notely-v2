import { supabaseServerRoute } from "./supabaseServerRoute";
/** Server-side DB client til route handlers */
export const db = await supabaseServerRoute();
