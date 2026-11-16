import { z } from "zod";
import { idField } from "../../../common/http/id-field";

/** F5-SHIFT-01 — los turnos con su arqueo. `from`/`to` son días del calendario del negocio. */
export const shiftsReportQuerySchema = z
  .object({
    warehouseId: idField().optional(),
    /** Quien CERRÓ el turno (quien lo abrió, en los abiertos). */
    userId: idField().optional(),
    /**
     * Sin estado, los CERRADOS — salvo que se busque por folio: un folio se
     * busca en abiertos y cerrados (Carlos, 2026-11-16), ver `where`.
     */
    status: z.enum(["open", "closed"]).optional(),
    /** El folio del turno, completo o un pedazo («TUR-000042», «42»). */
    search: z.string().trim().min(1).max(32).optional(),
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
