import { ConflictException, Injectable, NotFoundException } from "@nestjs/common";
import { Prisma } from "../../generated/prisma/client";
import { PrismaService } from "../../infrastructure/prisma/prisma.service";
import type { UserScope } from "../../infrastructure/warehouse-scope/request-warehouse-scope";
import { AuditService } from "../audit/audit.service";
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

export interface ExpiringRow {
  productId: string;
  sku: string;
  name: string;
  lot: { id: string; lotCode: string; expiresAt: Date };
  warehouse: { id: string; name: string };
  location: string;
  quantity: string;
  /** Negativo si ya venció. */
  daysLeft: number;
  expired: boolean;
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
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditService: AuditService,
  ) {}

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

  /**
   * F3-LOTS-04 — corregir un lote mal cargado.
   *
   * **Cambiar `expiresAt` cambia qué se vende primero.** No es una edición
   * cosmética: FEFO ordena por caducidad, así que corregir una fecha reordena
   * TODO el stock de ese lote en todos los almacenes, y la próxima salida va a
   * tomar otra partida. Por eso se audita con `before`/`after`: sin el
   * "antes", nadie podría explicar por qué el orden de salida cambió de un día
   * para el otro.
   *
   * Un lote NO se borra. Los movimientos lo referencian y el histórico no se
   * reescribe (FK `Restrict`); sin saldo simplemente deja de aparecer con
   * `withStock=true`, que es el comportamiento que la pantalla ya usa.
   */
  async updateLot(
    user: AuthUser,
    productId: string,
    lotId: string,
    input: { lotCode?: string; expiresAt?: string | null },
    meta: { ip?: string; userAgent?: string } = {},
  ) {
    return this.prisma.withTenantContext(user.tenantId, async (tx) => {
      const lote = await tx.productLot.findFirst({
        where: { id: lotId, productId, tenantId: user.tenantId },
        select: { id: true, lotCode: true, expiresAt: true },
      });
      if (lote === null) {
        throw new NotFoundException({ message: "inventory.lot_not_found" });
      }

      if (input.lotCode !== undefined && input.lotCode !== lote.lotCode) {
        const tomado = await tx.productLot.findFirst({
          where: { productId, tenantId: user.tenantId, lotCode: input.lotCode },
          // La CADUCIDAD es lo que distingue a un lote de otro en la pantalla:
          // sin ella el mensaje dice «ya lo usa otro lote» y el usuario, que
          // está viendo dos renglones, no sabe cuál de los dos choca
          // (Carlos, 2026-08-24: «el mensaje es confuso»).
          select: { id: true, lotCode: true, expiresAt: true },
        });
        if (tomado !== null) {
          throw new ConflictException({
            // Dos mensajes y no uno con «(sin caducidad)» pegado: una frase
            // que cambia de forma según los datos se lee peor que dos frases
            // escritas para su caso.
            message:
              tomado.expiresAt === null
                ? "inventory.lot_code_taken_no_expiry"
                : "inventory.lot_code_taken",
            args: {
              lotCode: tomado.lotCode,
              expiresAt: tomado.expiresAt?.toISOString().slice(0, 10) ?? "",
            },
          });
        }
      }

      const nuevaFecha =
        input.expiresAt === undefined
          ? undefined
          : input.expiresAt === null
            ? null
            : new Date(input.expiresAt);

      const actualizado = await tx.productLot.update({
        where: { id: lotId },
        data: {
          ...(input.lotCode !== undefined ? { lotCode: input.lotCode } : {}),
          ...(nuevaFecha !== undefined ? { expiresAt: nuevaFecha } : {}),
        },
        select: { id: true, lotCode: true, expiresAt: true },
      });

      const fecha = (value: Date | null) => value?.toISOString().slice(0, 10) ?? null;
      await this.auditService.record(tx, {
        tenantId: user.tenantId,
        userId: user.userId,
        action: "inventory.lot_update",
        resourceType: "product_lot",
        resourceId: lotId,
        before: { lotCode: lote.lotCode, expiresAt: fecha(lote.expiresAt) },
        after: { lotCode: actualizado.lotCode, expiresAt: fecha(actualizado.expiresAt) },
        ip: meta.ip,
        userAgent: meta.userAgent,
      });

      return { ...actualizado, expiresAt: fecha(actualizado.expiresAt) };
    });
  }

  /**
   * Lo que está por vencerse — y lo que YA venció.
   *
   * **Sin cron y sin notificaciones, a propósito.** Es una consulta que la
   * pantalla hace cuando alguien la abre. Un job que manda mails es una
   * decisión de producto (y de costos) que F5/F6 tomarán con más información;
   * construir esa maquinaria ahora sería infraestructura para una necesidad
   * que todavía nadie expresó.
   *
   * Lo ya vencido aparece SIEMPRE, sin importar el `days` pedido: sigue en el
   * estante y hay que sacarlo. Esconderlo porque "ya pasó" es exactamente el
   * error que esta consulta viene a evitar.
   *
   * Los lotes SIN caducidad no aparecen nunca: no vencen, así que no hay nada
   * que alertar.
   */
  async listExpiring(
    user: AuthUser,
    scope: UserScope,
    options: { days: number; warehouseId?: string },
  ): Promise<ExpiringRow[]> {
    if (options.warehouseId !== undefined) {
      assertWarehouseInScope(scope, options.warehouseId);
    }

    // Medianoche UTC: `expires_at` es una columna DATE y compararla contra un
    // instante con hora correría el corte según el huso del servidor.
    const hoy = new Date();
    hoy.setUTCHours(0, 0, 0, 0);
    const limite = new Date(hoy);
    limite.setUTCDate(limite.getUTCDate() + options.days);

    return this.prisma.withTenantContext(user.tenantId, async (tx) => {
      const rows = await tx.stockLot.findMany({
        where: {
          tenantId: user.tenantId,
          quantity: { gt: 0 },
          ...this.stockWhere(scope, options.warehouseId),
          lot: { expiresAt: { not: null, lte: limite } },
        },
        select: {
          location: true,
          quantity: true,
          warehouse: { select: { id: true, name: true } },
          lot: {
            select: {
              id: true,
              lotCode: true,
              expiresAt: true,
              product: { select: { id: true, sku: true, name: true } },
            },
          },
        },
        orderBy: [{ lot: { expiresAt: "asc" } }, { lot: { lotCode: "asc" } }],
      });

      const MS_POR_DIA = 24 * 60 * 60 * 1000;

      return rows.map((row) => {
        const expiresAt = row.lot.expiresAt as Date;
        const daysLeft = Math.round((expiresAt.getTime() - hoy.getTime()) / MS_POR_DIA);

        return {
          productId: row.lot.product.id,
          sku: row.lot.product.sku,
          name: row.lot.product.name,
          lot: { id: row.lot.id, lotCode: row.lot.lotCode, expiresAt },
          warehouse: row.warehouse,
          location: row.location,
          quantity: row.quantity.toString(),
          daysLeft,
          expired: daysLeft < 0,
        };
      });
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
