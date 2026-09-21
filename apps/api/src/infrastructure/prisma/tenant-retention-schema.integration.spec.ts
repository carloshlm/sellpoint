import { ConfigService } from "@nestjs/config";
import { tenantRetentionYears } from "@sellpoint/shared";
import type { Env } from "../../config/env.schema";
import { PrismaService } from "./prisma.service";

/**
 * F7-LIFECYCLE-10 — la retención legal vive en la BASE, no solo en el service:
 * `purge_tenant()` se niega a borrar a un CLIENTE (al menos un pago real)
 * antes de su plazo, así que ni el backoffice ni los guiones de
 * `infrastructure/scripts/` pueden saltársela. `tenant_retention_years()` es
 * la regla en SQL y este spec la ata a la de `@sellpoint/shared`: si alguien
 * cambia un plazo en un solo lado, esto se pone en rojo.
 */
describe("retención legal de un cliente: tenant_retention_years() y purge_tenant() (F7-LIFECYCLE-10)", () => {
  let prisma: PrismaService;
  let planPlusId: string;
  const stamp = Date.now();
  const creados: string[] = [];

  const haceAnios = (anios: number, diasDeMas = 0): Date => {
    const fecha = new Date();
    fecha.setUTCFullYear(fecha.getUTCFullYear() - anios);
    return new Date(fecha.getTime() - diasDeMas * 86_400_000);
  };

  async function negocio(country: string | null, sufijo: string): Promise<string> {
    const { id } = await prisma.tenant.create({
      data: { name: `Retención ${sufijo} ${stamp}`, country },
    });
    creados.push(id);
    return id;
  }

  async function pago(
    tenantId: string,
    extra: { method?: string; amount?: string; status?: string } = {},
  ): Promise<string> {
    return prisma.withTenantContext(tenantId, async (tx) => {
      const sub =
        (await tx.tenantSubscription.findUnique({ where: { tenantId } })) ??
        (await tx.tenantSubscription.create({
          // El estado de la suscripción no entra en la regla: solo los pagos.
          data: { tenantId, planId: planPlusId, status: "trialing", trialEndsAt: new Date() },
        }));
      const amount = extra.amount ?? "499.00";
      const { id } = await tx.subscriptionPayment.create({
        data: {
          tenantId,
          subscriptionId: sub.id,
          planId: planPlusId,
          planCode: "plus",
          billingCycle: "monthly",
          grossAmount: amount,
          amount,
          method: extra.method ?? "transfer",
          status: extra.status ?? "recorded",
          ...(extra.status === "voided"
            ? { voidedAt: new Date(), voidReason: "registrado por error" }
            : {}),
          paidAt: new Date(),
          periodStart: new Date("2026-08-05"),
          periodEnd: new Date("2026-09-05"),
        },
      });
      return id;
    });
  }

  const desactivar = (tenantId: string, desde: Date) =>
    prisma.tenant.update({
      where: { id: tenantId },
      data: { suspendedAt: desde, suspendedReason: "Baja del cliente" },
    });

  const aniosEnLaBase = async (tenantId: string): Promise<number | null> => {
    const [fila] = await prisma.$queryRaw<{ anios: number | null }[]>`
      SELECT tenant_retention_years(${tenantId}::uuid) AS anios`;
    return fila?.anios ?? null;
  };

  const purgar = (tenantId: string) => prisma.$queryRaw`SELECT purge_tenant(${tenantId}::uuid)`;
  const existe = async (tenantId: string) =>
    (await prisma.tenant.findUnique({ where: { id: tenantId } })) !== null;

  beforeAll(async () => {
    prisma = new PrismaService(
      new ConfigService<Env, true>({ DATABASE_URL: process.env.DATABASE_URL }),
    );
    await prisma.onModuleInit();
    planPlusId = (await prisma.plan.findUniqueOrThrow({ where: { code: "plus" } })).id;
  });

  afterAll(async () => {
    // Lo que el spec no logró purgar se libera anulando sus pagos: es la
    // salida legítima, la misma que tiene Carlos con un pago de prueba.
    for (const id of creados) {
      if (!(await existe(id))) continue;
      await prisma.withTenantContext(id, (tx) =>
        tx.subscriptionPayment.updateMany({
          where: { tenantId: id, status: "recorded" },
          data: { status: "voided", voidedAt: new Date(), voidReason: "fin del spec" },
        }),
      );
      await prisma.tenant.updateMany({
        where: { id, suspendedAt: null },
        data: { suspendedAt: new Date(), suspendedReason: "fin del spec" },
      });
      await purgar(id);
    }
    await prisma.onModuleDestroy();
  });

  describe("tenant_retention_years()", () => {
    it.each([["MX"], ["CA"], ["US"], ["BR"], [null]])(
      "cliente de %s: la base dice los mismos años que @sellpoint/shared",
      async (country) => {
        const id = await negocio(country, `plazo-${country ?? "sin-pais"}`);
        await pago(id);
        expect(await aniosEnLaBase(id)).toBe(tenantRetentionYears(country));
      },
    );

    it("sin pagos no hay retención", async () => {
      expect(await aniosEnLaBase(await negocio("MX", "sin-pagos"))).toBeNull();
    });

    it("una cortesía no es un pago real", async () => {
      const id = await negocio("MX", "cortesia");
      await pago(id, { method: "courtesy", amount: "0.00" });
      expect(await aniosEnLaBase(id)).toBeNull();
    });

    it("un pago ANULADO no cuenta: anular es la salida de un pago de prueba", async () => {
      const id = await negocio("MX", "anulado");
      await pago(id, { status: "voided" });
      expect(await aniosEnLaBase(id)).toBeNull();
    });
  });

  describe("purge_tenant() respeta la retención", () => {
    it("cliente mexicano desactivado hace 9 años: se niega y no toca nada", async () => {
      const id = await negocio("MX", "mx-9");
      await pago(id);
      await desactivar(id, haceAnios(9));
      await expect(purgar(id)).rejects.toThrow(/retención/);
      expect(await existe(id)).toBe(true);
      const pagos = await prisma.withTenantContext(id, (tx) =>
        tx.subscriptionPayment.count({ where: { tenantId: id } }),
      );
      expect(pagos).toBe(1);
    });

    it("cliente mexicano desactivado hace 10 años y un día: se borra", async () => {
      const id = await negocio("MX", "mx-10");
      await pago(id);
      await desactivar(id, haceAnios(10, 1));
      await purgar(id);
      expect(await existe(id)).toBe(false);
    });

    it("cliente canadiense: a los 6 años no, a los 7 y un día sí", async () => {
      const id = await negocio("CA", "ca");
      await pago(id);
      await desactivar(id, haceAnios(6));
      await expect(purgar(id)).rejects.toThrow(/retención/);
      await desactivar(id, haceAnios(7, 1));
      await purgar(id);
      expect(await existe(id)).toBe(false);
    });

    it("cliente de Estados Unidos desactivado hace 8 años: se borra (7 años, no 10)", async () => {
      const id = await negocio("US", "us");
      await pago(id);
      await desactivar(id, haceAnios(8));
      await purgar(id);
      expect(await existe(id)).toBe(false);
    });

    it("cliente SIN país desactivado hace 8 años: se niega (le tocan 10)", async () => {
      const id = await negocio(null, "sin-pais-8");
      await pago(id);
      await desactivar(id, haceAnios(8));
      await expect(purgar(id)).rejects.toThrow(/retención/);
    });

    it("quien nunca pagó se borra recién desactivado: así limpian los guiones una prueba", async () => {
      const id = await negocio("MX", "prueba");
      await pago(id, { method: "courtesy", amount: "0.00" });
      await desactivar(id, new Date());
      await purgar(id);
      expect(await existe(id)).toBe(false);
    });

    it("anular el pago de prueba libera al negocio", async () => {
      const id = await negocio("MX", "pago-de-prueba");
      const pagoId = await pago(id);
      await desactivar(id, new Date());
      await expect(purgar(id)).rejects.toThrow(/retención/);
      await prisma.withTenantContext(id, (tx) =>
        tx.subscriptionPayment.update({
          where: { id: pagoId },
          data: { status: "voided", voidedAt: new Date(), voidReason: "era una prueba" },
        }),
      );
      await purgar(id);
      expect(await existe(id)).toBe(false);
    });
  });
});
