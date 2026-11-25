import { z } from "zod";
import { idField } from "../../../common/http/id-field";

/**
 * Los filtros del reporte de ventas (F5-SALES). Hereda los del historial del
 * POS y suma `warehouseId` — que es justamente lo que el mostrador no filtra.
 */
export const salesReportQuerySchema = z
  .object({
    warehouseId: idField().optional(),
    /**
     * Fechas de CALENDARIO (`YYYY-MM-DD`), no instantes: el servidor las
     * traduce con la zona del negocio. Ver la nota de `buildSalesWhere`.
     */
    from: z.iso.date().optional(),
    to: z.iso.date().optional(),
    /** Parcial: encuentra por folio (`VTA-…`) o por código de barras. */
    folio: z.string().trim().max(32).optional(),
    sellerId: idField().optional(),
    status: z.enum(["completed", "canceled"]).optional(),
    /**
     * F10-KPI-11 — «Solo con descuento»: las ventas con `discount > 0` (el
     * descuento TOTAL de la venta). Llega por la URL como texto, como el
     * `belowMin` del stock. Opcional también a la salida: sin él, la consulta
     * es la de siempre y el campo ni aparece.
     */
    discounted: z
      .enum(["true", "false"])
      .transform((valor) => valor === "true")
      .optional(),
    page: z.coerce.number().int().positive().default(1),
    pageSize: z.coerce.number().int().positive().max(100).default(20),
  })
  .strict();

export type SalesReportQueryDto = z.infer<typeof salesReportQuerySchema>;

export const salesExportQuerySchema = salesReportQuerySchema
  .omit({ page: true, pageSize: true })
  .extend({ format: z.enum(["csv", "xlsx"]).default("xlsx") });

export type SalesExportQueryDto = z.infer<typeof salesExportQuerySchema>;

/**
 * Los filtros de «Ventas por producto» y «Ventas por servicio»: los de Ventas
 * SIN `status`. Esos dos reportes listan solo lo cobrado (Carlos, 2026-11-02:
 * «sólo debe mostrar las ventas cobradas»), así que el estado no es un filtro
 * y mandarlo responde 400: `.omit` conserva el `.strict()`.
 *
 * Tampoco llevan `discounted` (F10-KPI-11): el descuento es del TICKET, y
 * esos reportes son de líneas. Mandarlo sigue respondiendo 400, como antes.
 *
 * Suman `itemId` (F10-RPT-02): las líneas de UN artículo, el producto en
 * «por producto» y el servicio en «por servicio». Un solo nombre para los
 * dos, porque la ruta ya dice de qué tipo es. Es a donde llevan el aviso
 * «creció» del panel y los reportes por artículo, para ver sus tickets.
 */
const lineFilters = {
  itemId: idField().optional(),
};

export const salesLinesQuerySchema = salesReportQuerySchema
  .omit({ status: true, discounted: true })
  .extend(lineFilters);

export type SalesLinesQueryDto = z.infer<typeof salesLinesQuerySchema>;

export const salesLinesExportQuerySchema = salesExportQuerySchema
  .omit({ status: true, discounted: true })
  .extend(lineFilters);

export type SalesLinesExportQueryDto = z.infer<typeof salesLinesExportQuerySchema>;
