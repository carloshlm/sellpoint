import { Injectable } from "@nestjs/common";
import { PrismaService } from "../../infrastructure/prisma/prisma.service";
import { AuditService } from "../audit/audit.service";
import {
  INITIAL_WAREHOUSE_NAME,
  PRODUCTS_CATALOG_KEY,
  PRODUCTS_CATALOG_NAME,
  PROVISIONAL_TENANT_NAME,
  resolveRolePermissionCodes,
  TENANT_ROLE_NAMES,
} from "./role-catalog";

export interface ProvisionTenantInput {
  tenantName?: string;
  currency?: string;
  ownerEmail: string;
  // Ya hasheado por el caller (AuthService), FUERA de esta transacción —
  // argon2 (~80-150ms) nunca corre dentro de un $transaction (AD-1).
  ownerPasswordHash: string;
  firstName: string;
  lastNamePaternal: string;
  lastNameMaternal?: string;
  locale?: "es" | "en";
  ip?: string;
  userAgent?: string;
}

export interface ProvisionTenantResult {
  tenantId: string;
  userId: string;
}

/**
 * f1-auth design §4 (POST /auth/register-tenant): tenant + owner + 4 roles
 * base + audit, en UNA sola transacción. Único lugar del sistema que usa
 * `withNewTenantContext` — el tenant no existe todavía al abrir la tx.
 */
@Injectable()
export class TenantsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditService: AuditService,
  ) {}

  async provision(input: ProvisionTenantInput): Promise<ProvisionTenantResult> {
    return this.prisma.withNewTenantContext(async (tx, setTenantContext) => {
      const tenant = await tx.tenant.create({
        data: {
          name: input.tenantName ?? PROVISIONAL_TENANT_NAME[input.locale ?? "es"],
          currency: input.currency ?? "MXN",
        },
      });

      // Justo después del insert de tenant, antes de tocar CUALQUIER tabla
      // con RLS (users, roles, audit_logs) — design §4.
      await setTenantContext(tenant.id);

      const owner = await tx.user.create({
        data: {
          tenantId: tenant.id,
          email: input.ownerEmail,
          passwordHash: input.ownerPasswordHash,
          firstName: input.firstName,
          lastNamePaternal: input.lastNamePaternal,
          lastNameMaternal: input.lastNameMaternal,
          locale: input.locale ?? "es",
          status: "invited",
        },
      });

      const allPermissions = await tx.permission.findMany({ select: { id: true, code: true } });
      const permissionIdByCode = new Map(allPermissions.map((p) => [p.code, p.id]));
      const codesByRole = resolveRolePermissionCodes(allPermissions.map((p) => p.code));

      let ownerRoleId: string | undefined;

      for (const roleName of TENANT_ROLE_NAMES) {
        const role = await tx.role.create({ data: { tenantId: tenant.id, name: roleName } });

        if (roleName === "Admin") {
          ownerRoleId = role.id;
        }

        const codes = codesByRole[roleName];
        if (codes.length > 0) {
          await tx.rolePermission.createMany({
            data: codes.map((code) => ({
              roleId: role.id,
              // El code viene de allPermissions, así que SIEMPRE resuelve.
              permissionId: permissionIdByCode.get(code) as string,
            })),
          });
        }
      }

      if (!ownerRoleId) {
        throw new Error("TENANT_ROLE_NAMES no incluye Admin — invariante rota");
      }

      await tx.userRole.create({ data: { userId: owner.id, roleId: ownerRoleId } });

      // F2-CAT-01: el Catálogo de Productos es el catálogo PRINCIPAL y
      // obligatorio del motor (ARQUITECTURA § 3.3). Nace con el tenant, en
      // esta misma transacción, porque sin él no hay dónde colgar los campos
      // personalizados y el alta de productos no tendría contra qué validar.
      //
      // `isSystem` + `systemKey` lo marcan como no borrable ni renombrable; el
      // índice único parcial de (tenant_id, system_key) garantiza que haya uno
      // solo. Va DESPUÉS de `setTenantContext` como todo lo que tiene RLS: su
      // policy `tenant_isolation` rechazaría el INSERT sin contexto abierto.
      //
      // El catálogo del sistema NO se renombra ni se archiva (F2-CAT-02): es
      // la referencia estable que ve todo el equipo y que nombran los docs y
      // el soporte. Los subcatálogos sí son libres.
      await tx.catalog.create({
        data: {
          tenantId: tenant.id,
          name: PRODUCTS_CATALOG_NAME,
          systemKey: PRODUCTS_CATALOG_KEY,
          isSystem: true,
        },
      });

      // F3-HOME-03: el tenant nace CON su almacén, en esta misma transacción.
      // Antes existía el estado "tenant sin almacén" hasta que alguien
      // completaba el paso 3 del onboarding — y el POS de F4 no puede vender
      // desde la nada. El nombre es una sugerencia editable por idioma, no una
      // referencia de sistema como el catálogo de productos.
      const warehouse = await tx.warehouse.create({
        data: {
          tenantId: tenant.id,
          name: INITIAL_WAREHOUSE_NAME[input.locale ?? "es"],
        },
      });

      // Y queda ASIGNADO al owner: con un solo almacén no hay ambigüedad, y
      // así el primer usuario del sistema ya opera desde algún lado.
      await tx.user.update({
        where: { id: owner.id },
        data: { defaultWarehouseId: warehouse.id },
      });

      await this.auditService.record(tx, {
        tenantId: tenant.id,
        userId: owner.id,
        action: "auth.register_tenant",
        resourceType: "tenant",
        resourceId: tenant.id,
        ip: input.ip,
        userAgent: input.userAgent,
      });

      return { tenantId: tenant.id, userId: owner.id };
    });
  }
}
