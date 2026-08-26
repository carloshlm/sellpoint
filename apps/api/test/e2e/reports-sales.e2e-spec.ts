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
 * F5-SALES — las ventas por período.
 *
 * ── Por qué un endpoint PROPIO y no `GET /pos/sales` ────────────────────
 *
 * Son dos audiencias con dos contratos. El del POS es el MOSTRADOR: pide
 * `pos:view`, no aplica alcance —la cajera necesita encontrar el ticket que
 * el cliente trae en la mano, sin importar de qué caja salió— y su semántica
 * es de F4. El de reportes es el ANÁLISIS: pide `reports:read` y SÍ aplica
 * alcance, porque un Manager de una bodega no puede enterarse de lo que
 * vendieron las otras.
 *
 * Lo que comparten es el armado del `where`, extraído a un builder. Y ese
 * builder arrastra dos semánticas que costaron caro: el rango de fechas en
 * días del calendario del NEGOCIO (el bug de «los de hoy no salen») y el
 * filtro de folio que también busca por código de barras.
 */
describe("Reporte de ventas (F5-SALES)", () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let tokenService: TokenService;
  let token: string;
  let tenantId: string;
  let userId: string;
  let centralId: string;
  let norteId: string;
  let folioCentral: string;
  let barcodeCentral: string;

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
        tenantName: `Tenant ventas ${randomUUID()}`,
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
        tx.warehouse.create({ data: { tenantId, name: "Central ventas" } }),
        tx.warehouse.create({ data: { tenantId, name: "Norte ventas" } }),
      ]);
      centralId = central.id;
      norteId = norte.id;

      const stamp = randomUUID().slice(0, 5);
      folioCentral = `VTA-C${stamp}`;
      barcodeCentral = `2026082${String(Date.now()).slice(-5)}`;

      // Toda venta cuelga de un turno de caja (`cashboxSessionId` es
      // obligatorio): sin turno abierto no se puede cobrar. Van en SERIE y el
      // primero se cierra antes de abrir el segundo porque el índice
      // `cashbox_sessions_one_open_per_user` permite UN turno abierto por
      // persona — no se puede estar en dos cajas a la vez.
      const turnoCentral = await tx.cashboxSession.create({
        data: {
          tenantId,
          warehouseId: central.id,
          openedBy: userId,
          status: "closed",
          closedBy: userId,
          closedAt: new Date(),
        },
      });
      const turnoNorte = await tx.cashboxSession.create({
        data: { tenantId, warehouseId: norte.id, openedBy: userId },
      });

      await tx.sale.createMany({
        data: [
          {
            tenantId,
            folio: folioCentral,
            barcode: barcodeCentral,
            warehouseId: central.id,
            cashboxSessionId: turnoCentral.id,
            status: "completed",
            paymentMethod: "cash",
            subtotal: "100.00",
            discount: "0.00",
            total: "100.00",
            createdBy: userId,
          },
          {
            tenantId,
            folio: `VTA-N${stamp}`,
            barcode: null,
            warehouseId: norte.id,
            cashboxSessionId: turnoNorte.id,
            status: "completed",
            paymentMethod: "card",
            subtotal: "250.00",
            discount: "0.00",
            total: "250.00",
            createdBy: userId,
          },
          {
            tenantId,
            folio: `VTA-X${stamp}`,
            warehouseId: central.id,
            cashboxSessionId: turnoCentral.id,
            status: "canceled",
            paymentMethod: "cash",
            subtotal: "70.00",
            discount: "0.00",
            total: "70.00",
            createdBy: userId,
            // `canceled_by` y `canceled_at` van en PAREJA: lo exige el CHECK
            // `sales_canceled_coherent`. Una anulación sin responsable no es
            // una anulación, es un dato huérfano.
            canceledAt: new Date(),
            canceledBy: userId,
            cancelReason: "prueba",
          },
        ],
      });
    });
  });

  afterAll(async () => {
    await app.close();
  });

  // ── F5-SALES-01 ───────────────────────────────────────────────────────
  describe("la consulta (F5-SALES-01)", () => {
    it("lista las ventas del tenant con su almacén y su vendedor", async () => {
      const response = await request(app.getHttpServer())
        .get("/reports/sales")
        .set(auth())
        .expect(200);

      const body = response.body as {
        rows: { folio: string; warehouse: { name: string }; seller: { name: string } }[];
        total: number;
      };
      expect(body.total).toBe(3);
      expect(body.rows.find((r) => r.folio === folioCentral)?.warehouse.name).toBe(
        "Central ventas",
      );
      expect(body.rows[0]?.seller.name).toContain("Ana");
    });

    it("filtra por almacén", async () => {
      const response = await request(app.getHttpServer())
        .get(`/reports/sales?warehouseId=${norteId}`)
        .set(auth())
        .expect(200);

      const rows = (response.body as { rows: { warehouseId: string }[] }).rows;
      expect(rows).toHaveLength(1);
      expect(rows[0]?.warehouseId).toBe(norteId);
    });

    /**
     * ⚠ La diferencia de contrato con el POS. Un usuario acotado no puede
     * enterarse de lo que vendieron las otras bodegas — mientras que
     * `GET /pos/sales` sí las muestra, porque el mostrador necesita encontrar
     * el ticket que el cliente trae en la mano.
     */
    it("aplica el ALCANCE: un usuario acotado no ve ventas de otro almacén", async () => {
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
        .get("/reports/sales")
        .set("Authorization", `Bearer ${acotado}`)
        .expect(200);

      const rows = (response.body as { rows: { warehouseId: string }[] }).rows;
      expect(rows).toHaveLength(1);
      expect(rows[0]?.warehouseId).toBe(norteId);

      await prisma.withTenantContext(tenantId, (tx) =>
        tx.userWarehouseScope.deleteMany({ where: { userId } }),
      );
    });

    it("pedir un almacén fuera del alcance se rechaza, no devuelve vacío", async () => {
      const acotado = tokenService.signAccessToken({
        sub: userId,
        tenantId,
        permissions: ["reports:read"],
        locale: "es",
      });
      await prisma.withTenantContext(tenantId, (tx) =>
        tx.userWarehouseScope.create({ data: { tenantId, userId, warehouseId: norteId } }),
      );

      await request(app.getHttpServer())
        .get(`/reports/sales?warehouseId=${centralId}`)
        .set("Authorization", `Bearer ${acotado}`)
        .expect(403);

      await prisma.withTenantContext(tenantId, (tx) =>
        tx.userWarehouseScope.deleteMany({ where: { userId } }),
      );
    });

    /**
     * La semántica que el builder ARRASTRA del POS: un solo campo para las dos
     * identidades del papel. Quien escanea el ticket trae el código de 12
     * dígitos; quien lo dicta por teléfono trae el folio.
     */
    it("el filtro de folio encuentra también por código de barras", async () => {
      const response = await request(app.getHttpServer())
        .get(`/reports/sales?folio=${barcodeCentral.slice(0, 7)}`)
        .set(auth())
        .expect(200);

      const rows = (response.body as { rows: { folio: string }[] }).rows;
      expect(rows).toHaveLength(1);
      expect(rows[0]?.folio).toBe(folioCentral);
    });

    it("las ANULADAS se ven, marcadas: el filtro existe para acotar, no para tapar", async () => {
      const todas = await request(app.getHttpServer())
        .get("/reports/sales")
        .set(auth())
        .expect(200);
      const soloAnuladas = await request(app.getHttpServer())
        .get("/reports/sales?status=canceled")
        .set(auth())
        .expect(200);

      expect(
        (todas.body as { rows: { status: string }[] }).rows.some((r) => r.status === "canceled"),
      ).toBe(true);
      expect((soloAnuladas.body as { rows: unknown[] }).rows).toHaveLength(1);
    });

    /**
     * Los totales del período, para el pie de la tabla. Las ANULADAS no suman:
     * revertida es plata que no entró, y meterla en el total del método de
     * pago haría que el reporte no cuadre contra la caja.
     */
    it("devuelve los totales por método de pago, sin contar las anuladas", async () => {
      const response = await request(app.getHttpServer())
        .get("/reports/sales")
        .set(auth())
        .expect(200);

      const totals = (response.body as { totals: { paymentMethod: string; total: string }[] })
        .totals;
      const porMetodo = new Map(totals.map((t) => [t.paymentMethod, t.total]));

      expect(porMetodo.get("cash")).toBe("100.00");
      expect(porMetodo.get("card")).toBe("250.00");
    });

    /**
     * Las tres ventas se crearon en la MISMA transacción, así que comparten
     * `created_at` al microsegundo —`transaction_timestamp()`— y el orden por
     * fecha no las separa. Ahí es donde el desempate por `id` deja de ser
     * cosmético: sin él, quién va primero lo decide el plan de Postgres, y eso
     * cambia entre consultas — una fila puede salir en dos páginas o en
     * ninguna.
     *
     * Por eso el test compara contra el orden ESPERADO (id descendente) y no
     * solo busca repetidos entre páginas: buscar repetidos depende de que
     * Postgres se contradiga durante el test, que es justo lo que no se puede
     * pedir a voluntad.
     */
    it("con el mismo instante, el orden lo fija el id y no el plan de Postgres", async () => {
      const response = await request(app.getHttpServer())
        .get("/reports/sales")
        .set(auth())
        .expect(200);

      const ids = (response.body as { rows: { id: string }[] }).rows.map((r) => r.id);
      const esperados = [...ids].sort().reverse();

      expect(ids).toHaveLength(3);
      expect(ids).toEqual(esperados);
    });

    it("las páginas no repiten ni pierden filas", async () => {
      const primera = await request(app.getHttpServer())
        .get("/reports/sales?page=1&pageSize=2")
        .set(auth())
        .expect(200);
      const segunda = await request(app.getHttpServer())
        .get("/reports/sales?page=2&pageSize=2")
        .set(auth())
        .expect(200);

      const uno = (primera.body as { rows: { id: string }[] }).rows.map((r) => r.id);
      const dos = (segunda.body as { rows: { id: string }[] }).rows.map((r) => r.id);

      expect(uno).toHaveLength(2);
      expect(dos).toHaveLength(1);
      expect(new Set([...uno, ...dos]).size).toBe(3);
    });

    it("sin `reports:read` no se entra, aunque se tenga `pos:view`", async () => {
      const cajera = tokenService.signAccessToken({
        sub: randomUUID(),
        tenantId,
        permissions: ["pos:view", "pos:sell"],
        locale: "es",
      });

      await request(app.getHttpServer())
        .get("/reports/sales")
        .set("Authorization", `Bearer ${cajera}`)
        .expect(403);
    });
  });

  /**
   * La no-regresión del builder extraído. El historial del POS es otra
   * audiencia con otro contrato, y refactorizar su `where` no puede cambiarlo
   * en silencio.
   */
  describe("el historial del POS conserva SU contrato", () => {
    it("NO aplica alcance: la cajera encuentra el ticket de cualquier caja", async () => {
      const acotado = tokenService.signAccessToken({
        sub: userId,
        tenantId,
        permissions: ["pos:view"],
        locale: "es",
      });
      await prisma.withTenantContext(tenantId, (tx) =>
        tx.userWarehouseScope.create({ data: { tenantId, userId, warehouseId: norteId } }),
      );

      const response = await request(app.getHttpServer())
        .get("/pos/sales")
        .set("Authorization", `Bearer ${acotado}`)
        .expect(200);

      // Las tres, incluidas las de Central: el mostrador ve todo el tenant.
      expect((response.body as { total: number }).total).toBe(3);

      await prisma.withTenantContext(tenantId, (tx) =>
        tx.userWarehouseScope.deleteMany({ where: { userId } }),
      );
    });

    it("sigue encontrando por folio Y por código de barras", async () => {
      const response = await request(app.getHttpServer())
        .get(`/pos/sales?folio=${barcodeCentral.slice(0, 7)}`)
        .set(auth())
        .expect(200);

      expect((response.body as { rows: { folio: string }[] }).rows[0]?.folio).toBe(folioCentral);
    });
  });

  // ── F5-SALES-02 ───────────────────────────────────────────────────────
  describe("el export (F5-SALES-02)", () => {
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

    async function celdas(body: Buffer): Promise<{ name: string; rows: string[][] }> {
      const ExcelJS = (await import("exceljs")).default;
      const workbook = new ExcelJS.Workbook();
      type XlsxInput = Parameters<typeof workbook.xlsx.load>[0];
      await workbook.xlsx.load(body as unknown as XlsxInput);
      const sheet = workbook.worksheets[0];
      const rows: string[][] = [];
      sheet?.eachRow((row) => {
        const values = Array.isArray(row.values) ? row.values.slice(1) : [];
        rows.push(values.map((v) => (v === null || v === undefined ? "" : String(v))));
      });
      return { name: sheet?.name ?? "", rows };
    }

    it("baja un xlsx con la hoja «Ventas» y una fila por venta", async () => {
      const response = await descargar("/reports/sales/export").expect(200);

      expect(response.headers["content-disposition"]).toContain("ventas.xlsx");
      const { name, rows } = await celdas(response.body as Buffer);
      expect(name).toBe("Ventas");
      // Encabezado + las tres ventas.
      expect(rows).toHaveLength(4);
    });

    /**
     * El código de barras es la segunda columna, igual que en la pantalla: el
     * Excel tiene que contar la misma historia que el historial.
     */
    it("la segunda columna es el código de barras, y va vacía en las ventas viejas", async () => {
      const response = await descargar("/reports/sales/export").expect(200);
      const { rows } = await celdas(response.body as Buffer);

      expect(rows[0]?.[1]).toBe("Código de barras");
      const conCodigo = rows.find((r) => r[0] === folioCentral);
      expect(conCodigo?.[1]).toBe(barcodeCentral);
      // La del Norte no tiene: celda vacía, no un cero ni un guion.
      const sinCodigo = rows.find((r) => r[0]?.startsWith("VTA-N"));
      expect(sinCodigo?.[1]).toBe("");
    });

    it("las anuladas se exportan MARCADAS, no se omiten", async () => {
      const response = await descargar("/reports/sales/export").expect(200);
      const { rows } = await celdas(response.body as Buffer);

      const anulada = rows.find((r) => r[0]?.startsWith("VTA-X"));
      expect(anulada).toBeDefined();
      expect(anulada?.join("|")).toContain("Anulada");
    });

    it("el export respeta los mismos filtros que la consulta", async () => {
      const response = await descargar(`/reports/sales/export?warehouseId=${norteId}`).expect(200);
      const { rows } = await celdas(response.body as Buffer);

      // Encabezado + la única venta del Norte.
      expect(rows).toHaveLength(2);
    });

    it("un Seller no puede exportar lo que no puede ver", async () => {
      const vendedor = tokenService.signAccessToken({
        sub: randomUUID(),
        tenantId,
        permissions: ["pos:sell", "pos:view"],
        locale: "es",
      });

      await request(app.getHttpServer())
        .get("/reports/sales/export")
        .set("Authorization", `Bearer ${vendedor}`)
        .expect(403);
    });
  });
});
