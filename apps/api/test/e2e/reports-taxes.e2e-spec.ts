import { randomUUID } from "node:crypto";
import type { INestApplication } from "@nestjs/common";
import { Test, type TestingModule } from "@nestjs/testing";
import request from "supertest";
import type { App } from "supertest/types";
import { AppModule } from "../../src/app.module";
import { PrismaService } from "../../src/infrastructure/prisma/prisma.service";
import { TokenService } from "../../src/modules/auth/services/token.service";
import { MAILER } from "../../src/modules/mail/mailer.port";
import { NoopMailer } from "../../src/modules/mail/noop.mailer";
import {
  almacenInicial,
  bearer,
  cargarStock,
  crearProducto,
  registerTenant,
  type TenantFixture,
} from "./support/billing-scenario";
import { startTestApp } from "./support/start-test-app";

interface FilaImpuesto {
  code: string;
  name: string;
  rate: string;
  base: string;
  amount: string;
  tickets: number;
}

interface Reporte {
  rows: FilaImpuesto[];
  totals: { gross: string; net: string; tax: string; tickets: number };
}

/**
 * F4-TAX-21 — el reporte de impuestos cobrados: lo que el negocio declara.
 * Agrupa `sale_taxes` por componente y tasa, SOLO de ventas cobradas, en el
 * calendario del negocio; anular una venta la saca de acá igual que de la
 * caja. Un negocio canadiense en excluido: cada venta de 100 lleva GST 5 y
 * PST 7.
 */
