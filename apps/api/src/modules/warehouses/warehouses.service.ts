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

  async list(user: AuthUser): Promise<WarehouseSummary[]> {
    return this.prisma.withTenantContext(user.tenantId, (tx) =>
      tx.warehouse.findMany({ orderBy: { name: "asc" } }),
    );
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
