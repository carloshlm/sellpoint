import { randomUUID } from "node:crypto";
import type { INestApplication } from "@nestjs/common";
import { Test, type TestingModule } from "@nestjs/testing";
import ExcelJS from "exceljs";
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
  registerTenant,
  type TenantFixture,
} from "./support/billing-scenario";
import { startTestApp } from "./support/start-test-app";

interface Fila {
  folio: string;
  status: string;
  warehouseId: string;
  warehouse: { name: string };
  seller: { name: string };
  code: string | null;
  barcode: string | null;
  name: string;
  quantity: string;
  baseUnit: string | null;
  presentation: { name: string; factor: string } | null;
  unitPrice: string;
  taxAmount: string;
  lineTotal: string;
}

interface Pagina {
  rows: Fila[];
  totals: { tax: string; total: string } | null;
  total: number;
  page: number;
  pageSize: number;
}

/**
 * «Ventas por producto» y «Ventas por servicio»: el reporte de Ventas, pero
 * una LÍNEA de ticket por renglón. Las dos pantallas son la misma consulta
 * con un `kind`: la de productos lee las líneas sin servicio y la de
 * servicios, las que sí lo tienen.
 *
 * El escenario se arma por el camino REAL del cobro (`POST /pos/sales`), no
 * con filas sembradas: lo que se prueba es que el reporte lea lo que el motor
 * de impuestos y el prorrateo del descuento dejaron en cada línea. México en
 * «incluido», con IVA 16% de fábrica y un grupo Exento:
 *
 *  · Venta 1 (Centro, efectivo): Agua en Caja ×12, Agua por pieza ×3 con $6
 *    de descuento de línea, un Libro exento y un Envío (servicio). $245.00.
 *  · Venta 2 (Centro, tarjeta): Agua ×2 y Envío ×2 con $9.40 de descuento del
 *    TICKET, que se prorratea entre las dos líneas. $84.60.
 *  · Venta 3 (Norte, efectivo): Libro ×2. $100.00.
 *  · Venta 4 (Norte, efectivo): Agua ×1, ANULADA.
 */