describe("Reporte de impuestos cobrados (F4-TAX-21)", () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let tokenService: TokenService;
  let negocio: TenantFixture;
  let almacenId: string;
  let ventaAnulableId: string;

  const get = (token: string, url: string) =>
    request(app.getHttpServer()).get(url).set("Authorization", bearer(token));
  const post = (token: string, url: string, body: object = {}) =>
    request(app.getHttpServer()).post(url).set("Authorization", bearer(token)).send(body);
  const descargar = (token: string, url: string) =>
    get(token, url)
      .buffer(true)
      .parse((r, cb) => {
        const chunks: Buffer[] = [];
        r.on("data", (c: Buffer) => chunks.push(c));
        r.on("end", () => cb(null, Buffer.concat(chunks)));
      });

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(MAILER)
      .useClass(NoopMailer)
      .compile();
    app = moduleFixture.createNestApplication();
    await startTestApp(app);
    prisma = app.get(PrismaService);
    tokenService = app.get(TokenService);

    negocio = await registerTenant(app, "tax-report");
    almacenId = await almacenInicial(prisma, negocio.tenantId);
    await request(app.getHttpServer())
      .put("/tenants/me/taxes")
      .set("Authorization", bearer(negocio.token))
      .send({
        mode: "excluded",
        groups: [
          {
            code: "GST_PST",
            name: "GST 5% + PST 7%",
            isDefault: true,
            rates: [
              { code: "GST", name: "GST 5%", rate: "5" },
              { code: "PST", name: "PST 7%", rate: "7" },
            ],
          },
        ],
      })
      .expect(200);

    const producto = await crearProducto(app, negocio.token, 100);
    await cargarStock(app, negocio.token, almacenId, producto.id, 10);
    await post(negocio.token, "/pos/session").expect(201);
    // Dos ventas de 100 neto: 112 cada una, con GST 5 y PST 7.
    const primera = await post(negocio.token, "/pos/sales", {
      paymentMethod: "cash",
      lines: [{ productId: producto.id, quantity: 1 }],
    }).expect(201);
    ventaAnulableId = (primera.body as { id: string }).id;
    await post(negocio.token, "/pos/sales", {
      paymentMethod: "card",
      lines: [{ productId: producto.id, quantity: 1 }],
    }).expect(201);
  });

  afterAll(async () => {
    await app.close();
  });

  it("agrupa lo cobrado por componente y tasa; el pie suma bruto, neto e impuesto", async () => {
    const res = await get(negocio.token, "/reports/taxes").expect(200);
    const reporte = res.body as Reporte;
    expect(reporte.rows).toEqual([
      { code: "GST", name: "GST 5%", rate: "5", base: "200.00", amount: "10.00", tickets: 2 },
      { code: "PST", name: "PST 7%", rate: "7", base: "200.00", amount: "14.00", tickets: 2 },
    ]);
    expect(reporte.totals).toEqual({ gross: "224.00", net: "200.00", tax: "24.00", tickets: 2 });
  });

  it("el rango es del calendario del negocio y el almacén filtra", async () => {
    const vacio = await get(negocio.token, "/reports/taxes?from=2000-01-01&to=2000-01-02").expect(
      200,
    );
    expect((vacio.body as Reporte).rows).toEqual([]);
    expect((vacio.body as Reporte).totals).toEqual({
      gross: "0.00",
      net: "0.00",
      tax: "0.00",
      tickets: 0,
    });

    const otroAlmacen = await get(
      negocio.token,
      `/reports/taxes?warehouseId=${randomUUID()}`,
    ).expect(200);
    expect((otroAlmacen.body as Reporte).rows).toEqual([]);
    const elSuyo = await get(negocio.token, `/reports/taxes?warehouseId=${almacenId}`).expect(200);
    expect((elSuyo.body as Reporte).totals.tickets).toBe(2);

    await get(negocio.token, "/reports/taxes?from=ayer").expect(400);
  });

  it("anular una venta la saca del reporte, igual que de las ventas cobradas", async () => {
    await post(negocio.token, `/pos/sales/${ventaAnulableId}/cancel`, { reason: "e2e" }).expect(
      200,
    );
    const res = await get(negocio.token, "/reports/taxes").expect(200);
    const reporte = res.body as Reporte;
    expect(reporte.rows.map((f) => [f.code, f.amount, f.tickets])).toEqual([
      ["GST", "5.00", 1],
      ["PST", "7.00", 1],
    ]);
    expect(reporte.totals).toEqual({ gross: "112.00", net: "100.00", tax: "12.00", tickets: 1 });

    const ventas = await get(negocio.token, "/reports/sales").expect(200);
    const totales = (ventas.body as { totals: { paymentMethod: string; total: string }[] }).totals;
    expect(totales).toEqual([{ paymentMethod: "card", total: "112.00" }]);
  });

  it("exporta las mismas cifras con el nombre y el encabezado por idioma", async () => {
    const csv = await descargar(negocio.token, "/reports/taxes/export?format=csv").expect(200);
    expect(csv.headers["content-disposition"]).toContain('filename="impuestos.csv"');
    const lineas = (csv.body as Buffer)
      .toString("utf8")
      .replace(/^\uFEFF/, "")
      .trim()
      .split("\n");
    expect(lineas).toEqual([
      "Impuesto,Tasa %,Base,Impuesto cobrado,Tickets",
      "GST 5%,5,100.00,5.00,1",
      "PST 7%,7,100.00,7.00,1",
    ]);

    const tokenEn = tokenService.signAccessToken({
      sub: negocio.userId,
      tenantId: negocio.tenantId,
      permissions: ["reports:read"],
      locale: "en",
    });
    const en = await descargar(tokenEn, "/reports/taxes/export?format=csv").expect(200);
    expect(en.headers["content-disposition"]).toContain('filename="taxes.csv"');
    expect(
      (en.body as Buffer)
        .toString("utf8")
        .replace(/^\uFEFF/, "")
        .split("\n")[0],
    ).toBe("Tax,Rate %,Base,Tax collected,Tickets");
  });

  it("sin reports:read → 403", async () => {
    const soloVende = tokenService.signAccessToken({
      sub: negocio.userId,
      tenantId: negocio.tenantId,
      permissions: ["pos:sell"],
      locale: "es",
    });
    await get(soloVende, "/reports/taxes").expect(403);
    await get(soloVende, "/reports/taxes/export").expect(403);
  });
});
