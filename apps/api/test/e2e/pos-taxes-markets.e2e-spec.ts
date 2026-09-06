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
  type TenantFixture,
} from "./support/billing-scenario";
import { textoDelPdf } from "./support/pdf-text";
import { startTestApp } from "./support/start-test-app";

interface Mercado {
  nombre: string;
  clave: string;
  pais: { country: string; region?: string };
  mode: "included" | "excluded";
  /** El grupo que no suma: exento en MX/CA, «sin impuesto» en US. */
  exento: string;
  /** Un artículo de 100 al default + uno de 50 al grupo exento. */
  total: string;
  taxTotal: string;
  componentes: [string, string][];
  papel: string[];
}

/**
 * F4-TAX-22 — los cuatro mercados de punta a punta, sembrados por el
 * onboarding (no a mano): catálogo → cotización con desglose → cargarla →
 * cobrar → ticket 58 y 80 mm → reporte de impuestos → anular → el reporte y
 * la caja la excluyen. Un artículo de 100 al default y uno de 50 al grupo que
 * no suma, en cada mercado.
 *
 * México es la prueba de regresión cero: 100 + 50 siguen costando 150 con el
 * módulo puesto; el papel solo gana el desglose.
 */
const MERCADOS: Mercado[] = [
  {
    nombre: "México, IVA 16% incluido",
    clave: "mx",
    pais: { country: "MX" },
    mode: "included",
    exento: "EXEMPT",
    total: "150",
    taxTotal: "13.79",
    componentes: [["VAT", "13.79"]],
    papel: ["IVA 16%", "150.00"],
  },
  {
    nombre: "Columbia Británica, GST 5% + PST 7%",
    clave: "bc",
    pais: { country: "CA", region: "BC" },
    mode: "excluded",
    exento: "EXEMPT",
    total: "162",
    taxTotal: "12",
    componentes: [
      ["GST", "5"],
      ["PST", "7"],
    ],
    papel: ["GST 5%", "PST 7%", "162.00"],
  },
  {
    nombre: "Ontario, HST 13%",
    clave: "on",
    pais: { country: "CA", region: "ON" },
    mode: "excluded",
    exento: "EXEMPT",
    total: "163",
    taxTotal: "13",
    componentes: [["HST", "13"]],
    papel: ["HST 13%", "163.00"],
  },
  {
    nombre: "Texas, 6.25% estatal",
    clave: "tx",
    pais: { country: "US", region: "TX" },
    mode: "excluded",
    exento: "NO_TAX",
    total: "156.25",
    taxTotal: "6.25",
    componentes: [["SALES_TAX", "6.25"]],
    papel: ["Sales tax 6.25%", "156.25"],
  },
];

