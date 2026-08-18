import {
  ForbiddenException,
  NotFoundException,
  UnprocessableEntityException,
} from "@nestjs/common";
import type { Prisma } from "../../generated/prisma/client";
import type { UserScope } from "../../infrastructure/warehouse-scope/request-warehouse-scope";

/**
 * F3-CORE-03 — el alcance por almacén, en UN solo lugar.
 *
 * `@CurrentUserScope()` existe desde F1-SCOPE pero nunca tuvo consumidores:
 * hasta que hubo movimientos, no había nada que acotar. Estos helpers son ese
 * primer consumidor, y viven acá y no repartidos por los controllers para que
 * "estar fuera de alcance" signifique lo mismo en toda la fase.
 *
 * Los tres estados del scope y por qué importan los tres:
 *   · `"all"` — sin restricción. Es el default permisivo de F2-SCOPE-01: un
 *     tenant que nunca asignó alcances ve todos sus almacenes, porque lo
 *     contrario dejaría a un negocio chico sin ver su propio inventario.
 *   · `[a, b]` — solo esos.
 *   · `[]` — NINGUNO. Es el fail-closed del interceptor cuando no pudo
 *     resolver el scope. Tratarlo como "todos" abriría el inventario entero,
 *     así que se distingue explícitamente.
 */
export function assertWarehouseInScope(scope: UserScope, warehouseId: string): void {
  if (scope.warehouseIds === "all") {
    return;
  }
  if (!scope.warehouseIds.includes(warehouseId)) {
    throw new ForbiddenException({ message: "inventory.warehouse_out_of_scope" });
  }
}

/**
 * El `where` de Prisma que acota un listado al alcance del usuario.
 *
 * Con la lista vacía devuelve `{ id: { in: [] } }` y no `{}`: un `where` vacío
 * significaría "todos", que es exactamente lo contrario de lo que pide un
 * scope vacío.
 */
export function warehouseScopeWhere(scope: UserScope): Prisma.WarehouseWhereInput {
  return scope.warehouseIds === "all" ? {} : { id: { in: scope.warehouseIds } };
}

/**
 * Un movimiento no se registra contra un almacén desactivado: el saldo
 * quedaría en una bodega que el negocio ya no usa, y nadie lo miraría hasta el
 * próximo inventario físico.
 *
 * 404 y no 403 cuando no existe: para este tenant, un almacén de otro
 * simplemente no existe.
 */
export async function assertActiveWarehouse(
  tx: Prisma.TransactionClient,
  tenantId: string,
  warehouseId: string,
): Promise<void> {
  const warehouse = await tx.warehouse.findFirst({
    where: { id: warehouseId, tenantId },
    select: { isActive: true },
  });

  if (warehouse === null) {
    throw new NotFoundException({ message: "warehouses.not_found" });
  }
  if (!warehouse.isActive) {
    throw new UnprocessableEntityException({ message: "inventory.warehouse_inactive" });
  }
}
