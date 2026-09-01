import { ConflictException, Injectable, NotFoundException } from "@nestjs/common";
import { Prisma } from "../../generated/prisma/client";
import { PrismaService } from "../../infrastructure/prisma/prisma.service";
import type { UserScope } from "../../infrastructure/warehouse-scope/request-warehouse-scope";
import { AuditService } from "../audit/audit.service";
import type { RequestMeta } from "../auth/auth.service";
import type { AuthUser } from "../auth/types/auth-user";
import { assertSystemCatalogAttributes } from "../catalogs/attribute-assertions";
import { warehouseScopeWhere } from "../inventory/warehouse-scope.helpers";
import { WAREHOUSES_CATALOG_KEY } from "../tenants/role-catalog";
import type { CreateWarehouseDto, UpdateWarehouseDto } from "./dto/upsert-warehouse.dto";

export interface WarehouseSummary {
  id: string;
  /** El código estándar, único por negocio (Carlos, 2026-09-01). */
  code: string;
  name: string;
  address: string | null;
  phone: string | null;
  email: string | null;
  /** Campos dinámicos del catálogo de sistema "warehouses" (2026-08-26). */
  attributes: unknown;
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
  /**
   * El código no se repite en el negocio. Se pregunta ANTES del INSERT y no
   * solo por el índice único: Prisma no siempre dice en el P2002 QUÉ índice
   * chocó, y «ya tienes uno con ese nombre» cuando lo repetido era el código
   * manda a corregir el campo equivocado. El índice sigue siendo la guarda
   * real ante dos altas simultáneas.
   */
  private async assertCodeFree(
    tx: Prisma.TransactionClient,
    tenantId: string,
    code: string,
  ): Promise<void> {
    const repetido = await tx.warehouse.findFirst({
      where: { tenantId, code },
      select: { id: true },
    });
    if (repetido !== null) {
      throw new ConflictException({ message: "warehouses.code_taken" });
    }
  }

  /**
   * El siguiente código de la serie `ALM-NNN` del negocio (Carlos,
   * 2026-09-01). Se mira el MAYOR número ya usado y no la cantidad de
   * almacenes: si alguien borró el ALM-002, contar daría otra vez ALM-002 y
   * chocaría con el índice único de un ALM-003 que sí existe.
   *
   * Los códigos capturados a mano que no siguen el patrón (`NORTE-01`) no
   * cuentan para la serie — son de la persona, no del sistema.
   */
  private async nextCode(tx: Prisma.TransactionClient, tenantId: string): Promise<string> {
    const [fila] = await tx.$queryRaw<{ max: number | null }[]>`
      SELECT MAX(substring(code FROM '^ALM-(\\d+)$')::int) AS max
        FROM warehouses
       WHERE tenant_id = ${tenantId}::uuid
         AND code ~ '^ALM-\\d+$'`;
    const siguiente = (fila?.max ?? 0) + 1;
    return `ALM-${String(siguiente).padStart(3, "0")}`;
  }

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
      if (input.attributes !== undefined) {
        await assertSystemCatalogAttributes(tx, user, WAREHOUSES_CATALOG_KEY, input.attributes, {
          invalid: "warehouses.invalid_attributes",
          catalogMissing: "warehouses.catalog_missing",
        });
      }

      if (input.code !== undefined) {
        await this.assertCodeFree(tx, user.tenantId, input.code);
      }

      let warehouse: WarehouseSummary;
      try {
        warehouse = await tx.warehouse.create({
          data: {
            tenantId: user.tenantId,
            // Sin código en el alta (onboarding, otro cliente del API) se
            // genera el siguiente de la serie del negocio.
            code: input.code ?? (await this.nextCode(tx, user.tenantId)),
            name: input.name,
            address: input.address ?? null,
            phone: input.phone ?? null,
            email: input.email ?? null,
            ...(input.attributes !== undefined
              ? { attributes: input.attributes as Prisma.InputJsonValue }
              : {}),
          },
        });
      } catch (error) {
        const campo = uniqueViolationOn(error);
        if (campo !== null) {
          throw new ConflictException({
            message: campo === "code" ? "warehouses.code_taken" : "warehouses.name_taken",
          });
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
          // `total` viaja DOS veces a propósito: suelto en el payload (dato
          // para quien consuma el API) y en `args` (insumo del filter para
          // interpolar el mensaje — sin esto la pantalla mostraba «{total}»
          // crudo, captura de Carlos 2026-08-25).
          throw new ConflictException({
            message: "warehouses.has_stock",
            total: total.toString(),
            args: { total: total.toString() },
          });
        }
        if (enTransito > 0) {
          throw new ConflictException({ message: "warehouses.has_transfers_in_transit" });
        }
      }

