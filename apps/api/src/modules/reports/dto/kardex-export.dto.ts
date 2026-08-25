import { MOVEMENT_REASONS } from "@sellpoint/shared";
import { z } from "zod";

/**
 * Los MISMOS filtros que la pantalla del kardex. Sin `page` ni `pageSize`: el
 * export no pagina, lo acota el tope de filas.
 */
export const kardexExportQuerySchema = z
  .object({
    warehouseId: z.uuid().optional(),
    /** Días del calendario del negocio, no instantes. */
    from: z.iso.date().optional(),
    to: z.iso.date().optional(),
    direction: z.enum(["entry", "exit"]).optional(),
    reasonCode: z.enum(MOVEMENT_REASONS).optional(),
    lotId: z.uuid().optional(),
    format: z.enum(["csv", "xlsx"]).default("xlsx"),
  })
  .strict();

export type KardexExportQueryDto = z.infer<typeof kardexExportQuerySchema>;

/** Los mismos filtros SIN el formato: es del transporte, no de la consulta. */
export type KardexExportFilters = Omit<KardexExportQueryDto, "format">;
