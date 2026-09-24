import { z } from "zod";
import { optionalIdFilter } from "../../../common/http/id-field";
import { lenientFormat, lenientSwitch } from "./lenient-query";

/**
 * F3-LOTS-02 — los lotes de un producto (`GET /products/:id/lots`), para el
 * selector de «forzar lote» y el detalle del producto.
 */
export const productLotsQuerySchema = z.object({
  /** Solo los lotes con existencias: `?withStock=true`. */
  withStock: lenientSwitch("true"),
  warehouseId: optionalIdFilter(),
});

export type ProductLotsQueryDto = z.infer<typeof productLotsQuerySchema>;

/**
 * Lo que está por vencerse (`GET /inventory/expiring`). `days` es un número
 * de días, no una fecha: la pantalla ofrece 7/30/90 y así el cliente no tiene
 * que calcular nada.
 */
export const expiringQuerySchema = z.object({
  // 30 días es el default del tablero. Un `days` basura cae acá y no en un
  // 500: pedir «próximos a vencer» sin decir cuántos días es razonable.
  days: z.coerce.number().nonnegative().transform(Math.floor).catch(30),
  warehouseId: optionalIdFilter(),
  /** Solo lo YA vencido (`?onlyExpired=true` o `=1`): su propio filtro, no un plazo. */
  onlyExpired: lenientSwitch("true", "1"),
});

export type ExpiringQueryDto = z.infer<typeof expiringQuerySchema>;

/** F5-EXP-01: lo mismo en Excel (o CSV). */
export const expiringExportQuerySchema = expiringQuerySchema.extend({
  format: lenientFormat(),
});

export type ExpiringExportQueryDto = z.infer<typeof expiringExportQuerySchema>;
