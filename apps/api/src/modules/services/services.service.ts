import { ConflictException, Injectable, NotFoundException } from "@nestjs/common";
import { Prisma } from "../../generated/prisma/client";
import { PrismaService } from "../../infrastructure/prisma/prisma.service";
import { AuditService } from "../audit/audit.service";
import type { RequestMeta } from "../auth/auth.service";
import type { AuthUser } from "../auth/types/auth-user";
import type {
  CreateServiceDto,
  ListServicesQuery,
  UpdateServiceDto,
} from "./dto/upsert-service.dto";

/** Lo que sale al cliente. Los importes van como STRING, nunca como number. */
export interface ServiceSummary {
  id: string;
  code: string;
  name: string;
  description: string | null;
  cost: string | null;
  price: string | null;
  isActive: boolean;
  /** F3-SVC-07. En qué almacenes se ofrece. Vacío = no se vende en ninguno. */
  warehouseIds: string[];
}

/**
 * F3-SVC-03 — el catálogo de Servicios (CU-CAT-08).
 *
 * Mismo molde que `warehouses.service.ts`: todo dentro de `withTenantContext`,
 * `tenantId` en el WHERE además de la RLS, y auditoría en la misma transacción.
 *
 * A diferencia de los almacenes, acá SÍ hay DELETE: hoy nada referencia un
 * servicio, así que borrarlo no deja huérfanos. Cuando F4 traiga `sale_items`
 * eso cambia — ver el TODO de `remove`.
 */
