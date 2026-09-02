import { ConfigService } from "@nestjs/config";
import type { Env } from "../../config/env.schema";
import type { Prisma } from "../../generated/prisma/client";
import { PrismaService } from "../../infrastructure/prisma/prisma.service";
import { updateUserSchema } from "../users/dto/update-user.dto";

/**
 * Integration (Postgres real) — F7-DB: el modelo de datos de billing.
 *
 * ── Por qué los tests de RLS usan `SET LOCAL ROLE sellpoint_app` ─────────
 *
 * La conexión local de dev es `sellpoint` (superuser con BYPASSRLS): con ella
 * las policies NO se evalúan y un test de aislamiento pasaría en falso. En
 * producción la app conecta como `sellpoint_app` (sin bypass) — el `SET LOCAL
 * ROLE` dentro de la transacción reproduce EXACTAMENTE ese contexto, y al
 * cerrar la transacción el rol vuelve solo.
 *
 * ── Qué fija este archivo ────────────────────────────────────────────────
 *
 *  - los CHECKs de catálogo y de coherencia de estado (un estado sin sus
 *    fechas obligatorias no puede existir ni por bug);
 *  - el seed de referencia: 5 planes, 9 precios (3 publicados × 3 mercados),
 *    free y premium sin precio, anual = mensual × 10;
 *  - el aislamiento: RLS canónica en las tablas de billing, y el bypass del
 *    backoffice ACOTADO — abre suscripciones cross-tenant pero JAMÁS una
 *    tabla de negocio;
 *  - que el saldo de stock ya puede ser negativo (la barrera dejó de ser
 *    estructural: la impone StockLedgerService según el plan).
 */
