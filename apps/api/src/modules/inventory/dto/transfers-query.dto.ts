import { TRANSFER_STATUSES } from "@sellpoint/shared";
import { z } from "zod";
import { optionalIdFilter } from "../../../common/http/id-field";
import { lenientDay, lenientEnum, lenientNonNegativeInt } from "./lenient-query";

/**
 * Los filtros del listado de traspasos (`GET /transfers`).
 *
 * Los parámetros basura se descartan en vez de reventar: un listado es lo
 * primero que abre alguien, y un 400 por un `page=abc` en un enlace viejo
 * sería una pared en la puerta. Los ids no (F10-MANFIX-20): un almacén mal
 * formado es 400 `common.invalid_id`.
 */
export const listTransfersQuerySchema = z.object({
  status: lenientEnum(TRANSFER_STATUSES),
  direction: lenientEnum(["incoming", "outgoing"]),
  originWarehouseId: optionalIdFilter(),
  destinationWarehouseId: optionalIdFilter(),
  /** Cualquiera de las dos puntas: un cancelado le importa al origen y al destino. */
  warehouseId: optionalIdFilter(),
  /** Por el folio del despacho (SAL-…); vacío o repetido es «sin filtro». */
  folio: z
    .string()
    .trim()
    .optional()
    .catch(undefined)
    .transform((folio) => folio || undefined),
  from: lenientDay(),
  to: lenientDay(),
  olderThanDays: lenientNonNegativeInt(),
  page: lenientNonNegativeInt(),
  pageSize: lenientNonNegativeInt(),
});

export type ListTransfersQueryDto = z.infer<typeof listTransfersQuerySchema>;
