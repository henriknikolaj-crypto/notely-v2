// lib/validation/notes.ts
import { z } from "zod";

export const NoteCreateSchema = z.object({
  title: z.string().trim().max(200, "Titel er for lang").optional().nullable(),

  content: z
    .string()
    .trim()
    .min(1, "Indhold mangler")
    .max(100_000, "Indhold er for langt"),

  note_type: z.string().trim().max(64, "note_type er for lang").optional().nullable(),

  // Hvis du bruger notes_folders / folder_id i notes-tabellen:
  folder_id: z.string().uuid("Ugyldigt folder_id").optional().nullable(),

  source_title: z
    .string()
    .trim()
    .max(300, "Kildetitel er for lang")
    .optional()
    .nullable(),

  source_url: z
    .string()
    .trim()
    .max(1000, "Kilde-URL er for lang")
    .optional()
    .nullable(),
});

// Update: alt valgfrit
export const NoteUpdateSchema = NoteCreateSchema.partial();

export type NoteCreateInput = z.infer<typeof NoteCreateSchema>;
export type NoteUpdateInput = z.infer<typeof NoteUpdateSchema>;
