import { z } from "zod";

/** F9-CLINIC-10 — abrir un expediente: el paciente, y el turno si vino de uno. */
export const createRecordSchema = z
  .object({
    customerId: z.string().uuid(),
    turnId: z.string().uuid().optional(),
  })
  .strict();

/**
 * F9-CLINIC-32 — el buscador de historias clínicas: por paciente (id o
 * nombre) y por rango de fechas de consulta. El web abre con `from = to =
 * hoy` (las consultas del día); sin filtros sale todo, de la más reciente a
 * la más antigua.
 */
export const listRecordsQuerySchema = z
  .object({
    customerId: z.string().uuid().optional(),
    /** Nombre del paciente, como se ve en el expediente (búsqueda parcial). */
    query: z.string().trim().min(1).max(120).optional(),
    /** `YYYY-MM-DD`, fecha de consulta en el calendario del negocio. */
    from: z.iso.date().optional(),
    to: z.iso.date().optional(),
    page: z.coerce.number().int().positive().default(1),
    pageSize: z.coerce.number().int().positive().max(100).default(20),
  })
  .refine((q) => q.from === undefined || q.to === undefined || q.from <= q.to, {
    message: "medical_clinic.invalid_query",
    path: ["to"],
  });

export type CreateRecordDto = z.infer<typeof createRecordSchema>;
export type ListRecordsQuery = z.infer<typeof listRecordsQuerySchema>;
