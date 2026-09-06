import { z } from "zod";

/** F5-SHIFT-01 — los turnos con su arqueo. `from`/`to` son días del calendario del negocio. */
export const shiftsReportQuerySchema = z
  .object({
    warehouseId: z.uuid().optional(),
    /** Quien CERRÓ el turno (quien lo abrió, en los abiertos). */
    userId: z.uuid().optional(),
    status: z.enum(["open", "closed"]).default("closed"),
    from: z.iso.date().optional(),
    to: z.iso.date().optional(),
    page: z.coerce.number().int().positive().default(1),
    pageSize: z.coerce.number().int().positive().max(100).default(20),
  })
  .strict();

export type ShiftsReportQueryDto = z.infer<typeof shiftsReportQuerySchema>;

export const shiftsExportQuerySchema = shiftsReportQuerySchema
  .omit({ page: true, pageSize: true })
  .extend({ format: z.enum(["csv", "xlsx"]).default("xlsx") });

export type ShiftsExportQueryDto = z.infer<typeof shiftsExportQuerySchema>;
