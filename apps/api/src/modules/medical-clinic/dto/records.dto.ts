import { z } from "zod";

/** F9-CLINIC-10 — abrir un expediente: el paciente, y el turno si vino de uno. */
export const createRecordSchema = z
  .object({
    customerId: z.string().uuid(),
    turnId: z.string().uuid().optional(),
  })
  .strict();

export const listRecordsQuerySchema = z.object({
  customerId: z.string().uuid().optional(),
  page: z.coerce.number().int().positive().default(1),
  pageSize: z.coerce.number().int().positive().max(100).default(20),
});

export type CreateRecordDto = z.infer<typeof createRecordSchema>;
export type ListRecordsQuery = z.infer<typeof listRecordsQuerySchema>;
