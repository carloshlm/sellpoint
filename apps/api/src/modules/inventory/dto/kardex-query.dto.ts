import { MOVEMENT_DIRECTIONS, MOVEMENT_REASONS } from "@sellpoint/shared";
import { z } from "zod";
import { optionalIdFilter } from "../../../common/http/id-field";
import { lenientDay, lenientEnum, lenientFormat, lenientPositiveInt } from "./lenient-query";

/**
 * F3-KARDEX-01 — los filtros del kárdex de un producto (`GET
 * /products/:id/kardex`).
 *
 * Los parámetros basura se descartan en vez de reventar: un kárdex es lo
 * primero que alguien abre desde un enlace viejo. Los ids no (F10-MANFIX-20):
 * un `?warehouseId=` o un `?lotId=` mal formado es 400 `common.invalid_id`.
 */
export const kardexQuerySchema = z.object({
  warehouseId: optionalIdFilter(),
  lotId: optionalIdFilter(),
  from: lenientDay(),
  to: lenientDay(),
  direction: lenientEnum(MOVEMENT_DIRECTIONS),
  reasonCode: lenientEnum(MOVEMENT_REASONS),
  page: lenientPositiveInt(),
  pageSize: lenientPositiveInt(),
});

export type KardexQueryDto = z.infer<typeof kardexQuerySchema>;

/** `GET /products/:id/stock`: el saldo de todos los almacenes, o de uno. */
export const productStockQuerySchema = z.object({
  warehouseId: optionalIdFilter(),
});

export type ProductStockQueryDto = z.infer<typeof productStockQuerySchema>;

/** `GET /inventory/in-transit`: lo despachado que nadie ha recibido. */
export const inTransitQuerySchema = z.object({
  productId: optionalIdFilter(),
  /** El alcance mira el ORIGEN: es mercancía de la que se sigue siendo responsable. */
  originWarehouseId: optionalIdFilter(),
});

export type InTransitQueryDto = z.infer<typeof inTransitQuerySchema>;

/** F5-EXP-02: lo mismo en Excel (o CSV), sin agrupar. */
export const inTransitExportQuerySchema = inTransitQuerySchema.extend({
  format: lenientFormat(),
});

export type InTransitExportQueryDto = z.infer<typeof inTransitExportQuerySchema>;
