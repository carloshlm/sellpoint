import { ConflictException, Injectable, NotFoundException } from "@nestjs/common";
import { Prisma } from "../../generated/prisma/client";
import { PrismaService } from "../../infrastructure/prisma/prisma.service";
import { AuditService } from "../audit/audit.service";
import type { RequestMeta } from "../auth/auth.service";
import type { AuthUser } from "../auth/types/auth-user";

/**
 * F2-SCOPE-02 — alcance por almacén de un usuario (CU-SYS-04).
 *
 * El SET se reemplaza completo, no por delta: la UI muestra una lista de
 * checkboxes y guarda lo que quedó marcado. Mismo criterio que `roleIds` en
 * el alta de usuarios.
 *
 * Lista VACÍA es un estado válido y significativo: sin filas, el interceptor
 * le da acceso a todos los almacenes (default permisivo, F2-SCOPE-01). O sea
 * que "quitar todos los alcances" es literalmente "sacarle la restricción".
 */
@Injectable()
export class WarehouseScopeService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditService: AuditService,
  ) {}

  async get(actor: AuthUser, userId: string): Promise<string[]> {
    return this.prisma.withTenantContext(actor.tenantId, async (tx) => {
      await this.findUserOrFail(tx, actor, userId);
      const scopes = await tx.userWarehouseScope.findMany({
        where: { userId },
        select: { warehouseId: true },
      });
      return scopes.map((scope) => scope.warehouseId);
    });
  }

  async replace(
    actor: AuthUser,
    userId: string,
    warehouseIds: string[],
    meta: RequestMeta,
  ): Promise<string[]> {
    return this.prisma.withTenantContext(actor.tenantId, async (tx) => {
      await this.findUserOrFail(tx, actor, userId);

      // Todos los almacenes tienen que existir, estar activos y ser del mismo
      // tenant. La FK garantiza lo último; que estén VIVOS no, y asignar un
      // alcance hacia un almacén desactivado dejaría al usuario sin ver nada
      // sin explicación.
      if (warehouseIds.length > 0) {
        const found = await tx.warehouse.findMany({
          where: { id: { in: warehouseIds }, tenantId: actor.tenantId, isActive: true },
          select: { id: true },
        });
        if (found.length !== new Set(warehouseIds).size) {
          throw new ConflictException({ message: "users.warehouse_scope_invalid" });
        }
      }

      // F3-HOME-01: encoger el alcance por debajo del almacén ASIGNADO da 409
      // EXPLÍCITO y no lo limpia solo. En F4 el turno de caja depende del
      // asignado: limpiarlo por atrás dejaría al vendedor varado a mitad de
      // turno sin ninguna explicación. Que el Admin decida primero.
      if (warehouseIds.length > 0) {
        const usuario = await tx.user.findFirst({
          where: { id: userId, tenantId: actor.tenantId },
          select: { defaultWarehouseId: true },
        });
        if (usuario?.defaultWarehouseId && !warehouseIds.includes(usuario.defaultWarehouseId)) {
          throw new ConflictException({ message: "users.default_warehouse_out_of_scope" });
        }
      }

      await tx.userWarehouseScope.deleteMany({ where: { userId } });
      if (warehouseIds.length > 0) {
        await tx.userWarehouseScope.createMany({
          data: warehouseIds.map((warehouseId) => ({
            userId,
            warehouseId,
            tenantId: actor.tenantId,
          })),
        });
      }

      await this.auditService.record(tx, {
        tenantId: actor.tenantId,
        userId: actor.userId,
        action: "users.warehouse_scope_replace",
        resourceType: "user",
        resourceId: userId,
        after: { warehouseIds },
        ip: meta.ip,
        userAgent: meta.userAgent,
      });

      return warehouseIds;
    });
  }

  private async findUserOrFail(
    tx: Prisma.TransactionClient,
    actor: AuthUser,
    userId: string,
  ): Promise<{ id: string }> {
    const user = await tx.user.findFirst({
      where: { id: userId, tenantId: actor.tenantId },
      select: { id: true },
    });

    if (!user) {
      throw new NotFoundException({ message: "users.not_found" });
    }

    return user;
  }
}
