# Notely – docs-overblik

Dette katalog samler de vigtigste “levende” design- og arkitektur-noter
for Notely v2 (trænerdelen).

Formålet er, at vi hurtigt kan finde:

- hvordan mapper og træningsfiler er modelleret
- hvilke beslutninger der faktisk gælder nu
- hvilke dokumenter der beskriver fremtidige planer.

---

## 1. Arkitektur & data (gældende nu)

- **`notely-arkitektur.md`**  
  Primær arkitektur-note for Notely v2. Dækker bl.a.:

  - tech-stack (Next.js 15, Supabase, OpenAI)
  - auth-mønster og brug af `DEV_USER_ID` i lokal dev
  - tabellerne `folders`, `training_files`, `doc_chunks`, `exam_sessions` m.fl.
  - hvordan Upload, Noter, Multiple Choice og Træner bruger de samme mapper
    og træningsfiler
  - hvilke ting der er plan vs. implementeret.

Læs denne når du skal forstå, **hvordan systemet virker i dag.**

---

## 2. Mapper til træning – plan-dokument

- **`training_folders_plan.md`**  
  Beskriver målet om et dedikeret `training_folders`-system til træningsmapper
  (perioder, fag, Overblik-grafer osv.).

  - **Status (dec 2025):**  
    - Ikke implementeret.  
    - Alt kører stadig på tabellen `folders`, og træningsfiler ligger i
      `training_files`.  
    - Dokumentet er en **roadmap**, ikke nutidsbeskrivelse.

Brug dette dokument når vi planlægger “mapper v2” og Overblik-arbejde.

---

## 3. Historiske noter

- **`../Notely_Arkitektur_og_Aftaler.md`**  
  Større ældre arkitektur-dokument. Kan bruges som historisk reference, men
  nyere beslutninger skrives i `notely-arkitektur.md`.

Der kan ligge andre ældre doc-filer; de må gerne beholdes som reference, men
skal ikke nødvendigvis holdes 100% ajour.

---

## 4. Huskeliste når vi ændrer noget

Når vi laver større ændringer i data-modellering eller trænings-flowet:

1. Opdatér **`notely-arkitektur.md`** (gældende sandhed).
2. Hvis det påvirker mapper/Overblik, opdatér også
   **`training_folders_plan.md`**.
3. Skriv kort i commit-beskeden hvilke af disse docs der er ændret.

Så undgår vi at skulle gætte på, hvad der er rigtigt om 3 måneder.

---

## 9. TODO – næste skridt for mapper

Denne liste handler kun om mapperne (`folders` → `training_folders`).

### 9.1 Kortsigtet (før produktion)

1. **Stabilisér `folders` som “single source of truth”**
   - Sikr at alle sider (Upload, Noter, MC, Træner, Overblik) kun henter mapper
     fra `folders`.
   - Dobbelttjek at alle API-ruter bruger samme `getOwnerId()`-helper og altid
     filtrerer på `owner_id`.

2. **Oprydning og indexes**
   - Tilføj indeks på `folders(owner_id, created_at desc)`.
   - Tilføj indeks på `training_files(owner_id, folder_id, created_at desc)`.
   - Gennemgå RLS-politikker på `folders` og `training_files` og bekræft:
     - authenticated-brugere kan kun se deres egne rækker
     - service-role kan se / opdatere alt.

3. **Smoke-tests til mapper**
   - Lav 1–2 små scripts (fx PowerShell) der tester:
     - opret mappe, upload fil, se filen i `/api/files?folder_id=…`
     - flyt fil til anden mappe og se at den forsvinder fra den gamle og vises i den nye
     - slet mappe (soft delete) og bekræft at upload til mappe fejler korrekt.

### 9.2 Mellemsigtet (forbered `training_folders`)

4. **Definér endelig skema for `training_folders`**
   - Beslut de endelige kolonner (navn, parent, start/slut, flags).
   - Lav migrations til at oprette tabellen, men **uden at tage den i brug** endnu.

5. **Synkroniser modeller i kode**
   - Tilføj TypeScript-typer for `TrainingFolder`.
   - Lav en lille helper `listTrainingFolders(ownerId)` der stadig læser fra
     `folders`, men som senere kan skifte til `training_folders` uden at UI ændres.

6. **Forbered `exam_sessions.folder_id`**
   - Udvid `exam_sessions` med `folder_id uuid null`.
   - Sæt kolonnen ved nye træninger baseret på den aktive mappe (fra `folders`).
   - Brug kolonnen i Overblik-queries, så migrationen senere bare er et tabel-skifte.

### 9.3 Langsigtet (selve migrationen)

7. **Data-migration `folders` → `training_folders`**
   - Kopiér alle rækker fra `folders` til `training_folders` (behold samme `id`
     hvor muligt).
   - Opdatér:
     - `training_files.folder_id`
     - `exam_sessions.folder_id`
     - evt. `notes.folder_id` og andre relevante tabeller
     til at pege på `training_folders`.

8. **Skift helpers og API over**
   - Lad `listTrainingFolders(ownerId)` skifte fra at læse `folders` til
     `training_folders`.
   - Opdatér Upload/Noter/MC/Træner/Overblik til at bruge helperen
     i stedet for at slå direkte i `folders`.

9. **Afvikl `folders` (eller gør den legacy-only)**
   - Når alt kører stabilt på `training_folders`, kan `folders`:
     - enten droppes helt
     - eller reduceres til legacy / andre features der ikke er træningsrelaterede.

