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
import { extractTokenFromLink } from "./support/extract-token-from-link";
import { startTestApp } from "./support/start-test-app";

const PASSWORD = "twelve-characters";

/**
 * F5-STK — el reporte de stock por almacén.
 *
 * Es la primera consulta TRANSVERSAL del sistema: hasta hoy el stock solo se
 * podía ver producto por producto (la tab de la ficha). Acá se pregunta al
 * revés — «qué hay en mis bodegas» — y esa vuelta trae tres cosas que la
 * ficha no necesitaba: alcance por almacén, orden estable entre páginas y
 * valorización.
 */
describe("Reporte de stock (F5-STK)", () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let tokenService: TokenService;
  let token: string;
  let tenantId: string;
  let userId: string;
  let centralId: string;
  let norteId: string;
  let cafeId: string;
  let azucarId: string;
  let loteadoId: string;
  let repartidoId: string;

  const auth = () => ({ Authorization: `Bearer ${token}` });

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(MAILER)
      .useClass(NoopMailer)
      .compile();
    app = moduleFixture.createNestApplication();
    await startTestApp(app);
    prisma = app.get(PrismaService);
    tokenService = app.get(TokenService);

    const email = `owner-${randomUUID()}@example.com`;
    const registered = await request(app.getHttpServer())
      .post("/auth/register-tenant")
      .send({
        tenantName: `Tenant stock ${randomUUID()}`,
        email,
        password: PASSWORD,
        firstName: "Ana",
        lastNamePaternal: "Pérez",
        locale: "es",
      })
      .expect(201);
    tenantId = (registered.body as { tenantId: string }).tenantId;

    const mailer = app.get<NoopMailer>(MAILER);
    const link = extractTokenFromLink(mailer.sent.find((m) => m.to === email)?.vars.link);
    await request(app.getHttpServer()).post("/auth/verify-email").send({ token: link }).expect(200);

    const login = await request(app.getHttpServer())
      .post("/auth/login")
      .send({ email, password: PASSWORD })
      .expect(200);
    token = (login.body as { accessToken: string }).accessToken;

    await prisma.withTenantContext(tenantId, async (tx) => {
      userId = (await tx.user.findFirstOrThrow({ where: { tenantId } })).id;

      const [central, norte] = await Promise.all([
        tx.warehouse.create({ data: { tenantId, name: "Central stock" } }),
        tx.warehouse.create({ data: { tenantId, name: "Norte stock" } }),
      ]);
      centralId = central.id;
      norteId = norte.id;

      const stamp = randomUUID().slice(0, 6);
      // `stockMin` 100 con 60 en total: el producto queda bajo mínimo.
      const cafe = await tx.product.create({
        data: { tenantId, sku: `SCAF-${stamp}`, name: "Café", stockMin: "100" },
      });
      const azucar = await tx.product.create({
        data: { tenantId, sku: `SAZU-${stamp}`, name: "Azúcar", stockMin: "0" },
      });
      const loteado = await tx.product.create({
        data: { tenantId, sku: `SLOT-${stamp}`, name: "Con lotes", tracksLots: true },
      });
      // El producto que DISTINGUE los dos criterios: 40 + 30 = 70 sobre un
      // mínimo de 50 —no está bajo mínimo— pero ninguna bodega llega sola a
      // 50. Con el criterio por fila, las dos saldrían marcadas.
      const repartido = await tx.product.create({
        data: { tenantId, sku: `SREP-${stamp}`, name: "Repartido", stockMin: "50" },
      });
      cafeId = cafe.id;
      azucarId = azucar.id;
      loteadoId = loteado.id;
      repartidoId = repartido.id;

      await tx.stockByWarehouse.createMany({
        data: [
          { tenantId, productId: cafe.id, warehouseId: central.id, quantity: "40" },
          { tenantId, productId: cafe.id, warehouseId: norte.id, quantity: "20" },
          { tenantId, productId: azucar.id, warehouseId: central.id, quantity: "500" },
          { tenantId, productId: loteado.id, warehouseId: central.id, quantity: "30" },
          { tenantId, productId: repartido.id, warehouseId: central.id, quantity: "40" },
          { tenantId, productId: repartido.id, warehouseId: norte.id, quantity: "30" },
        ],
      });

      // Dos lotes del mismo producto, uno de ellos partido en DOS ubicaciones:
      // la ubicación parte el stock (es parte de la PK de `stock_lots`).
      const [lote1, lote2] = await Promise.all([
        tx.productLot.create({
          data: {
            tenantId,
            productId: loteado.id,
            lotCode: `L1-${stamp}`,
            expiresAt: new Date("2027-03-01"),
          },
        }),
        tx.productLot.create({ data: { tenantId, productId: loteado.id, lotCode: `L2-${stamp}` } }),
      ]);
      await tx.stockLot.createMany({
        data: [
          {
            tenantId,
            lotId: lote1.id,
            warehouseId: central.id,
            location: "A-1",
            quantity: "12",
          },
          {
            tenantId,
            lotId: lote1.id,
            warehouseId: central.id,
            location: "B-2",
            quantity: "8",
          },
          { tenantId, lotId: lote2.id, warehouseId: central.id, location: "", quantity: "10" },
        ],
      });

      // Dos compras del café para que tenga promedio ponderado: 10 a $5 y
      // 30 a $9 → $8. El azúcar NO se compra nunca: su celda va vacía.
      const documento = await tx.inventoryDocument.create({
        data: {
          tenantId,
          folio: `ENT-${stamp}`,
          type: "entry",
          status: "confirmed",
          warehouseId: central.id,
          reasonCode: "invoice",
          createdBy: userId,
          confirmedBy: userId,
          confirmedAt: new Date(),
        },
      });
      await tx.stockMovement.createMany({
        data: [
          {
            tenantId,
            documentId: documento.id,
            productId: cafe.id,
            warehouseId: central.id,
            direction: "entry",
            reasonCode: "invoice",
            quantity: "10",
            unitCost: "5.00",
            createdBy: userId,
          },
          {
            tenantId,
            documentId: documento.id,
            productId: cafe.id,
            warehouseId: central.id,
            direction: "entry",
            reasonCode: "invoice",
            quantity: "30",
            unitCost: "9.00",
            createdBy: userId,
          },
        ],
      });
    });
  });

  afterAll(async () => {
    await app.close();
  });

  // ── F5-STK-01 ─────────────────────────────────────────────────────────
  describe("la consulta (F5-STK-01)", () => {
    it("devuelve una fila por producto Y almacén, no una por producto", async () => {
      const response = await request(app.getHttpServer())
        .get("/reports/stock")
        .set(auth())
        .expect(200);

      const body = response.body as {
        rows: { productId: string; warehouseId: string; quantity: string }[];
        total: number;
      };
      const delCafe = body.rows.filter((r) => r.productId === cafeId);

      expect(delCafe).toHaveLength(2);
      expect(delCafe.map((r) => r.quantity).sort()).toEqual(["20", "40"]);
    });

    it("filtrar por almacén acota las filas a ese almacén", async () => {
      const response = await request(app.getHttpServer())
        .get(`/reports/stock?warehouseId=${norteId}`)
        .set(auth())
        .expect(200);

      const rows = (response.body as { rows: { warehouseId: string }[] }).rows;
      expect(rows.length).toBeGreaterThan(0);
      expect(rows.every((r) => r.warehouseId === norteId)).toBe(true);
    });

    /**
     * `stockMin` es un umbral GLOBAL del producto («no quiero tener menos de
     * 100 en total»), así que `belowMin` compara contra el TOTAL y no contra
     * el saldo de la fila. Es el mismo criterio del kardex, y el que responde
     * la pregunta de reposición: qué hay que comprar. Las filas siguen
     * mostrando DÓNDE está ese stock.
     */
    it("belowMin mira el total del producto, no el saldo de cada almacén", async () => {
      const response = await request(app.getHttpServer())
        .get("/reports/stock?belowMin=true")
        .set(auth())
        .expect(200);

      const rows = (response.body as { rows: { productId: string; belowMin: boolean }[] }).rows;

      // El café tiene 40 + 20 = 60 contra un mínimo de 100: sus DOS filas
      // están bajo mínimo, incluso la de 40 —que aislada podría parecer que
      // «casi alcanza»—.
      expect(rows.filter((r) => r.productId === cafeId)).toHaveLength(2);
      expect(rows.every((r) => r.belowMin)).toBe(true);
      // El azúcar tiene mínimo 0: sin umbral no hay déficit que reportar.
      expect(rows.some((r) => r.productId === azucarId)).toBe(false);

      // ⚠ El caso que distingue los dos criterios: «Repartido» tiene 40 + 30
      // contra un mínimo de 50. Su total ALCANZA, así que no hay nada que
      // comprar — aunque ninguna bodega llegue sola. Con el criterio por fila
      // aparecerían sus dos filas y alguien saldría a comprar de más.
      expect(rows.some((r) => r.productId === repartidoId)).toBe(false);
    });

    it("un producto con el total suficiente NO está bajo mínimo, aunque ninguna bodega llegue sola", async () => {
      const response = await request(app.getHttpServer())
        .get("/reports/stock?search=Repartido")
        .set(auth())
        .expect(200);

      const rows = (response.body as { rows: { belowMin: boolean; quantity: string }[] }).rows;
      expect(rows).toHaveLength(2);
      expect(rows.every((r) => r.belowMin)).toBe(false);
      expect(rows.some((r) => r.belowMin)).toBe(false);
    });

    it("la búsqueda encuentra por SKU y por nombre", async () => {
      const porNombre = await request(app.getHttpServer())
        .get("/reports/stock?search=Azúcar")
        .set(auth())
        .expect(200);

      const rows = (porNombre.body as { rows: { productId: string }[] }).rows;
      expect(rows.every((r) => r.productId === azucarId)).toBe(true);
      expect(rows.length).toBeGreaterThan(0);
    });

    /**
     * Sin desempate por `id`, dos filas empatadas en el criterio de orden
     * quedan en el orden que Postgres decida — y ese orden puede cambiar
     * entre consultas, así que una fila saldría en dos páginas o en ninguna.
     */
    it("el orden es estable entre páginas: nada se repite ni se pierde", async () => {
      const primera = await request(app.getHttpServer())
        .get("/reports/stock?page=1&pageSize=2")
        .set(auth())
        .expect(200);
      const segunda = await request(app.getHttpServer())
        .get("/reports/stock?page=2&pageSize=2")
        .set(auth())
        .expect(200);

      const clave = (r: { productId: string; warehouseId: string }) =>
        `${r.productId}|${r.warehouseId}`;
      const uno = (primera.body as { rows: { productId: string; warehouseId: string }[] }).rows.map(
        clave,
      );
      const dos = (segunda.body as { rows: { productId: string; warehouseId: string }[] }).rows.map(
        clave,
      );

      expect(uno).toHaveLength(2);
      expect(uno.filter((k) => dos.includes(k))).toEqual([]);
    });

    /**
     * El desempate se prueba con filas EMPATADAS: el mismo producto en dos
     * almacenes comparte nombre, así que el orden por nombre no las separa. Si
     * el `orderBy` no incluye las columnas de la clave, quién va primero lo
     * decide el plan de Postgres —y eso cambia entre consultas, así que una
     * fila puede salir en dos páginas o en ninguna—.
     */
    it("dos filas del mismo producto salen en orden determinista, no en el que Postgres elija", async () => {
      const response = await request(app.getHttpServer())
        .get("/reports/stock?search=Repartido")
        .set(auth())
        .expect(200);

      const rows = (response.body as { rows: { productId: string; warehouseId: string }[] }).rows;
      const comoLlegaron = rows.map((r) => `${r.productId}|${r.warehouseId}`);
      const ordenados = [...comoLlegaron].sort();

      expect(comoLlegaron).toEqual(ordenados);
    });

    it("un usuario acotado a un almacén NO ve las filas de otro", async () => {
      const acotado = tokenService.signAccessToken({
        sub: userId,
        tenantId,
        permissions: ["reports:read"],
        locale: "es",
      });
      // El alcance viaja en el interceptor a partir de los almacenes
      // asignados al usuario, así que se le asigna SOLO el Norte.
      await prisma.withTenantContext(tenantId, (tx) =>
        tx.userWarehouseScope.create({ data: { tenantId, userId, warehouseId: norteId } }),
      );

      const response = await request(app.getHttpServer())
        .get("/reports/stock")
        .set("Authorization", `Bearer ${acotado}`)
        .expect(200);

      const rows = (response.body as { rows: { warehouseId: string }[] }).rows;
      expect(rows.length).toBeGreaterThan(0);
      expect(rows.every((r) => r.warehouseId === norteId)).toBe(true);

      await prisma.withTenantContext(tenantId, (tx) =>
        tx.userWarehouseScope.deleteMany({ where: { userId } }),
      );
    });

    /**
     * El TOTAL que se muestra también está acotado.
     *
     * Sumar los almacenes de afuera filtraría por la ventana del total
     * información que la persona no puede ver: le diría «hay 60» señalando
     * stock de una bodega que no administra, y encima cambiaría su `belowMin`
     * por mercancía a la que no puede llegar.
     */
    it("el total del producto suma SOLO los almacenes del alcance", async () => {
      const acotado = tokenService.signAccessToken({
        sub: userId,
        tenantId,
        permissions: ["reports:read"],
        locale: "es",
      });
      await prisma.withTenantContext(tenantId, (tx) =>
        tx.userWarehouseScope.create({ data: { tenantId, userId, warehouseId: norteId } }),
      );

      const response = await request(app.getHttpServer())
        .get("/reports/stock?search=Repartido")
        .set("Authorization", `Bearer ${acotado}`)
        .expect(200);

      const rows = (
        response.body as { rows: { quantity: string; totalQuantity: string; belowMin: boolean }[] }
      ).rows;

      expect(rows).toHaveLength(1);
      // 30 en el Norte, y el total es 30 — no los 70 que existen de verdad.
      expect(rows[0]?.quantity).toBe("30");
      expect(rows[0]?.totalQuantity).toBe("30");
      // Y con 30 sobre un mínimo de 50, para ESTE usuario sí está bajo mínimo.
      expect(rows[0]?.belowMin).toBe(true);

      await prisma.withTenantContext(tenantId, (tx) =>
        tx.userWarehouseScope.deleteMany({ where: { userId } }),
      );
    });

    it("pedir un almacén FUERA del alcance se rechaza, no devuelve vacío", async () => {
      const acotado = tokenService.signAccessToken({
        sub: userId,
        tenantId,
        permissions: ["reports:read"],
        locale: "es",
      });
      await prisma.withTenantContext(tenantId, (tx) =>
        tx.userWarehouseScope.create({ data: { tenantId, userId, warehouseId: norteId } }),
      );

      // Un 200 vacío diría «ese almacén no tiene nada», que es mentira.
      await request(app.getHttpServer())
        .get(`/reports/stock?warehouseId=${centralId}`)
        .set("Authorization", `Bearer ${acotado}`)
        .expect(403);

      await prisma.withTenantContext(tenantId, (tx) =>
        tx.userWarehouseScope.deleteMany({ where: { userId } }),
      );
    });
  });

  // ── F5-STK-03 ─────────────────────────────────────────────────────────
  describe("la valorización (F5-STK-03)", () => {
    it("valoriza con el promedio ponderado de las compras", async () => {
      const response = await request(app.getHttpServer())
        .get(`/reports/stock?warehouseId=${centralId}`)
        .set(auth())
        .expect(200);

      const rows = (
        response.body as {
          rows: { productId: string; avgCost: string | null; totalValue: string | null }[];
        }
      ).rows;
      const cafe = rows.find((r) => r.productId === cafeId);

      // 10 a $5 y 30 a $9 → $8 la unidad; 40 en Central → $320.
      expect(cafe?.avgCost).toBe("8.00");
      expect(cafe?.totalValue).toBe("320.00");
    });

    /**
     * ⚠ Sin historial la celda va VACÍA, no en cero. Un 0 se sumaría al total
     * del inventario y lo haría mentir: «no sé cuánto vale» y «no vale nada»
     * son afirmaciones distintas.
     */
    it("un producto sin compras deja el costo y el valor en null, no en cero", async () => {
      const response = await request(app.getHttpServer())
        .get(`/reports/stock?search=Azúcar`)
        .set(auth())
        .expect(200);

      const azucar = (
        response.body as {
          rows: { productId: string; avgCost: string | null; totalValue: string | null }[];
        }
      ).rows.find((r) => r.productId === azucarId);

      expect(azucar?.avgCost).toBeNull();
      expect(azucar?.totalValue).toBeNull();
    });
  });

  // ── F5-STK-05 ─────────────────────────────────────────────────────────
  describe("el detalle por lote y ubicación (F5-STK-05)", () => {
    /**
     * La ubicación PARTE el stock: es parte de la clave primaria de
     * `stock_lots`. «12 en A-1 y 8 en B-2» son dos filas, no una fila con una
     * etiqueta — quien va a buscar la mercancía necesita saber a qué estante ir.
     */
    it("el mismo lote en dos ubicaciones son DOS filas", async () => {
      const response = await request(app.getHttpServer())
        .get("/reports/stock?detail=lots")
        .set(auth())
        .expect(200);

      const rows = (
        response.body as {
          rows: { productId: string; lotCode: string; location: string; quantity: string }[];
        }
      ).rows.filter((r) => r.productId === loteadoId);

      const ubicaciones = rows.map((r) => r.location).sort();
      expect(ubicaciones).toEqual(["", "A-1", "B-2"]);
      expect(rows.find((r) => r.location === "A-1")?.quantity).toBe("12");
      expect(rows.find((r) => r.location === "B-2")?.quantity).toBe("8");
    });

    it("cada fila trae su caducidad, y vacía cuando el lote no vence", async () => {
      const response = await request(app.getHttpServer())
        .get("/reports/stock?detail=lots")
        .set(auth())
        .expect(200);

      const rows = (response.body as { rows: { location: string; expiresAt: string | null }[] })
        .rows;

      expect(rows.find((r) => r.location === "A-1")?.expiresAt).toBe("2027-03-01");
      // Hay rubros que manejan lote sin vencimiento (una partida de tornillos).
      expect(rows.find((r) => r.location === "")?.expiresAt).toBeNull();
    });

    it("los productos que NO manejan lotes quedan fuera del detalle", async () => {
      const response = await request(app.getHttpServer())
        .get("/reports/stock?detail=lots")
        .set(auth())
        .expect(200);

      const rows = (response.body as { rows: { productId: string }[] }).rows;
      expect(rows.some((r) => r.productId === cafeId)).toBe(false);
      expect(rows.some((r) => r.productId === loteadoId)).toBe(true);
    });

    it("sin `detail`, la respuesta es la de F5-STK-01: ningún campo de lote", async () => {
      const response = await request(app.getHttpServer())
        .get("/reports/stock")
        .set(auth())
        .expect(200);

      const primera = (response.body as { rows: Record<string, unknown>[] }).rows[0];
      expect(primera).not.toHaveProperty("lotCode");
      expect(primera).toHaveProperty("quantity");
    });

    it("el detalle también respeta el alcance por almacén", async () => {
      const acotado = tokenService.signAccessToken({
        sub: userId,
        tenantId,
        permissions: ["reports:read"],
        locale: "es",
      });
      await prisma.withTenantContext(tenantId, (tx) =>
        tx.userWarehouseScope.create({ data: { tenantId, userId, warehouseId: norteId } }),
      );

      const response = await request(app.getHttpServer())
        .get("/reports/stock?detail=lots")
        .set("Authorization", `Bearer ${acotado}`)
        .expect(200);

      // Todos los lotes están en Central: quien solo ve el Norte no ve ninguno.
      expect((response.body as { rows: unknown[] }).rows).toEqual([]);

      await prisma.withTenantContext(tenantId, (tx) =>
        tx.userWarehouseScope.deleteMany({ where: { userId } }),
      );
    });
  });

  // ── F5-STK-02 ─────────────────────────────────────────────────────────
  describe("el export (F5-STK-02)", () => {
    it("baja un xlsx con nombre de archivo y las filas de la consulta", async () => {
      const response = await descargar("/reports/stock/export").expect(200);

      expect(response.headers["content-type"]).toContain("spreadsheetml");
      expect(response.headers["content-disposition"]).toContain("stock.xlsx");
      expect(response.body.length).toBeGreaterThan(0);
    });

    it("el export respeta los MISMOS filtros que la tabla", async () => {
      // Si el export ignorara los filtros, bajaría el inventario entero
      // mientras la pantalla muestra tres filas — y nadie lo notaría hasta
      // abrir el archivo.
      const tabla = await request(app.getHttpServer())
        .get(`/reports/stock?warehouseId=${norteId}`)
        .set(auth())
        .expect(200);
      const exportado = await descargar(`/reports/stock/export?warehouseId=${norteId}`).expect(200);

      const filas = (tabla.body as { total: number }).total;
      const workbook = await cargarXlsx(exportado.body as Buffer);
      // +1 por la fila de encabezados.
      expect(workbook.rowCount).toBe(filas + 1);
    });

    it("el detalle por lote se exporta con su propia hoja", async () => {
      const response = await descargar("/reports/stock/export?detail=lots").expect(200);

      const workbook = await cargarXlsx(response.body as Buffer);
      expect(workbook.name).toBe("Stock por lote");
    });

    it("sin `detail`, la hoja se llama Stock", async () => {
      const response = await descargar("/reports/stock/export").expect(200);

      expect((await cargarXlsx(response.body as Buffer)).name).toBe("Stock");
    });

    it("un POS_Seller no puede exportar lo que no puede ver", async () => {
      const vendedor = tokenService.signAccessToken({
        sub: randomUUID(),
        tenantId,
        permissions: ["pos:sell"],
        locale: "es",
      });

      await request(app.getHttpServer())
        .get("/reports/stock/export")
        .set("Authorization", `Bearer ${vendedor}`)
        .expect(403);
    });
  });

  /**
   * `.buffer(true)` + `.parse` porque supertest no sabe qué hacer con el
   * binario de xlsx: sin esto el body llega vacío y el test verde no probaría
   * nada del contenido.
   */
  function descargar(url: string, headers: Record<string, string> = auth()) {
    return request(app.getHttpServer())
      .get(url)
      .set(headers)
      .buffer(true)
      .parse((r, cb) => {
        const chunks: Buffer[] = [];
        r.on("data", (c: Buffer) => chunks.push(c));
        r.on("end", () => cb(null, Buffer.concat(chunks)));
      });
  }

  async function cargarXlsx(body: Buffer): Promise<{ name: string; rowCount: number }> {
    const ExcelJS = (await import("exceljs")).default;
    const workbook = new ExcelJS.Workbook();
    type XlsxInput = Parameters<typeof workbook.xlsx.load>[0];
    await workbook.xlsx.load(body as unknown as XlsxInput);
    const sheet = workbook.worksheets[0];
    return { name: sheet?.name ?? "", rowCount: sheet?.rowCount ?? 0 };
  }
});