      if (input.attributes !== undefined) {
        await assertSystemCatalogAttributes(tx, user, WAREHOUSES_CATALOG_KEY, input.attributes, {
          invalid: "warehouses.invalid_attributes",
          catalogMissing: "warehouses.catalog_missing",
        });
      }

      if (input.code !== undefined && input.code !== current.code) {
        await this.assertCodeFree(tx, user.tenantId, input.code);
      }

      let updated: WarehouseSummary;
      try {
        updated = await tx.warehouse.update({
          where: { id },
          data: {
            ...(input.code !== undefined ? { code: input.code } : {}),
            ...(input.name !== undefined ? { name: input.name } : {}),
            ...(input.address !== undefined ? { address: input.address } : {}),
            ...(input.phone !== undefined ? { phone: input.phone } : {}),
            ...(input.email !== undefined ? { email: input.email } : {}),
            ...(input.attributes !== undefined
              ? { attributes: input.attributes as Prisma.InputJsonValue }
              : {}),
            ...(input.isActive !== undefined ? { isActive: input.isActive } : {}),
          },
        });
      } catch (error) {
        const campo = uniqueViolationOn(error);
        if (campo !== null) {
          throw new ConflictException({
            message: campo === "code" ? "warehouses.code_taken" : "warehouses.name_taken",
          });
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

  /**
   * Eliminar de verdad (Carlos, 2026-08-25) — solo un almacén que NUNCA operó.
   *
   * La guarda es la de la casa (products.has_movements, F3-GUARDS): con
   * historia detrás no se borra, porque el kardex, los folios y los cortes lo
   * referencian y el histórico no se reescribe. Las FK `Restrict` son la red;
   * este chequeo es la puerta amable con el motivo. La salida no destructiva
   * sigue siendo desactivarlo.
   *
   * Lo que NO cuenta como historia se lo lleva el delete por diseño: el scope
   * de usuarios y el vínculo con servicios (FK `Cascade`), y el almacén
   * asignado de un usuario (FK `SetNull`) — configuración que apunta a un
   * almacén muerto, no hechos que haya que preservar.
   */
  async remove(user: AuthUser, id: string, meta: RequestMeta): Promise<void> {
    return this.prisma.withTenantContext(user.tenantId, async (tx) => {
      const current = await tx.warehouse.findFirst({ where: { id, tenantId: user.tenantId } });

      if (!current) {
        throw new NotFoundException({ message: "warehouses.not_found" });
      }

      // Todas las formas de tener historia — incluidas las VINCULADAS, donde
      // este almacén es la contraparte de un movimiento o documento ajeno. Un
      // BORRADOR también cuenta: ya tomó folio de la serie.
      const historia = (
        await Promise.all([
          tx.inventoryDocument.count({ where: { warehouseId: id } }),
          tx.inventoryDocument.count({ where: { linkedWarehouseId: id } }),
          tx.stockMovement.count({ where: { warehouseId: id } }),
          tx.stockMovement.count({ where: { linkedWarehouseId: id } }),
          tx.transfer.count({ where: { originWarehouseId: id } }),
          tx.transfer.count({ where: { destinationWarehouseId: id } }),
          tx.sale.count({ where: { warehouseId: id } }),
          tx.quote.count({ where: { warehouseId: id } }),
          tx.cashboxSession.count({ where: { warehouseId: id } }),
        ])
      ).reduce((sum, count) => sum + count, 0);
      if (historia > 0) {
        throw new ConflictException({ message: "warehouses.has_history" });
      }

      await tx.warehouse.delete({ where: { id } });

      await this.auditService.record(tx, {
        tenantId: user.tenantId,
        userId: user.userId,
        action: "warehouses.delete",
        resourceType: "warehouse",
        resourceId: id,
        before: { name: current.name, isActive: current.isActive },
        ip: meta.ip,
        userAgent: meta.userAgent,
      });
    });
  }
}

/**
 * Qué índice único chocó: `code` o `name`. Los dos son únicos por negocio y
 * el usuario merece saber CUÁL repitió — «ya tienes uno con ese nombre»
 * cuando lo repetido era el código lo manda a corregir el campo equivocado.
 */
function uniqueViolationOn(error: unknown): "code" | "name" | null {
  if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== "P2002") {
    return null;
  }
  const target = (error.meta as { target?: string[] | string } | undefined)?.target;
  const columnas = Array.isArray(target) ? target : [String(target ?? "")];
  return columnas.some((c) => c.includes("code")) ? "code" : "name";
}
