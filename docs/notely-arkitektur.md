# Notely v2 – Arkitektur (opdateret 2025-12-19)

Dette dokument beskriver den nuværende arkitektur, dataflow og nøgle-konventioner i **notely-v2** (Next.js + Supabase + OpenAI).  
Målet er at gøre det hurtigt at finde “hvor bor tingene?”, “hvem må kalde hvad?”, og “hvordan hænger pipeline + UI sammen?”.

---

## 1) Produkt-overblik

Notely er en dansk **studieassistent / eksamenstræner**:

- **Upload pensum** (PDF) → tekst → **doc_chunks** (retrieval-ready)
- **Træner**: generér eksamensspørgsmål + evaluer elevsvar (sensor-lignende feedback)
- **Multiple Choice**: generér MC ud fra samme pensum + gem resultater
- **Noter**: gem “resumé” og “fokus-noter” (stub nu, LLM senere)
- Senere: **Overblik** (historik/indsigt), **Simulator** (timede tests), **Mundtlig simulator**

**Brand-tone:** nordisk, rolig, troværdig, uden AI-hype.

---

## 2) Tech stack

- **Frontend/Backend:** Next.js 15 (App Router), Route Handlers (`app/api/**/route.ts`)
- **Styling:** Tailwind CSS v4 (v4-syntax i `globals.css`)
- **DB/Auth/Storage:** Supabase (Postgres + RLS + Storage)
- **LLM:** OpenAI (primært `gpt-4o-mini`), flows kan mappes til forskellige modeller
- **Hosting (typisk):** Cloudflare (Pages/Workers) + Supabase

---

## 3) Auth & owner-resolve (kritisk mønster)

### 3.1 “Én måde at finde ownerId på”
Vi bruger et fælles mønster, så alle routes opfører sig ens:

- **Prod:** kræver rigtig auth cookie (Supabase auth)
- **Dev:** *kan* bruge dev-bypass, men kun hvis:
  - `NODE_ENV !== "production"`
  - `DEV_USER_ID` er sat og er UUID
  - `DEV_BYPASS_SECRET` (eller `DEV_SECRET`) er sat
  - request har header `x-dev-secret` eller `x-shared-secret` med korrekt secret

> Pointen: ingen “silent DEV_USER_ID” i prod, og ingen dev-bypass uden secret.

**Kanoniske helpers**
- `lib/auth/owner.ts` → `getOwnerCtx(req, sb)`
- `lib/auth.ts` → `requireUser(req?)`

### 3.2 Hvornår bruger vi service role?
Service role (`SUPABASE_SERVICE_ROLE_KEY`) bruges **kun** når vi bevidst skal omgå RLS:
- webhooks / server-to-server flows (fx `/api/import`)
- visse quota/status opsummeringer, hvis de kræver counts på tværs uden client-session

Alt andet bør køre med “normal” supabase server client (`supabaseServerRoute()`), og være beskyttet af RLS.

---

## 4) Domænemodeller (tabeller)

Nøgle-tabeller (typisk):

### 4.1 Brugere/planer/kvoter
- `profiles`  
  - `id` (owner_id), `plan`, `quota`, `quota_renew_at`, `email` m.fl.
- `plan_limits`  
  - `plan`, `feature` (`import`, `evaluate`, …), `monthly_limit`
- `jobs`  
  - generisk joblog til usage og async flows  
  - `kind`: fx `"import"`  
  - `status`: `"queued" | "started" | "succeeded" | "finished" | "failed"` (varierer, hold det konsistent)

### 4.2 Upload + retrieval
- `files`  
  - metadata om uploadede filer (storage_path, folder_id, osv.)
- `doc_chunks`  
  - chunked tekst til retrieval  
  - vigtige felter: `owner_id`, `folder_id`, `file_id`, `content`, `source_type`, `academic_weight`
- `ocr_texts`  
  - raw OCR output pr. fil (hvis import-pipeline bruger OCR)

