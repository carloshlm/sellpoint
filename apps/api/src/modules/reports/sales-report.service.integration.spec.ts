import { randomUUID } from "node:crypto";
import { ConfigService } from "@nestjs/config";
import type { Env } from "../../config/env.schema";
import { PrismaService } from "../../infrastructure/prisma/prisma.service";
import { salesReportQuerySchema } from "./dto/sales-report.dto";
import { SalesReportService } from "./sales-report.service";

/**
 * F10-KPI-11 — el reporte «Ventas» lee el descuento y los motivos
 * (integration, Postgres real).
 *
 * La tarjeta «Control» del panel dirá CUÁNTO se fue en descuentos y
 * cancelaciones; este reporte tiene que decir CUÁLES, quién y por qué. Por
 * eso cada venta trae su descuento (el TOTAL de la venta: el de sus líneas más
 * el del ticket, que es lo que `sales.discount` ya guarda), el motivo del
 * descuento, el de la cancelación, cuándo y quién canceló; el filtro «Solo con
 * descuento»; y el total de descuentos del periodo, que solo suma lo cobrado.
 */
describe("SalesReportService — descuentos y motivos (integration)", () => {
  let prisma: PrismaService;
  let service: SalesReportService;

  let tenantId: string;
  let anaId: string;
  let luisId: string;
  const SCOPE = { warehouseIds: "all" as const };
  const usuario = () => ({
    userId: anaId,
    tenantId,
    permissions: ["reports:read"],
    locale: "es" as const,
  });
  /** La consulta tal como la deja el schema del controller. */
  const consulta = (crudo: Record<string, unknown> = {}) => salesReportQuerySchema.parse(crudo);

  const folios = {
    conMotivo: `KPI-A-${randomUUID().slice(0, 6)}`,
    sinMotivo: `KPI-B-${randomUUID().slice(0, 6)}`,
    sinDescuento: `KPI-C-${randomUUID().slice(0, 6)}`,
    cancelada: `KPI-D-${randomUUID().slice(0, 6)}`,
  };
  const CANCELADA_EN = new Date("2026-11-20T18:30:00.000Z");

  beforeAll(async () => {
    prisma = new PrismaService(
      new ConfigService<Env, true>({ DATABASE_URL: process.env.DATABASE_URL }),
    );
    await prisma.onModuleInit();
    service = new SalesReportService(prisma);

    const tenant = await prisma.tenant.create({
      data: { name: `Descuentos ${randomUUID().slice(0, 6)}`, timezone: "America/Mexico_City" },
    });
    tenantId = tenant.id;
    await prisma.withTenantContext(tenantId, async (tx) => {
      const [ana, luis] = await Promise.all([
        tx.user.create({
          data: {
            tenantId,
            email: `ana-${randomUUID()}@example.com`,
            firstName: "Ana",
            lastName: "Pérez",
          },
        }),
        tx.user.create({
          data: {
            tenantId,
            email: `luis-${randomUUID()}@example.com`,
            firstName: "Luis",
            lastName: "Cajero",
          },
        }),
      ]);
      anaId = ana.id;
      luisId = luis.id;
      const almacen = await tx.warehouse.create({
        data: { tenantId, code: `WH-${Math.random().toString(36).slice(2, 10)}`, name: "Central" },
      });
      const turno = await tx.cashboxSession.create({
        data: {
          folio: `TUR-${randomUUID().slice(0, 8)}`,
          tenantId,
          warehouseId: almacen.id,
          openedBy: ana.id,
        },
      });
      const base = {
        tenantId,
        warehouseId: almacen.id,
        cashboxSessionId: turno.id,
        createdBy: ana.id,
      };
      await tx.sale.createMany({
        data: [
          {
            ...base,
            folio: folios.conMotivo,
            status: "completed",
            paymentMethod: "cash",
            subtotal: "120.00",
            discount: "20.00",
            discountReason: "Cliente frecuente",
            total: "100.00",
          },
          {
            ...base,
            folio: folios.sinMotivo,
            status: "completed",
            paymentMethod: "card",
            subtotal: "50.00",
            discount: "5.50",
            total: "44.50",
          },
          {
            ...base,
            folio: folios.sinDescuento,
            status: "completed",
            paymentMethod: "cash",
            subtotal: "80.00",
            discount: "0.00",
            total: "80.00",
          },
          {
            ...base,
            folio: folios.cancelada,
            status: "canceled",
            paymentMethod: "cash",
            subtotal: "60.00",
            discount: "10.00",
            discountReason: "Promoción",
            total: "50.00",
            // `canceled_by` y `canceled_at` van en pareja: lo exige el CHECK
            // `sales_canceled_coherent`.
            canceledBy: luis.id,
            canceledAt: CANCELADA_EN,
            cancelReason: "Se equivocó de producto",
          },
        ],
      });
    });
  });

  afterAll(async () => {
    await prisma.onModuleDestroy();
  });

  it("cada venta trae su descuento, sus motivos y quién la canceló", async () => {
    const { rows } = await service.list(usuario(), SCOPE, consulta());
    const porFolio = new Map(rows.map((r) => [r.folio, r]));

    expect(porFolio.get(folios.conMotivo)).toMatchObject({
      discount: "20.00",
      discountReason: "Cliente frecuente",
      cancelReason: null,
      canceledAt: null,
      canceledBy: null,
    });
    // Sin descuento es un CERO real (no hubo descuento), no un dato que falta.
    expect(porFolio.get(folios.sinDescuento)).toMatchObject({
      discount: "0.00",
      discountReason: null,
    });
    expect(porFolio.get(folios.cancelada)).toMatchObject({
      discount: "10.00",
      discountReason: "Promoción",
      cancelReason: "Se equivocó de producto",
      canceledAt: CANCELADA_EN.toISOString(),
      canceledBy: { id: luisId, name: "Luis Cajero" },
    });
  });

  it("«Solo con descuento» deja fuera las ventas sin descuento, también al contar", async () => {
    const todas = await service.list(usuario(), SCOPE, consulta());
    const conDescuento = await service.list(usuario(), SCOPE, consulta({ discounted: "true" }));

    expect(todas.total).toBe(4);
    expect(conDescuento.total).toBe(3);
    expect(conDescuento.rows.map((r) => r.folio).sort()).toEqual(
      [folios.conMotivo, folios.sinMotivo, folios.cancelada].sort(),
    );
    // El export cuenta con `count`: tiene que contar lo mismo que la tabla.
    expect(await service.count(usuario(), SCOPE, consulta({ discounted: "true" }))).toBe(3);
    // `discounted=false` es la consulta de siempre.
    expect((await service.list(usuario(), SCOPE, consulta({ discounted: "false" }))).total).toBe(4);
  });

  it("el total de descuentos es de todo el periodo y solo de lo cobrado", async () => {
    // Una venta por página: el total no puede salir de la página.
    const pagina = await service.list(usuario(), SCOPE, consulta({ pageSize: "1" }));

    expect(pagina.rows).toHaveLength(1);
    // 20.00 + 5.50: la cancelada (10.00) no suma, de ella no entró dinero.
    expect(pagina.discountTotal).toBe("25.50");
  });

  it("el total de descuentos respeta los filtros: con Estado = Cancelada es 0.00", async () => {
    const canceladas = await service.list(usuario(), SCOPE, consulta({ status: "canceled" }));
    const futuro = await service.list(usuario(), SCOPE, consulta({ from: "2099-01-01" }));

    expect(canceladas.total).toBe(1);
    expect(canceladas.discountTotal).toBe("0.00");
    expect(futuro.total).toBe(0);
    expect(futuro.discountTotal).toBe("0.00");
  });

  /**
   * Lo de siempre no cambia: los totales por forma de pago siguen siendo de
   * las cobradas, y con «Solo con descuento» suman lo que la tabla lista.
   */
  it("el pie por forma de pago sigue igual, y con el filtro suma lo que la tabla lista", async () => {
    const metodos = async (crudo: Record<string, unknown>) =>
      new Map(
        (await service.list(usuario(), SCOPE, consulta(crudo))).totals.map((t) => [
          t.paymentMethod,
          t.total,
        ]),
      );

    const todas = await metodos({});
    expect(todas.get("cash")).toBe("180.00");
    expect(todas.get("card")).toBe("44.50");
    const conDescuento = await metodos({ discounted: "true" });
    expect(conDescuento.get("cash")).toBe("100.00");
    expect(conDescuento.get("card")).toBe("44.50");
  });
});
