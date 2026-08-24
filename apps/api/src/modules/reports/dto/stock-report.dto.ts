import { z } from "zod";

/**
 * Los filtros del reporte de stock (F5-STK). Los MISMOS para la tabla y para
 * el export: si divergieran, el archivo traería un universo distinto del que
 * la pantalla muestra y nadie lo notaría hasta abrirlo.
 */
export const stockReportQuerySchema = z
  .object({
    warehouseId: z.uuid().optional(),
    /**
     * Solo los productos cuyo TOTAL está bajo su `stock_min`. Ver la nota del
     * service: el mínimo es un umbral global del producto, no del almacén.
     */
    belowMin: z
      .enum(["true", "false"])
      .optional()
      .transform((valor) => valor === "true"),
    /** Parcial e insensible, sobre SKU y nombre. */
    search: z.string().trim().min(1).optional(),
    /**
     * `lots` baja al detalle por lote y ubicación (F5-STK-05). Es un modo y no
     * un endpoint aparte porque son los mismos filtros sobre el mismo stock,
     * mirado con más resolución.
     */
    detail: z.enum(["lots"]).optional(),
    page: z.coerce.number().int().positive().default(1),
    pageSize: z.coerce.number().int().positive().max(100).default(20),
  })
  .strict();

export type StockReportQueryDto = z.infer<typeof stockReportQuerySchema>;

/** El export no pagina: baja lo que los filtros dejen, hasta el tope. */
export const stockExportQuerySchema = stockReportQuerySchema
  .omit({ page: true, pageSize: true })
  .extend({ format: z.enum(["csv", "xlsx"]).default("xlsx") });

export type StockExportQueryDto = z.infer<typeof stockExportQuerySchema>;
