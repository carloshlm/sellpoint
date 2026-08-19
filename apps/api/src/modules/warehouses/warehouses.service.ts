import { ConflictException, Injectable, NotFoundException } from "@nestjs/common";
import { Prisma } from "../../generated/prisma/client";
import { PrismaService } from "../../infrastructure/prisma/prisma.service";
import type { UserScope } from "../../infrastructure/warehouse-scope/request-warehouse-scope";
import { AuditService } from "../audit/audit.service";
import type { RequestMeta } from "../auth/auth.service";
import type { AuthUser } from "../auth/types/auth-user";
import { warehouseScopeWhere } from "../inventory/warehouse-scope.helpers";
import type { CreateWarehouseDto, UpdateWarehouseDto } from "./dto/upsert-warehouse.dto";

export interface WarehouseSummary {
  id: string;
  name: string;
  address: string | null;
  isActive: boolean;
}

/**
 * F3-GUARDS-03. Por qué este almacén no se puede desactivar, o `null` si sí.
 *
 * Es un motivo y no dos banderas porque `update` corta en el saldo antes de
 * mirar los traspasos: dos banderas prometerían un orden que la guarda no
 * respeta. Esto dice exactamente con qué error se va a chocar.
 */
export type DeactivationBlock = "stock" | "transfers_in_transit" | null;

export interface WarehouseListItem extends WarehouseSummary {
  deactivationBlockedBy: DeactivationBlock;
}

/**
 * F2-WH-01. Mismo molde que el resto: `withTenantContext`, `where` con
 * `tenantId` además de la RLS y auditoría en la misma transacción.
 *
 * NO hay DELETE: desactivar (`isActive: false`) es la salida. Borrar un
 * almacén se llevaría por CASCADE su stock y los alcances de usuario que lo
 * referencian — y el histórico de movimientos de F3 quedaría apuntando a la
 * nada.
 *
 * La validación "no desactivar con stock pendiente" (CU-ALM-02) llega con F3:
 * hoy no hay movimientos que puedan dejar saldo.
 */
