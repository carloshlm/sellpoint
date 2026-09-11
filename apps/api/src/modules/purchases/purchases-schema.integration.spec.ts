import { ConfigService } from "@nestjs/config";
import type { Env } from "../../config/env.schema";
import { Prisma } from "../../generated/prisma/client";
import { PrismaService } from "../../infrastructure/prisma/prisma.service";

/**
 * Integration (Postgres real) — F9-PURCH-02: el modelo de datos de Compras.
 *
 * Lo que fija:
 *  - las CUATRO tablas llevan la RLS canónica con `FORCE` (el rol real de la
 *    app no ve nada sin contexto, y A no ve lo de B);
 *  - los CHECKs de coherencia: `confirmed` sin sus sellos revienta, un
 *    `tax_mode` fuera del catálogo revienta, un borrador con sellos revienta;
 *  - **la asimetría del trigger**: insertar o tocar una línea de una compra
 *    confirmada revienta con `42501`, pero `UPDATE purchases SET notes` sobre
 *    esa misma compra PASA (recepción, factura y notas se anotan después).
 */
describe("modelo de datos de Compras (F9-PURCH-02)", () => {
  let prisma: PrismaService;
  let tenantA: string;
  let tenantB: string;
  let userA: string;
  let warehouseA: string;
  let supplierA: string;
  let productA: string;
  const stamp = Date.now();
  const HOY = new Date("2026-09-11");

  const asAppRole = <T>(fn: (tx: Prisma.TransactionClient) => Promise<T>): Promise<T> =>
    prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SET LOCAL ROLE sellpoint_app`;
      return fn(tx);
    });

  /** Una compra mínima del tenant A; `extra` pisa lo que el caso quiera romper. */
  const compra = (extra: Record<string, unknown> = {}) => ({
    tenantId: tenantA,
    folio: `COM-${String(Math.floor(Math.random() * 1_000_000)).padStart(6, "0")}`,
    supplierId: supplierA,
    warehouseId: warehouseA,
    purchaseDate: HOY,
    createdBy: userA,
    ...extra,
  });
  const crear = (extra: Record<string, unknown> = {}) =>
    prisma.withTenantContext(tenantA, (tx) => tx.purchase.create({ data: compra(extra) }));

  const confirmada = () =>
    crear({ status: "confirmed", confirmedAt: new Date(), confirmedBy: userA });

  const linea = (purchaseId: string, extra: Record<string, unknown> = {}) =>
    prisma.withTenantContext(tenantA, (tx) =>
      tx.purchaseLine.create({
        data: {
          tenantId: tenantA,
          purchaseId,
          lineNo: 1,
          productId: productA,
          description: "Paracetamol 500 mg",
          ...extra,
        },
      }),
    );

  beforeAll(async () => {
    prisma = new PrismaService(
      new ConfigService<Env, true>({ DATABASE_URL: process.env.DATABASE_URL }),
    );
    await prisma.onModuleInit();
    tenantA = (await prisma.tenant.create({ data: { name: `Purch A ${stamp}` } })).id;
    tenantB = (await prisma.tenant.create({ data: { name: `Purch B ${stamp}` } })).id;
    for (const [tenantId, sufijo] of [
      [tenantA, "a"],
      [tenantB, "b"],
    ] as const) {
      await prisma.withTenantContext(tenantId, async (tx) => {
        const user = await tx.user.create({
          data: {
            tenantId,
            email: `purch-${stamp}-${sufijo}@example.com`,
            firstName: "Ana",
            lastName: "Pérez",
          },
        });
        const warehouse = await tx.warehouse.create({
          data: { tenantId, code: "ALM-001", name: "Central" },
        });
        const supplier = await tx.supplier.create({
          data: { tenantId, name: "Distribuidora Norte" },
        });
        const product = await tx.product.create({
          data: { tenantId, sku: `P-${stamp}-${sufijo}`, name: "Paracetamol" },
        });
        await tx.purchase.create({
          data: {
            tenantId,
            folio: "COM-000001",
            supplierId: supplier.id,
            warehouseId: warehouse.id,
            purchaseDate: HOY,
            createdBy: user.id,
          },
        });
        if (tenantId === tenantA) {
          userA = user.id;
          warehouseA = warehouse.id;
          supplierA = supplier.id;
          productA = product.id;
        }
      });
    }
  });

  afterAll(async () => {
    await prisma.onModuleDestroy();
  });

  describe("RLS", () => {
    it("sin contexto de tenant, cero filas en las cuatro tablas con el rol real de la app", async () => {
      const compraA = await crear();
      await linea(compraA.id);
      const [compras, lineas, impuestos, cargos] = await asAppRole((tx) =>
        Promise.all([
          tx.purchase.findMany(),
          tx.purchaseLine.findMany(),
          tx.purchaseTax.findMany(),
          tx.purchaseCharge.findMany(),
        ]),
      );
      expect(compras).toHaveLength(0);
      expect(lineas).toHaveLength(0);
      expect(impuestos).toHaveLength(0);
      expect(cargos).toHaveLength(0);
    });

    it("el contexto del tenant A no ve las compras del tenant B", async () => {
      const filas = await asAppRole(async (tx) => {
        await tx.$executeRaw`SELECT set_config('app.tenant_id', ${tenantA}::text, true)`;
        return tx.purchase.findMany({ where: { tenantId: { in: [tenantA, tenantB] } } });
      });
      expect(new Set(filas.map((f) => f.tenantId))).toEqual(new Set([tenantA]));
    });
  });

  describe("CHECKs de coherencia", () => {
    it("una compra nace borrador, sin sellos, en `excluded` y en ceros", async () => {
      const creada = await crear();
      expect(creada).toMatchObject({ status: "draft", taxMode: "excluded" });
      expect(creada.confirmedAt).toBeNull();
      expect(creada.total.toString()).toBe("0");
      expect(creada.declaredTotal).toBeNull();
    });

    it("`confirmed` sin sus sellos revienta; con ellos pasa", async () => {
      await expect(crear({ status: "confirmed" })).rejects.toThrow();
      await expect(crear({ status: "confirmed", confirmedAt: new Date() })).rejects.toThrow();
      await expect(confirmada()).resolves.toMatchObject({ status: "confirmed" });
    });

    it("un borrador con sellos revienta: draft es un estado sin historia", async () => {
      await expect(crear({ confirmedAt: new Date(), confirmedBy: userA })).rejects.toThrow();
    });

    it("anular exige quién, cuándo y por qué", async () => {
      await expect(crear({ status: "canceled", canceledAt: new Date() })).rejects.toThrow();
      await expect(
        crear({
          status: "canceled",
          canceledAt: new Date(),
          canceledBy: userA,
          cancelReason: "duplicada",
        }),
      ).resolves.toMatchObject({ status: "canceled" });
    });

    it("un modo fiscal o un estado fuera del catálogo revientan", async () => {
      await expect(crear({ taxMode: "raro" })).rejects.toThrow();
      await expect(crear({ status: "open" })).rejects.toThrow();
    });

    it("los montos no son negativos y la descripción de la línea no es un espacio", async () => {
      await expect(crear({ total: new Prisma.Decimal(-1) })).rejects.toThrow();
      const borrador = await crear();
      await expect(linea(borrador.id, { description: "   " })).rejects.toThrow();
      await expect(linea(borrador.id, { lineNo: 0 })).rejects.toThrow();
    });
  });

  describe("la asimetría del trigger (lo confirmado es intocable, la cabecera no)", () => {
    it("insertar, cambiar o borrar una línea de una compra CONFIRMADA revienta con 42501", async () => {
      const borrador = await crear();
      const suLinea = await linea(borrador.id);
      await prisma.withTenantContext(tenantA, (tx) =>
        tx.purchase.update({
          where: { id: borrador.id },
          data: { status: "confirmed", confirmedAt: new Date(), confirmedBy: userA },
        }),
      );

      await expect(linea(borrador.id, { lineNo: 2 })).rejects.toThrow(/42501/);
      await expect(
        prisma.withTenantContext(tenantA, (tx) =>
          tx.purchaseLine.update({
            where: { id: suLinea.id },
            data: { quantity: new Prisma.Decimal(5) },
          }),
        ),
      ).rejects.toThrow(/42501/);
      await expect(
        prisma.withTenantContext(tenantA, (tx) =>
          tx.purchaseLine.delete({ where: { id: suLinea.id } }),
        ),
      ).rejects.toThrow(/42501/);
    });

    it("los impuestos y los cargos heredan la misma inmutabilidad", async () => {
      const compraConfirmada = await confirmada();
      await expect(
        prisma.withTenantContext(tenantA, (tx) =>
          tx.purchaseTax.create({
            data: {
              tenantId: tenantA,
              purchaseId: compraConfirmada.id,
              code: "IVA",
              name: "IVA",
              rate: new Prisma.Decimal(16),
              base: new Prisma.Decimal(100),
              amount: new Prisma.Decimal(16),
            },
          }),
        ),
      ).rejects.toThrow(/42501/);
      await expect(
        prisma.withTenantContext(tenantA, (tx) =>
          tx.purchaseCharge.create({
            data: {
              tenantId: tenantA,
              purchaseId: compraConfirmada.id,
              lineNo: 1,
              description: "Flete",
              amount: new Prisma.Decimal(200),
            },
          }),
        ),
      ).rejects.toThrow(/42501/);
    });

    it("pero la CABECERA de una confirmada SÍ se edita: recepción, factura y notas", async () => {
      const compraConfirmada = await confirmada();
      const anotada = await prisma.withTenantContext(tenantA, (tx) =>
        tx.purchase.update({
          where: { id: compraConfirmada.id },
          data: {
            receivedDate: new Date("2026-09-15"),
            supplierInvoice: "A-4471",
            notes: "Llegó incompleta: faltan 2 cajas",
          },
        }),
      );
      expect(anotada.supplierInvoice).toBe("A-4471");
      expect(anotada.notes).toContain("faltan 2 cajas");
    });

    it("borrar un BORRADOR se lleva sus hijas en cascada sin que el trigger frene", async () => {
      const borrador = await crear();
      await linea(borrador.id);
      await expect(
        prisma.withTenantContext(tenantA, (tx) =>
          tx.purchase.delete({ where: { id: borrador.id } }),
        ),
      ).resolves.toMatchObject({ id: borrador.id });
      const quedan = await prisma.withTenantContext(tenantA, (tx) =>
        tx.purchaseLine.count({ where: { purchaseId: borrador.id } }),
      );
      expect(quedan).toBe(0);
    });
  });

  it("el folio es único por negocio, y el mismo folio existe en OTRO negocio", async () => {
    await expect(crear({ folio: "COM-000001" })).rejects.toMatchObject({ code: "P2002" });
    const enB = await prisma.withTenantContext(tenantB, (tx) =>
      tx.purchase.findFirst({ where: { folio: "COM-000001" } }),
    );
    expect(enB).not.toBeNull();
  });
});
