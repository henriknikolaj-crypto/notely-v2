import { redirect } from "next/navigation";
import { supabaseServerRSC } from "@/lib/supabase/server";
import LoginPage from "./auth/login/page"; // client-komponenten vi allerede har

export default async function Home() {
  const supabase = await supabaseServerRSC();
  const { data: { user } } = await supabase.auth.getUser();

  if (user) redirect("/exam");     // logget ind → til exam
  return <LoginPage />;            // ikke logget ind → vis login-formen på forsiden
}