describe("Impuestos de punta a punta en los cuatro mercados (F4-TAX-22)", () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;

  const http = () => request(app.getHttpServer());
  const get = (token: string, url: string) => http().get(url).set("Authorization", bearer(token));
  const post = (token: string, url: string, body: object = {}) =>
    http().post(url).set("Authorization", bearer(token)).send(body);
  const pdf = (token: string, ruta: string) =>
    get(token, ruta)
      .buffer(true)
      .parse((r, cb) => {
        const chunks: Buffer[] = [];
        r.on("data", (c: Buffer) => chunks.push(c));
        r.on("end", () => cb(null, Buffer.concat(chunks)));
      });

  interface Escenario {
    negocio: TenantFixture;
    almacenId: string;
    gravadoId: string;
    exentoId: string;
    exentoGrupoId: string;
  }

  /** Un negocio recién incorporado en su mercado, con sus dos artículos y turno abierto. */
  async function incorporar(m: Mercado): Promise<Escenario> {
    const negocio = await registerTenant(app, `tax-${m.clave}`);
    await http()
      .patch("/tenants/me")
      .set("Authorization", bearer(negocio.token))
      .send(m.pais)
      .expect(200);
    const hecho = await post(negocio.token, "/tenants/me/complete-onboarding").expect(200);
    expect((hecho.body as { taxMode: string }).taxMode).toBe(m.mode);

    const vista = await get(negocio.token, "/tenants/me/taxes").expect(200);
    const grupos = (vista.body as { groups: { id: string; code: string }[] }).groups;
    const exentoGrupoId = grupos.find((g) => g.code === m.exento)?.id as string;
    expect(exentoGrupoId).toBeDefined();

    const almacenId = await almacenInicial(prisma, negocio.tenantId);
    const gravado = await crearProducto(app, negocio.token, 100);
    const exento = await crearProducto(app, negocio.token, 50);
    await http()
      .patch(`/products/${exento.id}`)
      .set("Authorization", bearer(negocio.token))
      .send({ taxGroupId: exentoGrupoId })
      .expect(200);
    await cargarStock(app, negocio.token, almacenId, gravado.id, 10);
    await cargarStock(app, negocio.token, almacenId, exento.id, 10);
    await post(negocio.token, "/pos/session").expect(201);
    return { negocio, almacenId, gravadoId: gravado.id, exentoId: exento.id, exentoGrupoId };
  }

  beforeAll(async () => {
    const moduleRef: TestingModule = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(MAILER)
      .useValue(new NoopMailer())
      .compile();
    app = moduleRef.createNestApplication<INestApplication<App>>();
    await startTestApp(app);
    prisma = app.get(PrismaService);
  });

  afterAll(async () => {
    await app.close();
  });

  for (const m of MERCADOS) {
    it(`${m.nombre}: cotiza, cobra, imprime, declara y anula con las mismas cifras`, async () => {
      const esc = await incorporar(m);
      const token = esc.negocio.token;
      const lineas = [
        { productId: esc.gravadoId, quantity: 1 },
        { productId: esc.exentoId, quantity: 1 },
      ];

      // La cotización ya desglosa, y el exento no suma.
      const cotizacion = await post(token, "/pos/quotes", {
        warehouseId: esc.almacenId,
        lines: lineas,
      }).expect(201);
      const cot = cotizacion.body as {
        id: string;
        folio: string;
        total: string;
        taxTotal: string;
        lines: { taxAmount: string; taxGroupCode: string | null }[];
        taxes: { code: string; amount: string }[];
      };
      expect(cot.total).toBe(m.total);
      expect(cot.taxTotal).toBe(m.taxTotal);
      expect(cot.lines[1]).toMatchObject({ taxAmount: "0", taxGroupCode: m.exento });
      expect(cot.taxes.map((t) => [t.code, t.amount])).toEqual(m.componentes);

      // Cargarla al POS: cada ítem viaja con su impuesto vigente.
      const paraVender = await get(token, `/pos/quotes/folio/${cot.folio}/for-sale`).expect(200);
      const fs = paraVender.body as {
        taxMode: string;
        lines: { item: { tax: { groupCode: string; components: unknown[] } } }[];
      };
      expect(fs.taxMode).toBe(m.mode);
      expect(fs.lines[1]?.item.tax).toEqual({ groupCode: m.exento, components: [] });

      // Cobrar: las MISMAS cifras que la cotización.
      const venta = await post(token, "/pos/sales", {
        paymentMethod: "cash",
        quoteId: cot.id,
        lines: lineas,
      }).expect(201);
      const v = venta.body as {
        id: string;
        total: string;
        taxMode: string;
        taxTotal: string;
        taxes: { code: string; amount: string }[];
      };
      expect(v).toMatchObject({ total: m.total, taxMode: m.mode, taxTotal: m.taxTotal });
      expect(v.taxes.map((t) => [t.code, t.amount])).toEqual(m.componentes);

      // El papel, en los dos anchos.
      for (const ancho of ["58mm", "80mm"]) {
        const ticket = await pdf(token, `/pos/sales/${v.id}/ticket?width=${ancho}`).expect(200);
        const texto = textoDelPdf(ticket.body as Buffer);
        for (const frase of m.papel) expect(texto).toContain(frase);
      }

      // El reporte de impuestos ya la cuenta…
      const reporte = await get(token, "/reports/taxes").expect(200);
      const r = reporte.body as {
        rows: { code: string; amount: string; tickets: number }[];
        totals: { gross: string; tax: string; tickets: number };
      };
      expect(r.rows.map((f) => [f.code, Number(f.amount), f.tickets])).toEqual(
        m.componentes.map(([code, amount]) => [code, Number(amount), 1]),
      );
      expect(Number(r.totals.gross)).toBe(Number(m.total));
      expect(Number(r.totals.tax)).toBe(Number(m.taxTotal));

      // …y anularla la saca del reporte Y de la caja.
      await post(token, `/pos/sales/${v.id}/cancel`, { reason: "e2e: cuatro mercados" }).expect(
        200,
      );
      const sinElla = await get(token, "/reports/taxes").expect(200);
      expect((sinElla.body as { rows: unknown[] }).rows).toEqual([]);
      expect((sinElla.body as { totals: { tickets: number } }).totals.tickets).toBe(0);
      const caja = await get(token, "/pos/session/totals").expect(200);
      const totales = (caja.body as { totals: { total: string }[] }).totals;
      expect(totales.every((t) => Number(t.total) === 0)).toBe(true);
    });
  }

  it("Texas: cambiar la tasa no toca la venta anterior; la siguiente cobra la nueva", async () => {
    const esc = await incorporar(MERCADOS[3] as Mercado);
    const token = esc.negocio.token;
    const vender = async () => {
      const venta = await post(token, "/pos/sales", {
        paymentMethod: "cash",
        lines: [{ productId: esc.gravadoId, quantity: 1 }],
      }).expect(201);
      return venta.body as { id: string; total: string; taxTotal: string };
    };
    const antes = await vender();
    expect(antes).toMatchObject({ total: "106.25", taxTotal: "6.25" });

    await http()
      .put("/tenants/me/taxes")
      .set("Authorization", bearer(token))
      .send({
        groups: [
          {
            code: "SALES_TAX",
            name: "Sales tax 8.25%",
            isDefault: true,
            rates: [{ code: "SALES_TAX", name: "Sales tax 8.25%", rate: "8.25" }],
          },
          { code: "NO_TAX", name: "No tax", rates: [] },
        ],
      })
      .expect(200);

    const despues = await vender();
    expect(despues).toMatchObject({ total: "108.25", taxTotal: "8.25" });
    const laDeAntes = await get(token, `/pos/sales/${antes.id}`).expect(200);
    expect(laDeAntes.body).toMatchObject({ total: "106.25", taxTotal: "6.25" });
  });
});
