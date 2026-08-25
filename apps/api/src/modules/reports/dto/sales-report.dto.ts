import { z } from "zod";

/**
 * Los filtros del reporte de ventas (F5-SALES). Hereda los del historial del
 * POS y suma `warehouseId` — que es justamente lo que el mostrador no filtra.
 */
export const salesReportQuerySchema = z
  .object({
    warehouseId: z.uuid().optional(),
    /**
     * Fechas de CALENDARIO (`YYYY-MM-DD`), no instantes: el servidor las
     * traduce con la zona del negocio. Ver la nota de `buildSalesWhere`.
     */
    from: z.iso.date().optional(),
    to: z.iso.date().optional(),
    /** Parcial: encuentra por folio (`VTA-…`) o por código de barras. */
    folio: z.string().trim().max(32).optional(),
    sellerId: z.uuid().optional(),
    status: z.enum(["completed", "canceled"]).optional(),
    page: z.coerce.number().int().positive().default(1),
    pageSize: z.coerce.number().int().positive().max(100).default(20),
  })
  .strict();

export type SalesReportQueryDto = z.infer<typeof salesReportQuerySchema>;

export const salesExportQuerySchema = salesReportQuerySchema
  .omit({ page: true, pageSize: true })
  .extend({ format: z.enum(["csv", "xlsx"]).default("xlsx") });

export type SalesExportQueryDto = z.infer<typeof salesExportQuerySchema>;
