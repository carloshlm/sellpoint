import { z } from "zod";

/**
 * F9-CLINIC-09 — buscar al paciente por nombre o por número de turno. El
 * turno es un entero positivo (el mismo `q` sirve para los dos modos: es un
 * solo campo en pantalla).
 */
export const searchPatientsSchema = z
  .object({
    mode: z.enum(["name", "turn"]),
    q: z.string().trim().min(1).max(120),
  })
  .refine((v) => v.mode !== "turn" || /^[1-9]\d{0,8}$/.test(v.q), {
    message: "medical_clinic.invalid_query",
  });

export type SearchPatientsQuery = z.infer<typeof searchPatientsSchema>;
