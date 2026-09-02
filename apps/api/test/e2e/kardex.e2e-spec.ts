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

/**
 * F3-KARDEX-01 — el kardex de un producto.
 *
 * **`balanceAfter` es lo que justifica que este endpoint exista.** Un listado
 * de movimientos lo da cualquier `findMany`; lo que nadie puede reconstruir
 * mirando una página es el saldo QUE QUEDÓ después de cada línea. Por eso se
 * calcula con una window function sobre TODO el histórico y recién después se
 * filtra y se pagina: si se calculara sobre la página, la primera fila
 * arrancaría en cero.
 *
 * Y por eso el orden usa `seq` además de `created_at`: las N líneas de una
 * misma factura comparten el timestamp al microsegundo, y sin desempate los
 * saldos intermedios saldrían en cualquier orden — es decir, falsos.
 */
describe("Kardex (F3-KARDEX-01)", () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  const OWNER_PASSWORD = "twelve-characters";

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(MAILER)
      .useClass(NoopMailer)
      .compile();
    app = moduleFixture.createNestApplication();
    await startTestApp(app);
    prisma = app.get(PrismaService);
  });

  afterAll(async () => {
    await app.close();
  });

  const bearer = (t: string) => `Bearer ${t}`;

  async function registerAndLogin(): Promise<{ token: string; tenantId: string }> {
    const email = `owner-${randomUUID()}@example.com`;
    const registered = await request(app.getHttpServer())
      .post("/auth/register-tenant")
      .send({
        tenantName: `Tenant kardex ${randomUUID()}`,
        email,
        password: OWNER_PASSWORD,
        firstName: "Ana",
        lastNamePaternal: "Pérez",
        locale: "es",
      })
      .expect(201);

    const mailer = app.get<NoopMailer>(MAILER);
    const link = extractTokenFromLink(mailer.sent.find((m) => m.to === email)?.vars.link);
    await request(app.getHttpServer()).post("/auth/verify-email").send({ token: link }).expect(200);

    const login = await request(app.getHttpServer())
      .post("/auth/login")
      .send({ email, password: OWNER_PASSWORD })
      .expect(200);

    return {
      token: (login.body as { accessToken: string }).accessToken,
      tenantId: (registered.body as { tenantId: string }).tenantId,
    };
  }

  /** Dos almacenes y un producto, con los movimientos hechos por el camino real. */
  async function escenario() {
    const { token, tenantId } = await registerAndLogin();
    const auth = () => ({ Authorization: bearer(token) });

    const { productId, otroId, warehouseA, warehouseB } = await prisma.withTenantContext(
      tenantId,
      async (tx) => {
        const stamp = randomUUID().slice(0, 6);
        const [producto, otro] = await Promise.all([
          tx.product.create({ data: { tenantId, sku: `KDX-${stamp}`, name: "Jabón" } }),
          tx.product.create({ data: { tenantId, sku: `OTR-${stamp}`, name: "Otro" } }),
        ]);
        const [a, b] = await Promise.all([
          tx.warehouse.create({
            data: {
              tenantId,
              code: `WH-${Math.random().toString(36).slice(2, 10)}`,
              name: `A ${stamp}`,
            },
          }),
          tx.warehouse.create({
            data: {
              tenantId,
              code: `WH-${Math.random().toString(36).slice(2, 10)}`,
              name: `B ${stamp}`,
            },
          }),
        ]);
        return { productId: producto.id, otroId: otro.id, warehouseA: a.id, warehouseB: b.id };
      },
    );

    async function mover(
      type: "entry" | "exit",
      warehouse: string,
      lineas: Record<string, unknown>[],
      header: Record<string, unknown> = { reasonCode: "adjustment", reasonNote: "prueba" },
    ) {
      const creado = await request(app.getHttpServer())
        .post("/inventory/documents")
        .set(auth())
        .send({ type, warehouseId: warehouse })
        .expect(201);
      const id = (creado.body as { id: string }).id;
      await request(app.getHttpServer())
        .patch(`/inventory/documents/${id}`)
        .set(auth())
        .send(header)
        .expect(200);
      for (const linea of lineas) {
        await request(app.getHttpServer())
          .post(`/inventory/documents/${id}/lines`)
          .set(auth())
          .send(linea)
          .expect(201);
      }
      await request(app.getHttpServer())
        .post(`/inventory/documents/${id}/confirm`)
        .set(auth())
        .send({})
        .expect(201);
      return id;
    }

    return { token, tenantId, productId, otroId, warehouseA, warehouseB, mover };
  }

  async function tokenConAlcance(tenantId: string, warehouseIds: string[]): Promise<string> {
    const tokenService = app.get(TokenService);
    const userId = await prisma.withTenantContext(tenantId, async (tx) => {
      const owner = await tx.user.findFirstOrThrow({ select: { id: true } });
      for (const warehouseId of warehouseIds) {
        await tx.userWarehouseScope.create({ data: { userId: owner.id, warehouseId, tenantId } });
      }
      return owner.id;
    });
    return tokenService.signAccessToken({
      sub: userId,
      tenantId,
      permissions: ["inventory:read"],
      locale: "es",
    });
  }

  const kardex = (token: string, productId: string, query = "") =>
    request(app.getHttpServer())
      .get(`/products/${productId}/kardex${query}`)
      .set("Authorization", bearer(token));

  /**
   * F5-KDX-01 — el kardex en Excel.
   *
   * ── Por qué REUSA `kardex.service.list` ─────────────────────────────────
   *
   * Porque el `balanceAfter` es lo único que justifica que el kardex exista, y
   * lo calcula una window function sobre el orden total de los movimientos.
   * Una segunda implementación para el export daría los mismos números hasta
   * el día que no, y ese día nadie sabría cuál de los dos creerle.
   */
  describe("F5-KDX-01 — el export", () => {
    function descargar(token: string, productId: string, query = "") {
      return request(app.getHttpServer())
        .get(`/reports/kardex/${productId}/export${query}`)
        .set("Authorization", bearer(token))
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

    /**
     * Carlos (2026-09-02): el Excel salía con «physical_count», «adjustment»
     * y «10.0000». Las columnas hablan el idioma del usuario, dicen la unidad
     * y si el producto solo acepta enteros, y la cantidad se pinta según eso:
     * sin decimales para piezas; dos para lo continuo, cuatro si el registro
     * los trae.
     */
    describe("el Excel habla el idioma del usuario (Carlos, 2026-09-02)", () => {
      const columna = (rows: string[][], nombre: string) => {
        const idx = rows[0]?.indexOf(nombre) ?? -1;
        expect(idx).toBeGreaterThan(-1);
        return rows.slice(1).map((fila) => fila[idx]);
      };

      it("en español: Tipo, Movimiento y Motivo traducidos, unidad y «Solo enteros»", async () => {
        const { token, productId, warehouseA, mover } = await escenario();
        await mover("entry", warehouseA, [{ productId, quantity: 10 }]);

        const { rows } = await celdas(
          (await descargar(token, productId).expect(200)).body as Buffer,
        );

        expect(rows[0]).toEqual([
          "Fecha",
          "Folio",
          "Tipo",
          "Movimiento",
          "Motivo",
          "Lote",
          "Ubicación",
          "Almacén",
          "Unidad",
          "Solo enteros",
          "Cantidad",
          "Saldo",
          "Costo unitario",
          "Usuario",
        ]);
        expect(columna(rows, "Tipo")).toEqual(["Entrada"]);
        expect(columna(rows, "Movimiento")).toEqual(["Entrada"]);
        expect(columna(rows, "Motivo")[0]).not.toMatch(/^[a-z_]+$/);
        expect(columna(rows, "Unidad")).toEqual(["Pieza"]);
        expect(columna(rows, "Solo enteros")).toEqual(["Sí"]);
        expect(columna(rows, "Cantidad")).toEqual(["10"]);
        expect(columna(rows, "Saldo")).toEqual(["10"]);
      });

      it("en inglés, todo en inglés", async () => {
        const { tenantId, productId, warehouseA, mover } = await escenario();
        await mover("entry", warehouseA, [{ productId, quantity: 10 }]);
        // El idioma sale del TOKEN (la preferencia del usuario), no del
        // Accept-Language: un usuario en inglés recibe el archivo en inglés.
        const userId = await prisma.withTenantContext(tenantId, async (tx) => {
          const owner = await tx.user.findFirstOrThrow({ select: { id: true } });
          return owner.id;
        });
        const tokenEn = app.get(TokenService).signAccessToken({
          sub: userId,
          tenantId,
          permissions: ["reports:read", "inventory:read"],
          locale: "en",
        });

        const response = await request(app.getHttpServer())
          .get(`/reports/kardex/${productId}/export`)
          .set("Authorization", bearer(tokenEn))
          .buffer(true)
          .parse((r, cb) => {
            const chunks: Buffer[] = [];
            r.on("data", (c: Buffer) => chunks.push(c));
            r.on("end", () => cb(null, Buffer.concat(chunks)));
          })
          .expect(200);
        const { rows } = await celdas(response.body as Buffer);

        expect(rows[0]?.slice(2, 5)).toEqual(["Type", "Movement", "Reason"]);
        expect(columna(rows, "Type")).toEqual(["Entry"]);
        expect(columna(rows, "Unit")).toEqual(["Piece"]);
        expect(columna(rows, "Integers only")).toEqual(["Yes"]);
      });

      it("un producto en kilos pinta dos decimales, y cuatro cuando el registro los trae", async () => {
        const { token, tenantId, warehouseA, mover } = await escenario();
        const kiloId = await prisma.withTenantContext(tenantId, async (tx) => {
          const p = await tx.product.create({
            data: {
              tenantId,
              sku: `KG-${randomUUID().slice(0, 6)}`,
              name: "Harina",
              baseUnit: "kg",
            },
          });
          return p.id;
        });
        await mover("entry", warehouseA, [{ productId: kiloId, quantity: 2.5 }]);
        await mover("entry", warehouseA, [{ productId: kiloId, quantity: 1.2345 }]);

        const { rows } = await celdas((await descargar(token, kiloId).expect(200)).body as Buffer);

        // Del más reciente al más viejo, como la pantalla.
        expect(columna(rows, "Solo enteros")).toEqual(["No", "No"]);
        expect(columna(rows, "Cantidad")).toEqual(["1.2345", "2.50"]);
        expect(columna(rows, "Saldo")).toEqual(["3.7345", "2.50"]);
      });
    });

    it("baja un xlsx con una fila por movimiento", async () => {
      const { token, productId, warehouseA, mover } = await escenario();
      await mover("entry", warehouseA, [{ productId, quantity: 10 }]);
      await mover("entry", warehouseA, [{ productId, quantity: 5 }]);

      const response = await descargar(token, productId).expect(200);

      expect(response.headers["content-disposition"]).toContain("kardex.xlsx");
      const { name, rows } = await celdas(response.body as Buffer);
      expect(name).toBe("Kardex");
      // Encabezado + los dos movimientos.
      expect(rows).toHaveLength(3);
    });

    /**
     * ⚠ El corazón de la tarea: el saldo del Excel es EL MISMO que el de la
     * API paginada, porque sale del mismo servicio. Si divergieran, el papel y
     * la pantalla contarían dos historias del mismo inventario.
     */
    it("el saldo del Excel es idéntico al de la API", async () => {
      const { token, productId, warehouseA, mover } = await escenario();
      await mover("entry", warehouseA, [{ productId, quantity: 10 }]);
      await mover("exit", warehouseA, [{ productId, quantity: 4 }], {
        reasonCode: "loss",
        reasonNote: "merma",
      });

      const api = await kardex(token, productId).expect(200);
      const saldosApi = (api.body as { rows: { balanceAfter: string }[] }).rows.map((r) =>
        Number(r.balanceAfter),
      );

      const { rows } = await celdas((await descargar(token, productId).expect(200)).body as Buffer);
      const columnaSaldo = rows[0]?.indexOf("Saldo") ?? -1;
      expect(columnaSaldo).toBeGreaterThan(-1);
      // El Excel pinta según la unidad («15», no «15.0000»): se compara el NÚMERO.
      const saldosExcel = rows.slice(1).map((fila) => Number(fila[columnaSaldo]));

      expect(saldosExcel).toEqual(saldosApi);
    });

    /**
     * ⚠ El SIGNO va en la cantidad y no en una columna aparte: lo primero que
     * alguien hace con este archivo es seleccionar la columna y mirar la suma,
     * y sin signo esa suma no significa nada.
     */
    it("las salidas van en negativo, para que la columna se pueda sumar", async () => {
      const { token, productId, warehouseA, mover } = await escenario();
      await mover("entry", warehouseA, [{ productId, quantity: 10 }]);
      await mover("exit", warehouseA, [{ productId, quantity: 4 }], {
        reasonCode: "loss",
        reasonNote: "merma",
      });

      const { rows } = await celdas((await descargar(token, productId).expect(200)).body as Buffer);
      const columna = rows[0]?.indexOf("Cantidad") ?? -1;
      const cantidades = rows.slice(1).map((fila) => fila[columna]);

      // Los decimales son del `DECIMAL(14,4)` del asiento: el archivo lleva el
      // número EXACTO, sin redondear por estética.
      expect(cantidades.some((c) => c?.startsWith("-4"))).toBe(true);
      expect(cantidades.some((c) => c?.startsWith("10"))).toBe(true);
    });

    /**
     * El kardex se pide de a 200 filas: un producto muy movido necesita varias
     * vueltas. Sin el bucle, el Excel saldría CORTADO en 200 — y un archivo
     * truncado se lee como completo, que es justo lo que el tope de filas
     * viene a evitar.
     */
    it("un producto con más de una página se exporta ENTERO", async () => {
      const { token, tenantId, productId, warehouseA, mover } = await escenario();
      // Un documento real primero —para tener de dónde colgar— y después 204
      // asientos sembrados a mano. Por el flujo de captura no serviría: el
      // documento CONSOLIDA las líneas del mismo producto en un movimiento, y
      // acá hacen falta 205 filas para pasar el corte de 200, que es donde se
      // esconden los off-by-one.
      const documentId = await mover("entry", warehouseA, [{ productId, quantity: 1 }]);
      await prisma.withTenantContext(tenantId, async (tx) => {
        const owner = await tx.user.findFirstOrThrow({ where: { tenantId } });
        await tx.stockMovement.createMany({
          data: Array.from({ length: 204 }, () => ({
            tenantId,
            documentId,
            productId,
            warehouseId: warehouseA,
            direction: "entry" as const,
            reasonCode: "adjustment" as const,
            quantity: "1",
            createdBy: owner.id,
          })),
        });
      });

      const { rows } = await celdas((await descargar(token, productId).expect(200)).body as Buffer);

      // Encabezado + las 205.
      expect(rows).toHaveLength(206);
    });

    it("respeta los filtros: un rango que no incluye nada baja solo el encabezado", async () => {
      const { token, productId, warehouseA, mover } = await escenario();
      await mover("entry", warehouseA, [{ productId, quantity: 10 }]);

      const response = await descargar(token, productId, "?from=2020-01-01&to=2020-01-31").expect(
        200,
      );

      expect((await celdas(response.body as Buffer)).rows).toHaveLength(1);
    });

    it("un producto de otro tenant es 404, no un Excel vacío", async () => {
      const { token } = await escenario();
      const ajeno = await escenario();

      await request(app.getHttpServer())
        .get(`/reports/kardex/${ajeno.productId}/export`)
        .set("Authorization", bearer(token))
        .expect(404);
    });

    it("respeta el alcance: un almacén fuera del scope se rechaza", async () => {
      const { tenantId, productId, warehouseA, warehouseB, mover } = await escenario();
      await mover("entry", warehouseA, [{ productId, quantity: 10 }]);
      const acotado = await tokenConAlcance(tenantId, [warehouseB]);

      await request(app.getHttpServer())
        .get(`/reports/kardex/${productId}/export?warehouseId=${warehouseA}`)
        .set("Authorization", bearer(acotado))
        .expect(403);
    });

    it("sin `reports:read` no se exporta", async () => {
      const { tenantId, productId } = await escenario();
      const tokenService = app.get(TokenService);
      const sinPermiso = tokenService.signAccessToken({
        sub: randomUUID(),
        tenantId,
        permissions: ["inventory:read"],
        locale: "es",
      });

      await request(app.getHttpServer())
        .get(`/reports/kardex/${productId}/export`)
        .set("Authorization", bearer(sinPermiso))
        .expect(403);
    });
  });

  /**
   * ── EL RANGO DE FECHAS SON DÍAS DEL NEGOCIO (2026-08-24) ──────────────
   *
   * Carlos: «no me salen los movimientos de hoy, pero si pongo mañana sí».
   * El filtro mandaba `2026-08-24` crudo a Postgres, que lo lee como
   * `00:00:00+00`: todo lo del día quedaba fuera.
   *
   * El movimiento se crea AHORA, así que «hoy» en la zona del negocio
   * (`America/Mexico_City` por defecto) tiene que incluirlo — sin importar la
   * hora a la que corra esta prueba, que es justo lo que el bug rompía a
   * partir de las 18:00 UTC.
   */
  describe("rango de fechas en la zona del negocio", () => {
    const hoyEnCdmx = () =>
      new Intl.DateTimeFormat("en-CA", {
        timeZone: "America/Mexico_City",
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
      }).format(new Date());

    it("un movimiento de HOY entra en el rango que termina hoy", async () => {
      const { token, productId, warehouseA, mover } = await escenario();
      await mover("entry", warehouseA, [{ productId, quantity: 9 }]);

      const hoy = hoyEnCdmx();
      const res = await kardex(token, productId, `?from=${hoy}&to=${hoy}`).expect(200);

      expect((res.body.rows as unknown[]).length).toBe(1);
    });

    it("un rango que termina AYER no lo trae", async () => {
      const { token, productId, warehouseA, mover } = await escenario();
      await mover("entry", warehouseA, [{ productId, quantity: 9 }]);

      const ayer = new Date(Date.now() - 86_400_000);
      const iso = new Intl.DateTimeFormat("en-CA", {
        timeZone: "America/Mexico_City",
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
      }).format(ayer);
      const res = await kardex(token, productId, `?to=${iso}`).expect(200);

      // La otra mitad del contrato: si el rango se estirara «por las dudas»,
      // el filtro dejaría de filtrar y este test lo caza.
      expect((res.body.rows as unknown[]).length).toBe(0);
    });
  });

  describe("el saldo después de cada línea", () => {
    it("+50, −10, +5 en A da saldos 50 / 40 / 45", async () => {
      const { token, productId, warehouseA, mover } = await escenario();
      await mover("entry", warehouseA, [{ productId, quantity: 50 }]);
      await mover("exit", warehouseA, [{ productId, quantity: 10 }]);
      await mover("entry", warehouseA, [{ productId, quantity: 5 }]);

      const res = await kardex(token, productId).expect(200);
      const filas = res.body.rows as { direction: string; balanceAfter: string }[];

      // Orden descendente: la más reciente primero.
      expect(filas.map((f) => Number(f.balanceAfter))).toEqual([45, 40, 50]);
    });

    /** El saldo es POR ALMACÉN: el de B no arrastra el de A. */
    it("cada almacén lleva su propio saldo", async () => {
      const { token, productId, warehouseA, warehouseB, mover } = await escenario();
      await mover("entry", warehouseA, [{ productId, quantity: 50 }]);
      await mover("entry", warehouseB, [{ productId, quantity: 7 }]);

      const res = await kardex(token, productId).expect(200);
      const filas = res.body.rows as { warehouse: { id: string }; balanceAfter: string }[];

      expect(Number(filas.find((f) => f.warehouse.id === warehouseB)?.balanceAfter)).toBe(7);
      expect(Number(filas.find((f) => f.warehouse.id === warehouseA)?.balanceAfter)).toBe(50);
    });

    /**
     * **El caso que `seq` existe para resolver.** Tres líneas de la MISMA
     * transacción comparten `created_at` al microsegundo: sin desempate, los
     * saldos intermedios saldrían en cualquier orden, o sea falsos.
     */
    it("tres LOTES en la misma transacción tienen saldos intermedios correctos", async () => {
      const { token, tenantId, warehouseA, mover } = await escenario();
      // Tres líneas del mismo producto se SUMAN en el borrador (escanear dos
      // veces el mismo código no duplica), así que el caso real de `seq` son
      // tres LOTES: son tres movimientos distintos con el MISMO `created_at`.
      const conLotes = await prisma.withTenantContext(tenantId, async (tx) => {
        const producto = await tx.product.create({
          data: {
            tenantId,
            sku: `SEQ-${randomUUID().slice(0, 6)}`,
            name: "Con lotes",
            tracksLots: true,
          },
        });
        return producto.id;
      });

      await mover("entry", warehouseA, [
        { productId: conLotes, quantity: 10, lotCode: "l1", expiresAt: "2027-01-01" },
        { productId: conLotes, quantity: 20, lotCode: "l2", expiresAt: "2027-02-01" },
        { productId: conLotes, quantity: 30, lotCode: "l3", expiresAt: "2027-03-01" },
      ]);

      const res = await kardex(token, conLotes).expect(200);
      const saldos = (res.body.rows as { balanceAfter: string }[]).map((f) =>
        Number(f.balanceAfter),
      );

      // 60 / 30 / 10 leídos de la más reciente a la más vieja. Los tres
      // comparten `created_at` al microsegundo: sin el desempate por `seq`
      // estos saldos saldrían en cualquier orden, o sea falsos.
      expect(saldos).toEqual([60, 30, 10]);
    });

    /**
     * El saldo se calcula sobre TODO el histórico y el filtro se aplica
     * después. Si se calculara sobre lo filtrado, esconder las salidas
     * inventaría un saldo que nunca existió.
     */
    it("filtrar por motivo NO altera los saldos", async () => {
      const { token, productId, warehouseA, mover } = await escenario();
      await mover("entry", warehouseA, [{ productId, quantity: 50 }]);
      await mover("exit", warehouseA, [{ productId, quantity: 10 }], {
        reasonCode: "loss",
        reasonNote: "se rompió",
      });
      await mover("entry", warehouseA, [{ productId, quantity: 5 }]);

      const res = await kardex(token, productId, "?reasonCode=adjustment").expect(200);
      const filas = res.body.rows as { balanceAfter: string }[];

      // Solo las dos de ajuste, pero con los saldos REALES: 45 y 50 — no 55 y 50.
      expect(filas.map((f) => Number(f.balanceAfter))).toEqual([45, 50]);
    });
  });

  describe("la fila", () => {
    it("trae el documento con su folio, el motivo y quién lo hizo", async () => {
      const { token, productId, warehouseA, mover } = await escenario();
      await mover("entry", warehouseA, [{ productId, quantity: 50 }]);

      const res = await kardex(token, productId).expect(200);
      const fila = (res.body.rows as Record<string, unknown>[])[0];

      expect(fila).toEqual(
        expect.objectContaining({
          direction: "entry",
          reasonCode: "adjustment",
          quantity: expect.any(String),
          document: expect.objectContaining({ folio: expect.stringMatching(/^ENT-/) }),
          createdBy: expect.objectContaining({ name: "Ana Pérez" }),
        }),
      );
    });

    /** `seq` es BigInt: `JSON.stringify` revienta si se expone crudo. */
    it("no expone `seq` crudo", async () => {
      const { token, productId, warehouseA, mover } = await escenario();
      await mover("entry", warehouseA, [{ productId, quantity: 50 }]);

      const res = await kardex(token, productId).expect(200);

      expect((res.body.rows as Record<string, unknown>[])[0]).not.toHaveProperty("seq");
    });

    it("solo trae los movimientos de ESE producto", async () => {
      const { token, productId, otroId, warehouseA, mover } = await escenario();
      await mover("entry", warehouseA, [{ productId, quantity: 50 }]);
      await mover("entry", warehouseA, [{ productId: otroId, quantity: 99 }]);

      const res = await kardex(token, productId).expect(200);

      expect(res.body.rows).toHaveLength(1);
      expect(res.body.total).toBe(1);
    });
  });

  describe("el alcance", () => {
    it("un almacén fuera de alcance no aporta filas", async () => {
      const { tenantId, productId, warehouseA, warehouseB, mover } = await escenario();
      await mover("entry", warehouseA, [{ productId, quantity: 50 }]);
      await mover("entry", warehouseB, [{ productId, quantity: 7 }]);
      const scoped = await tokenConAlcance(tenantId, [warehouseA]);

      const res = await kardex(scoped, productId).expect(200);
      const filas = res.body.rows as { warehouse: { id: string } }[];

      expect(filas).toHaveLength(1);
      expect(filas[0]?.warehouse.id).toBe(warehouseA);
    });

    /** Pedir explícitamente un almacén ajeno es un 403, no una lista vacía. */
    it("pedir un almacén fuera de alcance da 403", async () => {
      const { tenantId, productId, warehouseA, warehouseB, mover } = await escenario();
      await mover("entry", warehouseA, [{ productId, quantity: 50 }]);
      const scoped = await tokenConAlcance(tenantId, [warehouseA]);

      await kardex(scoped, productId, `?warehouseId=${warehouseB}`).expect(403);
    });

    it("un producto de otro tenant no existe", async () => {
      const { productId } = await escenario();
      const ajeno = await registerAndLogin();

      await kardex(ajeno.token, productId).expect(404);
    });
  });

  /**
   * F3-KARDEX-03/04 — dónde está el stock, y qué salió y no llegó.
   *
   * El endpoint devuelve UNA fila por almacén del alcance, incluidos los que
   * están en cero: un almacén sin filas no es "no existe", es "no hay". Sin
   * esas filas, quien mira no puede distinguir un producto que nunca llegó a
   * esa bodega de uno que se agotó ahí.
   */
  describe("F3-KARDEX-03 — stock por almacén", () => {
    const stock = (token: string, productId: string, query = "") =>
      request(app.getHttpServer())
        .get(`/products/${productId}/stock${query}`)
        .set("Authorization", bearer(token));

    it("una fila por almacén, con total, y los vacíos en cero", async () => {
      const { token, productId, warehouseA, warehouseB, mover } = await escenario();
      await mover("entry", warehouseA, [{ productId, quantity: 50 }]);

      const res = await stock(token, productId).expect(200);
      const body = res.body as {
        rows: { warehouseId: string; quantity: string; updatedAt: string | null }[];
        total: string;
      };

      expect(Number(body.total)).toBe(50);
      expect(Number(body.rows.find((r) => r.warehouseId === warehouseA)?.quantity)).toBe(50);
      // B existe y está en cero: distinguirlo de "no hay bodega B" importa.
      const vacio = body.rows.find((r) => r.warehouseId === warehouseB);
      expect(Number(vacio?.quantity)).toBe(0);
      expect(vacio?.updatedAt).toBeNull();
    });

    it("marca cuando está bajo el mínimo", async () => {
      const { token, tenantId, productId, warehouseA, mover } = await escenario();
      await prisma.withTenantContext(tenantId, (tx) =>
        tx.product.update({ where: { id: productId }, data: { stockMin: 100 } }),
      );
      await mover("entry", warehouseA, [{ productId, quantity: 50 }]);

      const res = await stock(token, productId).expect(200);

      expect(res.body.belowMin).toBe(true);
      expect(Number(res.body.stockMin)).toBe(100);
    });

    it("el alcance recorta: un Manager solo ve su almacén y su total", async () => {
      const { tenantId, productId, warehouseA, warehouseB, mover } = await escenario();
      await mover("entry", warehouseA, [{ productId, quantity: 50 }]);
      await mover("entry", warehouseB, [{ productId, quantity: 7 }]);
      const scoped = await tokenConAlcance(tenantId, [warehouseA]);

      const res = await stock(scoped, productId).expect(200);

      expect(res.body.rows).toHaveLength(1);
      // El total es el de lo que PUEDE ver: 50, no 57.
      expect(Number(res.body.total)).toBe(50);
    });

    it("con lotes, cada almacén trae los suyos en orden FEFO", async () => {
      const { token, tenantId, warehouseA, mover } = await escenario();
      const conLotes = await prisma.withTenantContext(tenantId, async (tx) => {
        const p = await tx.product.create({
          data: {
            tenantId,
            sku: `FE-${randomUUID().slice(0, 6)}`,
            name: "Con lotes",
            tracksLots: true,
          },
        });
        return p.id;
      });
      // Códigos elegidos para que el orden alfabético NO coincida con el
      // cronológico: si alguien ordenara por código, esto lo delata.
      await mover("entry", warehouseA, [
        { productId: conLotes, quantity: 5, lotCode: "aaa-tarde", expiresAt: "2027-12-01" },
        { productId: conLotes, quantity: 3, lotCode: "zzz-pronto", expiresAt: "2027-01-01" },
      ]);

      const res = await stock(token, conLotes).expect(200);
      const fila = (res.body.rows as { warehouseId: string; lots: { lotCode: string }[] }[]).find(
        (r) => r.warehouseId === warehouseA,
      );

      // Se mandan en minúscula y se esperan en MAYÚSCULA a propósito: el API
      // normaliza el código de lote (2026-08-23), y esta aserción lo prueba de
      // punta a punta además de fijar el orden FEFO. Los nombres siguen
      // eligiéndose para que el alfabético NO coincida con el de vencimiento.
      expect(fila?.lots.map((l) => l.lotCode)).toEqual(["ZZZ-PRONTO", "AAA-TARDE"]);
    });

    /**
     * Hallazgo de Carlos (2026-08-20): un lote **YA VENCIDO** salía marcado
     * «Vence pronto». La condición era `expiresAt <= hoy+30`, y una fecha del
     * pasado también es menor que hoy+30 — así que un lote vencido hace un año
     * caía en la misma canasta que uno que vence mañana.
     *
     * No es cosmético: FEFO lo va a despachar PRIMERO, y quien lea «vence
     * pronto» lo va a dejar salir creyendo que todavía sirve.
     */
    it("distingue lo YA VENCIDO de lo que está por vencer", async () => {
      const { token, tenantId, warehouseA, mover } = await escenario();
      const conLotes = await prisma.withTenantContext(tenantId, async (tx) => {
        const p = await tx.product.create({
          data: {
            tenantId,
            sku: `VEN-${randomUUID().slice(0, 6)}`,
            name: "Con caducidad",
            tracksLots: true,
          },
        });
        return p.id;
      });

      const dias = (n: number) => {
        const d = new Date();
        d.setUTCHours(0, 0, 0, 0);
        d.setUTCDate(d.getUTCDate() + n);
        return d.toISOString().slice(0, 10);
      };

      await mover("entry", warehouseA, [
        { productId: conLotes, quantity: 12, lotCode: "vencido", expiresAt: dias(-19) },
        { productId: conLotes, quantity: 50, lotCode: "pronto", expiresAt: dias(3) },
        { productId: conLotes, quantity: 200, lotCode: "lejano", expiresAt: dias(400) },
      ]);

      const res = await stock(token, conLotes).expect(200);
      const lotes = (
        res.body.rows as {
          warehouseId: string;
          lots: { lotCode: string; expired: boolean; expiringSoon: boolean }[];
        }[]
      ).find((r) => r.warehouseId === warehouseA)?.lots;
      const porCodigo = new Map(lotes?.map((l) => [l.lotCode, l]));

      // El vencido es vencido, y NO "por vencer": son dos estados distintos.
      expect(porCodigo.get("VENCIDO")).toMatchObject({ expired: true, expiringSoon: false });
      expect(porCodigo.get("PRONTO")).toMatchObject({ expired: false, expiringSoon: true });
      expect(porCodigo.get("LEJANO")).toMatchObject({ expired: false, expiringSoon: false });
    });

    /** La invariante del ledger, verificada desde afuera. */
    it("la suma de los lotes es igual al saldo del almacén", async () => {
      const { token, tenantId, warehouseA, mover } = await escenario();
      const conLotes = await prisma.withTenantContext(tenantId, async (tx) => {
        const p = await tx.product.create({
          data: {
            tenantId,
            sku: `IN-${randomUUID().slice(0, 6)}`,
            name: "Invariante",
            tracksLots: true,
          },
        });
        return p.id;
      });
      await mover("entry", warehouseA, [
        { productId: conLotes, quantity: 5, lotCode: "l1", expiresAt: "2027-01-01" },
        { productId: conLotes, quantity: 3, lotCode: "l2", expiresAt: "2027-02-01" },
      ]);

      const res = await stock(token, conLotes).expect(200);
      const fila = (
        res.body.rows as { warehouseId: string; quantity: string; lots: { quantity: string }[] }[]
      ).find((r) => r.warehouseId === warehouseA);
      const suma = (fila?.lots ?? []).reduce((acc, l) => acc + Number(l.quantity), 0);

      expect(suma).toBe(Number(fila?.quantity));
    });

    /** Un compuesto no tiene saldo propio: se arma. */
    it("un compuesto responde con sus unidades armables, no con filas", async () => {
      const { token, tenantId, warehouseA, productId, mover } = await escenario();
      const compuesto = await prisma.withTenantContext(tenantId, async (tx) => {
        const kit = await tx.product.create({
          data: {
            tenantId,
            sku: `KIT-${randomUUID().slice(0, 6)}`,
            name: "Kit",
            isComposite: true,
          },
        });
        await tx.productComposition.create({
          data: {
            tenantId,
            parentProductId: kit.id,
            componentProductId: productId,
            quantity: 10,
          },
        });
        return kit.id;
      });
      await mover("entry", warehouseA, [{ productId, quantity: 50 }]);

      const res = await stock(token, compuesto).expect(200);

      expect(res.body.isComposite).toBe(true);
      expect(res.body.rows).toEqual([]);
      expect(res.body.availability.units).toBe(5);
    });
  });

  describe("F3-KARDEX-04 — lo que salió y no llegó", () => {
    const inTransit = (token: string, query = "") =>
      request(app.getHttpServer())
        .get(`/inventory/in-transit${query}`)
        .set("Authorization", bearer(token));

    async function despachar(
      token: string,
      productId: string,
      origen: string,
      destino: string,
      cantidad: number,
    ) {
      const auth = () => ({ Authorization: bearer(token) });
      const creado = await request(app.getHttpServer())
        .post("/inventory/documents")
        .set(auth())
        .send({ type: "exit", warehouseId: origen })
        .expect(201);
      const id = (creado.body as { id: string }).id;
      await request(app.getHttpServer())
        .patch(`/inventory/documents/${id}`)
        .set(auth())
        .send({ reasonCode: "transfer", linkedWarehouseId: destino })
        .expect(200);
      await request(app.getHttpServer())
        .post(`/inventory/documents/${id}/lines`)
        .set(auth())
        .send({ productId, quantity: cantidad })
        .expect(201);
      const res = await request(app.getHttpServer())
        .post(`/inventory/documents/${id}/confirm`)
        .set(auth())
        .send({})
        .expect(201);
      return (res.body as { transfer: { id: string } }).transfer.id;
    }

    /**
     * F5-EXP-02 — el tránsito en Excel.
     *
     * ── Por qué el archivo trae MÁS detalle que la pantalla ─────────────────
     *
     * `inTransit()` agrupa por producto —«hay 30 unidades repartidas en 2
     * traspasos»—, que es lo correcto para un tablero: dice cuánto falta sin
     * abrumar. Pero quien BAJA el archivo lo hace para rastrear: necesita de
     * qué bodega salió cada partida, hacia dónde va, con qué folio y desde
     * cuándo. Un Excel que repita el agregado no serviría para eso.
     *
     * No es una segunda implementación de un cálculo: es la misma tabla con
     * otro nivel de agregación, y el agregado de la pantalla se puede derivar
     * de este detalle.
     */
    describe("F5-EXP-02 — el export", () => {
      function descargar(token: string, query = "") {
        return request(app.getHttpServer())
          .get(`/inventory/in-transit/export${query}`)
          .set("Authorization", bearer(token))
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

      it("baja un xlsx con el origen, el destino y el folio de cada partida", async () => {
        const { token, productId, warehouseA, warehouseB, mover } = await escenario();
        await mover("entry", warehouseA, [{ productId, quantity: 50 }]);
        await despachar(token, productId, warehouseA, warehouseB, 10);

        const response = await descargar(token).expect(200);

        expect(response.headers["content-disposition"]).toContain("en-transito.xlsx");
        const { name, rows } = await celdas(response.body as Buffer);
        expect(name).toBe("En tránsito");
        expect(rows[0]).toEqual([
          "Producto",
          "SKU",
          "Lote",
          "Origen",
          "Destino",
          "Cantidad",
          "Folio",
          "Salió",
        ]);
        const fila = rows.find((r) => r.includes("Jabón"));
        expect(fila?.join("|")).toContain("A ");
        expect(fila?.join("|")).toContain("B ");
      });

      /**
       * ⚠ Un traspaso YA RECIBIDO deja de estar en tránsito. Si siguiera
       * apareciendo, alguien saldría a buscar mercancía que ya está en su
       * estante.
       */
      it("un traspaso confirmado ya no aparece", async () => {
        const { token, productId, warehouseA, warehouseB, mover } = await escenario();
        await mover("entry", warehouseA, [{ productId, quantity: 50 }]);
        // `despachar` ya devuelve el id del traspaso: listarlo para volver a
        // encontrarlo sería dar una vuelta para llegar al mismo lugar.
        const transferId = await despachar(token, productId, warehouseA, warehouseB, 10);

        const antes = await celdas((await descargar(token).expect(200)).body as Buffer);
        expect(antes.rows.length).toBe(2);

        // Lo recibe: se crea el borrador de entrada y se confirma.
        const borrador = await request(app.getHttpServer())
          .post(`/transfers/${transferId}/receipt-draft`)
          .set("Authorization", bearer(token))
          .send({})
          .expect(201);
        await request(app.getHttpServer())
          .post(`/inventory/documents/${(borrador.body as { id: string }).id}/confirm`)
          .set("Authorization", bearer(token))
          .send({})
          .expect(201);

        const despues = await celdas((await descargar(token).expect(200)).body as Buffer);
        // Solo el encabezado: ya no hay nada en camino.
        expect(despues.rows).toHaveLength(1);
      });

      /**
       * El alcance mira el ORIGEN: es mercancía de la que sigo siendo
       * responsable hasta que alguien la reciba (criterio de F3-KARDEX-04).
       */
      it("respeta el alcance por el almacén de ORIGEN", async () => {
        const { token, tenantId, productId, warehouseA, warehouseB, mover } = await escenario();
        await mover("entry", warehouseA, [{ productId, quantity: 50 }]);
        await despachar(token, productId, warehouseA, warehouseB, 10);
        const soloDestino = await tokenConAlcance(tenantId, [warehouseB]);

        const { rows } = await celdas((await descargar(soloDestino).expect(200)).body as Buffer);

        // Ve el almacén B, que es el DESTINO: la mercancía todavía no es suya.
        expect(rows).toHaveLength(1);
      });

      it("sin `inventory:read` no se exporta", async () => {
        const { tenantId } = await escenario();
        const tokenService = app.get(TokenService);
        const vendedor = tokenService.signAccessToken({
          sub: randomUUID(),
          tenantId,
          permissions: ["pos:sell"],
          locale: "es",
        });

        await request(app.getHttpServer())
          .get("/inventory/in-transit/export")
          .set("Authorization", bearer(vendedor))
          .expect(403);
      });
    });

    it("un traspaso en tránsito aparece agregado por producto", async () => {
      const { token, productId, warehouseA, warehouseB, mover } = await escenario();
      await mover("entry", warehouseA, [{ productId, quantity: 50 }]);
      await despachar(token, productId, warehouseA, warehouseB, 10);

      const res = await inTransit(token).expect(200);
      const fila = (
        res.body.rows as { productId: string; quantity: string; transfers: number }[]
      ).find((r) => r.productId === productId);

      expect(Number(fila?.quantity)).toBe(10);
      expect(fila?.transfers).toBe(1);
    });

    /** Recibido deja de estar en tránsito: no hay parciales. */
    it("al recibirlo desaparece del listado", async () => {
      const { token, productId, warehouseA, warehouseB, mover } = await escenario();
      await mover("entry", warehouseA, [{ productId, quantity: 50 }]);
      const transferId = await despachar(token, productId, warehouseA, warehouseB, 10);

      const borrador = (
        await request(app.getHttpServer())
          .post(`/transfers/${transferId}/receipt-draft`)
          .set("Authorization", bearer(token))
          .send({})
          .expect(201)
      ).body as { id: string };
      await request(app.getHttpServer())
        .post(`/inventory/documents/${borrador.id}/confirm`)
        .set("Authorization", bearer(token))
        .send({})
        .expect(201);

      const res = await inTransit(token).expect(200);

      expect(
        (res.body.rows as { productId: string }[]).find((r) => r.productId === productId),
      ).toBeUndefined();
    });

    it("un traspaso cancelado tampoco cuenta", async () => {
      const { token, productId, warehouseA, warehouseB, mover } = await escenario();
      await mover("entry", warehouseA, [{ productId, quantity: 50 }]);
      const transferId = await despachar(token, productId, warehouseA, warehouseB, 10);
      await request(app.getHttpServer())
        .post(`/transfers/${transferId}/cancel`)
        .set("Authorization", bearer(token))
        .send({ reason: "el camión no salió" })
        .expect(200);

      const res = await inTransit(token).expect(200);

      expect(
        (res.body.rows as { productId: string }[]).find((r) => r.productId === productId),
      ).toBeUndefined();
    });

    /** Es stock que salió de MI almacén: el alcance mira el ORIGEN. */
    it("el alcance mira el origen, no el destino", async () => {
      const { token, tenantId, productId, warehouseA, warehouseB, mover } = await escenario();
      await mover("entry", warehouseA, [{ productId, quantity: 50 }]);
      await despachar(token, productId, warehouseA, warehouseB, 10);
      const soloDestino = await tokenConAlcance(tenantId, [warehouseB]);

      const res = await inTransit(soloDestino).expect(200);

      // Quien solo administra el DESTINO no tiene stock en tránsito: no salió
      // de su bodega. Lo suyo son los traspasos entrantes, otra pantalla.
      expect(res.body.rows).toEqual([]);
    });
  });
});
