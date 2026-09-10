import { z } from "zod";

/**
 * F9-EXP-03 — los cuerpos de las categorías de gasto. Hay 18 de fábrica; el
 * negocio agrega las suyas. El `code` es la identidad estable (snake_case,
 * como las sembradas); si no viene, se deriva del nombre.
 */
const codigo = z
  .string()
  .trim()
  .min(1)
  .max(48)
  .regex(/^[a-z0-9]+(_[a-z0-9]+)*$/, "expenses.invalid_category_code");
const nombre = z.string().trim().min(1).max(120);

/** «Servicios Profesionales» → `servicios_profesionales`: sin acentos, snake_case, tope 48. */
export function categoryCodeFromName(name: string): string {
  const plano = name
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 48)
    .replace(/_+$/g, "");
  return plano === "" ? "category" : plano;
}

export const createExpenseCategorySchema = z
  .object({
    code: codigo.optional(),
    name: nombre,
    sortOrder: z.number().int().min(0).max(100_000).optional(),
  })
  .strict();

export const updateExpenseCategorySchema = z
  .object({
    name: nombre.optional(),
    sortOrder: z.number().int().min(0).max(100_000).optional(),
    isActive: z.boolean().optional(),
  })
  .strict()
  .refine((value) => Object.keys(value).length > 0, { message: "expenses.empty_update" });

export const listExpenseCategoriesQuerySchema = z.object({
  query: z.string().trim().min(1).max(120).optional(),
  // Texto y no `coerce.boolean`: "false" coaccionado sería `true`.
  isActive: z
    .enum(["true", "false"])
    .transform((v) => v === "true")
    .optional(),
  page: z.coerce.number().int().positive().default(1),
  pageSize: z.coerce.number().int().positive().max(100).default(50),
});

export type CreateExpenseCategoryDto = z.infer<typeof createExpenseCategorySchema>;
export type UpdateExpenseCategoryDto = z.infer<typeof updateExpenseCategorySchema>;
export type ListExpenseCategoriesQuery = z.infer<typeof listExpenseCategoriesQuerySchema>;
