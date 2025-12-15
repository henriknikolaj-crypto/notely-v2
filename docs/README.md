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