### 4.3 Træning og historik
- `exam_sessions`
  - alt træningsoutput (Træner/MC/Simulator/Oral) samles her
  - vigtige felter: `owner_id`, `question`, `answer`, `feedback`, `score`, `source_type`, `folder_id`, `meta`, `created_at`

### 4.4 Notes
- `notes`
  - genererede eller gemte noter
  - felter: `owner_id`, `title`, `content`, `folder_id`, `note_type`, `source_title`, `source_url`, `created_at`
- `notes_folders`
  - notes folder tree (max 1 nesting level)

### 4.5 Mapper (to systemer – midlertidigt)
Der kan eksistere flere folder-tabeller historisk. Målet er at konsolidere:

- **Training scope:** `training_folders` (med start/slut + 1 nesting level)
- **Notes:** `notes_folders`
- **Legacy:** `folders` (bruges kun hvor det stadig er nødvendigt)

**Plan:** alle trænings-flows (Træner/MC/Simulator/Overblik) bør bruge `training_folders` og `exam_sessions.folder_id`.

### 4.6 Generator-state (rotation)
- `generation_state`
  - per owner + kind + scope_key gemmes `last_used_file_id`
  - bruges til rotation i question/MC generator

### 4.7 Quiz/flashcards (import og senere UI)
- `flashcards`
- `quizzes`, `quiz_questions`, `quiz_answers`

---

## 5) Dataflows

### 5.1 Trainer upload → doc_chunks
Route: `POST /api/trainer/upload`

1) Auth: `requireUser(req)` (prod) / dev-bypass (kun med secret)  
2) Quota gate: tæller `jobs(kind=import,status=succeeded)` pr. måned  
3) Hard limits pr plan: max MB, max sider, max chunks  
4) PDF parse (pdfjs) → tekst → chunking  
5) Upload til Supabase Storage bucket (fx `trainer_uploads`)  
6) Insert `files` row  
7) Insert `doc_chunks` rows  
8) Insert `jobs` row (kind=import,status=succeeded) for usage tracking

### 5.2 /api/import (webhook) – async pipeline
Route: `POST /api/import`

- Bruges af ekstern OCR/generering (Apps Script el.lign.)
- Auth: `IMPORT_SHARED_SECRET` (x-shared-secret / bearer)
- Admin client: service role (persistSession=false)
- Opskriften (idempotens):
  - upsert `files` via md5
  - delete+insert `ocr_texts` by `file_md5`
  - delete+insert `notes/flashcards/quizzes` for (file/owner/title) som defineret
  - job logging i `jobs` med queued→started→finished/failed

### 5.3 Generate question (Træner)
Route: `POST /api/generate-question`

- Find filer i scope (`files` i udvalgte mapper)
- Hent `doc_chunks` fra flere filer, vælg og interleave
- Byg `contextText` og send til LLM
- Rotation: gem `usedFileId` i `generation_state`

### 5.4 Evaluate (Træner/Simulator/Oral)
Route: `POST /api/evaluate`

- Auth: sb + owner_id (dev-bypass kun via secret)
- Quota: `ensureQuotaAndDecrement(ownerId, "evaluate", 1)`
- Hvis `includeBackground`: build context fra `doc_chunks` (per file eller random recent file)
- LLM returnerer JSON (score + feedback-sektioner)
- Gem i `exam_sessions` (source_type = flow)
- Autoprune (fx max 50 trainer sessions) – kun for `source_type="trainer"`

### 5.5 Generate MC + submit
- `POST /api/generate-mc-question`: LLM genererer spørgsmål + 4 muligheder + forklaring, baseret på `doc_chunks`
- `POST /api/mc-submit`: gem resultat i `exam_sessions` (`source_type="mc"`)

### 5.6 Notes generator (stub)
Route: `POST /api/traener/generate-notes`

- Indsætter en note i `notes` med `note_type` = `resume` eller `focus`
- Flag `fromLLM: false` så UI viser “stub”-message

---

## 6) UI routing (højt niveau)

