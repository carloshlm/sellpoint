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
 * F3-LOTS-02 — consultar los lotes de un producto y las ubicaciones de un
 * almacén.
 *
 * Los dos existen para ALIMENTAR pantallas: el selector de "forzar lote" de
 * una salida y el autocompletado de ubicación de una entrada. Por eso el orden
 * del listado es **FEFO** y no alfabético — quien elige un lote a mano quiere
 * ver primero el que se vence antes, que es el que el sistema habría elegido
 * solo.
 */
describe("Lotes y ubicaciones (F3-LOTS-02)", () => {
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

  const bearer = (token: string) => `Bearer ${token}`;

  async function registerAndLogin(): Promise<{ token: string; tenantId: string }> {
    const email = `owner-${randomUUID()}@example.com`;
    const registered = await request(app.getHttpServer())
      .post("/auth/register-tenant")
      .send({
        tenantName: `Tenant lots ${randomUUID()}`,
        email,
        password: OWNER_PASSWORD,
        firstName: "Ana",
        lastNamePaternal: "Pérez",
        locale: "es",
      })
      .expect(201);

    const mailer = app.get<NoopMailer>(MAILER);
    const token = extractTokenFromLink(mailer.sent.find((m) => m.to === email)?.vars.link);
    await request(app.getHttpServer()).post("/auth/verify-email").send({ token }).expect(200);

    const login = await request(app.getHttpServer())
      .post("/auth/login")
      .send({ email, password: OWNER_PASSWORD })
      .expect(200);

    return {
      token: (login.body as { accessToken: string }).accessToken,
      tenantId: (registered.body as { tenantId: string }).tenantId,
    };
  }

  /**
   * Tres lotes con caducidades desordenadas a propósito, repartidos en dos
   * almacenes y dos ubicaciones. Si el endpoint ordenara por código o por
   * fecha de alta, este escenario lo delataría.
   */
  async function escenario() {
    const { token, tenantId } = await registerAndLogin();
    const datos = await prisma.withTenantContext(tenantId, async (tx) => {
      const producto = await tx.product.create({
        data: {
          tenantId,
          sku: `LOT-${randomUUID().slice(0, 8)}`,
          name: "Suero con caducidad",
          tracksLots: true,
        },
      });
      const [central, norte] = await Promise.all([
        tx.warehouse.create({ data: { tenantId, name: `Central ${randomUUID().slice(0, 6)}` } }),
        tx.warehouse.create({ data: { tenantId, name: `Norte ${randomUUID().slice(0, 6)}` } }),
      ]);

      // st30 vence DESPUÉS que st10; sinFecha no vence nunca.
      const [st30, st10, sinFecha] = await Promise.all([
        tx.productLot.create({
          data: {
            tenantId,
            productId: producto.id,
            lotCode: "st30",
            expiresAt: new Date("2026-09-30"),
          },
        }),
        tx.productLot.create({
          data: {
            tenantId,
            productId: producto.id,
            lotCode: "st10",
            expiresAt: new Date("2026-07-01"),
          },
        }),
        tx.productLot.create({ data: { tenantId, productId: producto.id, lotCode: "sinFecha" } }),
      ]);

      await tx.stockLot.createMany({
        data: [
          // st30 repartido en dos almacenes y dos ubicaciones: su total suma 3.
          { tenantId, lotId: st30.id, warehouseId: central.id, location: "A-1", quantity: 1 },
          { tenantId, lotId: st30.id, warehouseId: norte.id, location: "B-2", quantity: 2 },
          { tenantId, lotId: st10.id, warehouseId: central.id, location: "A-1", quantity: 5 },
          // Agotado: existe el registro pero no el saldo.
          { tenantId, lotId: sinFecha.id, warehouseId: central.id, location: "", quantity: 0 },
        ],
      });

      return { productId: producto.id, centralId: central.id, norteId: norte.id };
    });

    return { token, tenantId, ...datos };
  }

  describe("GET /products/:id/lots", () => {
    it("los devuelve en orden FEFO, con los sin fecha AL FINAL", async () => {
      const { token, productId } = await escenario();

      const res = await request(app.getHttpServer())
        .get(`/products/${productId}/lots`)
        .set("Authorization", bearer(token))
        .expect(200);

      const codigos = (res.body as { lotCode: string }[]).map((l) => l.lotCode);
      // Un lote SIN caducidad no es "el más urgente" sino lo contrario: no
      // corre riesgo de vencerse, así que sale cuando ya no queda nada que sí.
      expect(codigos).toEqual(["st10", "st30", "sinFecha"]);
    });

    it("`totalQuantity` suma todos los almacenes y `byWarehouse` los desglosa", async () => {
      const { token, productId, centralId, norteId } = await escenario();

      const res = await request(app.getHttpServer())
        .get(`/products/${productId}/lots`)
        .set("Authorization", bearer(token))
        .expect(200);

      const st30 = (
        res.body as { lotCode: string; totalQuantity: string; byWarehouse: unknown[] }[]
      ).find((l) => l.lotCode === "st30");
      expect(st30?.totalQuantity).toBe("3");
      expect(st30?.byWarehouse).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ warehouseId: centralId, location: "A-1", quantity: "1" }),
          expect.objectContaining({ warehouseId: norteId, location: "B-2", quantity: "2" }),
        ]),
      );
    });

    /** El selector de "forzar lote" no debe ofrecer un lote agotado. */
    it("`?withStock=true` esconde los que están en cero", async () => {
      const { token, productId } = await escenario();

      const res = await request(app.getHttpServer())
        .get(`/products/${productId}/lots?withStock=true`)
        .set("Authorization", bearer(token))
        .expect(200);

      const codigos = (res.body as { lotCode: string }[]).map((l) => l.lotCode);
      expect(codigos).toEqual(["st10", "st30"]);
    });

    it("`?warehouseId=` acota el saldo a ese almacén", async () => {
      const { token, productId, centralId } = await escenario();

      const res = await request(app.getHttpServer())
        .get(`/products/${productId}/lots?warehouseId=${centralId}&withStock=true`)
        .set("Authorization", bearer(token))
        .expect(200);

      const st30 = (res.body as { lotCode: string; totalQuantity: string }[]).find(
        (l) => l.lotCode === "st30",
      );
      // En Central st30 tiene 1, no los 3 del total: acotar tiene que cambiar
      // el número, no solo filtrar filas.
      expect(st30?.totalQuantity).toBe("1");
    });

    it("un producto de otro tenant no existe (404)", async () => {
      const { productId } = await escenario();
      const { token: ajeno } = await registerAndLogin();

      await request(app.getHttpServer())
        .get(`/products/${productId}/lots`)
        .set("Authorization", bearer(ajeno))
        .expect(404);
    });
  });

  describe("GET /warehouses/:id/locations", () => {
    it("devuelve las ubicaciones DISTINTAS ya usadas, sin repetir", async () => {
      const { token, centralId } = await escenario();

      const res = await request(app.getHttpServer())
        .get(`/warehouses/${centralId}/locations`)
        .set("Authorization", bearer(token))
        .expect(200);

      // "A-1" está en dos lotes distintos y aparece UNA vez. El `''` (sin
      // ubicación) no es una ubicación: no se ofrece para autocompletar.
      expect(res.body).toEqual(["A-1"]);
    });

    it("un almacén sin ubicaciones devuelve lista vacía, no 404", async () => {
      const { token, norteId } = await escenario();

      const res = await request(app.getHttpServer())
        .get(`/warehouses/${norteId}/locations`)
        .set("Authorization", bearer(token))
        .expect(200);

      expect(res.body).toEqual(["B-2"]);
    });

    it("un almacén de otro tenant no existe (404)", async () => {
      const { centralId } = await escenario();
      const { token: ajeno } = await registerAndLogin();

      await request(app.getHttpServer())
        .get(`/warehouses/${centralId}/locations`)
        .set("Authorization", bearer(ajeno))
        .expect(404);
    });
  });

  /**
   * El alcance por almacén, contra los dos endpoints.
   *
   * El token se firma con permisos REDUCIDOS a propósito: un Admin
   * bypasea el scope a `"all"` (F2-SCOPE-01), así que con su token esto no
   * probaría nada. Con `inventory:read` a secas el interceptor va a la DB y
   * resuelve el alcance real.
   */
  describe("alcance por almacén", () => {
    async function conAlcanceSoloEnNorte() {
      const base = await escenario();
      const tokenService = app.get(TokenService);

      const userId = await prisma.withTenantContext(base.tenantId, async (tx) => {
        const owner = await tx.user.findFirstOrThrow({ select: { id: true } });
        await tx.userWarehouseScope.create({
          data: { userId: owner.id, warehouseId: base.norteId, tenantId: base.tenantId },
        });
        return owner.id;
      });

      const scopedToken = tokenService.signAccessToken({
        sub: userId,
        tenantId: base.tenantId,
        permissions: ["inventory:read"],
        locale: "es",
      });

      return { ...base, scopedToken };
    }

    it("las ubicaciones de un almacén FUERA de alcance dan 403", async () => {
      const { scopedToken, centralId } = await conAlcanceSoloEnNorte();

      await request(app.getHttpServer())
        .get(`/warehouses/${centralId}/locations`)
        .set("Authorization", bearer(scopedToken))
        .expect(403);
    });

    it("las del almacén que SÍ administra, en cambio, se ven", async () => {
      const { scopedToken, norteId } = await conAlcanceSoloEnNorte();

      const res = await request(app.getHttpServer())
        .get(`/warehouses/${norteId}/locations`)
        .set("Authorization", bearer(scopedToken))
        .expect(200);

      expect(res.body).toEqual(["B-2"]);
    });

    it("pedir los lotes acotados a un almacén fuera de alcance da 403", async () => {
      const { scopedToken, productId, centralId } = await conAlcanceSoloEnNorte();

      await request(app.getHttpServer())
        .get(`/products/${productId}/lots?warehouseId=${centralId}`)
        .set("Authorization", bearer(scopedToken))
        .expect(403);
    });

    /**
     * Sin `warehouseId` el listado no falla: muestra el producto con el saldo
     * que esa persona PUEDE ver. Un 403 acá escondería que el lote existe;
     * mostrar el total completo filtraría cuánto hay en una bodega ajena.
     */
    it("sin acotar, el saldo se recorta al alcance en vez de fallar", async () => {
      const { scopedToken, productId } = await conAlcanceSoloEnNorte();

      const res = await request(app.getHttpServer())
        .get(`/products/${productId}/lots`)
        .set("Authorization", bearer(scopedToken))
        .expect(200);

      const body = res.body as { lotCode: string; totalQuantity: string }[];
      // st30 tiene 3 en total (1 en Central + 2 en Norte), pero desde Norte
      // solo se ven 2. Y st10, que vive entero en Central, queda en cero.
      expect(body.find((l) => l.lotCode === "st30")?.totalQuantity).toBe("2");
      expect(body.find((l) => l.lotCode === "st10")?.totalQuantity).toBe("0");
    });
  });

  /**
   * F3-LOTS-03 — qué está por vencerse.
   *
   * **Sin cron y sin notificaciones**: es una CONSULTA que la pantalla hace
   * cuando alguien la abre. Un job que manda mails es una decisión de producto
   * (y de costos) que F5/F6 tomarán con más información; adelantarla acá sería
   * construir infraestructura para una necesidad que todavía nadie expresó.
   */
  describe("GET /inventory/expiring", () => {
    /** Una fecha a N días de hoy, en formato de columna DATE. */
    function enDias(dias: number): Date {
      const d = new Date();
      d.setUTCHours(0, 0, 0, 0);
      d.setUTCDate(d.getUTCDate() + dias);
      return d;
    }

    async function conCaducidades() {
      const { token, tenantId } = await registerAndLogin();
      const datos = await prisma.withTenantContext(tenantId, async (tx) => {
        const producto = await tx.product.create({
          data: {
            tenantId,
            sku: `EXP-${randomUUID().slice(0, 8)}`,
            name: "Yogur",
            tracksLots: true,
          },
        });
        const warehouse = await tx.warehouse.create({
          data: { tenantId, name: `Central ${randomUUID().slice(0, 6)}` },
        });

        const [pronto, lejos, vencido, agotado] = await Promise.all([
          tx.productLot.create({
            data: { tenantId, productId: producto.id, lotCode: "bbb-en10", expiresAt: enDias(10) },
          }),
          tx.productLot.create({
            data: { tenantId, productId: producto.id, lotCode: "aaa-en90", expiresAt: enDias(90) },
          }),
          tx.productLot.create({
            data: { tenantId, productId: producto.id, lotCode: "zzz-ayer", expiresAt: enDias(-1) },
          }),
          tx.productLot.create({
            data: { tenantId, productId: producto.id, lotCode: "ccc-vacio", expiresAt: enDias(5) },
          }),
        ]);

        await tx.stockLot.createMany({
          data: [
            { tenantId, lotId: pronto.id, warehouseId: warehouse.id, location: "A-1", quantity: 4 },
            { tenantId, lotId: lejos.id, warehouseId: warehouse.id, quantity: 7 },
            { tenantId, lotId: vencido.id, warehouseId: warehouse.id, quantity: 2 },
            // Sin saldo: no hay nada que se pueda echar a perder.
            { tenantId, lotId: agotado.id, warehouseId: warehouse.id, quantity: 0 },
          ],
        });

        return { productId: producto.id, warehouseId: warehouse.id };
      });
      return { token, tenantId, ...datos };
    }

    it("con `days=30` trae el que vence en 10 y no el que vence en 90", async () => {
      const { token } = await conCaducidades();

      const res = await request(app.getHttpServer())
        .get("/inventory/expiring?days=30")
        .set("Authorization", bearer(token))
        .expect(200);

      const codigos = (res.body as { lot: { lotCode: string } }[]).map((r) => r.lot.lotCode);
      expect(codigos).toContain("bbb-en10");
      expect(codigos).not.toContain("aaa-en90");
    });

    /**
     * F5-EXP-01 — vencimientos en Excel.
     *
     * Permiso `inventory:read` y NO `reports:read`: es la misma lectura de la
     * pantalla en otro formato, y pedir un permiso nuevo para bajar lo que ya
     * se está viendo sería una puerta sobre una puerta abierta (mismo criterio
     * que «reimprimir es leer» de F4-UI-03).
     */
    describe("F5-EXP-01 — el export", () => {
      function descargar(token: string, query = "") {
        return request(app.getHttpServer())
          .get(`/inventory/expiring/export${query}`)
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

      it("baja un xlsx con los lotes por vencer", async () => {
        const { token } = await conCaducidades();

        const response = await descargar(token, "?days=30").expect(200);

        expect(response.headers["content-disposition"]).toContain("vencimientos.xlsx");
        const { name, rows } = await celdas(response.body as Buffer);
        expect(name).toBe("Vencimientos");
        expect(rows.flat()).toContain("bbb-en10");
      });

      /**
       * La UBICACIÓN es columna (directiva de Carlos, 2026-08-24): quien va a
       * retirar la mercancía que se echa a perder necesita saber a qué estante
       * ir, y el dato ya viaja en la consulta de la pantalla.
       */
      it("trae la ubicación y los días que faltan", async () => {
        const { token } = await conCaducidades();

        const { rows } = await celdas(
          (await descargar(token, "?days=30").expect(200)).body as Buffer,
        );
        const columnaUbicacion = rows[0]?.indexOf("Ubicación") ?? -1;
        const columnaDias = rows[0]?.indexOf("Días restantes") ?? -1;

        expect(columnaUbicacion).toBeGreaterThan(-1);
        expect(columnaDias).toBeGreaterThan(-1);
        const fila = rows.find((r) => r.includes("bbb-en10"));
        expect(fila?.[columnaUbicacion]).toBe("A-1");
        expect(fila?.[columnaDias]).toBe("10");
      });

      /**
       * Los YA VENCIDOS salen con días en negativo, no escondidos: son los que
       * más urge sacar del almacén.
       */
      it("un lote ya vencido se exporta con los días en negativo", async () => {
        const { token } = await conCaducidades();

        const { rows } = await celdas(
          (await descargar(token, "?days=30").expect(200)).body as Buffer,
        );
        const columnaDias = rows[0]?.indexOf("Días restantes") ?? -1;

        expect(rows.find((r) => r.includes("zzz-ayer"))?.[columnaDias]).toBe("-1");
      });

      it("respeta el filtro de días, igual que la pantalla", async () => {
        const { token } = await conCaducidades();

        const { rows } = await celdas(
          (await descargar(token, "?days=7").expect(200)).body as Buffer,
        );

        expect(rows.flat()).not.toContain("bbb-en10");
      });

      it("sin `inventory:read` no se exporta", async () => {
        const { tenantId } = await conCaducidades();
        const tokenService = app.get(TokenService);
        const vendedor = tokenService.signAccessToken({
          sub: randomUUID(),
          tenantId,
          permissions: ["pos:sell"],
          locale: "es",
        });

        await request(app.getHttpServer())
          .get("/inventory/expiring/export")
          .set("Authorization", bearer(vendedor))
          .expect(403);
      });
    });

    it("con `days=7` ya no trae el que vence en 10", async () => {
      const { token } = await conCaducidades();

      const res = await request(app.getHttpServer())
        .get("/inventory/expiring?days=7")
        .set("Authorization", bearer(token))
        .expect(200);

      const codigos = (res.body as { lot: { lotCode: string } }[]).map((r) => r.lot.lotCode);
      expect(codigos).not.toContain("bbb-en10");
    });

    /**
     * Lo YA vencido es lo más urgente: sigue en el estante y hay que sacarlo.
     * Esconderlo porque "ya pasó" es justamente el error que esta pantalla
     * viene a evitar.
     */
    it("lo ya vencido aparece SIEMPRE, marcado y primero", async () => {
      const { token } = await conCaducidades();

      const res = await request(app.getHttpServer())
        .get("/inventory/expiring?days=7")
        .set("Authorization", bearer(token))
        .expect(200);

      const filas = res.body as { lot: { lotCode: string }; expired: boolean; daysLeft: number }[];
      // Alfabéticamente "zzz-ayer" iría ÚLTIMO: que salga primero solo puede
      // deberse a que se ordenó por caducidad.
      expect(filas[0]?.lot.lotCode).toBe("zzz-ayer");
      expect(filas[0]?.expired).toBe(true);
      expect(filas[0]?.daysLeft).toBe(-1);
    });

    it("un lote sin saldo no aparece: no hay nada que se eche a perder", async () => {
      const { token } = await conCaducidades();

      const res = await request(app.getHttpServer())
        .get("/inventory/expiring?days=90")
        .set("Authorization", bearer(token))
        .expect(200);

      const codigos = (res.body as { lot: { lotCode: string } }[]).map((r) => r.lot.lotCode);
      expect(codigos).not.toContain("ccc-vacio");
    });

    it("cada fila dice dónde está y cuánto hay", async () => {
      const { token, productId, warehouseId: whId } = await conCaducidades();

      const res = await request(app.getHttpServer())
        .get("/inventory/expiring?days=30")
        .set("Authorization", bearer(token))
        .expect(200);

      const fila = (res.body as { lot: { lotCode: string } }[]).find(
        (r) => r.lot.lotCode === "bbb-en10",
      );
      expect(fila).toEqual(
        expect.objectContaining({
          productId,
          sku: expect.stringContaining("EXP-"),
          name: "Yogur",
          location: "A-1",
          quantity: "4",
          daysLeft: 10,
          expired: false,
          warehouse: expect.objectContaining({ id: whId }),
        }),
      );
    });

    it("`?warehouseId=` acota a ese almacén y deja fuera el resto", async () => {
      const { token, tenantId, productId, warehouseId: central } = await conCaducidades();

      // El MISMO producto, con un lote más, en OTRA bodega.
      const lejano = await prisma.withTenantContext(tenantId, async (tx) => {
        const otro = await tx.warehouse.create({
          data: { tenantId, name: `Lejos ${randomUUID().slice(0, 6)}` },
        });
        const lot = await tx.productLot.create({
          data: { tenantId, productId, lotCode: "solo-alla", expiresAt: enDias(3) },
        });
        await tx.stockLot.create({
          data: { tenantId, lotId: lot.id, warehouseId: otro.id, quantity: 9 },
        });
        return otro.id;
      });

      const enCentral = await request(app.getHttpServer())
        .get(`/inventory/expiring?days=90&warehouseId=${central}`)
        .set("Authorization", bearer(token))
        .expect(200);
      const enLejos = await request(app.getHttpServer())
        .get(`/inventory/expiring?days=90&warehouseId=${lejano}`)
        .set("Authorization", bearer(token))
        .expect(200);

      const codigos = (body: unknown) =>
        (body as { lot: { lotCode: string } }[]).map((r) => r.lot.lotCode);

      expect(codigos(enCentral.body)).not.toContain("solo-alla");
      expect(codigos(enLejos.body)).toEqual(["solo-alla"]);
    });

    /** Un lote sin caducidad no vence nunca: no tiene por qué alertar. */
    it("los lotes sin fecha no aparecen", async () => {
      const { token, tenantId } = await registerAndLogin();
      await prisma.withTenantContext(tenantId, async (tx) => {
        const producto = await tx.product.create({
          data: {
            tenantId,
            sku: `NF-${randomUUID().slice(0, 8)}`,
            name: "Tornillos",
            tracksLots: true,
          },
        });
        const warehouse = await tx.warehouse.create({
          data: { tenantId, name: `W ${randomUUID().slice(0, 6)}` },
        });
        const lot = await tx.productLot.create({
          data: { tenantId, productId: producto.id, lotCode: "sinFecha" },
        });
        await tx.stockLot.create({
          data: { tenantId, lotId: lot.id, warehouseId: warehouse.id, quantity: 50 },
        });
      });

      const res = await request(app.getHttpServer())
        .get("/inventory/expiring?days=3650")
        .set("Authorization", bearer(token))
        .expect(200);

      expect(res.body).toEqual([]);
    });
  });

  /**
   * F3-LOTS-04 — corregir un lote mal cargado.
   *
   * **Cambiar la caducidad cambia qué se vende primero.** No es una edición
   * cosmética: FEFO ordena por `expires_at`, así que corregir una fecha
   * reordena todo el stock de ese lote en todos los almacenes. Por eso se
   * audita con before/after y por eso la pantalla lo advierte antes.
   *
   * Un lote NO se borra: los movimientos lo referencian y el histórico no se
   * reescribe. Sin saldo simplemente deja de aparecer con `withStock=true`.
   */
  describe("F3-LOTS-04 — editar un lote", () => {
    const editar = (
      token: string,
      productId: string,
      lotId: string,
      body: Record<string, unknown>,
    ) =>
      request(app.getHttpServer())
        .patch(`/products/${productId}/lots/${lotId}`)
        .set("Authorization", bearer(token))
        .send(body);

    async function conDosLotes() {
      const { token, tenantId } = await registerAndLogin();
      const datos = await prisma.withTenantContext(tenantId, async (tx) => {
        const stamp = randomUUID().slice(0, 6);
        const producto = await tx.product.create({
          data: { tenantId, sku: `ED-${stamp}`, name: "Editable", tracksLots: true },
        });
        const warehouse = await tx.warehouse.create({ data: { tenantId, name: `W ${stamp}` } });
        // "pronto" vence antes que "tarde": es el primero en salir.
        const [pronto, tarde] = await Promise.all([
          tx.productLot.create({
            data: {
              tenantId,
              productId: producto.id,
              lotCode: "PRONTO",
              expiresAt: new Date("2027-01-01"),
            },
          }),
          tx.productLot.create({
            data: {
              tenantId,
              productId: producto.id,
              lotCode: "TARDE",
              expiresAt: new Date("2027-12-01"),
            },
          }),
        ]);
        await tx.stockLot.createMany({
          data: [
            { tenantId, lotId: pronto.id, warehouseId: warehouse.id, quantity: 5 },
            { tenantId, lotId: tarde.id, warehouseId: warehouse.id, quantity: 5 },
          ],
        });
        await tx.stockByWarehouse.create({
          data: { tenantId, productId: producto.id, warehouseId: warehouse.id, quantity: 10 },
        });
        return {
          productId: producto.id,
          warehouseId: warehouse.id,
          prontoId: pronto.id,
          tardeId: tarde.id,
        };
      });
      return { token, tenantId, ...datos };
    }

    it("corregir el código lo deja guardado", async () => {
      const { token, productId, prontoId } = await conDosLotes();

      const res = await editar(token, productId, prontoId, { lotCode: "L-0001" }).expect(200);

      expect((res.body as { lotCode: string }).lotCode).toBe("L-0001");
    });

    it("un código ya usado por otro lote del mismo producto da 409", async () => {
      const { token, productId, prontoId } = await conDosLotes();

      // Se manda en MINÚSCULA contra un lote guardado en mayúscula: el 409
      // llega porque el API normaliza antes de comparar (2026-08-23). Sin esa
      // normalización, `tarde` y `TARDE` serían dos lotes distintos del mismo
      // producto — existencias partidas y FEFO tratándolos por separado.
      const res = await editar(token, productId, prontoId, { lotCode: "tarde" }).expect(409);

      /**
       * El mensaje NOMBRA al lote que estorba y su caducidad (Carlos,
       * 2026-08-24: «el mensaje es confuso»). Decir «ese código ya lo usa
       * otro lote» es cierto y no sirve: el usuario ve dos renglones y no
       * sabe cuál de los dos es el que choca ni por qué la regla existe.
       * Con la fecha puede reconocerlo en la lista de un vistazo.
       */
      expect(res.body).toMatchObject({
        code: "inventory.lot_code_taken",
        message: expect.stringContaining("TARDE"),
      });
      // La caducidad del lote en conflicto es lo que lo distingue en pantalla.
      expect((res.body as { message: string }).message).toMatch(
        /\d{4}-\d{2}-\d{2}|\d{2}\/\d{2}\/\d{4}/,
      );
    });

    /**
     * **El caso que justifica la auditoría**: corregir la fecha reordena FEFO,
     * así que la próxima salida sale de OTRA partida.
     */
    it("cambiar la caducidad cambia de qué lote sale la próxima salida", async () => {
      const { token, productId, warehouseId, tardeId } = await conDosLotes();

      // Antes: sale "pronto" (2027-01-01). Se corrige "tarde" a 2026-06-01,
      // que pasa a vencer primero.
      await editar(token, productId, tardeId, { expiresAt: "2026-06-01" }).expect(200);

      const lotes = await request(app.getHttpServer())
        .get(`/products/${productId}/lots?withStock=true&warehouseId=${warehouseId}`)
        .set("Authorization", bearer(token))
        .expect(200);

      // El orden es FEFO: ahora "tarde" va primero.
      expect((lotes.body as { lotCode: string }[]).map((l) => l.lotCode)).toEqual([
        "TARDE",
        "PRONTO",
      ]);
    });

    it("queda auditado con el antes y el después", async () => {
      const { token, tenantId, productId, tardeId } = await conDosLotes();

      await editar(token, productId, tardeId, { expiresAt: "2026-06-01" }).expect(200);

      const entrada = await prisma.withTenantContext(tenantId, (tx) =>
        tx.auditLog.findFirst({
          where: { action: "inventory.lot_update", resourceId: tardeId },
          select: { before: true, after: true },
        }),
      );

      expect(entrada).not.toBeNull();
      // Sin el `before` nadie podría explicar por qué el orden de salida
      // cambió de un día para el otro.
      expect(entrada?.before).toEqual(expect.objectContaining({ expiresAt: "2027-12-01" }));
      expect(entrada?.after).toEqual(expect.objectContaining({ expiresAt: "2026-06-01" }));
    });

    it("quitar la caducidad manda el lote al final del orden", async () => {
      const { token, productId, warehouseId, prontoId } = await conDosLotes();

      await editar(token, productId, prontoId, { expiresAt: null }).expect(200);

      const lotes = await request(app.getHttpServer())
        .get(`/products/${productId}/lots?withStock=true&warehouseId=${warehouseId}`)
        .set("Authorization", bearer(token))
        .expect(200);

      // Un lote sin fecha no corre riesgo de vencerse: sale último.
      expect((lotes.body as { lotCode: string }[]).map((l) => l.lotCode)).toEqual([
        "TARDE",
        "PRONTO",
      ]);
    });

    it("un lote de otro producto no se edita desde acá", async () => {
      const { token, prontoId } = await conDosLotes();
      const otro = await conDosLotes();

      await editar(token, otro.productId, prontoId, { lotCode: "X" }).expect(404);
    });

    it("sin `inventory:movement` no se edita", async () => {
      const { tenantId, productId, prontoId } = await conDosLotes();
      // Solo lectura: puede VER los lotes y no corregirlos. Corregir una
      // caducidad reordena de qué partida sale la próxima venta.
      const tokenService = app.get(TokenService);
      const userId = await prisma.withTenantContext(tenantId, async (tx) => {
        const owner = await tx.user.findFirstOrThrow({ select: { id: true } });
        return owner.id;
      });
      const soloLectura = tokenService.signAccessToken({
        sub: userId,
        tenantId,
        permissions: ["inventory:read"],
        locale: "es",
      });

      await editar(soloLectura, productId, prontoId, { lotCode: "X" }).expect(403);
    });
  });
});
