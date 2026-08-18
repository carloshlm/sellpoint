import { Injectable, NotFoundException } from "@nestjs/common";
import { Prisma } from "../../generated/prisma/client";
import { PrismaService } from "../../infrastructure/prisma/prisma.service";
import type { UserScope } from "../../infrastructure/warehouse-scope/request-warehouse-scope";
import type { AuthUser } from "../auth/types/auth-user";
import { assertWarehouseInScope } from "./warehouse-scope.helpers";

export interface LotStockRow {
  warehouseId: string;
  warehouseName: string;
  location: string;
  quantity: string;
}

export interface ProductLotRow {
  id: string;
  lotCode: string;
  expiresAt: Date | null;
  totalQuantity: string;
  byWarehouse: LotStockRow[];
}

export interface ListLotsOptions {
  withStock?: boolean;
  warehouseId?: string;
}

/**
 * F3-LOTS-02 — consultar lotes y ubicaciones.
 *
 * Los dos endpoints existen para ALIMENTAR pantallas: el selector de "forzar
 * lote" de una salida y el autocompletado de ubicación de una entrada. Eso
 * explica dos decisiones que si no parecerían arbitrarias:
 *
 *  · el orden es **FEFO**, el mismo de `resolveLotsFefo`, y no alfabético.
 *    Quien elige un lote a mano quiere ver primero el que se vence antes —el
 *    que el sistema habría elegido solo—, y ofrecerle otro orden lo empujaría
 *    a contradecir la regla sin querer;
 *  · las ubicaciones salen de lo YA USADO y no de un catálogo. Son texto
 *    libre a propósito: un catálogo de ubicaciones obligaría a darlas de alta
 *    antes de poder guardar la primera caja en un estante.
 */
@Injectable()
export class LotsService {
  constructor(private readonly prisma: PrismaService) {}

  async listProductLots(
    user: AuthUser,
    scope: UserScope,
    productId: string,
    options: ListLotsOptions = {},
  ): Promise<ProductLotRow[]> {
    if (options.warehouseId !== undefined) {
      assertWarehouseInScope(scope, options.warehouseId);
    }

    return this.prisma.withTenantContext(user.tenantId, async (tx) => {
      const product = await tx.product.findFirst({
        where: { id: productId, tenantId: user.tenantId },
        select: { id: true },
      });
      if (product === null) {
        throw new NotFoundException({ message: "products.not_found" });
      }

      const lots = await tx.productLot.findMany({
        where: { productId, tenantId: user.tenantId },
        // El MISMO orden que `resolveLotsFefo`: `expires_at ASC NULLS LAST` con
        // desempate por código. Un lote sin caducidad no es "el más urgente"
        // sino lo contrario — no corre riesgo de vencerse, así que va al final.
        orderBy: [{ expiresAt: { sort: "asc", nulls: "last" } }, { lotCode: "asc" }],
        select: {
          id: true,
          lotCode: true,
          expiresAt: true,
          stock: {
            where: this.stockWhere(scope, options.warehouseId),
            select: {
              location: true,
              quantity: true,
              warehouse: { select: { id: true, name: true } },
            },
            orderBy: [{ warehouseId: "asc" }, { location: "asc" }],
          },
        },
      });

      const rows = lots.map((lot) => {
        const byWarehouse = lot.stock.map((stock) => ({
          warehouseId: stock.warehouse.id,
          warehouseName: stock.warehouse.name,
          location: stock.location,
          quantity: stock.quantity.toString(),
        }));
        const total = byWarehouse.reduce(
          (acc, stock) => acc.plus(new Prisma.Decimal(stock.quantity)),
          new Prisma.Decimal(0),
        );

        return {
          id: lot.id,
          lotCode: lot.lotCode,
          expiresAt: lot.expiresAt,
          totalQuantity: total.toString(),
          byWarehouse,
        };
      });

      // `withStock` mira el TOTAL ya acotado, no la existencia de filas: un
      // lote con una fila en cero está agotado igual, y ofrecerlo en el
      // selector sería ofrecer algo de lo que no se puede sacar nada.
      return options.withStock === true
        ? rows.filter((row) => new Prisma.Decimal(row.totalQuantity).greaterThan(0))
        : rows;
    });
  }

  /**
   * Las ubicaciones ya usadas en un almacén, sin repetir.
   *
   * El `''` se excluye: es el centinela de "sin ubicación" (entra en la PK de
   * `stock_lots`, por eso no puede ser NULL), no una ubicación real. Ofrecerlo
   * para autocompletar sería sugerir escribir la cadena vacía.
   */
  async listWarehouseLocations(
    user: AuthUser,
    scope: UserScope,
    warehouseId: string,
  ): Promise<string[]> {
    return this.prisma.withTenantContext(user.tenantId, async (tx) => {
      const warehouse = await tx.warehouse.findFirst({
        where: { id: warehouseId, tenantId: user.tenantId },
        select: { id: true },
      });
      if (warehouse === null) {
        throw new NotFoundException({ message: "warehouses.not_found" });
      }
      // Después del 404: para este tenant, un almacén ajeno simplemente no
      // existe, y decir "no tenés acceso" confirmaría que sí existe.
      assertWarehouseInScope(scope, warehouseId);

      const rows = await tx.stockLot.findMany({
        where: { warehouseId, tenantId: user.tenantId, location: { not: "" } },
        distinct: ["location"],
        select: { location: true },
        orderBy: { location: "asc" },
      });

      return rows.map((row) => row.location);
    });
  }

  /** El saldo que el usuario puede VER: su alcance, acotado si pidió un almacén. */
  private stockWhere(scope: UserScope, warehouseId?: string): Prisma.StockLotWhereInput {
    if (warehouseId !== undefined) {
      return { warehouseId };
    }
    return scope.warehouseIds === "all" ? {} : { warehouseId: { in: scope.warehouseIds } };
  }
}
