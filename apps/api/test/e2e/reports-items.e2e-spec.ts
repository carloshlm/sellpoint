import { randomUUID } from "node:crypto";
import type { INestApplication } from "@nestjs/common";
import { Test, type TestingModule } from "@nestjs/testing";
import { localCalendarDate } from "@sellpoint/shared";
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
  kind: "product" | "service" | "concept";
  itemId: string;
  code: string | null;
  name: string;
  quantity: string;
  baseUnit: string | null;
  revenue: string;
  cost: string | null;
  profit: string | null;
  margin: number | null;
}

interface Pagina {
  rows: Fila[];
  totals: {
    revenue: string;
    cost: string | null;
    profit: string | null;
    margin: number | null;
  } | null;
  total: number;
  page: number;
  pageSize: number;
}

interface Panel {
  topSold: { itemId: string; kind: string; units: string; revenue: string }[];
  topProfit: {
    itemId: string;
    kind: string;
    revenue: string;
    cost: string;
    profit: string;
    marginPct: number;
  }[];
  belowCost: {
    itemId: string;
    kind: string;
    revenue: string;
    cost: string;
    profit: string;
    marginPct: number | null;
  }[];
  belowCostCount: number;
}

/**
 * F10-RPT-03 — el reporte por artículo: «Más vendidos», «Mayor utilidad» y
 * «Vendidos bajo su costo», con los filtros de los otros reportes (Carlos,
 * 2026-11-25: «con filtros como otros reportes (sucursal, fechas, productos o
 * servicios)»).
 *
 * El escenario va por el camino REAL del cobro (`POST /pos/sales`): el costo
 * se congela del catálogo y el impuesto lo reparte el motor. México en
 * «incluido», con IVA 16% de fábrica y un grupo Exento:
 *
 *  · V1 (Centro): Queso 2 kg y 2 porciones de 250 g, Refresco ×3 con IVA,
 *    Corte de cabello ×1 con IVA y Misterio ×1 (sin costo).
 *  · V2 (Centro): Pan ×4 y Planchado ×2, los dos bajo su costo.
 *  · V3 (Norte): Refresco ×5 y Pan ×1.
 *  · V4 (Norte): Queso 10 kg, CANCELADA.
 *  · V5 (Centro): Corte de cabello ×3, movida al 12 de marzo de 2026 a las
 *    23:30 de la Ciudad de México (05:30 UTC del 13).
 *
 * Del mes en curso, por artículo (venta sin impuesto · costo · utilidad):
 *  Queso 510 · 375 · 135 | Refresco 160 · 120 · 40 | Corte 100 · 30 · 70 |
 *  Pan 50 · 60 · −10 | Misterio 50 · sin costo | Planchado 40 · 52 · −12.
 */
