training_folders_plan.md

# Training folders – plan

Mål:
- Eget træningsmappe-system med start- og slutdato.
- Max ét niveau under hovedmappe.
- Bruges både i venstre træningskolonne og i Overblik/historik.

Trin:

1. Skema
   - Opret/udbyg `training_folders`:
     - id (uuid), owner_id, name
     - parent_id (nullable, kun ét niveau)
     - start_date, end_date (nullable)
     - created_at
   - Udvid `exam_sessions` med `folder_id uuid`.

2. Migration
   - Script, der kopierer eksisterende mapper fra nuværende `folders`
     til `training_folders` pr. owner.
   - Evt. sæt `folder_id` på eksisterende `exam_sessions` hvor muligt.

3. API
   - `/api/training-folders` → brug KUN `training_folders`.
   - `/api/folders` kan blive som legacy til andre steder (hvis noget stadig bruger det).
   - Fjern fallback til `/api/folders` i `app/traener/upload/UploadClient.tsx`.

4. UI
   - Venstre træningskolonne (AppShell) skal læse fra `training_folders`.
   - Mapper i Upload, Noter, MC, osv. skal alle bruge samme `/api/training-folders`.
   - Sørg for at scope-valg til Træner/MC/SIMULATOR følger training_folders.

5. Overblik
   - Tilpas Overblik-siden til at bruge `exam_sessions.folder_id`
     for grafer og filter pr. fag/forløb.
