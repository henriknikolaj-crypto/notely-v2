/* eslint-disable @typescript-eslint/no-explicit-any */
import { z } from "zod";

export const NoteCreateSchema = z.object({
  title: z.string().trim().min(1, "Title required").max(200),
  content: z.string().trim().nullable().optional(),
});

export const NoteUpdateSchema = z.object({
  title: z.string().trim().min(1, "Title required").max(200).optional(),
  content: z.string().trim().nullable().optional(),
}).refine((data) => Object.keys(data).length > 0, {
  message: "Nothing to update",
});