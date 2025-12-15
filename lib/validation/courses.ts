import { z } from "zod";

export const CourseCreateSchema = z.object({
  title: z.string().trim().min(1, "Titel mangler").max(120, "Titel er for lang"),
  description: z
    .string()
    .trim()
    .max(5000, "Beskrivelse er for lang")
    .optional()
    .nullable(),
});

// Update: alt valgfrit
export const CourseUpdateSchema = CourseCreateSchema.partial();