@Injectable()
export class WarehousesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditService: AuditService,
  ) {}

  /**
   * F3-GUARDS-03: el listado trae, además del almacén, el motivo por el que no
   * se puede cerrar. El criterio del módulo es que la UI muestre la guarda
   * ANTES del clic — sin esto, la única forma de enterarse sería chocando con
   * el 409, y para entonces el usuario ya creyó que iba a poder.
   *
   * Los dos agregados replican la condición de `update`, en el mismo orden.
   */
  async list(user: AuthUser): Promise<WarehouseListItem[]> {
    return this.prisma.withTenantContext(user.tenantId, async (tx) => {
      const [warehouses, conSaldo, enTransito] = await Promise.all([
        tx.warehouse.findMany({ orderBy: { name: "asc" } }),
        tx.stockByWarehouse.groupBy({
          by: ["warehouseId"],
          where: { quantity: { gt: 0 } },
          _sum: { quantity: true },
        }),
        tx.transfer.findMany({
          where: { status: "in_transit" },
          select: { originWarehouseId: true, destinationWarehouseId: true },
        }),
      ]);

      const idsConSaldo = new Set(
        conSaldo.filter((fila) => fila._sum.quantity?.greaterThan(0)).map((f) => f.warehouseId),
      );
      const idsEnTransito = new Set(
        enTransito.flatMap((t) => [t.originWarehouseId, t.destinationWarehouseId]),
      );

      return warehouses.map((warehouse) => ({
        ...warehouse,
        // Uno ya desactivado no tiene bloqueo que mostrar: la guarda solo
        // corre al pasar de activo a inactivo, igual que aquí.
        deactivationBlockedBy: !warehouse.isActive
          ? null
          : idsConSaldo.has(warehouse.id)
            ? "stock"
            : idsEnTransito.has(warehouse.id)
              ? "transfers_in_transit"
              : null,
      }));
    });
  }

  /**
   * F3-CORE-03: los almacenes ACTIVOS dentro del alcance del usuario, que es
   * lo que alimenta los selectores de movimientos. Un almacén desactivado no
   * aparece aunque esté en el alcance: no se puede mover stock contra él.
   */
  async listScoped(user: AuthUser, scope: UserScope): Promise<WarehouseSummary[]> {
    return this.prisma.withTenantContext(user.tenantId, (tx) =>
      tx.warehouse.findMany({
        where: { isActive: true, ...warehouseScopeWhere(scope) },
        orderBy: { name: "asc" },
      }),
    );
  }

  async create(
    user: AuthUser,
    input: CreateWarehouseDto,
    meta: RequestMeta,
  ): Promise<WarehouseSummary> {
    return this.prisma.withTenantContext(user.tenantId, async (tx) => {
      let warehouse: WarehouseSummary;
      try {
        warehouse = await tx.warehouse.create({
          data: { tenantId: user.tenantId, name: input.name, address: input.address ?? null },
        });
      } catch (error) {
        if (isUniqueViolation(error)) {
          throw new ConflictException({ message: "warehouses.name_taken" });
        }
        throw error;
      }

      await this.auditService.record(tx, {
        tenantId: user.tenantId,
        userId: user.userId,
        action: "warehouses.create",
        resourceType: "warehouse",
        resourceId: warehouse.id,
        after: { name: warehouse.name },
        ip: meta.ip,
        userAgent: meta.userAgent,
      });

      return warehouse;
    });
  }

  async update(
    user: AuthUser,
    id: string,
    input: UpdateWarehouseDto,
    meta: RequestMeta,
  ): Promise<WarehouseSummary> {
    return this.prisma.withTenantContext(user.tenantId, async (tx) => {
      const current = await tx.warehouse.findFirst({ where: { id, tenantId: user.tenantId } });

      if (!current) {
        throw new NotFoundException({ message: "warehouses.not_found" });
      }

      // F3-GUARDS-03 (CU-ALM-02): un almacén con mercancía adentro no se
      // cierra. Desactivarlo lo saca de los selectores, y el saldo quedaría
      // ahí sin que nadie pudiera sacarlo ni verlo — una pérdida silenciosa.
      // Primero hay que vaciarlo, y el error dice cuánto falta mover.
      if (input.isActive === false && current.isActive) {
        const [saldo, enTransito] = await Promise.all([
          tx.stockByWarehouse.aggregate({
            where: { warehouseId: id, quantity: { gt: 0 } },
            _sum: { quantity: true },
          }),
          // Origen O destino: si es destino hay mercancía en camino que nadie
          // podría recibir; si es origen, un traspaso sin quien lo despache.
          tx.transfer.count({
            where: {
              status: "in_transit",
              OR: [{ originWarehouseId: id }, { destinationWarehouseId: id }],
            },
          }),
        ]);

        const total = saldo._sum.quantity;
        if (total?.greaterThan(0)) {
          throw new ConflictException({
            message: "warehouses.has_stock",
            total: total.toString(),
          });
        }
        if (enTransito > 0) {
          throw new ConflictException({ message: "warehouses.has_transfers_in_transit" });
        }
      }

      let updated: WarehouseSummary;
      try {
        updated = await tx.warehouse.update({
          where: { id },
          data: {
            ...(input.name !== undefined ? { name: input.name } : {}),
            ...(input.address !== undefined ? { address: input.address } : {}),
            ...(input.isActive !== undefined ? { isActive: input.isActive } : {}),
          },
        });
      } catch (error) {
        if (isUniqueViolation(error)) {
          throw new ConflictException({ message: "warehouses.name_taken" });
        }
        throw error;
      }

      await this.auditService.record(tx, {
        tenantId: user.tenantId,
        userId: user.userId,
        action: "warehouses.update",
        resourceType: "warehouse",
        resourceId: id,
        before: { name: current.name, isActive: current.isActive },
        after: { name: updated.name, isActive: updated.isActive },
        ip: meta.ip,
        userAgent: meta.userAgent,
      });

      return updated;
    });
  }
}

function isUniqueViolation(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002";
}
