import { randomUUID } from "node:crypto";
import type { INestApplication } from "@nestjs/common";
import { Test, type TestingModule } from "@nestjs/testing";
import { localCalendarDate } from "@sellpoint/shared";
import ExcelJS from "exceljs";
import request from "supertest";
import type { App } from "supertest/types";
import { AppModule } from "../../src/app.module";
import { PrismaService } from "../../src/infrastructure/prisma/prisma.service";
import { MAILER } from "../../src/modules/mail/mailer.port";
import { NoopMailer } from "../../src/modules/mail/noop.mailer";
import {
  almacenInicial,
  bearer,
  registerTenant,
  type TenantFixture,
} from "./support/billing-scenario";
import { adminDePlataforma } from "./support/medical-clinic-scenario";
import { startTestApp } from "./support/start-test-app";

interface Fila {
  folio: string;
  warehouseId: string;
  name: string;
  quantity: string;
  lineTotal: string;
}

interface Pagina {
  rows: Fila[];
  totals: { tax: string; total: string } | null;
  total: number;
  item?: { id: string; name: string } | null;
}

/**
 * F10-RPT-02 — «Ventas por producto» y «Ventas por servicio» filtradas por UN
 * artículo (`itemId`). Es a donde lleva el aviso «creció» del panel (Carlos,
 * 2026-11-25: «Ese elemento al darle click debería enviar al reporte de
 * Ventas por producto o ventas por servicio»), y a donde llevarán los
 * reportes por artículo para ver los tickets.
 *
 * El escenario va por el camino real del cobro (`POST /pos/sales`), todo en
 * Centro y con IVA incluido:
 *
 *  · V1: Agua ×2, Libro ×1 y Envío ×1.
 *  · V2: Agua ×3 y Corte de cabello ×1.
 *  · V3: Agua ×1, ANULADA: no aparece en ningún reporte de líneas.
 */
