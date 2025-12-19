# Kør fra projektroden:
#   Set-ExecutionPolicy -Scope Process Bypass
#   .\apply_auth.ps1
#   npm run dev

$ErrorActionPreference = "Stop"

function Write-FileUtf8 {
  param([string]$Path,[string]$Content)
  $dir = Split-Path $Path -Parent
  if ($dir -and -not (Test-Path $dir)) { New-Item -ItemType Directory -Path $dir -Force | Out-Null }
  [System.IO.File]::WriteAllText($Path,$Content,[Text.UTF8Encoding]::new($false))
  Write-Host "Wrote: $Path"
}

# --- lib/auth.ts: helper til at hente session.user ---
$libAuth = @'
import { createServerClient } from "@/lib/supabase/server";

export async function getUserOrNull() {
  const supabase = createServerClient();
  const { data } = await supabase.auth.getUser();
  return data.user ?? null;
}

export async function requireUser() {
  const user = await getUserOrNull();
  if (!user) throw new Error("AUTH_REQUIRED");
  return user;
}
'@
Write-FileUtf8 -Path "src/lib/auth.ts" -Content $libAuth

# --- Header (server-komponent): viser login/logout status ---
$headerServer = @'
import { getUserOrNull } from "@/lib/auth";

export default async function HeaderBar() {
  const user = await getUserOrNull();
  return (
    <header style={{padding:"12px 16px", borderBottom:"1px solid #e5e7eb"}}>
      <nav style={{display:"flex", gap:12, alignItems:"center", flexWrap:"wrap"}}>
        <a href="/" style={{textDecoration:"underline"}}>Dashboard</a>
        <a href="/notes" style={{textDecoration:"underline"}}>Notes</a>
        <a href="/courses" style={{textDecoration:"underline"}}>Courses</a>
        <span style={{marginLeft:"auto", fontSize:12, opacity:.7}}>
          {user ? `Logged in: ${user.email ?? user.id}` : "Not logged in"}
        </span>
        {user ? (
          <form method="post" action="/api/auth/signout">
            <button style={{textDecoration:"underline"}}>Log ud</button>
          </form>
        ) : (
          <a href="/auth/login" style={{textDecoration:"underline"}}>Log ind</a>
        )}
      </nav>
    </header>
  );
}
'@
Write-FileUtf8 -Path "src/app/HeaderBar.tsx" -Content $headerServer

# --- layout.tsx: brug headeren ---
$layout = @'
import HeaderBar from "./HeaderBar";

export const metadata = { title: "Notely" };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="da">
      <body className="min-h-screen antialiased">
        <HeaderBar />
        <main>{children}</main>
      </body>
    </html>
  );
}
'@
Write-FileUtf8 -Path "src/app/layout.tsx" -Content $layout

# --- Login-side (magic link via Supabase) ---
$loginPage = @'
"use client";

import { useState } from "react";
import { createBrowserClient } from "@/lib/supabase/client";

export default function LoginPage() {
  const supabase = createBrowserClient();
  const [email, setEmail] = useState("");
  const [msg, setMsg] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setMsg(null); setLoading(true);
    try {
      const { error } = await supabase.auth.signInWithOtp({ email, options: { emailRedirectTo: `${location.origin}/` }});
      if (error) throw error;
      setMsg("Tjek din mail for login-link.");
    } catch (err: any) {
      setMsg(err.message ?? "Login-fejl");
    } finally { setLoading(false); }
  }

  return (
    <div className="p-6 max-w-md">
      <h1 className="text-2xl font-semibold mb-4">Log ind</h1>
      <form onSubmit={onSubmit} className="space-y-3">
        <div>
          <label className="block text-sm mb-1">Email</label>
          <input type="email" value={email} onChange={(e)=>setEmail(e.target.value)}
            className="w-full border rounded-md px-3 py-2" required />
        </div>
        <button disabled={loading} className="px-4 py-2 rounded-md border">
          {loading ? "Sender link…" : "Send magic link"}
        </button>
      </form>
      {msg && <p className="mt-3 text-sm">{msg}</p>}
    </div>
  );
}
'@
Write-FileUtf8 -Path "src/app/auth/login/page.tsx" -Content $loginPage

