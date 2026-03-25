# Mundtlig eksamen (server-TTS, ikke streaming) — Spec (A–D)

## A) UX / flow (turn-based)
- Bruger vælger 1+ mapper (scope) i venstre side → vises i “Træningsområde” som kort label (fx “Samfund +1”).
- Bruger vælger varighed: 20 / 40 / 60 min (3 valgmuligheder).
- Bruger trykker Start.
- Spørgsmålet gives som LYD (ingen tekstspørgsmål i UI).
- Mikrofon-indikator:
  - Rød når system/LLM taler (spørgsmålet afspilles).
  - Grøn når brugeren taler (optagelse af svar).
  - Neutral = samme farve som yderfelternes baggrund (kan evt. være grå ved “evaluerer/venter”).
- Ingen live-afskrift under optagelse. Afskrift vises først efter aflevering (fold-ud).
- Noter (valgfrit): lille felt til højre. Kun label “Noter” + input (ingen ekstra hjælpetekst).
- Turn-based opfølgning: efter brugerens svar kan systemet stille 1+ opfølgende spørgsmål (samme loop: TTS → optagelse), indtil tid udløber eller brugeren afleverer.

## B) UI layout (mundtlig)
- Øverste del (titel/undertitel + tabs Skrift/Mundtlig + “Træningsområde”) skal være ens på begge sider.
- Under tidskortet: højre kolonne bliver en enkel “split”:
  - Venstre: stort mic-ikon (ingen ekstra kasser omkring).
  - Højre: én boks “Noter” (valgfrit).
- Spørgsmål-felt findes ikke som tekstfelt. Kun lyd-afspilning.
- Efter aflevering: vis feedback + karakter. Afskrift kan foldes ud i fuld bredde af højre kolonne.

## C) Tekniske valg
- TTS: server-genereret audio (ikke streaming).
- Optagelse: browser optager audio (webm) pr. tur.
- Transcribe: OpenAI transcribe-model styres af env `OPENAI_TRANSCRIBE_MODEL`.
- Eval: chat-model for mundtlig styres af `requireFlowModel("oral")` → env `OPENAI_MODEL_ORAL`.
- Events til sidebar refresh efter succes:
  - `notely:exam-updated`
  - `notely:simulator-updated`

## D) API: POST /api/oral/submit (nodejs)
- Modtag `multipart/form-data`:
  - `audio` (webm)
  - `question` (string) — den aktuelle tur
  - `durationMin` (number)
  - `startedAt` (ISO/string eller ms)
  - `endedAt` (ISO/string eller ms)
  - `folderId` (string|null)
  - `scopeFolderIds` (csv eller json)
  - `notes` (string, optional)
  - (valgfrit) `turnIndex` / `sessionId` hvis vi vil samle flere ture
- Transskriber med modellen fra env:
  - `OPENAI_TRANSCRIBE_MODEL` (fx `gpt-4o-mini-transcribe`)
  - brug `verbose_json` + segment timestamps
- Evaluer med chat-model:
  - `requireFlowModel("oral")`
  - `OPENAI_MODEL_ORAL = gpt-5.4`
- Returnér JSON:
  - `{ ok:true, result:{ grade, score, summary, strengths, improvements, transcript:{ text, segments:[{start,end,text}] } } }`
- Gem i `exam_sessions`:
  - `source_type = "oral"`
  - `folder_id` = (single)
  - `meta.folder_ids` = (flere)
  - `meta.transcriptSegments`
  - `meta.durationMin / startedAt / endedAt`
  - `meta.notes`
- Client: efter succes dispatch:
  - `notely:exam-updated`
  - `notely:simulator-updated`
