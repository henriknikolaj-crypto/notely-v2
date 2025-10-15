import { z } from "zod";

export const CourseCreateSchema = z.object({
  title: z.string().trim().min(1, "Title required").max(200),
  description: z.string().trim().nullable().optional(),
});

export const CourseUpdateSchema = z.object({
  title: z.string().trim().min(1, "Title required").max(200).optional(),
  description: z.string().trim().nullable().optional(),
}).refine((v) => Object.keys(v).length > 0, { message: "Nothing to update" });