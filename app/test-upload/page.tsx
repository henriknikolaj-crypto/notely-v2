"use client";
import { createClient } from "@supabase/supabase-js";
import { useEffect } from "react";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  { auth: { persistSession: true, autoRefreshToken: true } }
);

export default function TestUploadPage() {
  useEffect(() => {
    async function testUpload() {
      const { data: sess } = await supabase.auth.getSession();
      console.log("session?", !!sess.session);

      const file = new File([new Blob(["hi"])], "ping.txt", { type: "text/plain" });
      const { data, error } = await supabase.storage
        .from("uploads")
        .upload(`test/ping-${Date.now()}.txt`, file);
      console.log({ data, error });
    }
    testUpload();
  }, []);

  return (
    <div style={{ padding: "2rem" }}>
      <h1>Upload-test</h1>
      <p>Åbn dev-console (F12 → Console) for output.</p>
    </div>
  );
}


