import { z } from "zod";
import { idField } from "../../../common/http/id-field";

/**
 * F10-RPT-03 — los filtros del reporte por artículo: los de los otros
 * reportes (Carlos, 2026-11-25: «sucursal, fechas, productos o servicios»)
 * más la vista. La vista por omisión es «Más vendidos»: así un id mal escrito
 * responde con su propio error (`common.invalid_id`, F10-MANFIX-20) y no con
 * el de un campo que faltó.
 */
export const itemsReportQuerySchema = z
  .object({
    /**
     * «Más vendidos» (por venta), «Mayor utilidad» (solo lo que dejó) y
     * «Vendidos bajo su costo» (solo lo que perdió).
     */
    view: z.enum(["top-sold", "top-profit", "below-cost"]).default("top-sold"),
    /** `product` son los productos y los conceptos libres: todo lo que no es servicio. */
    type: z.enum(["all", "product", "service"]).default("all"),
    warehouseId: idField().optional(),
    /**
     * Fechas de CALENDARIO (`YYYY-MM-DD`), no instantes: el servidor las
     * traduce con la zona del negocio, como en el reporte de ventas.
     */
    from: z.iso.date().optional(),
    to: z.iso.date().optional(),
    page: z.coerce.number().int().positive().default(1),
    pageSize: z.coerce.number().int().positive().max(100).default(20),
  })
  .strict();

export type ItemsReportQueryDto = z.infer<typeof itemsReportQuerySchema>;

export type ItemsReportView = ItemsReportQueryDto["view"];

export const itemsExportQuerySchema = itemsReportQuerySchema
  .omit({ page: true, pageSize: true })
  .extend({ format: z.enum(["csv", "xlsx"]).default("xlsx") });

export type ItemsExportQueryDto = z.infer<typeof itemsExportQuerySchema>;
