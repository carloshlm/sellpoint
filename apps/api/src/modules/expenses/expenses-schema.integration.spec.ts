import { ConfigService } from "@nestjs/config";
import type { Env } from "../../config/env.schema";
import { Prisma } from "../../generated/prisma/client";
import { PrismaService } from "../../infrastructure/prisma/prisma.service";

/**
 * Integration (Postgres real) — F9-EXP-02/04: el modelo de datos de Gastos.
 *
 * Lo que fija:
 *  - `expense_categories` y `expenses` llevan la RLS canónica (con el rol
 *    REAL de la app, sin bypass): A no ve lo de B;
 *  - los CHECKs de coherencia: pagado sin método, sesión con transferencia,
 *    anulado sin motivo, proveedor + beneficiario, impuesto sin grupo;
 *  - las FK son RESTRICT: borrar una categoría o un proveedor en uso rebota
 *    (el 409 del service nace de aquí, y es lo que empuja a desactivar).
 */
describe("modelo de datos de Gastos (F9-EXP-02/04)", () => {
  let prisma: PrismaService;
  let tenantA: string;
  let tenantB: string;
  let userA: string;
  let warehouseA: string;
  let categoriaA: string;
  let proveedorA: string;
  const stamp = Date.now();
  const hoy = new Date("2026-09-10");

  /** Transacción con el rol REAL de la app (sin bypass de RLS). */
  const asAppRole = <T>(fn: (tx: Prisma.TransactionClient) => Promise<T>): Promise<T> =>
    prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SET LOCAL ROLE sellpoint_app`;
      return fn(tx);
    });

  /** Un gasto mínimo válido del tenant A; `extra` pisa lo que el caso quiera romper. */
  const gasto = (extra: Record<string, unknown> = {}) => ({
    tenantId: tenantA,
    folio: `GAS-${String(Math.floor(Math.random() * 1_000_000)).padStart(6, "0")}`,
    warehouseId: warehouseA,
    expenseDate: hoy,
    categoryId: categoriaA,
    description: "Renta de septiembre",
    amount: new Prisma.Decimal(100),
    total: new Prisma.Decimal(100),
    taxMode: "included",
    createdBy: userA,
    ...extra,
  });

  const crear = (extra: Record<string, unknown> = {}) =>
    prisma.withTenantContext(tenantA, (tx) => tx.expense.create({ data: gasto(extra) }));

  beforeAll(async () => {
    prisma = new PrismaService(
      new ConfigService<Env, true>({ DATABASE_URL: process.env.DATABASE_URL }),
    );
    await prisma.onModuleInit();
    tenantA = (await prisma.tenant.create({ data: { name: `Exp A ${stamp}` } })).id;
    tenantB = (await prisma.tenant.create({ data: { name: `Exp B ${stamp}` } })).id;
    for (const [tenantId, sufijo] of [
      [tenantA, "a"],
      [tenantB, "b"],
    ] as const) {
      await prisma.withTenantContext(tenantId, async (tx) => {
        const user = await tx.user.create({
          data: {
            tenantId,
            email: `exp-${stamp}-${sufijo}@example.com`,
            firstName: "Ana",
            lastName: "Pérez",
          },
        });
        const warehouse = await tx.warehouse.create({
          data: { tenantId, code: "ALM-001", name: "Central" },
        });
        const categoria = await tx.expenseCategory.create({
          data: { tenantId, code: "rent", name: "Renta", createdBy: user.id },
        });
        const proveedor = await tx.supplier.create({
          data: { tenantId, code: "INMOBILIARIA-CENTRO-1", name: "Inmobiliaria Centro" },
        });
        if (tenantId === tenantA) {
          userA = user.id;
          warehouseA = warehouse.id;
          categoriaA = categoria.id;
          proveedorA = proveedor.id;
        }
      });
    }
  });

  afterAll(async () => {
    await prisma.onModuleDestroy();
  });

  describe("RLS", () => {
    it("sin contexto de tenant, cero filas en las dos tablas con el rol real de la app", async () => {
      await crear();
      const [categorias, gastos] = await asAppRole((tx) =>
        Promise.all([tx.expenseCategory.findMany(), tx.expense.findMany()]),
      );
      expect(categorias).toHaveLength(0);
      expect(gastos).toHaveLength(0);
    });

    it("el contexto del tenant A no ve las categorías del tenant B", async () => {
      const filas = await asAppRole(async (tx) => {
        await tx.$executeRaw`SELECT set_config('app.tenant_id', ${tenantA}::text, true)`;
        return tx.expenseCategory.findMany({ where: { tenantId: { in: [tenantA, tenantB] } } });
      });
      expect(new Set(filas.map((f) => f.tenantId))).toEqual(new Set([tenantA]));
    });
  });

  describe("CHECKs de expense_categories", () => {
    it("el código va en snake_case y el nombre no puede ser un espacio; el par (tenant, code) es único", async () => {
      await expect(
        prisma.withTenantContext(tenantA, (tx) =>
          tx.expenseCategory.create({ data: { tenantId: tenantA, code: "Mal Código", name: "X" } }),
        ),
      ).rejects.toThrow();
      await expect(
        prisma.withTenantContext(tenantA, (tx) =>
          tx.expenseCategory.create({ data: { tenantId: tenantA, code: "blank", name: "   " } }),
        ),
      ).rejects.toThrow();
      await expect(
        prisma.withTenantContext(tenantA, (tx) =>
          tx.expenseCategory.create({
            data: { tenantId: tenantA, code: "rent", name: "Otra renta" },
          }),
        ),
      ).rejects.toMatchObject({ code: "P2002" });
    });
  });

  describe("CHECKs de expenses", () => {
    it("un gasto mínimo nace activo, pendiente y sin método de pago", async () => {
      const creado = await crear();
      expect(creado.status).toBe("active");
      expect(creado.paymentStatus).toBe("pending");
      expect(creado.paymentMethod).toBeNull();
      expect(creado.taxRates).toEqual([]);
    });

    it("pagado sin método o sin fecha revienta; con los dos pasa", async () => {
      await expect(crear({ paymentStatus: "paid" })).rejects.toThrow();
      await expect(crear({ paymentStatus: "paid", paymentMethod: "cash" })).rejects.toThrow();
      await expect(
        crear({ paymentStatus: "paid", paymentMethod: "card", paidAt: new Date() }),
      ).resolves.toMatchObject({ paymentStatus: "paid" });
    });

    it("una sesión de caja solo con efectivo", async () => {
      const sesion = await prisma.withTenantContext(tenantA, (tx) =>
        tx.cashboxSession.create({
          data: { tenantId: tenantA, warehouseId: warehouseA, openedBy: userA },
        }),
      );
      await expect(
        crear({
          paymentStatus: "paid",
          paymentMethod: "transfer",
          paidAt: new Date(),
          cashboxSessionId: sesion.id,
        }),
      ).rejects.toThrow();
      await expect(
        crear({
          paymentStatus: "paid",
          paymentMethod: "cash",
          paidAt: new Date(),
          cashboxSessionId: sesion.id,
        }),
      ).resolves.toMatchObject({ cashboxSessionId: sesion.id });
    });

    it("anulado exige quién, cuándo y por qué", async () => {
      await expect(crear({ status: "canceled" })).rejects.toThrow();
      await expect(
        crear({ status: "canceled", canceledAt: new Date(), canceledBy: userA }),
      ).rejects.toThrow();
      await expect(
        crear({
          status: "canceled",
          canceledAt: new Date(),
          canceledBy: userA,
          cancelReason: "duplicado",
        }),
      ).resolves.toMatchObject({ status: "canceled" });
    });

    it("proveedor y beneficiario son excluyentes; un descuento mayor al monto revienta", async () => {
      await expect(crear({ supplierId: proveedorA, beneficiary: "Don Pepe" })).rejects.toThrow();
      await expect(crear({ supplierId: proveedorA })).resolves.toMatchObject({
        supplierId: proveedorA,
      });
      await expect(crear({ discount: new Prisma.Decimal(200) })).rejects.toThrow();
      await expect(
        crear({ amount: new Prisma.Decimal(0), total: new Prisma.Decimal(0) }),
      ).rejects.toThrow();
    });

    it("un impuesto sin grupo revienta; un modo fiscal fuera del catálogo también", async () => {
      await expect(crear({ taxAmount: new Prisma.Decimal(16) })).rejects.toThrow();
      await expect(
        crear({ taxAmount: new Prisma.Decimal(16), taxGroupCode: "IVA16" }),
      ).resolves.toMatchObject({ taxGroupCode: "IVA16" });
      await expect(crear({ taxMode: "raro" })).rejects.toThrow();
    });
  });

  describe("las FK son RESTRICT", () => {
    it("borrar una categoría o un proveedor en uso rebota con P2003", async () => {
      await expect(
        prisma.withTenantContext(tenantA, (tx) =>
          tx.expenseCategory.delete({ where: { id: categoriaA } }),
        ),
      ).rejects.toMatchObject({ code: "P2003" });
      await expect(
        prisma.withTenantContext(tenantA, (tx) =>
          tx.supplier.delete({ where: { id: proveedorA } }),
        ),
      ).rejects.toMatchObject({ code: "P2003" });
    });
  });
});
