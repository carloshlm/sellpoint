import type { INestApplication } from "@nestjs/common";
import { Test, type TestingModule } from "@nestjs/testing";
import request from "supertest";
import type { App } from "supertest/types";
import { AppModule } from "../../src/app.module";
import { PrismaService } from "../../src/infrastructure/prisma/prisma.service";
import { MAILER } from "../../src/modules/mail/mailer.port";
import { NoopMailer } from "../../src/modules/mail/noop.mailer";
import {
  almacenInicial,
  bearer,
  cargarStock,
  crearProducto,
  registerTenant,
  setTenantMarket,
  type TenantFixture,
} from "./support/billing-scenario";
import { startTestApp } from "./support/start-test-app";

/**
 * F4-TAX-07/08 — el impuesto en la venta y en la cotización, de punta a punta.
 *
 * México (incluido): el total NO cambia por que exista el impuesto — es la
 * propiedad que hace segura la migración de los negocios existentes — y el
 * papel gana el desglose. Canadá BC (excluido): el impuesto se suma y sale
 * en DOS componentes. Y el concepto cobra el impuesto CONGELADO en la
 * cotización aunque el default del negocio sea otro y aunque la tasa cambie.
 */
describe("impuestos en la venta y la cotización (F4-TAX-07/08)", () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let mx: TenantFixture;
  let bc: TenantFixture;
  let almacenMx: string;
  let almacenBc: string;
  let exentoMx: string;

  const http = () => request(app.getHttpServer());

  /** Siembra el catálogo fiscal a mano (los endpoints llegan en F4-TAX-09). */
  async function sembrar(
    tenantId: string,
    mode: "included" | "excluded",
    grupos: {
      code: string;
      name: string;
      isDefault?: boolean;
      rates: { code: string; name: string; rate: string }[];
    }[],
  ): Promise<Record<string, string>> {
    await prisma.tenant.update({ where: { id: tenantId }, data: { taxMode: mode } });
    const ids: Record<string, string> = {};
    for (const [i, g] of grupos.entries()) {
      const creado = await prisma.withTenantContext(tenantId, (tx) =>
        tx.taxGroup.create({
          data: {
            tenantId,
            code: g.code,
            name: g.name,
            isDefault: g.isDefault ?? false,
            sortOrder: i,
            rates: {
              create: g.rates.map((r, j) => ({
                tenantId,
                code: r.code,
                name: r.name,
                rate: r.rate,
                sortOrder: j,
              })),
            },
          },
        }),
      );
      ids[g.code] = creado.id;
    }
    return ids;
  }

  async function abrirTurno(token: string) {
    await http().post("/pos/session").set("Authorization", bearer(token)).send({}).expect(201);
  }

  beforeAll(async () => {
    const moduleRef: TestingModule = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(MAILER)
      .useValue(new NoopMailer())
      .compile();
    app = moduleRef.createNestApplication<INestApplication<App>>();
    await startTestApp(app);
    prisma = app.get(PrismaService);

    mx = await registerTenant(app, "tax-mx");
    await setTenantMarket(prisma, mx.tenantId, "MX");
    almacenMx = await almacenInicial(prisma, mx.tenantId);
    const gruposMx = await sembrar(mx.tenantId, "included", [
      {
        code: "VAT16",
        name: "IVA 16%",
        isDefault: true,
        rates: [{ code: "VAT", name: "IVA 16%", rate: "16" }],
      },
      { code: "EXEMPT", name: "Exento", rates: [] },
    ]);
    exentoMx = gruposMx.EXEMPT as string;

    bc = await registerTenant(app, "tax-bc");
    await setTenantMarket(prisma, bc.tenantId, "CA");
    almacenBc = await almacenInicial(prisma, bc.tenantId);
    await sembrar(bc.tenantId, "excluded", [
      {
        code: "GST_PST",
        name: "GST 5% + PST 7%",
        isDefault: true,
        rates: [
          { code: "GST", name: "GST 5%", rate: "5" },
          { code: "PST", name: "PST 7%", rate: "7" },
        ],
      },
    ]);
  });

  afterAll(async () => {
    await app.close();
  });

  it("México: $116 sigue costando $116; el papel gana Subtotal 100 + IVA 16, y el exento no suma", async () => {
    const gravado = await crearProducto(app, mx.token, 116);
    const exento = await crearProducto(app, mx.token, 50);
    await prisma.withTenantContext(mx.tenantId, (tx) =>
      tx.product.update({ where: { id: exento.id }, data: { taxGroupId: exentoMx } }),
    );
    await cargarStock(app, mx.token, almacenMx, gravado.id, 10);
    await cargarStock(app, mx.token, almacenMx, exento.id, 10);
    await abrirTurno(mx.token);

    const venta = await http()
      .post("/pos/sales")
      .set("Authorization", bearer(mx.token))
      .send({
        paymentMethod: "cash",
        lines: [
          { productId: gravado.id, quantity: 1 },
          { productId: exento.id, quantity: 2 },
        ],
      })
      .expect(201);
    const body = venta.body as {
      total: string;
      subtotal: string;
      taxMode: string;
      taxTotal: string;
      items: { taxAmount: string; taxGroupCode: string | null; lineTotal: string }[];
      taxes: { code: string; name: string; rate: string; base: string; amount: string }[];
    };
    // Lo que se paga es EXACTAMENTE lo de antes del módulo.
    expect(body.total).toBe("216");
    expect(body.subtotal).toBe("216");
    expect(body.taxMode).toBe("included");
    expect(body.taxTotal).toBe("16");
    expect(body.items.map((i) => [i.lineTotal, i.taxAmount, i.taxGroupCode])).toEqual([
      ["116", "16", "VAT16"],
      ["100", "0", "EXEMPT"],
    ]);
    expect(body.taxes).toEqual([
      expect.objectContaining({
        code: "VAT",
        name: "IVA 16%",
        rate: "16",
        base: "100",
        amount: "16",
      }),
    ]);
  });

  it("Columbia Británica: $80 netos pagan $89.60, con GST y PST en filas separadas", async () => {
    const producto = await crearProducto(app, bc.token, 80);
    await cargarStock(app, bc.token, almacenBc, producto.id, 10);
    await abrirTurno(bc.token);

    const venta = await http()
      .post("/pos/sales")
      .set("Authorization", bearer(bc.token))
      .send({ paymentMethod: "card", lines: [{ productId: producto.id, quantity: 1 }] })
      .expect(201);
    const body = venta.body as {
      total: string;
      subtotal: string;
      taxMode: string;
      taxTotal: string;
      items: { taxAmount: string; lineTotal: string }[];
      taxes: { code: string; base: string; amount: string }[];
    };
    expect(body.taxMode).toBe("excluded");
    expect(body.subtotal).toBe("80");
    expect(body.taxTotal).toBe("9.6");
    expect(body.total).toBe("89.6");
    expect(body.items[0]).toMatchObject({ lineTotal: "89.6", taxAmount: "9.6" });
    expect(body.taxes.map((t) => [t.code, t.base, t.amount])).toEqual([
      ["GST", "80", "4"],
      ["PST", "80", "5.6"],
    ]);
  });

  it("el concepto cobra el impuesto CONGELADO en la cotización: exento aunque el default sea IVA 16%, y aunque la tasa cambie", async () => {
    const producto = await crearProducto(app, mx.token, 116);
    await cargarStock(app, mx.token, almacenMx, producto.id, 10);

    const cotizacion = await http()
      .post("/pos/quotes")
      .set("Authorization", bearer(mx.token))
      .send({
        warehouseId: almacenMx,
        lines: [
          { productId: producto.id, quantity: 1 },
          {
            concept: { description: "Biometría hemática", unitPrice: 300, taxGroupId: exentoMx },
            quantity: 1,
          },
          { concept: { description: "Flete", unitPrice: 116 }, quantity: 1 },
        ],
      })
      .expect(201);
    const cot = cotizacion.body as {
      id: string;
      folio: string;
      total: string;
      taxTotal: string;
      lines: {
        kind: string;
        taxAmount: string;
        taxGroupCode: string | null;
        taxRates: unknown[];
      }[];
      taxes: { code: string; amount: string }[];
    };
    expect(cot.total).toBe("532");
    // IVA del producto (16) + IVA del flete (16); el estudio, nada.
    expect(cot.taxTotal).toBe("32");
    expect(cot.lines.map((l) => [l.kind, l.taxAmount, l.taxGroupCode])).toEqual([
      ["product", "16", "VAT16"],
      ["concept", "0", "EXEMPT"],
      ["concept", "16", "VAT16"],
    ]);
    expect(cot.lines[2]?.taxRates).toEqual([{ code: "VAT", name: "IVA 16%", rate: "16" }]);

    // El negocio cambia su IVA a 8% (frontera) ANTES de cobrar.
    await prisma.withTenantContext(mx.tenantId, (tx) =>
      tx.taxRate.updateMany({
        where: { tenantId: mx.tenantId, code: "VAT" },
        data: { rate: "8", name: "IVA 8%" },
      }),
    );

    const paraVender = await http()
      .get(`/pos/quotes/folio/${cot.folio}/for-sale`)
      .set("Authorization", bearer(mx.token))
      .expect(200);
    const fs = paraVender.body as {
      taxMode: string;
      lines: {
        item: { type: string; tax: { groupCode: string | null; components: { rate: string }[] } };
      }[];
    };
    expect(fs.taxMode).toBe("included");
    // El producto RELEE: hoy es 8%. El concepto queda como se cotizó.
    expect(fs.lines[0]?.item.tax).toEqual({
      groupCode: "VAT16",
      components: [{ code: "VAT", name: "IVA 8%", rate: "8" }],
    });
    expect(fs.lines[1]?.item.tax).toEqual({ groupCode: "EXEMPT", components: [] });
    expect(fs.lines[2]?.item.tax).toEqual({
      groupCode: "VAT16",
      components: [{ code: "VAT", name: "IVA 16%", rate: "16" }],
    });

    const venta = await http()
      .post("/pos/sales")
      .set("Authorization", bearer(mx.token))
      .send({
        paymentMethod: "cash",
        quoteId: cot.id,
        lines: [
          { productId: producto.id, quantity: 1 },
          { quoteLineId: (cot.lines as unknown as { id: string }[])[1]?.id, quantity: 1 },
          { quoteLineId: (cot.lines as unknown as { id: string }[])[2]?.id, quantity: 1 },
        ],
      })
      .expect(201);
    const v = venta.body as {
      total: string;
      taxTotal: string;
      items: { taxAmount: string; taxGroupCode: string | null }[];
      taxes: { code: string; name: string; rate: string; amount: string }[];
    };
    // Incluido: el dinero no cambia. El producto desglosa al 8% de HOY
    // (116 → 8.59); el estudio 0; el flete al 16% CONGELADO (16).
    expect(v.total).toBe("532");
    expect(v.items.map((i) => [i.taxAmount, i.taxGroupCode])).toEqual([
      ["8.59", "VAT16"],
      ["0", "EXEMPT"],
      ["16", "VAT16"],
    ]);
    expect(v.taxTotal).toBe("24.59");
    // Un solo componente `VAT` en el papel, con la suma de los dos.
    expect(v.taxes.map((t) => [t.code, t.amount])).toEqual([["VAT", "24.59"]]);
  });
});
