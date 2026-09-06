import { z } from "zod";

/**
 * F4-TAX-21 — el reporte de impuestos cobrados. `from`/`to` son días del
 * calendario del negocio (como Ventas y Cierres); sin paginar: agrupa por
 * componente y tasa, y un negocio tiene un puñado.
 */
export const taxReportQuerySchema = z
  .object({
    warehouseId: z.uuid().optional(),
    from: z.iso.date().optional(),
    to: z.iso.date().optional(),
  })
  .strict();

export type TaxReportQueryDto = z.infer<typeof taxReportQuerySchema>;

export const taxExportQuerySchema = taxReportQuerySchema.extend({
  format: z.enum(["csv", "xlsx"]).default("xlsx"),
});

export type TaxExportQueryDto = z.infer<typeof taxExportQuerySchema>;