describe("GET /reports/items (F10-RPT-03)", () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let tokenService: TokenService;
  let negocio: TenantFixture;
  let centroId: string;
  let norteId: string;
  let ids: {
    queso: string;
    refresco: string;
    pan: string;
    misterio: string;
    corte: string;
    planchado: string;
  };
  let codigos: { queso: string; corte: string };
  /** El mes en curso, en el calendario del negocio: la ventana `month` del panel. */
  let inicioDeMes: string;
  let hoy: string;

  const get = (token: string, url: string) =>
    request(app.getHttpServer()).get(url).set("Authorization", bearer(token));
  const post = (url: string, body: object = {}) =>
    request(app.getHttpServer()).post(url).set("Authorization", bearer(negocio.token)).send(body);
  const pagina = async (url: string, token = negocio.token): Promise<Pagina> =>
    (await get(token, url).expect(200)).body as Pagina;
  const delMes = (vista: string, extra = "") =>
    `/reports/items?view=${vista}&from=${inicioDeMes}&to=${hoy}${extra}`;
  const nombres = (p: Pagina) => p.rows.map((f) => f.name);
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

    negocio = await registerTenant(app, "reporte-por-articulo");
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

    const stamp = randomUUID().replace(/\D/g, "").padEnd(8, "7").slice(0, 8);
    codigos = { queso: `QUESO-${stamp}`, corte: `CORTE-${stamp}` };

    const creados = await prisma.withTenantContext(negocio.tenantId, async (tx) => {
      const tenantId = negocio.tenantId;
      const exento = await tx.taxGroup.findFirstOrThrow({ where: { tenantId, code: "EXEMPT" } });
      const norte = await tx.warehouse.create({
        data: { tenantId, code: `NTE-${stamp}`, name: "Norte" },
      });

      // Un producto con su presentación de venta: el costo es el del catálogo.
      const producto = async (
        sku: string,
        name: string,
        presentaciones: { name: string; factor: number; price: number; cost?: number }[],
        extra: { baseUnit?: string; taxGroupId?: string } = {},
      ) => {
        const p = await tx.product.create({ data: { tenantId, sku, name, ...extra } });
        const creadas: string[] = [];
        for (const [i, pr] of presentaciones.entries()) {
          creadas.push(
            (
              await tx.productPresentation.create({
                data: {
                  tenantId,
                  productId: p.id,
                  name: pr.name,
                  factor: pr.factor,
                  allowFractionalInput: extra.baseUnit === "kg",
                  isDefaultSale: i === 0,
                  price: pr.price,
                  ...(pr.cost !== undefined && { cost: pr.cost }),
                },
              })
            ).id,
          );
        }
        for (const warehouseId of [centroId, norte.id]) {
          await tx.stockByWarehouse.create({
            data: { tenantId, productId: p.id, warehouseId, quantity: 100 },
          });
        }
        return { id: p.id, presentaciones: creadas };
      };

      const queso = await producto(
        codigos.queso,
        "Queso Oaxaca",
        [
          { name: "Kilogramo", factor: 1, price: 200, cost: 150 },
          { name: "Porción 250 g", factor: 0.25, price: 55, cost: 37.5 },
        ],
        { baseUnit: "kg", taxGroupId: exento.id },
      );
      // Con IVA incluido: $23.20 son $20 de venta y $3.20 de impuesto.
      const refresco = await producto(`REF-${stamp}`, "Refresco", [
        { name: "Pieza", factor: 1, price: 23.2, cost: 15 },
      ]);
      const pan = await producto(
        `PAN-${stamp}`,
        "Pan",
        [{ name: "Pieza", factor: 1, price: 10, cost: 12 }],
        { taxGroupId: exento.id },
      );
      const misterio = await producto(
        `MIS-${stamp}`,
        "Misterio",
        [{ name: "Pieza", factor: 1, price: 50 }],
        { taxGroupId: exento.id },
      );

      const servicio = async (
        code: string,
        name: string,
        price: number,
        cost: number,
        iva: boolean,
      ) => {
        const s = await tx.service.create({
          data: {
            tenantId,
            code,
            name,
            price,
            cost,
            ...(!iva && { taxGroupId: exento.id }),
          },
        });
        for (const warehouseId of [centroId, norte.id]) {
          await tx.serviceWarehouse.create({ data: { tenantId, serviceId: s.id, warehouseId } });
        }
        return s.id;
      };
      const corte = await servicio(codigos.corte, "Corte de cabello", 116, 30, true);
      const planchado = await servicio(`PLA-${stamp}`, "Planchado", 20, 26, false);

      return { norteId: norte.id, queso, refresco, pan, misterio, corte, planchado };
    });
    norteId = creados.norteId;
    ids = {
      queso: creados.queso.id,
      refresco: creados.refresco.id,
      pan: creados.pan.id,
      misterio: creados.misterio.id,
      corte: creados.corte,
      planchado: creados.planchado,
    };
    const [kilo, porcion] = creados.queso.presentaciones;

    const cobrar = async (body: object) =>
      ((await post("/pos/sales", body).expect(201)).body as { id: string }).id;

    await post("/pos/session", { warehouseId: centroId }).expect(201);
    await cobrar({
      paymentMethod: "cash",
      lines: [
        { productId: ids.queso, presentationId: kilo, quantity: 2 },
        { productId: ids.queso, presentationId: porcion, quantity: 2 },
        { productId: ids.refresco, quantity: 3 },
        { serviceId: ids.corte, quantity: 1 },
        { productId: ids.misterio, quantity: 1 },
      ],
    });
    await cobrar({
      paymentMethod: "cash",
      lines: [
        { productId: ids.pan, quantity: 4 },
        { serviceId: ids.planchado, quantity: 2 },
      ],
    });
    const deMarzo = await cobrar({
      paymentMethod: "cash",
      lines: [{ serviceId: ids.corte, quantity: 3 }],
    });
    await post("/pos/session/close", { declaredCash: 0 }).expect(200);

    await post("/pos/session", { warehouseId: norteId }).expect(201);
    await cobrar({
      paymentMethod: "cash",
      lines: [
        { productId: ids.refresco, quantity: 5 },
        { productId: ids.pan, quantity: 1 },
      ],
    });
    const cancelada = await cobrar({
      paymentMethod: "cash",
      lines: [{ productId: ids.queso, presentationId: kilo, quantity: 10 }],
    });
    await post(`/pos/sales/${cancelada}/cancel`, { reason: "e2e" }).expect(200);

    await prisma.withTenantContext(negocio.tenantId, (tx) =>
      tx.sale.update({
        where: { id: deMarzo },
        data: { createdAt: new Date("2026-03-13T05:30:00.000Z") },
      }),
    );

    const tenant = await prisma.tenant.findUniqueOrThrow({
      where: { id: negocio.tenantId },
      select: { timezone: true },
    });
    hoy = localCalendarDate(tenant.timezone, new Date());
    inicioDeMes = `${hoy.slice(0, 7)}-01`;
  });

  afterAll(async () => {
    await app.close();
  });

  describe("las tres vistas", () => {
    it("«Más vendidos» ordena por venta sin impuesto y, en un empate, por cantidad", async () => {
      const p = await pagina(delMes("top-sold"));

      expect(p.total).toBe(6);
      expect(p.rows.map((f) => [f.name, f.revenue])).toEqual([
        ["Queso Oaxaca", "510.00"],
        ["Refresco", "160.00"],
        ["Corte de cabello", "100.00"],
        // Pan y Misterio vendieron $50 cada uno: Pan movió 5 piezas, Misterio 1.
        ["Pan", "50.00"],
        ["Misterio", "50.00"],
        ["Planchado", "40.00"],
      ]);
      expect(p.rows[0]).toEqual({
        kind: "product",
        itemId: ids.queso,
        code: codigos.queso,
        name: "Queso Oaxaca",
        // 2 kg más 2 porciones de 250 g, en la unidad base.
        quantity: "2.5000",
        baseUnit: "kg",
        revenue: "510.00",
        cost: "375.00",
        profit: "135.00",
        margin: 26.5,
      });
      expect(p.rows[2]).toEqual({
        kind: "service",
        itemId: ids.corte,
        code: codigos.corte,
        name: "Corte de cabello",
        quantity: "1.0000",
        // Un servicio no tiene unidad de medida.
        baseUnit: null,
        revenue: "100.00",
        cost: "30.00",
        profit: "70.00",
        margin: 70,
      });
      // Sin costo no hay utilidad: ni cero ni inventada.
      expect(p.rows[4]).toMatchObject({ name: "Misterio", cost: null, profit: null, margin: null });
      // El pie es de TODO lo filtrado; con un artículo sin costo, la utilidad no está completa.
      expect(p.totals).toEqual({ revenue: "910.00", cost: null, profit: null, margin: null });
    });

    it("«Mayor utilidad» solo trae lo que dejó, de mayor a menor utilidad", async () => {
      const p = await pagina(delMes("top-profit"));

      expect(p.rows.map((f) => [f.name, f.revenue, f.cost, f.profit, f.margin])).toEqual([
        ["Queso Oaxaca", "510.00", "375.00", "135.00", 26.5],
        ["Corte de cabello", "100.00", "30.00", "70.00", 70],
        ["Refresco", "160.00", "120.00", "40.00", 25],
      ]);
      expect(p.total).toBe(3);
      expect(p.totals).toEqual({
        revenue: "770.00",
        cost: "525.00",
        profit: "245.00",
        margin: 31.8,
      });
    });

    it("«Vendidos bajo su costo» trae solo las pérdidas, de la mayor a la menor", async () => {
      const p = await pagina(delMes("below-cost"));

      expect(p.rows.map((f) => [f.kind, f.name, f.revenue, f.cost, f.profit, f.margin])).toEqual([
        ["service", "Planchado", "40.00", "52.00", "-12.00", -30],
        ["product", "Pan", "50.00", "60.00", "-10.00", -20],
      ]);
      expect(p.totals).toEqual({
        revenue: "90.00",
        cost: "112.00",
        profit: "-22.00",
        margin: -24.4,
      });
    });

    it("un artículo sin costo no aparece en utilidad ni en bajo costo", async () => {
      for (const vista of ["top-profit", "below-cost"]) {
        const p = await pagina(`/reports/items?view=${vista}`);
        expect({ vista, ids: p.rows.map((f) => f.itemId) }).toEqual({
          vista,
          ids: expect.not.arrayContaining([ids.misterio]),
        });
      }
    });

    it("sin vista es «Más vendidos», y una vista o un filtro que no existe responde 400", async () => {
      const sinVista = await get(negocio.token, "/reports/items").expect(200);
      const masVendidos = await get(negocio.token, "/reports/items?view=top-sold").expect(200);
      expect(sinVista.body).toEqual(masVendidos.body);
      await get(negocio.token, "/reports/items?view=top-loss").expect(400);
      await get(negocio.token, "/reports/items?view=top-sold&type=concept").expect(400);
      await get(negocio.token, "/reports/items?view=top-sold&status=completed").expect(400);
      await get(negocio.token, "/reports/items?view=top-sold&pageSize=101").expect(400);
    });
  });

  it("una venta cancelada no cuenta: los 10 kg de queso de Norte no están en ningún lado", async () => {
    const todo = await pagina("/reports/items?view=top-sold");
    expect(todo.rows.find((f) => f.itemId === ids.queso)).toMatchObject({
      quantity: "2.5000",
      revenue: "510.00",
    });
    const norte = await pagina(`/reports/items?view=top-sold&warehouseId=${norteId}`);
    expect(nombres(norte)).not.toContain("Queso Oaxaca");
  });

  it("filtra por tipo: productos o servicios", async () => {
    expect(nombres(await pagina(delMes("top-sold", "&type=service")))).toEqual([
      "Corte de cabello",
      "Planchado",
    ]);
    expect(nombres(await pagina(delMes("top-sold", "&type=product")))).toEqual([
      "Queso Oaxaca",
      "Refresco",
      "Pan",
      "Misterio",
    ]);
    expect(nombres(await pagina(delMes("below-cost", "&type=service")))).toEqual(["Planchado"]);
    const todos = await pagina(delMes("top-sold", "&type=all"));
    expect(todos.total).toBe(6);
  });

  it("filtra por sucursal", async () => {
    const norte = await pagina(delMes("top-sold", `&warehouseId=${norteId}`));
    expect(norte.rows.map((f) => [f.name, f.quantity, f.revenue])).toEqual([
      ["Refresco", "5.0000", "100.00"],
      ["Pan", "1.0000", "10.00"],
    ]);
    expect(norte.totals).toEqual({
      revenue: "110.00",
      cost: "87.00",
      profit: "23.00",
      margin: 20.9,
    });
  });

  it("las fechas son días del calendario del negocio, como en Ventas", async () => {
    // V5 se cobró el 12 de marzo a las 23:30 de la Ciudad de México: en UTC ya era el 13.
    const del12 = await pagina("/reports/items?view=top-sold&from=2026-03-12&to=2026-03-12");
    expect(del12.rows.map((f) => [f.name, f.quantity, f.revenue, f.profit])).toEqual([
      ["Corte de cabello", "3.0000", "300.00", "210.00"],
    ]);
    const del13 = await pagina("/reports/items?view=top-sold&from=2026-03-13&to=2026-03-13");
    expect(del13.rows).toEqual([]);
    expect(del13.totals).toBeNull();
    expect(del13.total).toBe(0);

    // Sin fechas, todo lo cobrado: el corte de marzo se suma al de este mes.
    const siempre = await pagina("/reports/items?view=top-sold");
    expect(siempre.rows.find((f) => f.itemId === ids.corte)).toMatchObject({
      quantity: "4.0000",
      revenue: "400.00",
    });
    // El mes en curso no lo trae.
    const mes = await pagina(delMes("top-sold"));
    expect(mes.rows.find((f) => f.itemId === ids.corte)?.revenue).toBe("100.00");

    await get(negocio.token, "/reports/items?view=top-sold&from=ayer").expect(400);
  });

  it("pagina sin repetir renglones y el pie no depende de la página", async () => {
    const completa = await pagina(delMes("top-sold"));
    expect(completa.pageSize).toBe(20);
    const uno = await pagina(delMes("top-sold", "&page=1&pageSize=4"));
    const dos = await pagina(delMes("top-sold", "&page=2&pageSize=4"));
    expect(uno.rows).toHaveLength(4);
    expect(dos.rows).toHaveLength(2);
    expect([...uno.rows, ...dos.rows]).toEqual(completa.rows);
    expect(dos.total).toBe(6);
    expect(dos.totals).toEqual(completa.totals);
    // Una página más allá del final no pierde el conteo ni el pie.
    const tres = await pagina(delMes("top-sold", "&page=3&pageSize=4"));
    expect(tres.rows).toEqual([]);
    expect(tres.total).toBe(6);
    expect(tres.totals).toEqual(completa.totals);
  });

  it("dice los mismos números que el panel para la misma ventana", async () => {
    const panel = (await get(negocio.token, "/reports/dashboard/products?period=month").expect(200))
      .body as Panel;

    const vendidos = await pagina(delMes("top-sold"));
    expect(
      vendidos.rows.slice(0, 10).map((f) => [f.itemId, f.kind, f.quantity, f.revenue]),
    ).toEqual(panel.topSold.map((f) => [f.itemId, f.kind, f.units, f.revenue]));

    const utilidad = await pagina(delMes("top-profit"));
    expect(
      utilidad.rows
        .slice(0, 5)
        .map((f) => [f.itemId, f.kind, f.revenue, f.cost, f.profit, f.margin]),
    ).toEqual(
      panel.topProfit.map((f) => [f.itemId, f.kind, f.revenue, f.cost, f.profit, f.marginPct]),
    );

    const perdidas = await pagina(delMes("below-cost"));
    expect(
      perdidas.rows
        .slice(0, 5)
        .map((f) => [f.itemId, f.kind, f.revenue, f.cost, f.profit, f.margin]),
    ).toEqual(
      panel.belowCost.map((f) => [f.itemId, f.kind, f.revenue, f.cost, f.profit, f.marginPct]),
    );
    expect(perdidas.total).toBe(panel.belowCostCount);
  });

  describe("la exportación", () => {
    it("el Excel trae las columnas, con la cantidad como número y su unidad aparte", async () => {
      const respuesta = await descargar(
        negocio.token,
        delMes("top-sold").replace("/items?", "/items/export?"),
      ).expect(200);
      expect(respuesta.headers["content-disposition"]).toContain("mas-vendidos.xlsx");
      const sheet = await hoja(respuesta.body as Buffer);

      expect(sheet.name).toBe("Más vendidos");
      expect(encabezado(sheet)).toEqual([
        "Tipo",
        "Código",
        "Artículo",
        "Cantidad",
        "Unidad",
        "Venta sin impuesto",
        "Costo",
        "Utilidad",
        "Margen %",
      ]);
      // Los seis artículos, sin paginar y en el orden de la pantalla.
      expect(sheet.rowCount).toBe(7);
      const queso = sheet.getRow(2);
      expect(queso.getCell(1).value).toBe("Producto");
      expect({ value: queso.getCell(2).value, numFmt: queso.getCell(2).numFmt }).toEqual({
        value: codigos.queso,
        numFmt: "@",
      });
      expect(queso.getCell(3).value).toBe("Queso Oaxaca");
      expect(queso.getCell(5).value).toBe("Kilogramo");
      for (const [columna, valor] of [
        [4, 2.5],
        [6, 510],
        [7, 375],
        [8, 135],
        [9, 26.5],
      ] as const) {
        expect({
          columna,
          type: queso.getCell(columna).type,
          value: queso.getCell(columna).value,
        }).toEqual({ columna, type: ExcelJS.ValueType.Number, value: valor });
      }
      // El servicio: sin unidad de medida.
      const corte = sheet.getRow(4);
      expect(corte.getCell(1).value).toBe("Servicio");
      expect(corte.getCell(4).value).toBe(1);
      expect(corte.getCell(5).value ?? "").toBe("");
      // Sin costo, las celdas de dinero quedan vacías: un 0 se sumaría como dato.
      const misterio = sheet.getRow(6);
      expect(misterio.getCell(3).value).toBe("Misterio");
      expect([7, 8, 9].map((c) => misterio.getCell(c).value ?? "")).toEqual(["", "", ""]);
    });

    it("respeta la vista y los filtros, y habla el idioma de quien descarga", async () => {
      const perdidas = await descargar(
        negocio.token,
        `/reports/items/export?view=below-cost&type=service&from=${inicioDeMes}&to=${hoy}`,
      ).expect(200);
      expect(perdidas.headers["content-disposition"]).toContain("vendidos-bajo-su-costo.xlsx");
      const hojaPerdidas = await hoja(perdidas.body as Buffer);
      expect(hojaPerdidas.name).toBe("Vendidos bajo su costo");
      expect(hojaPerdidas.rowCount).toBe(2);
      expect(hojaPerdidas.getRow(2).getCell(3).value).toBe("Planchado");
      expect(hojaPerdidas.getRow(2).getCell(8).value).toBe(-12);

      const en = await descargar(
        tokenCon(["reports:read"], "en"),
        "/reports/items/export?view=top-profit",
      ).expect(200);
      expect(en.headers["content-disposition"]).toContain("top-profit.xlsx");
      const sheet = await hoja(en.body as Buffer);
      expect(sheet.name).toBe("Top profit");
      expect(encabezado(sheet)).toEqual([
        "Type",
        "Code",
        "Item",
        "Quantity",
        "Unit",
        "Sales before tax",
        "Cost",
        "Profit",
        "Margin %",
      ]);
      // Sin fechas es todo lo cobrado: con el de marzo, el corte deja 280 y encabeza.
      expect([1, 3, 8].map((c) => sheet.getRow(2).getCell(c).value)).toEqual([
        "Service",
        "Corte de cabello",
        280,
      ]);
      expect([1, 3, 5].map((c) => sheet.getRow(3).getCell(c).value)).toEqual([
        "Product",
        "Queso Oaxaca",
        "Kilogram",
      ]);

      const csv = await get(negocio.token, "/reports/items/export?view=top-sold&format=csv").expect(
        200,
      );
      expect(csv.headers["content-disposition"]).toContain("mas-vendidos.csv");
      expect(csv.text.split("\n")[0]).toContain("Venta sin impuesto");
    });

    it("la exportación también rechaza un filtro que no existe", async () => {
      await get(negocio.token, "/reports/items/export?view=top-sold&page=1").expect(400);
      await get(negocio.token, "/reports/items/export?view=top-loss").expect(400);
    });
  });

  describe("quién entra", () => {
    it.each(["/reports/items?view=top-sold", "/reports/items/export?view=top-sold"])(
      "%s pide `reports:read`",
      async (ruta) => {
        await get(tokenCon(["pos:view", "pos:sell"]), ruta).expect(403);
      },
    );

    it("aplica el alcance: un usuario de Norte no ve Centro y no puede pedirlo (403)", async () => {
      const acotado = tokenCon(["reports:read"]);
      await prisma.withTenantContext(negocio.tenantId, (tx) =>
        tx.userWarehouseScope.create({
          data: { tenantId: negocio.tenantId, userId: negocio.userId, warehouseId: norteId },
        }),
      );
      try {
        const suyo = await pagina(delMes("top-sold"), acotado);
        expect(nombres(suyo)).toEqual(["Refresco", "Pan"]);
        await get(acotado, `/reports/items?view=top-sold&warehouseId=${centroId}`).expect(403);
        await get(acotado, `/reports/items/export?view=top-sold&warehouseId=${centroId}`).expect(
          403,
        );
      } finally {
        await prisma.withTenantContext(negocio.tenantId, (tx) =>
          tx.userWarehouseScope.deleteMany({ where: { userId: negocio.userId } }),
        );
      }
    });
  });
});
