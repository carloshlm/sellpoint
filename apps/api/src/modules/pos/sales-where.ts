import { endOfDayUtc, startOfDayUtc } from "@sellpoint/shared";
import type { Prisma } from "../../generated/prisma/client";

/**
 * El armado del `where` de ventas, compartido por sus DOS audiencias.
 *
 * Nació dentro de `sales.service.list` (F4, el historial del mostrador) y se
 * extrajo acá cuando el reporte de F5 necesitó lo mismo con alcance encima.
 * Lo que se comparte es el FILTRADO; lo que NO se comparte es el contrato:
 *
 *  · **El historial del POS** (`pos:view`) no aplica alcance. La cajera tiene
 *    que encontrar el ticket que el cliente trae en la mano, sin importar de
 *    qué caja salió.
 *  · **El reporte** (`reports:read`) SÍ lo aplica: un Manager de una bodega no
 *    puede enterarse de lo que vendieron las otras.
 *
 * Ese `warehouseId` es lo único que el reporte suma; el resto lo hereda.
 *
 * ── Las dos semánticas que este builder ARRASTRA ────────────────────────
 *
 * **1. El rango va en días del calendario del NEGOCIO.** `from`/`to` llegan
 * como fechas (`YYYY-MM-DD`) y se traducen a instantes con la zona del tenant.
 * Que la traducción sea del servidor es lo que arregló «los movimientos de hoy
 * no salen» (2026-08-24): con la conversión del lado del cliente, un negocio
 * en CDMX perdía las ventas de después de las 18:00 porque en UTC ya eran del
 * día siguiente.
 *
 * **2. El folio busca TAMBIÉN por código de barras.** Un solo campo para las
 * dos identidades del papel: quien escanea el ticket trae el código de 12
 * dígitos, quien lo dicta por teléfono trae el `VTA-…`.
 *
 * Extraer el builder sin arrastrar las dos habría sido una regresión
 * silenciosa en el POS — de esas que solo aparecen en producción y a las 18:01.
 */
export interface SalesWhereInput {
  tenantId: string;
  /** La zona del NEGOCIO, ya resuelta por el llamador. */
  timeZone: string;
  folio?: string;
  status?: "completed" | "canceled";
  sellerId?: string;
  sessionId?: string;
  from?: string;
  to?: string;
  /** Solo el reporte lo usa; el historial del POS no filtra por almacén. */
  warehouseId?: string;
  /**
   * Los almacenes que el usuario puede ver. `undefined` significa «sin
   * alcance», que es el contrato del POS — NO «ninguno». Quien quiera acotar
   * pasa la lista explícitamente.
   */
  warehouseIds?: readonly string[];
}

export function buildSalesWhere(input: SalesWhereInput): Prisma.SaleWhereInput {
  return {
    tenantId: input.tenantId,
    ...(input.folio !== undefined && {
      OR: [
        { folio: { contains: input.folio, mode: "insensitive" as const } },
        { barcode: { contains: input.folio } },
      ],
    }),
    ...(input.status !== undefined && { status: input.status }),
    ...(input.sellerId !== undefined && { createdBy: input.sellerId }),
    ...(input.sessionId !== undefined && { cashboxSessionId: input.sessionId }),
    ...(input.warehouseId !== undefined
      ? { warehouseId: input.warehouseId }
      : input.warehouseIds !== undefined
        ? // Lista vacía → `in: []`, que no devuelve nada. Omitir la clave
          // significaría «todos», justo lo contrario de un alcance vacío.
          { warehouseId: { in: [...input.warehouseIds] } }
        : {}),
    ...(input.from !== undefined || input.to !== undefined
      ? {
          createdAt: {
            ...(input.from !== undefined && { gte: startOfDayUtc(input.from, input.timeZone) }),
            // `lt` y no `lte`: el fin de día es el ARRANQUE del siguiente, así
            // no se pierde el último milisegundo.
            ...(input.to !== undefined && { lt: endOfDayUtc(input.to, input.timeZone) }),
          },
        }
      : {}),
  };
}