describe("modelo de datos de billing (F7-DB)", () => {
  let prisma: PrismaService;
  let tenantA: string;
  let tenantB: string;
  let planPlusId: string;
  const stamp = Date.now();

  /** Transacción con el rol REAL de la app (sin bypass de RLS). */
  const asAppRole = <T>(fn: (tx: Prisma.TransactionClient) => Promise<T>): Promise<T> =>
    prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SET LOCAL ROLE sellpoint_app`;
      return fn(tx);
    });

  beforeAll(async () => {
    prisma = new PrismaService(
      new ConfigService<Env, true>({ DATABASE_URL: process.env.DATABASE_URL }),
    );
    await prisma.onModuleInit();

    tenantA = (await prisma.tenant.create({ data: { name: `Billing A ${stamp}` } })).id;
    tenantB = (await prisma.tenant.create({ data: { name: `Billing B ${stamp}` } })).id;
    planPlusId = (await prisma.plan.findUniqueOrThrow({ where: { code: "plus" } })).id;

    // Una suscripción por tenant y un almacén en A: el material de las
    // pruebas de aislamiento (suscripciones = tabla de billing; almacén =
    // tabla de NEGOCIO que el bypass jamás debe abrir).
    for (const [tenantId, status] of [
      [tenantA, "trialing"],
      [tenantB, "trialing"],
    ] as const) {
      await prisma.withTenantContext(tenantId, async (tx) => {
        await tx.tenantSubscription.create({
          data: { tenantId, planId: planPlusId, status, trialEndsAt: new Date() },
        });
      });
    }
    await prisma.withTenantContext(tenantA, async (tx) => {
      await tx.warehouse.create({
        data: {
          tenantId: tenantA,
          code: `WH-${Math.random().toString(36).slice(2, 10)}`,
          name: `Bodega A ${stamp}`,
        },
      });
    });
  });

  afterAll(async () => {
    await prisma.onModuleDestroy();
  });

  describe("plans y plan_prices (F7-DB-01/02)", () => {
    it("un code fuera del catálogo rebota en el CHECK", async () => {
      await expect(
        prisma.$executeRaw`INSERT INTO plans (code, name) VALUES ('bogus', 'Bogus')`,
      ).rejects.toThrow();
    });

    it("dos precios del mismo plan y país rebotan en el UNIQUE", async () => {
      const basic = await prisma.plan.findUniqueOrThrow({ where: { code: "basic" } });
      await expect(
        prisma.planPrice.create({
          data: {
            planId: basic.id,
            country: "MX",
            currency: "MXN",
            priceMonthly: "199.00",
            priceYearly: "1990.00",
          },
        }),
      ).rejects.toThrow();
    });

    it("los 5 planes del catálogo están sembrados por la migración", async () => {
      const codes = (await prisma.plan.findMany({ orderBy: { sortOrder: "asc" } })).map(
        (p) => p.code,
      );
      expect(codes).toEqual(["free", "basic", "pro", "plus", "premium"]);
    });

    it("9 precios: los 3 planes publicados × los 3 mercados; free y premium sin precio", async () => {
      const precios = await prisma.planPrice.findMany({ include: { plan: true } });
      expect(precios).toHaveLength(9);
      const porPlan = new Map<string, string[]>();
      for (const p of precios) {
        porPlan.set(p.plan.code, [...(porPlan.get(p.plan.code) ?? []), p.country].sort());
      }
      expect(porPlan.get("basic")).toEqual(["CA", "MX", "US"]);
      expect(porPlan.get("pro")).toEqual(["CA", "MX", "US"]);
      expect(porPlan.get("plus")).toEqual(["CA", "MX", "US"]);
      expect(porPlan.has("free")).toBe(false);
      expect(porPlan.has("premium")).toBe(false);
    });

    it("el anual es exactamente 10× el mensual en cada mercado (2 meses gratis)", async () => {
      const precios = await prisma.planPrice.findMany();
      for (const p of precios) {
        expect(p.priceYearly.toString()).toBe(p.priceMonthly.mul(10).toString());
      }
    });
  });

  describe("tenant_subscriptions (F7-DB-03)", () => {
    it("una suscripción active sin due_at viola el CHECK de coherencia", async () => {
      await expect(
        prisma.withTenantContext(
          tenantA,
          (tx) =>
            tx.$executeRaw`
            INSERT INTO tenant_subscriptions (tenant_id, plan_id, status)
            VALUES (${tenantA}::uuid, ${planPlusId}::uuid, 'active')`,
        ),
      ).rejects.toThrow();
    });

    it("un status fuera del catálogo rebota", async () => {
      await expect(
        prisma.withTenantContext(
          tenantA,
          (tx) =>
            tx.$executeRaw`
            INSERT INTO tenant_subscriptions (tenant_id, plan_id, status)
            VALUES (${tenantA}::uuid, ${planPlusId}::uuid, 'expired')`,
        ),
      ).rejects.toThrow();
    });

    it("RLS: sin contexto de tenant, cero filas (con el rol real de la app)", async () => {
      const filas = await asAppRole((tx) => tx.tenantSubscription.findMany());
      expect(filas).toHaveLength(0);
    });

    it("RLS: el contexto del tenant A no ve la suscripción del tenant B", async () => {
      const filas = await asAppRole(async (tx) => {
        await tx.$executeRaw`SELECT set_config('app.tenant_id', ${tenantA}::text, true)`;
        return tx.tenantSubscription.findMany({ where: { tenantId: tenantB } });
      });
      expect(filas).toHaveLength(0);
    });
  });

  describe("pagos, descuentos y notificaciones (F7-DB-04)", () => {
    it("un pago cuyo amount no es gross − discount rebota en el CHECK", async () => {
      const sub = await prisma.withTenantContext(tenantA, (tx) =>
        tx.tenantSubscription.findUniqueOrThrow({ where: { tenantId: tenantA } }),
      );
      await expect(
        prisma.withTenantContext(tenantA, (tx) =>
          tx.subscriptionPayment.create({
            data: {
              tenantId: tenantA,
              subscriptionId: sub.id,
              planId: planPlusId,
              planCode: "plus",
              billingCycle: "monthly",
              grossAmount: "499.00",
              discountAmount: "200.00",
              amount: "499.00", // debería ser 299.00
              method: "transfer",
              paidAt: new Date(),
              periodStart: new Date("2026-08-05"),
              periodEnd: new Date("2026-09-05"),
            },
          }),
        ),
      ).rejects.toThrow();
    });

    it("dos descuentos activos del mismo tenant rebotan en el UNIQUE parcial", async () => {
      const cupon = (extra: Record<string, unknown> = {}) =>
        prisma.withTenantContext(tenantA, (tx) =>
          tx.tenantDiscount.create({
            data: {
              tenantId: tenantA,
              kind: "fixed_amount",
              amount: "200.00",
              startsAt: new Date(),
              ...extra,
            },
          }),
        );
      await cupon();
      await expect(cupon()).rejects.toThrow();
      // Revocado el primero, el segundo entra: el límite es UN activo, no uno en la vida.
      await prisma.withTenantContext(tenantA, (tx) =>
        tx.tenantDiscount.updateMany({ where: { tenantId: tenantA }, data: { isActive: false } }),
      );
      await expect(cupon()).resolves.toBeTruthy();
    });

    it("la misma notificación (suscripción, kind, ancla) rebota: la idempotencia del cron vive en la base", async () => {
      const sub = await prisma.withTenantContext(tenantA, (tx) =>
        tx.tenantSubscription.findUniqueOrThrow({ where: { tenantId: tenantA } }),
      );
      const ancla = new Date("2026-09-05T06:00:00.000Z");
      const aviso = () =>
        prisma.withTenantContext(tenantA, (tx) =>
          tx.billingNotification.create({
            data: {
              tenantId: tenantA,
              subscriptionId: sub.id,
              kind: "due_soon_3",
              anchorAt: ancla,
            },
          }),
        );
      await aviso();
      await expect(aviso()).rejects.toThrow();
    });
  });

  describe("el bypass del backoffice (F7-DB-05)", () => {
    it("con el GUC de billing, el rol de la app lee suscripciones de VARIOS tenants", async () => {
      const filas = await asAppRole(async (tx) => {
        await tx.$executeRaw`SELECT set_config('app.billing_admin', 'on', true)`;
        return tx.tenantSubscription.findMany({
          where: { tenantId: { in: [tenantA, tenantB] } },
        });
      });
      expect(filas).toHaveLength(2);
    });

    it("el bypass NO alcanza a las tablas de negocio: warehouses sigue en cero desde ese contexto", async () => {
      // El almacén del tenant A EXISTE (se creó en el beforeAll) — que este
      // count dé 0 con el bypass prendido es la prueba de que la policy vive
      // SOLO en las 4 tablas de billing.
      const bodegas = await asAppRole(async (tx) => {
        await tx.$executeRaw`SELECT set_config('app.billing_admin', 'on', true)`;
        return tx.warehouse.count({ where: { tenantId: tenantA } });
      });
      expect(bodegas).toBe(0);
    });

    it("withBillingAdminContext prende el GUC dentro y no existe fuera", async () => {
      const dentro = await prisma.withBillingAdminContext(async (tx) => {
        const [fila] = await tx.$queryRaw<[{ guc: string }]>`
          SELECT current_setting('app.billing_admin', true) AS guc`;
        return fila.guc;
      });
      expect(dentro).toBe("on");
      const [fuera] = await prisma.$queryRaw<[{ guc: string | null }]>`
        SELECT current_setting('app.billing_admin', true) AS guc`;
      expect(fuera.guc ?? "").not.toBe("on");
    });
  });

  describe("tenant_modules (F9-MOD-02)", () => {
    // Un módulo por negocio: el material de las pruebas de aislamiento. Se
    // crea desde el contexto de CADA tenant, como lo haría el backoffice.
    beforeAll(async () => {
      for (const tenantId of [tenantA, tenantB]) {
        await prisma.withTenantContext(tenantId, (tx) =>
          tx.tenantModule.create({ data: { tenantId, moduleKey: "reception" } }),
        );
      }
    });

    it("el mismo módulo dos veces en el mismo negocio rebota en el UNIQUE", async () => {
      await expect(
        prisma.withTenantContext(tenantA, (tx) =>
          tx.tenantModule.create({ data: { tenantId: tenantA, moduleKey: "reception" } }),
        ),
      ).rejects.toMatchObject({ code: "P2002" });
    });

    it("RLS: el contexto del tenant A no ve el módulo del tenant B", async () => {
      const filas = await asAppRole(async (tx) => {
        await tx.$executeRaw`SELECT set_config('app.tenant_id', ${tenantA}::text, true)`;
        return tx.tenantModule.findMany({ where: { tenantId: { in: [tenantA, tenantB] } } });
      });
      expect(filas.map((f) => f.tenantId)).toEqual([tenantA]);
    });

    it("el bypass del backoffice lee los módulos de VARIOS tenants — y warehouses sigue en cero", async () => {
      const { modulos, bodegas } = await asAppRole(async (tx) => {
        await tx.$executeRaw`SELECT set_config('app.billing_admin', 'on', true)`;
        return {
          modulos: await tx.tenantModule.findMany({
            where: { tenantId: { in: [tenantA, tenantB] } },
          }),
          bodegas: await tx.warehouse.count({ where: { tenantId: tenantA } }),
        };
      });
      expect(modulos).toHaveLength(2);
      expect(bodegas).toBe(0);
    });
  });

  describe("users.is_platform_admin (F7-DB-06)", () => {
    it("el flag nace en false", async () => {
      const user = await prisma.withTenantContext(tenantA, (tx) =>
        tx.user.create({
          data: {
            tenantId: tenantA,
            email: `billing-${stamp}@test.local`,
            firstName: "Billing",
            lastNamePaternal: "Test",
          },
        }),
      );
      expect(user.isPlatformAdmin).toBe(false);
    });

    it("updateUserSchema lo ignora: un PATCH no puede escalar privilegios", async () => {
      const parsed = updateUserSchema.parse({ firstName: "Eva", isPlatformAdmin: true });
      expect(parsed).not.toHaveProperty("isPlatformAdmin");
    });
  });

  describe("stock negativo permitido (F7-DB-07)", () => {
    it("el saldo por almacén y por lote aceptan negativos: la barrera ya es de plan, no de la base", async () => {
      await prisma.withTenantContext(tenantA, async (tx) => {
        const bodega = await tx.warehouse.findFirstOrThrow({ where: { tenantId: tenantA } });
        const producto = await tx.product.create({
          data: { tenantId: tenantA, sku: `NEG-${stamp}`, name: "Negativo" },
        });
        await expect(
          tx.stockByWarehouse.create({
            data: {
              tenantId: tenantA,
              productId: producto.id,
              warehouseId: bodega.id,
              quantity: -3,
            },
          }),
        ).resolves.toBeTruthy();

        const lote = await tx.productLot.create({
          data: { tenantId: tenantA, productId: producto.id, lotCode: `L-${stamp}` },
        });
        await expect(
          tx.stockLot.create({
            data: { tenantId: tenantA, warehouseId: bodega.id, lotId: lote.id, quantity: -2 },
          }),
        ).resolves.toBeTruthy();
      });
    });
  });
});