# --- API: signout ---
$signoutRoute = @'
import { NextResponse } from "next/server";
import { createServerClient } from "@/lib/supabase/server";

export async function POST() {
  const supabase = createServerClient();
  await supabase.auth.signOut();
  return NextResponse.redirect(new URL("/", process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000"));
}
'@
Write-FileUtf8 -Path "src/app/api/auth/signout/route.ts" -Content $signoutRoute

# --- Opdater NOTES-liste til at kræve login og bruge session.user.id ---
$notesPage = @'
import { createServerClient } from "@/lib/supabase/server";
import Link from "next/link";
import { redirect } from "next/navigation";

export default async function NotesIndex() {
  const supabase = createServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/auth/login");

  const { data: notes, error } = await supabase
    .from("notes")
    .select("id, title, content, created_at")
    .eq("owner_id", user.id)
    .order("created_at", { ascending: false });

  if (error) return <div className="p-6 text-red-600">Kunne ikke hente noter.</div>;

  return (
    <div className="p-6 space-y-4">
      <div><Link className="underline" href="/">← Til dashboard</Link></div>

      <form action="/api/notes" method="post" className="space-y-2">
        {/* behold din egen create-form hvis du havde den; ellers POST via fetch i client-komp. */}
      </form>

      <ul className="divide-y">
        {notes?.map((n) => (
          <li key={n.id} className="py-2">
            <Link href={`/notes/${n.id}`} className="underline">{n.title}</Link>
            {n.content ? <p className="text-sm text-gray-600">{n.content}</p> : null}
          </li>
        ))}
      </ul>
    </div>
  );
}
'@
# Skriv kun hvis filen findes allerede? Vi overskriver trygt:
Write-FileUtf8 -Path "src/app/notes/page.tsx" -Content $notesPage

# --- Opdater NOTES detail til at kræve login ---
$noteDetail = @'
import { createServerClient } from "@/lib/supabase/server";
import EditNoteForm from "./_EditNoteForm";
import Link from "next/link";
import { redirect } from "next/navigation";

export default async function NoteDetailPage({ params }: { params: { id: string } }) {
  const supabase = createServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/auth/login");

  const { data, error } = await supabase
    .from("notes")
    .select("id, owner_id, title, content, created_at")
    .eq("id", params.id)
    .eq("owner_id", user.id)
    .single();

  if (error || !data) {
    return (
      <div className="p-6">
        <p className="text-red-600">Noten blev ikke fundet.</p>
        <Link className="underline" href="/notes">Tilbage</Link>
      </div>
    );
  }

  return (
    <div className="p-6 max-w-2xl">
      <div className="mb-4"><Link className="underline" href="/notes">← Tilbage til noter</Link></div>
      <h1 className="text-2xl font-semibold mb-2">Rediger note</h1>
      <p className="text-sm text-gray-500 mb-6">Oprettet: {new Date(data.created_at).toLocaleString()}</p>
      <EditNoteForm note={data} />
    </div>
  );
}
'@
Write-FileUtf8 -Path "src/app/notes/[id]/page.tsx" -Content $noteDetail

# --- COURSES list + detail: kræv login og brug user.id ---
$coursesPage = @'
import { createServerClient } from "@/lib/supabase/server";
import { NewCourseForm, DeleteCourseBtn } from "./_actions";
import Link from "next/link";
import { redirect } from "next/navigation";

export default async function CoursesPage() {
  const supabase = createServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/auth/login");

  const { data: courses, error } = await supabase
    .from("courses")
    .select("id, title, description, created_at")
    .eq("owner_id", user.id)
    .order("created_at", { ascending: false });

  if (error) return <div className="p-6 text-red-600">Kunne ikke hente kurser.</div>;

  return (
    <div className="p-6 space-y-6">
      <h1 className="text-2xl font-semibold">Kurser</h1>
      <NewCourseForm />
      <ul className="divide-y">
        {courses?.map((c) => (
          <li key={c.id} className="py-3 flex items-start justify-between gap-4">
            <div className="min-w-0">
              <Link href={`/courses/${c.id}`} className="font-medium underline">{c.title}</Link>
              {c.description && <p className="text-sm text-gray-600">{c.description}</p>}
              <p className="text-xs text-gray-500 mt-1">Oprettet: {new Date(c.created_at).toLocaleString()}</p>
            </div>
            <DeleteCourseBtn id={c.id} />
          </li>
        ))}
      </ul>
    </div>
  );
}
'@
Write-FileUtf8 -Path "src/app/courses/page.tsx" -Content $coursesPage

$courseDetail = @'
import { createServerClient } from "@/lib/supabase/server";
import Link from "next/link";
import EditCourseForm from "./_EditCourseForm";
import { redirect } from "next/navigation";

export default async function CourseDetailPage({ params }: { params: { id: string } }) {
  const supabase = createServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/auth/login");

  const { data, error } = await supabase
    .from("courses")
    .select("id, title, description, created_at")
    .eq("id", params.id)
    .eq("owner_id", user.id)
    .single();

  if (error || !data) {
    return (
      <div className="p-6">
        <p className="text-red-600">Kurset blev ikke fundet.</p>
        <Link className="underline" href="/courses">Tilbage</Link>
      </div>
    );
  }

  return (
    <div className="p-6 max-w-2xl">
      <div className="mb-4"><Link className="underline" href="/courses">← Tilbage til kurser</Link></div>
      <h1 className="text-2xl font-semibold mb-2">Rediger kursus</h1>
      <p className="text-sm text-gray-500 mb-6">Oprettet: {new Date(data.created_at).toLocaleString()}</p>
      <EditCourseForm course={data} />
    </div>
  );
}
'@
Write-FileUtf8 -Path "src/app/courses/[id]/page.tsx" -Content $courseDetail

# --- API routes: kræv user og brug user.id i filtre ---
function PatchApiRouteUserId([string]$path, [string]$table) {
  $content = @"
import { NextResponse } from "next/server";
import { createServerClient } from "@/lib/supabase/server";
"@
  if ($path -match "courses/\[id]") {
    $content += 'import { CourseUpdateSchema } from "@/lib/validation/courses";' + "`r`n"
  } elseif ($path -match "notes/\[id]") {
    $content += 'import { NoteUpdateSchema } from "@/lib/validation/notes";' + "`r`n"
  } elseif ($path -match "courses/route.ts") {
    $content += 'import { CourseCreateSchema } from "@/lib/validation/courses";' + "`r`n"
  }

  if ($path -match "\[id]/route.ts$") {
    # GET + PATCH + DELETE with user
    if ($table -eq "notes") {
      $body = @'
export async function GET(_req: Request, { params }: { params: { id: string } }) {
  try {
    const supabase = createServerClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });

    const { data, error } = await supabase
      .from("notes")
      .select("id, owner_id, title, content, created_at")
      .eq("id", params.id)
      .eq("owner_id", user.id)
      .single();

    if (error?.code === "PGRST116") return NextResponse.json({ ok: false, error: "Not found" }, { status: 404 });
    if (error) throw error;
    return NextResponse.json({ ok: true, note: data }, { status: 200 });
  } catch (err: any) {
    return NextResponse.json({ ok: false, error: err.message ?? "Server error" }, { status: 500 });
  }
}

export async function PATCH(req: Request, { params }: { params: { id: string } }) {
  try {
    const supabase = createServerClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });

    const json = await req.json();
    const parse = NoteUpdateSchema.safeParse(json);
    if (!parse.success) return NextResponse.json({ ok: false, error: parse.error.flatten() }, { status: 400 });

    const { data, error } = await supabase
      .from("notes")
      .update({ ...parse.data })
      .eq("id", params.id)
      .eq("owner_id", user.id)
      .select("id, title, content")
      .single();

    if (error?.code === "PGRST116") return NextResponse.json({ ok: false, error: "Not found" }, { status: 404 });
    if (error) throw error;
    return NextResponse.json({ ok: true, note: data }, { status: 200 });
  } catch (err: any) {
    return NextResponse.json({ ok: false, error: err.message ?? "Server error" }, { status: 500 });
  }
}
'@
    } else {
      $body = @'
export async function GET(_req: Request, { params }: { params: { id: string } }) {
  try {
    const supabase = createServerClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });

    const { data, error } = await supabase
      .from("courses")
      .select("id, owner_id, title, description, created_at")
      .eq("id", params.id)
      .eq("owner_id", user.id)
      .single();

    if (error?.code === "PGRST116") return NextResponse.json({ ok: false, error: "Not found" }, { status: 404 });
    if (error) throw error;
    return NextResponse.json({ ok: true, course: data }, { status: 200 });
  } catch (err: any) {
    return NextResponse.json({ ok: false, error: err.message ?? "Server error" }, { status: 500 });
  }
}

