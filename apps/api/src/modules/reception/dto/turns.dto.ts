import { z } from "zod";

/**
 * F9-RECEP-05 — los cuerpos de los turnos. Generar un turno no exige cliente:
 * el «turno suelto» del botón de arriba es tan válido como el que sale del
 * registro. El filtro de fecha es un DÍA del calendario del negocio.
 */
export const createTurnSchema = z.object({
  customerId: z.uuid().optional(),
});

export const listTurnsQuerySchema = z.object({
  date: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "reception.invalid_query")
    .optional(),
});

export type CreateTurnDto = z.infer<typeof createTurnSchema>;
export type ListTurnsQuery = z.infer<typeof listTurnsQuerySchema>;
