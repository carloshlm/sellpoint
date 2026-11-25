import { randomUUID } from "node:crypto";
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
  makePlatformAdmin,
  registerTenant,
  setTenantMarket,
  type TenantFixture,
} from "./support/billing-scenario";
import { startTestApp } from "./support/start-test-app";

interface Pagina {
  rows: {
    kind: string;
    name: string;
    revenue: string;
    cost: string | null;
    profit: string | null;
  }[];
  totals: { revenue: string; cost: string | null; profit: string | null } | null;
  total: number;
}

/**
 * F10-RPT-04 — «Más vendidos», «Mayor utilidad» y «Vendidos bajo su costo»
 * también desde el expediente del backoffice: el espejo de `GET reports/items`
 * bajo `/admin/tenants/:tenantId`, con el actor sintético y alcance total.
 *
 * El negocio B vende por el camino real del cobro (exento, para que la venta
 * sin impuesto sea el precio): Queso 1 × $200 con costo $150, Pan 4 × $10 con
 * costo $12 y Planchado 2 × $20 con costo $26. El negocio del admin no vende
 * nada: lo que el reporte traiga es de B.
 */
describe("Reporte por artículo en el expediente (F10-RPT-04)", () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let admin: TenantFixture;
  let negocioB: TenantFixture;

  const ruta = (sufijo: string) => `/admin/tenants/${negocioB.tenantId}/${sufijo}`;
  const comoAdmin = (sufijo: string) =>
    request(app.getHttpServer()).get(ruta(sufijo)).set("Authorization", bearer(admin.token));
  const pagina = async (sufijo: string): Promise<Pagina> =>
    (await comoAdmin(sufijo).expect(200)).body as Pagina;
  const postB = (url: string, body: object = {}) =>
    request(app.getHttpServer()).post(url).set("Authorization", bearer(negocioB.token)).send(body);

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(MAILER)
      .useClass(NoopMailer)
      .compile();
    app = moduleFixture.createNestApplication();
    await startTestApp(app);
    prisma = app.get(PrismaService);

    admin = await registerTenant(app, "expediente-articulos-admin");
    await makePlatformAdmin(app, prisma, admin);
    negocioB = await registerTenant(app, "expediente-articulos-b");
    await setTenantMarket(prisma, negocioB.tenantId, "MX");
    const almacen = await almacenInicial(prisma, negocioB.tenantId);

    await request(app.getHttpServer())
      .put("/tenants/me/taxes")
      .set("Authorization", bearer(negocioB.token))
      .send({
        mode: "included",
        groups: [
          {
            code: "VAT16",
            name: "IVA 16%",
            isDefault: true,
            rates: [{ code: "VAT", name: "IVA 16%", rate: "16" }],
          },
          { code: "EXEMPT", name: "Exento", rates: [] },
        ],
      })
      .expect(200);

    const stamp = randomUUID().slice(0, 8).toUpperCase();
    const ids = await prisma.withTenantContext(negocioB.tenantId, async (tx) => {
      const tenantId = negocioB.tenantId;
      const exento = await tx.taxGroup.findFirstOrThrow({ where: { tenantId, code: "EXEMPT" } });
      const producto = async (sku: string, name: string, price: number, cost: number) => {
        const p = await tx.product.create({
          data: { tenantId, sku, name, taxGroupId: exento.id },
        });
        await tx.productPresentation.create({
          data: {
            tenantId,
            productId: p.id,
            name: "Pieza",
            factor: 1,
            allowFractionalInput: false,
            isDefaultSale: true,
            price,
            cost,
          },
        });
        await tx.stockByWarehouse.create({
          data: { tenantId, productId: p.id, warehouseId: almacen, quantity: 100 },
        });
        return p.id;
      };
      const queso = await producto(`QUESO-${stamp}`, "Queso fresco", 200, 150);
      const pan = await producto(`PAN-${stamp}`, "Pan", 10, 12);
      const planchado = await tx.service.create({
        data: {
          tenantId,
          code: `PLA-${stamp}`,
          name: "Planchado",
          price: 20,
          cost: 26,
          taxGroupId: exento.id,
        },
      });
      await tx.serviceWarehouse.create({
        data: { tenantId, serviceId: planchado.id, warehouseId: almacen },
      });
      return { queso, pan, planchado: planchado.id };
    });

    await postB("/pos/session", { warehouseId: almacen }).expect(201);
    await postB("/pos/sales", {
      paymentMethod: "cash",
      lines: [
        { productId: ids.queso, quantity: 1 },
        { productId: ids.pan, quantity: 4 },
        { serviceId: ids.planchado, quantity: 2 },
      ],
    }).expect(201);
    await postB("/pos/session/close", { declaredCash: 0 }).expect(200);
  });

  afterAll(async () => {
    await app.close();
  });

  it("un TenantAdmin normal recibe 403 en el reporte y en su Excel, no 402", async () => {
    for (const sufijo of [
      "reports/items",
      "reports/items?view=below-cost",
      "reports/items/export?format=xlsx",
    ]) {
      await request(app.getHttpServer())
        .get(ruta(sufijo))
        .set("Authorization", bearer(negocioB.token))
        .expect(403);
    }
  });

  it("las tres vistas traen los artículos de B, con los filtros del reporte del negocio", async () => {
    const masVendidos = await pagina("reports/items");
    expect(masVendidos.rows.map((f) => [f.name, f.revenue])).toEqual([
      ["Queso fresco", "200.00"],
      ["Pan", "40.00"],
      ["Planchado", "40.00"],
    ]);

    const utilidad = await pagina("reports/items?view=top-profit");
    expect(utilidad.rows.map((f) => [f.name, f.profit])).toEqual([["Queso fresco", "50.00"]]);

    const perdidas = await pagina("reports/items?view=below-cost");
    expect(perdidas.rows.map((f) => [f.kind, f.name, f.cost, f.profit])).toEqual([
      ["service", "Planchado", "52.00", "-12.00"],
      ["product", "Pan", "48.00", "-8.00"],
    ]);
    expect(perdidas.totals).toMatchObject({ revenue: "80.00", cost: "100.00", profit: "-20.00" });

    const servicios = await pagina("reports/items?view=below-cost&type=service");
    expect(servicios.rows.map((f) => f.name)).toEqual(["Planchado"]);
  });

  it("un filtro que el reporte no conoce responde 400, como en el negocio", async () => {
    await comoAdmin("reports/items?status=completed").expect(400);
  });

  it("el Excel baja los artículos de B con el nombre del negocio", async () => {
    const archivo = await comoAdmin("reports/items/export?view=below-cost&format=csv")
      .buffer(true)
      .parse((r, cb) => {
        const chunks: Buffer[] = [];
        r.on("data", (c: Buffer) => chunks.push(c));
        r.on("end", () => cb(null, Buffer.concat(chunks)));
      })
      .expect(200);

    expect(archivo.headers["content-disposition"]).toMatch(
      /^attachment; filename="negocio-expediente-articulos-b-[a-z0-9]+-vendidos-bajo-su-costo\.csv"$/,
    );
    const renglones = (archivo.body as Buffer).toString("utf8").replace(/^﻿/, "").trim().split("\n");
    expect(renglones).toHaveLength(3);
    expect(renglones[1]).toContain("Planchado");
    expect(renglones[2]).toContain("Pan");
  });
});