export async function PATCH(req: Request, { params }: { params: { id: string } }) {
  try {
    const supabase = createServerClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });

    const body = await req.json();
    const parsed = CourseUpdateSchema.safeParse(body);
    if (!parsed.success) return NextResponse.json({ ok: false, error: parsed.error.flatten() }, { status: 400 });

    const { data, error } = await supabase
      .from("courses")
      .update({ ...parsed.data })
      .eq("id", params.id)
      .eq("owner_id", user.id)
      .select("id, title, description")
      .single();

    if (error?.code === "PGRST116") return NextResponse.json({ ok: false, error: "Not found" }, { status: 404 });
    if (error) throw error;
    return NextResponse.json({ ok: true, course: data }, { status: 200 });
  } catch (err: any) {
    return NextResponse.json({ ok: false, error: err.message ?? "Server error" }, { status: 500 });
  }
}

export async function DELETE(_req: Request, { params }: { params: { id: string } }) {
  try {
    const supabase = createServerClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });

    const { error } = await supabase.from("courses")
      .delete()
      .eq("id", params.id)
      .eq("owner_id", user.id);

    if (error?.code === "PGRST116") return NextResponse.json({ ok: false, error: "Not found" }, { status: 404 });
    if (error) throw error;
    return NextResponse.json({ ok: true }, { status: 200 });
  } catch (err: any) {
    return NextResponse.json({ ok: false, error: err.message ?? "Server error" }, { status: 500 });
  }
}
'@
    }
    $content += $body
  } else {
    # list + create route
    if ($table -eq "notes") {
      $body = @'
export async function GET() {
  try {
    const supabase = createServerClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });

    const { data, error } = await supabase
      .from("notes")
      .select("id, owner_id, title, content, created_at")
      .eq("owner_id", user.id)
      .order("created_at", { ascending: false });

    if (error) throw error;
    return NextResponse.json({ ok: true, notes: data }, { status: 200 });
  } catch (err: any) {
    return NextResponse.json({ ok: false, error: err.message ?? "Server error" }, { status: 500 });
  }
}
'@
    } else {
      $body = @'
export async function GET() {
  try {
    const supabase = createServerClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });

    const { data, error } = await supabase
      .from("courses")
      .select("id, owner_id, title, description, created_at")
      .eq("owner_id", user.id)
      .order("created_at", { ascending: false });

    if (error) throw error;
    return NextResponse.json({ ok: true, courses: data }, { status: 200 });
  } catch (err: any) {
    return NextResponse.json({ ok: false, error: err.message ?? "Server error" }, { status: 500 });
  }
}

export async function POST(req: Request) {
  try {
    const supabase = createServerClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });

    const body = await req.json();
    const { title, description } = body ?? {};
    if (!title?.trim()) return NextResponse.json({ ok:false, error:"Title required" }, { status:400 });

    const { data, error } = await supabase
      .from("courses")
      .insert({ owner_id: user.id, title: title.trim(), description: description?.trim() ?? null })
      .select("id")
      .single();

    if (error) throw error;
    return NextResponse.json({ ok: true, id: data.id }, { status: 201 });
  } catch (err: any) {
    return NextResponse.json({ ok: false, error: err.message ?? "Server error" }, { status: 500 });
  }
}
'@
    }
    $content += $body
  }
  Write-FileUtf8 -Path $path -Content $content
}

# Patch de eksisterende routes
PatchApiRouteUserId "src/app/api/courses/route.ts" "courses"
PatchApiRouteUserId "src/app/api/courses/[id]/route.ts" "courses"
# Notes list route er ikke nødvendigvis lavet – vi lader den være; vi bruger allerede POST/DELETE fra før.
# PATCH/GET på notes [id] opdateres:
PatchApiRouteUserId "src/app/api/notes/[id]/route.ts" "notes"

Write-Host "`nAuth applied. Now run: npm run dev"