@Injectable()
export class ServicesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditService: AuditService,
  ) {}

  async list(user: AuthUser, query?: ListServicesQuery): Promise<ServiceSummary[]> {
    const texto = query?.query;
    return this.prisma.withTenantContext(user.tenantId, async (tx) => {
      const rows = await tx.service.findMany({
        where: {
          tenantId: user.tenantId,
          // Por código O por nombre: quien dicta "manicura" por teléfono no
          // sabe que su código es MANI.
          ...(texto
            ? {
                OR: [
                  { code: { contains: texto, mode: "insensitive" as const } },
                  { name: { contains: texto, mode: "insensitive" as const } },
                ],
              }
            : {}),
        },
        orderBy: { name: "asc" },
        include: { warehouses: { select: { warehouseId: true } } },
      });
      return rows.map(toSummary);
    });
  }

  async create(
    user: AuthUser,
    input: CreateServiceDto,
    meta: RequestMeta,
  ): Promise<ServiceSummary> {
    return this.prisma.withTenantContext(user.tenantId, async (tx) => {
      let service: Awaited<ReturnType<typeof tx.service.create>>;
      try {
        service = await tx.service.create({
          data: {
            tenantId: user.tenantId,
            code: input.code,
            name: input.name,
            description: input.description ?? null,
            cost: input.cost ?? null,
            price: input.price ?? null,
          },
        });
      } catch (error) {
        if (isUniqueViolation(error)) {
          throw new ConflictException({ message: "services.code_taken" });
        }
        throw error;
      }

      // Todo en la MISMA tx que el servicio: como los almacenes viajan en el
      // mismo POST (viven en el form, no en una pantalla aparte), no existe el
      // estado intermedio "servicio creado sin asociar" que una segunda
      // llamada dejaría si fallara.
      await this.replaceWarehouses(tx, user.tenantId, service.id, input.warehouseIds);

      await this.auditService.record(tx, {
        tenantId: user.tenantId,
        userId: user.userId,
        action: "services.create",
        resourceType: "service",
        resourceId: service.id,
        after: {
          code: service.code,
          name: service.name,
          warehouseIds: input.warehouseIds,
        },
        ip: meta.ip,
        userAgent: meta.userAgent,
      });

      return { ...toSummary(service), warehouseIds: input.warehouseIds };
    });
  }

  async update(
    user: AuthUser,
    id: string,
    input: UpdateServiceDto,
    meta: RequestMeta,
  ): Promise<ServiceSummary> {
    return this.prisma.withTenantContext(user.tenantId, async (tx) => {
      const current = await tx.service.findFirst({ where: { id, tenantId: user.tenantId } });
      if (!current) {
        throw new NotFoundException({ message: "services.not_found" });
      }

      let updated: Awaited<ReturnType<typeof tx.service.update>>;
      try {
        updated = await tx.service.update({
          where: { id },
          data: {
            ...(input.code !== undefined ? { code: input.code } : {}),
            ...(input.name !== undefined ? { name: input.name } : {}),
            ...(input.description !== undefined ? { description: input.description ?? null } : {}),
            ...(input.cost !== undefined ? { cost: input.cost ?? null } : {}),
            ...(input.price !== undefined ? { price: input.price ?? null } : {}),
            ...(input.isActive !== undefined ? { isActive: input.isActive } : {}),
          },
        });
      } catch (error) {
        if (isUniqueViolation(error)) {
          throw new ConflictException({ message: "services.code_taken" });
        }
        throw error;
      }

      // Presente = REEMPLAZO completo del set (doctrina del repo, igual que
      // `roleIds` o el alcance de usuarios). Ausente = no tocar.
      if (input.warehouseIds !== undefined) {
        await this.replaceWarehouses(tx, user.tenantId, id, input.warehouseIds);
      }

      const warehouseIds = (
        await tx.serviceWarehouse.findMany({
          where: { serviceId: id },
          select: { warehouseId: true },
          orderBy: { warehouseId: "asc" },
        })
      ).map((fila) => fila.warehouseId);

      await this.auditService.record(tx, {
        tenantId: user.tenantId,
        userId: user.userId,
        action: "services.update",
        resourceType: "service",
        resourceId: id,
        before: { code: current.code, name: current.name, isActive: current.isActive },
        after: {
          code: updated.code,
          name: updated.name,
          isActive: updated.isActive,
          ...(input.warehouseIds !== undefined ? { warehouseIds } : {}),
        },
        ip: meta.ip,
        userAgent: meta.userAgent,
      });

      return { ...toSummary(updated), warehouseIds };
    });
  }

  /**
   * Borra de verdad. Hoy nadie referencia un servicio, así que no hay historia
   * que proteger — desactivar existe para esconderlo del POS sin perderlo.
   *
   * TODO(F4): cuando `sale_items` referencie servicios, esto necesita la guarda
   * 409 `services.has_sales` (contar ventas antes de borrar) y la FK debe ser
   * RESTRICT — mismo patrón que `products.remove` cerró en F3-GUARDS-02.
   */
  async remove(user: AuthUser, id: string, meta: RequestMeta): Promise<void> {
    await this.prisma.withTenantContext(user.tenantId, async (tx) => {
      const current = await tx.service.findFirst({ where: { id, tenantId: user.tenantId } });
      if (!current) {
        throw new NotFoundException({ message: "services.not_found" });
      }

      await tx.service.delete({ where: { id } });
      await this.auditService.record(tx, {
        tenantId: user.tenantId,
        userId: user.userId,
        action: "services.delete",
        resourceType: "service",
        resourceId: id,
        before: { code: current.code, name: current.name },
        ip: meta.ip,
        userAgent: meta.userAgent,
      });
    });
  }

  /**
   * Reemplaza el SET completo de almacenes de un servicio.
   *
   * Valida que existan, sean del tenant y estén ACTIVOS — mismo criterio que
   * `WarehouseScopeService.replace`: ofrecer un servicio en un almacén
   * desactivado sería prometer algo que el POS nunca va a mostrar. El `Set`
   * tolera ids repetidos en el input sin dar un 409 falso.
   */
  private async replaceWarehouses(
    tx: Prisma.TransactionClient,
    tenantId: string,
    serviceId: string,
    warehouseIds: readonly string[],
  ): Promise<void> {
    if (warehouseIds.length > 0) {
      const encontrados = await tx.warehouse.findMany({
        where: { id: { in: [...warehouseIds] }, tenantId, isActive: true },
        select: { id: true },
      });
      if (encontrados.length !== new Set(warehouseIds).size) {
        throw new ConflictException({ message: "services.warehouses_invalid" });
      }
    }

    await tx.serviceWarehouse.deleteMany({ where: { serviceId } });
    if (warehouseIds.length > 0) {
      await tx.serviceWarehouse.createMany({
        data: [...new Set(warehouseIds)].map((warehouseId) => ({
          serviceId,
          warehouseId,
          tenantId,
        })),
      });
    }
  }
}

function toSummary(row: {
  id: string;
  code: string;
  name: string;
  description: string | null;
  cost: Prisma.Decimal | null;
  price: Prisma.Decimal | null;
  isActive: boolean;
  warehouses?: { warehouseId: string }[];
}): ServiceSummary {
  return {
    id: row.id,
    code: row.code,
    name: row.name,
    description: row.description,
    // String y no number: un Decimal serializado a number pierde precisión.
    cost: row.cost?.toString() ?? null,
    price: row.price?.toString() ?? null,
    isActive: row.isActive,
    warehouseIds: (row.warehouses ?? []).map((fila) => fila.warehouseId),
  };
}

function isUniqueViolation(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002";
}