Typiske top-level sider:
- `/traener` (Træner)
- `/mc` (Multiple Choice)
- `/notes` (Noter)
- `/overblik` (indsigt/historik) – kommer
- `/simulator` (timed) – kommer
- `/traener/simulator` / `/traener/oral` (mundtlig) – kommer

Admin-sider (dev/early):
- `/admin/*` (verified sources, tuning, etc.)

---

## 7) Dev/debug routes (C)

Filer der må blive (men bør gates hårdere):

- `app/api/dev/env-check/route.ts`
- `app/api/dev/quota-status/route.ts`
- `app/api/env-debug/route.ts`

**Anbefalet gating (enkelt og robust):**
- Returnér 404 i production (`if (process.env.NODE_ENV === "production") return NextResponse.json({error:"not found"},{status:404})`)
- I non-prod: kræv `x-dev-secret` matcher `DEV_BYPASS_SECRET` (eller `DEV_SECRET`)
- Undgå at lække `ownerId`/secrets i JSON-output

---

## 8) Oprydning (D)

- Slet/arkivér `app/api/evaluate/route.ts.bak.devbypass`
  - Den bør ikke ligge i repo (trigger søgning/forvirring).
  - Hvis du vil gemme, så læg den i fx `archive/` eller giv den `.txt`-suffix.

---

## 9) Repo-struktur (og hvordan du finder den)

Hvis du er i tvivl om den aktuelle struktur, så generér en snapshot-fil med denne PowerShell:

```powershell
# Kør i repo root (C:\Projects\ai-studiepakke\notely-v2)
$stamp = Get-Date -Format "yyyyMMdd_HHmmss"
$out = "repo_snapshot_$stamp.md"

@"
# Repo snapshot ($stamp)
Root: $(Get-Location)

## Versions
node: $(node -v)
npm : $(npm -v)
git : $(git --version)

## Git
$(git status -sb)
$(git remote -v)
branch: $(git rev-parse --abbrev-ref HEAD)
commit: $(git rev-parse HEAD)

## Top-level
$(Get-ChildItem -Force | Select Name,Mode,Length | Format-Table -AutoSize | Out-String)

## Key folders exist?
$(
  @('app','src','src\app','lib','src\lib','supabase','prisma') |
  ForEach-Object { "{0}: {1}" -f $_,(Test-Path $_) } |
  Out-String
)

## App Router – pages/layouts (page.tsx/layout.tsx/...)
$(
  Get-ChildItem -Recurse -File -Include page.tsx,layout.tsx,loading.tsx,error.tsx,not-found.tsx |
  ForEach-Object { $_.FullName.Replace((Get-Location).Path + "\","") } |
  Out-String
)

## API Routes (route.ts)
$(
  Get-ChildItem -Recurse -File -Filter route.ts |
  ForEach-Object { $_.FullName.Replace((Get-Location).Path + "\","") } |
  Out-String
)

## Potential duplicate app roots
$(
  @('app\api','src\app\api','app','src\app') |
  ForEach-Object { if (Test-Path $_) { "FOUND: $_" } } |
  Out-String
)

## Config files
$(
  @('package.json','next.config.js','next.config.mjs','tsconfig.json','tailwind.config.js','tailwind.config.ts','postcss.config.js','postcss.config.mjs') |
  ForEach-Object { if (Test-Path $_) { "FOUND: $_" } } |
  Out-String
)
"@ | Set-Content -Encoding utf8 $out

Write-Host "Wrote $out"
```

**Når du har den fil, kan vi “låse” arkitekturdokumentet 1:1 til din faktiske struktur** (fx om du kører `app/` eller `src/app` som primær).

---

## 10) Kendte konventioner (hurtige regler)

- Brug altid:  
  `import { applyAcademicDanishScoring } from '@/lib/retrieval/score';`
- Undgå “silent DEV_USER_ID” i prod.
- Hold `exam_sessions` som den fælles historik-tabel for alle træningsformer.
- `jobs(kind=import,status=succeeded)` er upload-usage (kvote).
- Quota for evaluate går via `ensureQuotaAndDecrement()`.

---
