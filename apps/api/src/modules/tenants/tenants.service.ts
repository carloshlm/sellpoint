import { Injectable } from "@nestjs/common";
import {
  dueInstant,
  EXPENSE_CATEGORY_SEED,
  expenseCategorySortOrder,
  localCalendarDate,
  TRIAL_DAYS,
} from "@sellpoint/shared";
import { PrismaService } from "../../infrastructure/prisma/prisma.service";
import { AuditService } from "../audit/audit.service";
import type { TermsAcceptanceStamp } from "../legal/terms.service";
import {
  INITIAL_WAREHOUSE_NAME,
  PRODUCTS_CATALOG_KEY,
  PRODUCTS_CATALOG_NAME,
  PROVISIONAL_TENANT_NAME,
  resolveRolePermissionCodes,
  SERVICES_CATALOG_KEY,
  SERVICES_CATALOG_NAME,
  SUPPLIERS_CATALOG_KEY,
  SUPPLIERS_CATALOG_NAME,
  TENANT_ROLES,
  WAREHOUSES_CATALOG_KEY,
  WAREHOUSES_CATALOG_NAME,
} from "./role-catalog";

export interface ProvisionTenantInput {
  tenantName?: string;
  currency?: string;
  ownerEmail: string;
  // Ya hasheado por el caller (AuthService), FUERA de esta transacción —
  // argon2 (~80-150ms) nunca corre dentro de un $transaction (AD-1).
  ownerPasswordHash: string;
  firstName: string;
  lastName: string;
  secondLastName?: string;
  locale?: "es" | "en";
  /**
   * F11-SITE-LEGAL-02: lo que el owner aceptó al registrarse, ya resuelto por
   * `TermsService`. `null` = no había nada vigente que aceptar (el estado
   * dormido) y el usuario nace con las dos columnas en NULL.
   */
  termsAcceptance?: TermsAcceptanceStamp | null;
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
          lastName: input.lastName,
          secondLastName: input.secondLastName,
          locale: input.locale ?? "es",
          status: "invited",
          // F11-SITE-LEGAL-02: el sello va en el MISMO insert que el usuario.
          // Una escritura aparte podría fallar dejando una cuenta creada sin
          // constancia de haber aceptado nada — que es el único estado que
          // estas columnas existen para impedir.
          termsVersion: input.termsAcceptance?.termsVersion ?? null,
          termsAcceptedAt: input.termsAcceptance?.termsAcceptedAt ?? null,
        },
      });

      const allPermissions = await tx.permission.findMany({ select: { id: true, code: true } });
      const permissionIdByCode = new Map(allPermissions.map((p) => [p.code, p.id]));
      const codesByRole = resolveRolePermissionCodes(allPermissions.map((p) => p.code));

      // El idioma del negocio es el del dueño que lo registra: en él nacen los
      // nombres de los roles, del almacén y de las categorías de gasto.
      const idioma = input.locale ?? "es";
      let ownerRoleId: string | undefined;

      // F10-MANFIX-22: cada rol nace con su CLAVE fija y el nombre en el idioma
      // del negocio. El dueño recibe el suyo por la clave: el nombre es un dato
      // que el negocio puede cambiar.
      for (const rol of TENANT_ROLES) {
        const role = await tx.role.create({
          data: { tenantId: tenant.id, systemKey: rol.key, name: rol.name[idioma] },
        });

        if (rol.key === "admin") {
          ownerRoleId = role.id;
        }

        const codes = codesByRole[rol.key];
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
        throw new Error("TENANT_ROLES no incluye la clave admin — invariante rota");
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
      // Los CUATRO catálogos del sistema (products F2-CAT; warehouses y services
      // 2026-08-26; suppliers F9-SUPPCAT-05): cada uno ancla los campos
      // dinámicos de su entidad.
      for (const sistema of [
        { name: PRODUCTS_CATALOG_NAME, systemKey: PRODUCTS_CATALOG_KEY },
        { name: WAREHOUSES_CATALOG_NAME, systemKey: WAREHOUSES_CATALOG_KEY },
        { name: SERVICES_CATALOG_NAME, systemKey: SERVICES_CATALOG_KEY },
        { name: SUPPLIERS_CATALOG_NAME, systemKey: SUPPLIERS_CATALOG_KEY },
      ]) {
        await tx.catalog.create({
          data: {
            tenantId: tenant.id,
            name: sistema.name,
            systemKey: sistema.systemKey,
            isSystem: true,
          },
        });
      }

      // F3-HOME-03: el tenant nace CON su almacén, en esta misma transacción.
      // Antes existía el estado "tenant sin almacén" hasta que alguien
      // completaba el paso 3 del onboarding — y el POS de F4 no puede vender
      // desde la nada. El nombre es una sugerencia editable por idioma, no una
      // referencia de sistema como el catálogo de productos.
      const warehouse = await tx.warehouse.create({
        data: {
          tenantId: tenant.id,
          // El primer código de la serie del negocio, el mismo que generaría
          // el service para un alta sin código (Carlos, 2026-09-01).
          code: "ALM-001",
          name: INITIAL_WAREHOUSE_NAME[idioma],
        },
      });

      // Y queda ASIGNADO al owner: con un solo almacén no hay ambigüedad, y
      // así el primer usuario del sistema ya opera desde algún lado.
      await tx.user.update({
        where: { id: owner.id },
        data: { defaultWarehouseId: warehouse.id },
      });

      // F9-EXP-02: las 18 categorías de gasto de fábrica, en el idioma del
      // negocio y en esta misma transacción. Los negocios que ya existían las
      // recibieron por el backfill de la migración; nunca se siembran en
      // diferido dentro de un GET (una escritura escondida en una lectura).
      await tx.expenseCategory.createMany({
        data: EXPENSE_CATEGORY_SEED.map((categoria, indice) => ({
          tenantId: tenant.id,
          code: categoria.code,
          name: categoria.name[idioma],
          sortOrder: expenseCategorySortOrder(indice),
          createdBy: owner.id,
        })),
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

      // F7-CORE-03: el tenant nace CON su trial (14 días, nivel Plus) en esta
      // misma transacción — no existe un tenant sin suscripción. El fin del
      // trial es el FIN DEL DÍA LOCAL a 14 días (dueInstant, límite abierto):
      // el día 14 completo sigue siendo hábil, misma semántica que los
      // vencimientos de cobro.
      const trialPlan = await tx.plan.findUniqueOrThrow({ where: { code: "plus" } });
      const en14Dias = new Date(Date.now() + TRIAL_DAYS * 86_400_000);
      const subscription = await tx.tenantSubscription.create({
        data: {
          tenantId: tenant.id,
          planId: trialPlan.id,
          status: "trialing",
          trialEndsAt: dueInstant(localCalendarDate(tenant.timezone, en14Dias), tenant.timezone),
        },
      });

      await this.auditService.record(tx, {
        tenantId: tenant.id,
        userId: owner.id,
        action: "billing.trial_started",
        resourceType: "subscription",
        resourceId: subscription.id,
        after: { planCode: trialPlan.code, trialEndsAt: subscription.trialEndsAt?.toISOString() },
      });

      return { tenantId: tenant.id, userId: owner.id };
    });
  }
}