describe("Ventas por producto y por servicio, de un solo artículo (F10-RPT-02)", () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let negocio: TenantFixture;
  let admin: TenantFixture;
  let centroId: string;
  let ids: { agua: string; libro: string; envio: string; corte: string };
  let hoy: string;

  const get = (token: string, url: string) =>
    request(app.getHttpServer()).get(url).set("Authorization", bearer(token));
  const post = (url: string, body: object = {}) =>
    request(app.getHttpServer()).post(url).set("Authorization", bearer(negocio.token)).send(body);
  const pagina = async (url: string, token = negocio.token): Promise<Pagina> =>
    (await get(token, url).expect(200)).body as Pagina;
  const descargar = (url: string) =>
    get(negocio.token, url)
      .buffer(true)
      .parse((r, cb) => {
        const chunks: Buffer[] = [];
        r.on("data", (c: Buffer) => chunks.push(c));
        r.on("end", () => cb(null, Buffer.concat(chunks)));
      });

  /** Los renglones de datos de la primera hoja (sin el encabezado), como texto. */
  async function renglonesDelExcel(url: string): Promise<string[][]> {
    const body = (await descargar(url).expect(200)).body as Buffer;
    const workbook = new ExcelJS.Workbook();
    type XlsxInput = Parameters<typeof workbook.xlsx.load>[0];
    await workbook.xlsx.load(body as unknown as XlsxInput);
    const sheet = workbook.worksheets[0];
    if (sheet === undefined) {
      throw new Error("sin hoja");
    }
    const renglones: string[][] = [];
    sheet.eachRow((row, numero) => {
      if (numero > 1) {
        renglones.push((row.values as unknown[]).slice(1).map((v) => String(v ?? "")));
      }
    });
    return renglones;
  }

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(MAILER)
      .useClass(NoopMailer)
      .compile();
    app = moduleFixture.createNestApplication();
    await startTestApp(app);
    prisma = app.get(PrismaService);

    admin = await adminDePlataforma(app, prisma, "ventas-por-articulo-admin");
    negocio = await registerTenant(app, "ventas-por-articulo");
    centroId = await almacenInicial(prisma, negocio.tenantId);

    const stamp = randomUUID().replace(/\D/g, "").padEnd(8, "7").slice(0, 8);
    ids = await prisma.withTenantContext(negocio.tenantId, async (tx) => {
      const tenantId = negocio.tenantId;
      const producto = async (sku: string, name: string, price: number) => {
        const p = await tx.product.create({ data: { tenantId, sku, name } });
        await tx.productPresentation.create({
          data: {
            tenantId,
            productId: p.id,
            name: "Pieza",
            factor: 1,
            allowFractionalInput: false,
            isDefaultSale: true,
            price,
          },
        });
        await tx.stockByWarehouse.create({
          data: { tenantId, productId: p.id, warehouseId: centroId, quantity: 100 },
        });
        return p.id;
      };
      const servicio = async (code: string, name: string, price: number) => {
        const s = await tx.service.create({ data: { tenantId, code, name, price } });
        await tx.serviceWarehouse.create({
          data: { tenantId, serviceId: s.id, warehouseId: centroId },
        });
        return s.id;
      };
      return {
        agua: await producto(`AGUA-${stamp}`, "Agua mineral", 12),
        libro: await producto(`LIBRO-${stamp}`, "Libro de cuentos", 50),
        envio: await servicio(`ENVIO-${stamp}`, "Envío a domicilio", 35),
        corte: await servicio(`CORTE-${stamp}`, "Corte de cabello", 100),
      };
    });

    const tenant = await prisma.tenant.findUniqueOrThrow({
      where: { id: negocio.tenantId },
      select: { timezone: true },
    });
    hoy = localCalendarDate(tenant.timezone, new Date());

    await post("/pos/session", { warehouseId: centroId }).expect(201);
    await post("/pos/sales", {
      paymentMethod: "cash",
      lines: [
        { productId: ids.agua, quantity: 2 },
        { productId: ids.libro, quantity: 1 },
        { serviceId: ids.envio, quantity: 1 },
      ],
    }).expect(201);
    await post("/pos/sales", {
      paymentMethod: "card",
      lines: [
        { productId: ids.agua, quantity: 3 },
        { serviceId: ids.corte, quantity: 1 },
      ],
    }).expect(201);
    const anulada = await post("/pos/sales", {
      paymentMethod: "cash",
      lines: [{ productId: ids.agua, quantity: 1 }],
    }).expect(201);
    await post(`/pos/sales/${(anulada.body as { id: string }).id}/cancel`, {
      reason: "e2e",
    }).expect(200);
  });

  afterAll(async () => {
    await app.close();
  });

  it("por producto: `itemId` deja solo las líneas de ese producto, y el pie suma solo esas", async () => {
    const filtrado = await pagina(`/reports/sales-by-product?itemId=${ids.agua}`);

    expect(filtrado.total).toBe(2);
    expect(filtrado.rows.map((f) => [f.name, f.quantity])).toEqual([
      ["Agua mineral", "3"],
      ["Agua mineral", "2"],
    ]);
    // Cinco aguas de $12: la anulada no entra.
    expect(filtrado.totals?.total).toBe("60.00");
    // El nombre viaja aparte: la pantalla dice qué filtra aunque no haya renglones.
    expect(filtrado.item).toEqual({ id: ids.agua, name: "Agua mineral" });
  });

  it("por servicio: `itemId` deja solo las líneas de ese servicio", async () => {
    const filtrado = await pagina(`/reports/sales-by-service?itemId=${ids.envio}`);

    expect(filtrado.total).toBe(1);
    expect(filtrado.rows.map((f) => f.name)).toEqual(["Envío a domicilio"]);
    expect(filtrado.totals?.total).toBe("35.00");
    expect(filtrado.item).toEqual({ id: ids.envio, name: "Envío a domicilio" });
  });

  it("sin `itemId`, los dos reportes son los de siempre: todas sus líneas y sin `item`", async () => {
    const productos = await pagina("/reports/sales-by-product");
    expect(productos.total).toBe(3);
    expect(productos).not.toHaveProperty("item");

    const servicios = await pagina("/reports/sales-by-service");
    expect(servicios.rows.map((f) => f.name).sort()).toEqual([
      "Corte de cabello",
      "Envío a domicilio",
    ]);
    expect(servicios).not.toHaveProperty("item");
  });

  it("un servicio en «por producto», o un id que no es de este negocio, no trae nada", async () => {
    const cruzado = await pagina(`/reports/sales-by-product?itemId=${ids.envio}`);
    expect(cruzado.rows).toEqual([]);
    expect(cruzado.totals).toBeNull();
    expect(cruzado.item).toBeNull();

    const ajeno = await pagina(`/reports/sales-by-service?itemId=${randomUUID()}`);
    expect(ajeno.rows).toEqual([]);
    expect(ajeno.item).toBeNull();
  });

  it("se combina con la sucursal y las fechas; sin ventas en el rango, el nombre sigue llegando", async () => {
    const deHoy = await pagina(
      `/reports/sales-by-product?itemId=${ids.agua}&warehouseId=${centroId}&from=${hoy}&to=${hoy}`,
    );
    expect(deHoy.total).toBe(2);

    const otroMes = await pagina(
      `/reports/sales-by-product?itemId=${ids.agua}&from=2020-01-01&to=2020-01-31`,
    );
    expect(otroMes.rows).toEqual([]);
    expect(otroMes.item).toEqual({ id: ids.agua, name: "Agua mineral" });
  });

  it("el Excel respeta el filtro: solo las líneas del artículo", async () => {
    // Columna 7 del de productos: «Producto» (después de los dos códigos).
    const productos = await renglonesDelExcel(
      `/reports/sales-by-product/export?itemId=${ids.agua}`,
    );
    expect(productos.map((r) => r[6])).toEqual(["Agua mineral", "Agua mineral"]);

    // Columna 6 del de servicios: «Servicio».
    const servicios = await renglonesDelExcel(
      `/reports/sales-by-service/export?itemId=${ids.corte}`,
    );
    expect(servicios.map((r) => r[5])).toEqual(["Corte de cabello"]);

    // Y sin filtro, el de siempre.
    expect(await renglonesDelExcel("/reports/sales-by-product/export")).toHaveLength(3);
  });

  it.each([
    "/reports/sales-by-product",
    "/reports/sales-by-product/export",
    "/reports/sales-by-service",
    "/reports/sales-by-service/export",
  ])("un `itemId` mal formado en %s responde 400 `common.invalid_id`", async (ruta) => {
    const res = await get(negocio.token, `${ruta}?itemId=no-es-un-id`).expect(400);
    expect((res.body as { code?: string }).code).toBe("common.invalid_id");
  });

  it("desde el backoffice filtra igual", async () => {
    const base = `/admin/tenants/${negocio.tenantId}/reports`;
    const productos = await pagina(`${base}/sales-by-product?itemId=${ids.agua}`, admin.token);
    expect(productos.total).toBe(2);
    expect(productos.item).toEqual({ id: ids.agua, name: "Agua mineral" });

    const servicios = await pagina(`${base}/sales-by-service?itemId=${ids.corte}`, admin.token);
    expect(servicios.rows.map((f) => f.name)).toEqual(["Corte de cabello"]);
  });
});
