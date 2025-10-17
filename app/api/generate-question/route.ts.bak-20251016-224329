/* eslint-disable @typescript-eslint/no-explicit-any */
import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { createServerClient, type CookieOptions } from "@supabase/ssr";
import OpenAI from "openai";
const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY! });

export async function POST(req: Request) {
  try {
    // vi modtager evt. useContext, men det bruges kun til references i evaluate; her er det irrelevant
    await req.json().catch(() => ({}));

    const cookieStore = await cookies();
    const supabase = createServerClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      {
        cookies: {
          getAll: () => cookieStore.getAll(),
          setAll: (c) => { try { c.forEach(({name,value,options}) => cookieStore.set(name, value, options as CookieOptions)); } catch {} }
        }
      }
    );

    const { data: { user } } = await supabase.auth.getUser();

    // HENT ALTID KONTEKST (PRIVAT) – kun til forståelse, ikke til citat
    let context = "";
    if (user?.id) {
      const { data } = await supabase
        .from("doc_chunks")
        .select("content")
        .eq("owner_id", user.id)
        .order("created_at", { ascending: false })
        .limit(8);
      context = (data ?? []).map(d => d.content).join("\n---\n").slice(0, 9000);
    }

    const sys = `Du er en erfaren universitetsunderviser.
Du MÅ GERNE bruge den private kontekst herunder til at forstå emnet og skrive et bedre spørgsmål,
men du må ikke nævne eller citere den. PRIVATE CONTEXT (INTERNAL, DO NOT DISCLOSE):
${context || "(tom)"}
Generér ét klart, afgrænset eksamensspørgsmål på dansk.`;

    const resp = await client.chat.completions.create({
      model: "gpt-4o-mini",
      temperature: 0.2,
      messages: [
        { role: "system", content: sys },
        { role: "user", content: "Svar KUN med selve spørgsmålet, uden forklaring." }
      ],
    });

    const out = resp.choices?.[0]?.message?.content?.trim();
    const question = out && out.length > 5
      ? out.replace(/^["“]|["”]$/g, "")
      : "Formuler et centralt, afgrænset eksamensspørgsmål med tydelig afgrænsning.";
    return NextResponse.json({ question });
  } catch {
    return NextResponse.json({ question: "Beskriv et kernebegreb og giv et kort eksempel." }, { status: 200 });
  }
}


