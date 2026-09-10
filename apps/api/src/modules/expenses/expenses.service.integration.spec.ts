import { ConfigService } from "@nestjs/config";
import type { Env } from "../../config/env.schema";
import { Prisma } from "../../generated/prisma/client";
import { PrismaService } from "../../infrastructure/prisma/prisma.service";
import type { AuthUser } from "../auth/types/auth-user";
import { ExpensesService } from "./expenses.service";

/**
 * Integration (Postgres real) — F9-EXP-05/06: el service de Gastos con la
 * aritmética fiscal de verdad.
 *
 * Lo que fija: el folio correlativo `GAS-000001`; `included` 116 con IVA 16
 * → total 116, impuesto 16, base 100; `excluded` 100 → 116; el descuento
 * reduce la base; un descuento mayor al monto es 422 con la clave del
 * módulo; el gasto en efectivo exige una sesión ABIERTA del mismo almacén;
 * pendiente nace sin método; pagar/anular/editar con sus 409.
 */
describe("ExpensesService (F9-EXP-05/06)", () => {
  let prisma: PrismaService;
  let service: ExpensesService;
  let tenantId: string;
  let user: AuthUser;
  let warehouseId: string;
  let otroAlmacen: string;
  let categoryId: string;
  let iva16: string;
  const SCOPE = { warehouseIds: "all" as const };
  const META = { ip: "127.0.0.1", userAgent: "jest" };
  const audit = { record: jest.fn() };

  const base = () => ({
    expenseDate: "2026-09-10",
    categoryId,
    description: "Renta de septiembre",
    amount: 116,
    discount: 0,
  });

  beforeAll(async () => {
    prisma = new PrismaService(
      new ConfigService<Env, true>({ DATABASE_URL: process.env.DATABASE_URL }),
    );
    await prisma.onModuleInit();
    // biome-ignore lint/suspicious/noExplicitAny: el audit se mockea a propósito
    service = new ExpensesService(prisma, audit as any);
    const stamp = Date.now();
    tenantId = (await prisma.tenant.create({ data: { name: `ExpSvc ${stamp}` } })).id;
    await prisma.withTenantContext(tenantId, async (tx) => {
      const creado = await tx.user.create({
        data: { tenantId, email: `expsvc-${stamp}@example.com`, firstName: "Ana", lastName: "P" },
      });
      user = { userId: creado.id, tenantId, permissions: [], locale: "es" };
      warehouseId = (await tx.warehouse.create({ data: { tenantId, code: "ALM-001", name: "C" } }))
        .id;
      otroAlmacen = (await tx.warehouse.create({ data: { tenantId, code: "ALM-002", name: "N" } }))
        .id;
      await tx.user.update({ where: { id: creado.id }, data: { defaultWarehouseId: warehouseId } });
      categoryId = (
        await tx.expenseCategory.create({ data: { tenantId, code: "rent", name: "Renta" } })
      ).id;
      const grupo = await tx.taxGroup.create({
        data: { tenantId, code: "VAT16", name: "IVA 16 %", isDefault: true },
      });
      iva16 = grupo.id;
      await tx.taxRate.create({
        data: {
          tenantId,
          taxGroupId: iva16,
          code: "IVA",
          name: "IVA",
          rate: new Prisma.Decimal(16),
        },
      });
    });
  });

  afterAll(async () => {
    await prisma.onModuleDestroy();
  });

  it("el folio es correlativo y el gasto pendiente nace sin método de pago", async () => {
    const primero = await service.create(user, SCOPE, base(), META);
    const segundo = await service.create(user, SCOPE, base(), META);
    expect(primero.folio).toBe("GAS-000001");
    expect(segundo.folio).toBe("GAS-000002");
    expect(primero).toMatchObject({
      status: "active",
      paymentStatus: "pending",
      paymentMethod: null,
      paidAt: null,
      warehouseId,
      categoryName: "Renta",
    });
  });

  it("`included`: 116 con IVA 16 → total 116, impuesto 16 y base 100 en el snapshot", async () => {
    const gasto = await service.create(user, SCOPE, base(), META);
    expect(gasto.total).toBe("116");
    expect(gasto.taxAmount).toBe("16");
    expect(gasto.taxGroupCode).toBe("VAT16");
    expect(gasto.taxMode).toBe("included");
    expect(gasto.taxRates).toEqual([
      { code: "IVA", name: "IVA", rate: "16", base: "100", amount: "16", sortOrder: 0 },
    ]);
  });

  it("`excluded`: 100 con IVA 16 → total 116", async () => {
    await prisma.tenant.update({ where: { id: tenantId }, data: { taxMode: "excluded" } });
    try {
      const gasto = await service.create(user, SCOPE, { ...base(), amount: 100 }, META);
      expect(gasto.total).toBe("116");
      expect(gasto.taxAmount).toBe("16");
      expect(gasto.taxMode).toBe("excluded");
    } finally {
      await prisma.tenant.update({ where: { id: tenantId }, data: { taxMode: "included" } });
    }
  });

  it("el descuento reduce la base; mayor al monto es 422 con la clave del módulo", async () => {
    const gasto = await service.create(user, SCOPE, { ...base(), amount: 100, discount: 20 }, META);
    expect(gasto.total).toBe("80");
    expect(gasto.taxRates[0]?.base).toBe("68.97");
    await expect(
      service.create(user, SCOPE, { ...base(), amount: 100, discount: 200 }, META),
    ).rejects.toMatchObject({ response: { message: "expenses.discount_exceeds_amount" } });
  });

  it("`taxGroupId: null` es sin impuesto; uno ajeno es 422", async () => {
    const sinIva = await service.create(user, SCOPE, { ...base(), taxGroupId: null }, META);
    expect(sinIva.taxAmount).toBe("0");
    expect(sinIva.taxGroupCode).toBeNull();
    await expect(
      service.create(
        user,
        SCOPE,
        { ...base(), taxGroupId: "00000000-0000-0000-0000-000000000000" },
        META,
      ),
    ).rejects.toMatchObject({ status: 422 });
  });

  describe("el gasto en efectivo y la caja", () => {
    // Un cajero tiene UN turno abierto (UNIQUE parcial): abrir otro cierra el
    // anterior, como haría el cierre real.
    const sesion = (extra: Record<string, unknown> = {}) =>
      prisma.withTenantContext(tenantId, async (tx) => {
        await tx.cashboxSession.updateMany({
          where: { tenantId, openedBy: user.userId, status: "open" },
          data: { status: "closed", closedAt: new Date(), closedBy: user.userId },
        });
        return tx.cashboxSession.create({
          data: { tenantId, warehouseId, openedBy: user.userId, ...extra },
        });
      });

    it("se liga a un turno ABIERTO del mismo almacén; cerrado o de otro almacén es 409", async () => {
      const abierta = await sesion();
      const ligado = await service.create(
        user,
        SCOPE,
        { ...base(), paymentMethod: "cash", cashboxSessionId: abierta.id },
        META,
      );
      expect(ligado).toMatchObject({ paymentStatus: "paid", cashboxSessionId: abierta.id });
      expect(ligado.paidAt).not.toBeNull();

      const cerrada = await sesion({
        status: "closed",
        closedAt: new Date(),
        closedBy: user.userId,
      });
      await expect(
        service.create(
          user,
          SCOPE,
          { ...base(), paymentMethod: "cash", cashboxSessionId: cerrada.id },
          META,
        ),
      ).rejects.toMatchObject({ response: { message: "expenses.session_not_open" } });

      const ajena = await sesion({ warehouseId: otroAlmacen });
      await expect(
        service.create(
          user,
          SCOPE,
          { ...base(), paymentMethod: "cash", cashboxSessionId: ajena.id },
          META,
        ),
      ).rejects.toMatchObject({ response: { message: "expenses.session_not_open" } });
    });

    it("anular uno ligado a una sesión CERRADA es 409; a una abierta, se anula", async () => {
      const abierta = await sesion();
      const gasto = await service.create(
        user,
        SCOPE,
        { ...base(), paymentMethod: "cash", cashboxSessionId: abierta.id },
        META,
      );
      await prisma.withTenantContext(tenantId, (tx) =>
        tx.cashboxSession.update({
          where: { id: abierta.id },
          data: { status: "closed", closedAt: new Date(), closedBy: user.userId },
        }),
      );
      await expect(
        service.cancel(user, gasto.id, { reason: "duplicado" }, META),
      ).rejects.toMatchObject({ response: { message: "expenses.session_closed" } });

      const viva = await sesion();
      const otro = await service.create(
        user,
        SCOPE,
        { ...base(), paymentMethod: "cash", cashboxSessionId: viva.id },
        META,
      );
      const anulado = await service.cancel(user, otro.id, { reason: "duplicado" }, META);
      expect(anulado.status).toBe("canceled");
      expect(anulado.cancelReason).toBe("duplicado");
    });
  });

  describe("pagar, anular y editar", () => {
    it("pagar es entero y una sola vez: la segunda es 409", async () => {
      const gasto = await service.create(user, SCOPE, base(), META);
      const pagado = await service.pay(
        user,
        SCOPE,
        gasto.id,
        { paymentMethod: "transfer", accountRef: "BBVA" },
        META,
      );
      expect(pagado).toMatchObject({
        paymentStatus: "paid",
        paymentMethod: "transfer",
        accountRef: "BBVA",
      });
      await expect(
        service.pay(user, SCOPE, gasto.id, { paymentMethod: "cash" }, META),
      ).rejects.toMatchObject({ response: { message: "expenses.already_paid" } });
    });

    it("anular dos veces es 409, y un anulado no se paga ni se edita", async () => {
      const gasto = await service.create(user, SCOPE, base(), META);
      await service.cancel(user, gasto.id, { reason: "error de captura" }, META);
      await expect(
        service.cancel(user, gasto.id, { reason: "otra vez" }, META),
      ).rejects.toMatchObject({ response: { message: "expenses.already_canceled" } });
      await expect(
        service.pay(user, SCOPE, gasto.id, { paymentMethod: "cash" }, META),
      ).rejects.toMatchObject({ response: { message: "expenses.already_canceled" } });
      await expect(service.update(user, gasto.id, { notes: "x" }, META)).rejects.toMatchObject({
        response: { message: "expenses.already_canceled" },
      });
    });

    it("pendiente se edita entero y recalcula; pagado solo lo que no mueve dinero", async () => {
      const gasto = await service.create(user, SCOPE, base(), META);
      const editado = await service.update(
        user,
        gasto.id,
        { amount: 232, notes: "dos meses" },
        META,
      );
      expect(editado.total).toBe("232");
      expect(editado.taxAmount).toBe("32");
      expect(editado.notes).toBe("dos meses");

      await service.pay(user, SCOPE, gasto.id, { paymentMethod: "card" }, META);
      await expect(service.update(user, gasto.id, { amount: 100 }, META)).rejects.toMatchObject({
        response: { message: "expenses.paid_immutable" },
      });
      const notas = await service.update(user, gasto.id, { notes: "ok", reference: "F-1" }, META);
      expect(notas).toMatchObject({ notes: "ok", reference: "F-1", total: "232" });
    });

    it("un proveedor y un beneficiario se excluyen: poner uno limpia al otro", async () => {
      const proveedor = await prisma.withTenantContext(tenantId, (tx) =>
        tx.supplier.create({ data: { tenantId, name: "Inmobiliaria" } }),
      );
      const gasto = await service.create(user, SCOPE, { ...base(), beneficiary: "Don Pepe" }, META);
      const conProveedor = await service.update(user, gasto.id, { supplierId: proveedor.id }, META);
      expect(conProveedor).toMatchObject({ supplierId: proveedor.id, beneficiary: null });
    });
  });

  describe("listar", () => {
    it("filtra por día del negocio (DATE con DATE) y por estado de pago; ordena del más reciente", async () => {
      const viejo = await service.create(
        user,
        SCOPE,
        { ...base(), expenseDate: "2026-01-05" },
        META,
      );
      const lista = await service.list(user, SCOPE, {
        from: "2026-01-05",
        to: "2026-01-05",
        page: 1,
        pageSize: 20,
      });
      expect(lista.rows.map((r) => r.id)).toEqual([viejo.id]);
      const pendientes = await service.list(user, SCOPE, {
        paymentStatus: "pending",
        page: 1,
        pageSize: 100,
      });
      expect(pendientes.rows.every((r) => r.paymentStatus === "pending")).toBe(true);
      expect(pendientes.rows.length).toBeGreaterThan(1);
      const fechas = pendientes.rows.map((r) => r.expenseDate);
      expect([...fechas].sort().reverse()).toEqual(fechas);
    });

    it("el alcance acota: un scope sin el almacén no ve nada", async () => {
      const lista = await service.list(
        user,
        { warehouseIds: [otroAlmacen] },
        { page: 1, pageSize: 20 },
      );
      expect(lista.total).toBe(0);
    });
  });
});