describe("Ventas por producto y por servicio", () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let tokenService: TokenService;
  let negocio: TenantFixture;
  let centroId: string;
  let norteId: string;
  let skuAgua: string;
  let skuLibro: string;
  let codigoEnvio: string;
  let barraPieza: string;
  let barraCaja: string;
  const folios: string[] = [];

  const get = (token: string, url: string) =>
    request(app.getHttpServer()).get(url).set("Authorization", bearer(token));
  const post = (url: string, body: object = {}) =>
    request(app.getHttpServer()).post(url).set("Authorization", bearer(negocio.token)).send(body);
  const pagina = async (url: string, token = negocio.token): Promise<Pagina> =>
    (await get(token, url).expect(200)).body as Pagina;
  const descargar = (token: string, url: string) =>
    get(token, url)
      .buffer(true)
      .parse((r, cb) => {
        const chunks: Buffer[] = [];
        r.on("data", (c: Buffer) => chunks.push(c));
        r.on("end", () => cb(null, Buffer.concat(chunks)));
      });
  const tokenCon = (permissions: string[], locale: "es" | "en" = "es") =>
    tokenService.signAccessToken({
      sub: negocio.userId,
      tenantId: negocio.tenantId,
      permissions,
      locale,
    });

  /** Lo que cobró cada venta en las líneas de un tipo, leído de la base. */
  async function cobradoPorTicket(kind: "product" | "service"): Promise<Map<string, string>> {
    const lineas = await prisma.withTenantContext(negocio.tenantId, (tx) =>
      tx.saleItem.findMany({
        where: {
          tenantId: negocio.tenantId,
          serviceId: kind === "service" ? { not: null } : null,
        },
        select: { lineTotal: true, sale: { select: { folio: true } } },
      }),
    );
    const suma = new Map<string, number>();
    for (const l of lineas) {
      suma.set(l.sale.folio, (suma.get(l.sale.folio) ?? 0) + Math.round(Number(l.lineTotal) * 100));
    }
    return new Map([...suma].map(([folio, centavos]) => [folio, (centavos / 100).toFixed(2)]));
  }

  /** Suma los Totales del reporte por folio, en centavos para no arrastrar flotantes. */
  function totalesPorFolio(filas: Fila[]): Map<string, string> {
    const suma = new Map<string, number>();
    for (const f of filas) {
      suma.set(f.folio, (suma.get(f.folio) ?? 0) + Math.round(Number(f.lineTotal) * 100));
    }
    return new Map([...suma].map(([folio, centavos]) => [folio, (centavos / 100).toFixed(2)]));
  }

  async function hoja(body: Buffer): Promise<ExcelJS.Worksheet> {
    const workbook = new ExcelJS.Workbook();
    type XlsxInput = Parameters<typeof workbook.xlsx.load>[0];
    await workbook.xlsx.load(body as unknown as XlsxInput);
    const sheet = workbook.worksheets[0];
    if (sheet === undefined) {
      throw new Error("sin hoja");
    }
    return sheet;
  }

  const encabezado = (sheet: ExcelJS.Worksheet) => (sheet.getRow(1).values as unknown[]).slice(1);

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(MAILER)
      .useClass(NoopMailer)
      .compile();
    app = moduleFixture.createNestApplication();
    await startTestApp(app);
    prisma = app.get(PrismaService);
    tokenService = app.get(TokenService);

    negocio = await registerTenant(app, "ventas-por-producto");
    centroId = await almacenInicial(prisma, negocio.tenantId);

    await request(app.getHttpServer())
      .put("/tenants/me/taxes")
      .set("Authorization", bearer(negocio.token))
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
    // El código del descuento del ticket (F4-DISC), para la venta 2.
    await request(app.getHttpServer())
      .patch("/tenants/me")
      .set("Authorization", bearer(negocio.token))
      .send({ discountCode: "1234" })
      .expect(200);

    const stamp = randomUUID().replace(/\D/g, "").padEnd(8, "7").slice(0, 8);
    skuAgua = `AGUA-${stamp}`;
    skuLibro = `LIBRO-${stamp}`;
    codigoEnvio = `ENVIO-${stamp}`;
    // Códigos internos de la tienda (prefijo 2): no chocan con ningún GTIN
    // real y el índice único es por negocio.
    barraPieza = `20${stamp}01`;
    barraCaja = `20${stamp}12`;

    const ids = await prisma.withTenantContext(negocio.tenantId, async (tx) => {
      const tenantId = negocio.tenantId;
      const exento = await tx.taxGroup.findFirstOrThrow({ where: { tenantId, code: "EXEMPT" } });
      const norte = await tx.warehouse.create({
        data: { tenantId, code: `NTE-${stamp}`, name: "Norte" },
      });

      const agua = await tx.product.create({
        data: { tenantId, sku: skuAgua, name: "Agua mineral" },
      });
      const pieza = await tx.productPresentation.create({
        data: {
          tenantId,
          productId: agua.id,
          name: "Pieza",
          factor: 1,
          allowFractionalInput: false,
          isDefaultSale: true,
          barcode: barraPieza,
          price: 12,
        },
      });
      const caja = await tx.productPresentation.create({
        data: {
          tenantId,
          productId: agua.id,
          name: "Caja ×12",
          factor: 12,
          allowFractionalInput: false,
          barcode: barraCaja,
          price: 130,
        },
      });

      // Sin código de barras: el reporte deja esa celda vacía.
      const libro = await tx.product.create({
        data: { tenantId, sku: skuLibro, name: "Libro de cuentos", taxGroupId: exento.id },
      });
      await tx.productPresentation.create({
        data: {
          tenantId,
          productId: libro.id,
          name: "Pieza",
          factor: 1,
          allowFractionalInput: false,
          isDefaultSale: true,
          price: 50,
        },
      });

      for (const warehouseId of [centroId, norte.id]) {
        for (const productId of [agua.id, libro.id]) {
          await tx.stockByWarehouse.create({
            data: { tenantId, productId, warehouseId, quantity: 100 },
          });
        }
      }

      const envio = await tx.service.create({
        data: { tenantId, code: codigoEnvio, name: "Envío a domicilio", price: 35 },
      });
      await tx.serviceWarehouse.create({
        data: { tenantId, serviceId: envio.id, warehouseId: centroId },
      });

      return {
        norteId: norte.id,
        agua: agua.id,
        pieza: pieza.id,
        caja: caja.id,
        libro: libro.id,
        envio: envio.id,
      };
    });
    norteId = ids.norteId;

    const cobrar = async (body: object) => {
      const venta = await post("/pos/sales", body).expect(201);
      const cuerpo = venta.body as { id: string; folio: string };
      folios.push(cuerpo.folio);
      return cuerpo;
    };

    await post("/pos/session", { warehouseId: centroId }).expect(201);
    await cobrar({
      paymentMethod: "cash",
      lines: [
        { productId: ids.agua, presentationId: ids.caja, quantity: 1 },
        { productId: ids.agua, presentationId: ids.pieza, quantity: 3, discount: 6 },
        { productId: ids.libro, quantity: 1 },
        { serviceId: ids.envio, quantity: 1 },
      ],
    });
    await cobrar({
      paymentMethod: "card",
      lines: [
        { productId: ids.agua, presentationId: ids.pieza, quantity: 2 },
        { serviceId: ids.envio, quantity: 2 },
      ],
      discount: { amount: 9.4, code: "1234" },
    });
    await post("/pos/session/close", { declaredCash: 245 }).expect(200);

    await post("/pos/session", { warehouseId: norteId }).expect(201);
    await cobrar({ paymentMethod: "cash", lines: [{ productId: ids.libro, quantity: 2 }] });
    const anulada = await cobrar({
      paymentMethod: "cash",
      lines: [{ productId: ids.agua, presentationId: ids.pieza, quantity: 1 }],
    });
    await post(`/pos/sales/${anulada.id}/cancel`, { reason: "e2e" }).expect(200);
  });

  afterAll(async () => {
    await app.close();
  });

  describe("por producto", () => {
    it("una línea de producto por renglón, de la venta más nueva a la más vieja", async () => {
      const [v1, v2, v3, v4] = folios;
      const { rows, total } = await pagina("/reports/sales-by-product");

      expect(total).toBe(6);
      expect(
        rows.map((f) => [
          f.folio,
          f.status,
          f.warehouse.name,
          f.seller.name,
          f.code,
          f.barcode,
          f.name,
          f.quantity,
          f.presentation?.name ?? null,
          f.unitPrice,
          f.taxAmount,
          f.lineTotal,
        ]),
      ).toEqual([
        [
          v4,
          "canceled",
          "Norte",
          "Ana Pérez",
          skuAgua,
          barraPieza,
          "Agua mineral",
          "1",
          "Pieza",
          "12.00",
          "1.66",
          "12.00",
        ],
        [
          v3,
          "completed",
          "Norte",
          "Ana Pérez",
          skuLibro,
          null,
          "Libro de cuentos",
          "2",
          "Pieza",
          "50.00",
          "0.00",
          "100.00",
        ],
        // El descuento del ticket ($9.40) ya viene prorrateado: $2.40 le tocan a esta línea.
        [
          v2,
          "completed",
          expect.any(String),
          "Ana Pérez",
          skuAgua,
          barraPieza,
          "Agua mineral",
          "2",
          "Pieza",
          "12.00",
          "2.98",
          "21.60",
        ],
        [
          v1,
          "completed",
          expect.any(String),
          "Ana Pérez",
          skuAgua,
          barraCaja,
          "Agua mineral",
          "1",
          "Caja ×12",
          "130.00",
          "17.93",
          "130.00",
        ],
        // Tres piezas de $12 menos $6 de descuento de línea.
        [
          v1,
          "completed",
          expect.any(String),
          "Ana Pérez",
          skuAgua,
          barraPieza,
          "Agua mineral",
          "3",
          "Pieza",
          "12.00",
          "4.14",
          "30.00",
        ],
        [
          v1,
          "completed",
          expect.any(String),
          "Ana Pérez",
          skuLibro,
          null,
          "Libro de cuentos",
          "1",
          "Pieza",
          "50.00",
          "0.00",
          "50.00",
        ],
      ]);
      // La presentación viaja con su factor: la pantalla la escribe como el ticket.
      expect(rows[3]?.presentation).toEqual({
        name: "Caja ×12",
        factor: "12",
        allowFractionalInput: false,
      });
      expect(rows[3]?.baseUnit).toBe("unit");
    });

    it("no trae líneas de servicio", async () => {
      const { rows } = await pagina("/reports/sales-by-product");
      expect(rows.some((f) => f.name === "Envío a domicilio")).toBe(false);
    });

    it("los Totales de cada ticket suman lo que cobraron sus líneas de producto", async () => {
      const { rows } = await pagina("/reports/sales-by-product");
      expect(totalesPorFolio(rows)).toEqual(await cobradoPorTicket("product"));
    });

    it("el pie suma Impuesto y Total del periodo, sin las anuladas", async () => {
      const { totals } = await pagina("/reports/sales-by-product");
      expect(totals).toEqual({ tax: "25.05", total: "331.60" });
    });

    it("filtra por sucursal, estado y fechas", async () => {
      const [, , v3, v4] = folios;
      const norte = await pagina(`/reports/sales-by-product?warehouseId=${norteId}`);
      expect(norte.rows.map((f) => f.folio)).toEqual([v4, v3]);
      expect(norte.rows.every((f) => f.warehouseId === norteId)).toBe(true);

      const anuladas = await pagina("/reports/sales-by-product?status=canceled");
      expect(anuladas.rows.map((f) => f.folio)).toEqual([v4]);
      // Sin ventas cobradas en el filtro no hay pie que mostrar.
      expect(anuladas.totals).toBeNull();

      const cobradas = await pagina("/reports/sales-by-product?status=completed");
      expect(cobradas.total).toBe(5);

      const desde2000 = await pagina("/reports/sales-by-product?from=2000-01-01");
      expect(desde2000.total).toBe(6);
      const otroDia = await pagina("/reports/sales-by-product?from=2000-01-01&to=2000-01-02");
      expect(otroDia.rows).toEqual([]);
      expect(otroDia.totals).toBeNull();

      await get(negocio.token, "/reports/sales-by-product?from=ayer").expect(400);
    });

    it("pagina igual que Ventas: 20 por omisión y sin repetir renglones", async () => {
      const primera = await pagina("/reports/sales-by-product");
      expect(primera.pageSize).toBe(20);

      const uno = await pagina("/reports/sales-by-product?page=1&pageSize=4");
      const dos = await pagina("/reports/sales-by-product?page=2&pageSize=4");
      expect(uno.rows).toHaveLength(4);
      expect(dos.rows).toHaveLength(2);
      expect([...uno.rows, ...dos.rows]).toEqual(primera.rows);
    });

    it("el Excel trae las mismas columnas: números como número, códigos y fecha como texto", async () => {
      const respuesta = await descargar(negocio.token, "/reports/sales-by-product/export").expect(
        200,
      );
      expect(respuesta.headers["content-disposition"]).toContain("ventas-por-producto.xlsx");
      const sheet = await hoja(respuesta.body as Buffer);

      expect(sheet.name).toBe("Ventas por producto");
      expect(encabezado(sheet)).toEqual([
        "Fecha",
        "Folio",
        "Vendió",
        "Sucursal",
        "Código interno",
        "Código de barras",
        "Producto",
        "Cantidad",
        "Precio unitario",
        "Impuesto",
        "Total",
        "Estado",
      ]);
      expect(sheet.rowCount).toBe(7);

      // La última columna marca el estado, como el Excel de Ventas: la anulada
      // (la venta 4, primer renglón) se distingue de las cobradas.
      expect(sheet.getRow(2).getCell(2).value).toBe(folios[3]);
      expect(sheet.getRow(2).getCell(12).value).toBe("Anulada");
      expect(sheet.getRow(2).getCell(12).numFmt).toBe("@");

      // La caja de agua de la venta 1: el quinto renglón de datos.
      const caja = sheet.getRow(5);
      expect(caja.getCell(12).value).toBe("Cobrada");
      expect(caja.getCell(2).value).toBe(folios[0]);
      expect(caja.getCell(1).value).toEqual(
        expect.stringMatching(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/),
      );
      for (const [columna, valor] of [
        [5, skuAgua],
        [6, barraCaja],
        [7, "Agua mineral"],
      ] as const) {
        expect({
          columna,
          value: caja.getCell(columna).value,
          numFmt: caja.getCell(columna).numFmt,
        }).toEqual({ columna, value: valor, numFmt: "@" });
      }
      for (const [columna, valor] of [
        [8, 1],
        [9, 130],
        [10, 17.93],
        [11, 130],
      ] as const) {
        expect({
          columna,
          type: caja.getCell(columna).type,
          value: caja.getCell(columna).value,
        }).toEqual({
          columna,
          type: ExcelJS.ValueType.Number,
          value: valor,
        });
      }
    });

    it("el Excel respeta los filtros y habla el idioma de quien descarga", async () => {
      const norte = await descargar(
        negocio.token,
        `/reports/sales-by-product/export?warehouseId=${norteId}`,
      ).expect(200);
      expect((await hoja(norte.body as Buffer)).rowCount).toBe(3);

      const en = await descargar(
        tokenCon(["reports:read"], "en"),
        "/reports/sales-by-product/export",
      ).expect(200);
      expect(en.headers["content-disposition"]).toContain("sales-by-product.xlsx");
      const sheet = await hoja(en.body as Buffer);
      expect(sheet.name).toBe("Sales by product");
      expect(encabezado(sheet)).toEqual([
        "Date",
        "Receipt number",
        "Sold by",
        "Store",
        "Internal code",
        "Barcode",
        "Product",
        "Quantity",
        "Price",
        "Tax",
        "Total",
        "Status",
      ]);
      expect(sheet.getRow(2).getCell(12).value).toBe("Canceled");
      expect(sheet.getRow(3).getCell(12).value).toBe("Charged");
    });
  });

  describe("por servicio", () => {
    it("una línea de servicio por renglón, con su código y sin líneas de producto", async () => {
      const [v1, v2] = folios;
      const { rows, total, totals } = await pagina("/reports/sales-by-service");

      expect(total).toBe(2);
      expect(
        rows.map((f) => [
          f.folio,
          f.code,
          f.barcode,
          f.name,
          f.quantity,
          f.baseUnit,
          f.presentation,
          f.unitPrice,
          f.taxAmount,
          f.lineTotal,
        ]),
      ).toEqual([
        // $7.00 del descuento del ticket le tocan a esta línea.
        [v2, codigoEnvio, null, "Envío a domicilio", "2", null, null, "35.00", "8.69", "63.00"],
        [v1, codigoEnvio, null, "Envío a domicilio", "1", null, null, "35.00", "4.83", "35.00"],
      ]);
      expect(totals).toEqual({ tax: "13.52", total: "98.00" });
    });

    it("los Totales de cada ticket suman lo que cobraron sus líneas de servicio", async () => {
      const { rows } = await pagina("/reports/sales-by-service");
      expect(totalesPorFolio(rows)).toEqual(await cobradoPorTicket("service"));
    });

    it("filtra por sucursal, estado y fechas", async () => {
      expect((await pagina(`/reports/sales-by-service?warehouseId=${norteId}`)).rows).toEqual([]);
      expect((await pagina(`/reports/sales-by-service?warehouseId=${centroId}`)).total).toBe(2);
      expect((await pagina("/reports/sales-by-service?status=canceled")).rows).toEqual([]);
      expect((await pagina("/reports/sales-by-service?status=completed")).total).toBe(2);
      expect(
        (await pagina("/reports/sales-by-service?from=2000-01-01&to=2000-01-02")).rows,
      ).toEqual([]);
    });

    it("el Excel trae las columnas del servicio, en los dos idiomas", async () => {
      const es = await descargar(negocio.token, "/reports/sales-by-service/export").expect(200);
      expect(es.headers["content-disposition"]).toContain("ventas-por-servicio.xlsx");
      const sheet = await hoja(es.body as Buffer);
      expect(sheet.name).toBe("Ventas por servicio");
      expect(encabezado(sheet)).toEqual([
        "Fecha",
        "Folio",
        "Vendió",
        "Sucursal",
        "Código",
        "Servicio",
        "Cantidad",
        "Precio unitario",
        "Impuesto",
        "Total",
        "Estado",
      ]);
      expect(sheet.rowCount).toBe(3);
      const envio = sheet.getRow(2);
      expect(envio.getCell(11).value).toBe("Cobrada");
      expect(envio.getCell(5).value).toBe(codigoEnvio);
      expect(envio.getCell(5).numFmt).toBe("@");
      expect(envio.getCell(7).type).toBe(ExcelJS.ValueType.Number);
      expect(envio.getCell(10).value).toBe(63);

      const en = await descargar(
        tokenCon(["reports:read"], "en"),
        "/reports/sales-by-service/export",
      ).expect(200);
      expect(en.headers["content-disposition"]).toContain("sales-by-service.xlsx");
      expect(encabezado(await hoja(en.body as Buffer))).toEqual([
        "Date",
        "Receipt number",
        "Sold by",
        "Store",
        "Code",
        "Service",
        "Quantity",
        "Price",
        "Tax",
        "Total",
        "Status",
      ]);
    });
  });

  it("entre los dos reportes, cada ticket cobra exactamente su total", async () => {
    const productos = totalesPorFolio((await pagina("/reports/sales-by-product")).rows);
    const servicios = totalesPorFolio((await pagina("/reports/sales-by-service")).rows);
    const ventas = (await pagina("/reports/sales")) as unknown as {
      rows: { folio: string; total: string }[];
    };

    for (const venta of ventas.rows) {
      const suma =
        Math.round(Number(productos.get(venta.folio) ?? 0) * 100) +
        Math.round(Number(servicios.get(venta.folio) ?? 0) * 100);
      expect({ folio: venta.folio, total: (suma / 100).toFixed(2) }).toEqual({
        folio: venta.folio,
        total: Number(venta.total).toFixed(2),
      });
    }
  });

  describe("quién entra", () => {
    const rutas = [
      "/reports/sales-by-product",
      "/reports/sales-by-product/export",
      "/reports/sales-by-service",
      "/reports/sales-by-service/export",
    ];

    it.each(rutas)("%s pide `reports:read`, como Ventas", async (ruta) => {
      await get(tokenCon(["pos:view", "pos:sell"]), ruta).expect(403);
    });

    it("aplica el alcance: un usuario de Norte no ve Centro y no puede pedirlo", async () => {
      const acotado = tokenCon(["reports:read"]);
      await prisma.withTenantContext(negocio.tenantId, (tx) =>
        tx.userWarehouseScope.create({
          data: { tenantId: negocio.tenantId, userId: negocio.userId, warehouseId: norteId },
        }),
      );
      try {
        const suyo = await pagina("/reports/sales-by-product", acotado);
        expect(suyo.rows.every((f) => f.warehouseId === norteId)).toBe(true);
        expect(suyo.total).toBe(2);
        expect((await pagina("/reports/sales-by-service", acotado)).rows).toEqual([]);
        await get(acotado, `/reports/sales-by-product?warehouseId=${centroId}`).expect(403);
      } finally {
        await prisma.withTenantContext(negocio.tenantId, (tx) =>
          tx.userWarehouseScope.deleteMany({ where: { userId: negocio.userId } }),
        );
      }
    });
  });
});
