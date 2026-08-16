import { ConflictException, Injectable, NotFoundException } from "@nestjs/common";
import { Prisma } from "../../generated/prisma/client";
import { PrismaService } from "../../infrastructure/prisma/prisma.service";
import { AuditService } from "../audit/audit.service";
import type { RequestMeta } from "../auth/auth.service";
import type { AuthUser } from "../auth/types/auth-user";
import type { CreateCatalogDto } from "./dto/create-catalog.dto";
import type { UpdateCatalogDto } from "./dto/update-catalog.dto";

export interface CatalogSummary {
  id: string;
  name: string;
  systemKey: string | null;
  isSystem: boolean;
  isActive: boolean;
}

/**
 * F2-CAT-02 — CRUD de catálogos del motor.
 *
 * Mismo molde que `RolesService`/`UsersAdminService`: cero SQL directo, todo
 * dentro de `withTenantContext`, `where` con `tenantId` además de la RLS
 * (defensa en profundidad) y auditoría en la MISMA transacción.
 *
 * ── Lo que este service protege ─────────────────────────────────────────
 * El **catálogo del sistema** (`isSystem`) es intocable: no se renombra ni se
 * archiva. Archivarlo dejaría al tenant sin dónde definir campos de producto
 * y apagaría el motor entero sin un error que lo explicara; renombrarlo
 * rompería la referencia estable que nombran los docs y el soporte. Los
 * subcatálogos, en cambio, son enteramente del tenant.
 *
 * Archivar (`isActive: false`) NO borra: los registros y los lookups que
 * apuntan a ellos siguen existiendo. Misma filosofía que `isArchived` de los
 * campos — quitar algo del medio nunca destruye datos del cliente.
 */
@Injectable()
export class CatalogsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditService: AuditService,
  ) {}

  async list(user: AuthUser): Promise<CatalogSummary[]> {
    return this.prisma.withTenantContext(user.tenantId, (tx) =>
      // El del sistema primero: es el que el 90% de los usuarios viene a
      // editar, y así el selector de la UI no necesita ordenarlo a mano.
      tx.catalog.findMany({ orderBy: [{ isSystem: "desc" }, { name: "asc" }] }),
    );
  }

  async create(
    user: AuthUser,
    input: CreateCatalogDto,
    meta: RequestMeta,
  ): Promise<CatalogSummary> {
    return this.prisma.withTenantContext(user.tenantId, async (tx) => {
      let catalog: CatalogSummary;
      try {
        // `systemKey`/`isSystem` NO se pasan: un catálogo creado por API es
        // siempre un subcatálogo. El único del sistema lo crea
        // `TenantsService.provision()`.
        catalog = await tx.catalog.create({
          data: { tenantId: user.tenantId, name: input.name },
        });
      } catch (error) {
        if (isUniqueViolation(error)) {
          throw new ConflictException({ message: "catalogs.name_taken" });
        }
        throw error;
      }

      await this.auditService.record(tx, {
        tenantId: user.tenantId,
        userId: user.userId,
        action: "catalogs.create",
        resourceType: "catalog",
        resourceId: catalog.id,
        after: { name: catalog.name },
        ip: meta.ip,
        userAgent: meta.userAgent,
      });

      return catalog;
    });
  }

  async update(
    user: AuthUser,
    id: string,
    input: UpdateCatalogDto,
    meta: RequestMeta,
  ): Promise<CatalogSummary> {
    return this.prisma.withTenantContext(user.tenantId, async (tx) => {
      const current = await tx.catalog.findFirst({ where: { id, tenantId: user.tenantId } });

      if (!current) {
        // 404 y no 403: confirmar que el id existe en OTRO tenant sería
        // filtrar información — mismo criterio que el resto de los módulos.
        throw new NotFoundException({ message: "catalogs.not_found" });
      }

      if (current.isSystem) {
        if (input.name !== undefined) {
          throw new ConflictException({ message: "catalogs.system_cannot_be_renamed" });
        }
        if (input.isActive === false) {
          throw new ConflictException({ message: "catalogs.system_cannot_be_archived" });
        }
      }

      let updated: CatalogSummary;
      try {
        updated = await tx.catalog.update({
          where: { id },
          data: {
            ...(input.name !== undefined ? { name: input.name } : {}),
            ...(input.isActive !== undefined ? { isActive: input.isActive } : {}),
          },
        });
      } catch (error) {
        if (isUniqueViolation(error)) {
          throw new ConflictException({ message: "catalogs.name_taken" });
        }
        throw error;
      }

      await this.auditService.record(tx, {
        tenantId: user.tenantId,
        userId: user.userId,
        action: "catalogs.update",
        resourceType: "catalog",
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
