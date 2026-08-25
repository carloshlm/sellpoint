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
 * F4-CASHBOX-01 — el turno de caja.
 *
 * **Por qué el turno existe:** el POS no puede vender desde una LISTA. El
 * alcance dice dónde PUEDE operar alguien y el almacén asignado desde dónde lo
 * hace por defecto, pero descontar stock exige UNO concreto, elegido y
 * registrado. El turno lo fija y la venta lo hereda.
 */
describe("Turno de caja (F4-CASHBOX-01)", () => {
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
    const email = `pos-${randomUUID()}@example.com`;
    await request(app.getHttpServer())
      .post("/auth/register-tenant")
      .send({
        tenantName: `Tenant pos ${randomUUID()}`,
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

    const body = login.body as { accessToken: string };
    const payload = JSON.parse(
      Buffer.from(body.accessToken.split(".")[1] as string, "base64").toString(),
    ) as { tenantId: string };

    return { token: body.accessToken, tenantId: payload.tenantId };
  }

  /** El tenant nace con su almacén (F3-HOME-03); devuelve ese y uno más. */
  async function escenario() {
    const { token, tenantId } = await registerAndLogin();

    const { propio, otro } = await prisma.withTenantContext(tenantId, async (tx) => {
      const existente = await tx.warehouse.findFirstOrThrow({ select: { id: true } });
      const segundo = await tx.warehouse.create({
        data: { tenantId, name: `Sucursal ${randomUUID().slice(0, 6)}` },
      });
      return { propio: existente.id, otro: segundo.id };
    });

    return { token, tenantId, propio, otro };
  }

  const abrir = (token: string, body: Record<string, unknown> = {}) =>
    request(app.getHttpServer())
      .post("/pos/session")
      .set("Authorization", bearer(token))
      .send(body);

  const consultar = (token: string) =>
    request(app.getHttpServer()).get("/pos/session").set("Authorization", bearer(token));

  describe("consultar el turno", () => {
    /**
     * `{ session: null }` y NO un 404: "todavía no abriste" es una respuesta
     * legítima a la pregunta, no un error. La pantalla la usa para decidir si
     * muestra el carrito o la apertura.
     */
    it("sin turno abierto responde 200 con session en null, no 404", async () => {
      const { token } = await escenario();

      const res = await consultar(token).expect(200);

      expect(res.body).toEqual({ session: null });
    });

    it("con turno abierto lo devuelve, con su almacén", async () => {
      const { token, propio } = await escenario();
      await abrir(token).expect(201);

      const res = await consultar(token).expect(200);
      const body = res.body as { session: { warehouseId: string; status: string } | null };

      expect(body.session?.warehouseId).toBe(propio);
      expect(body.session?.status).toBe("open");
    });
  });

  describe("abrir el turno", () => {
    /**
     * La cadena de F3-HOME funcionando: `usuario.asignado → turno`. Un cajero
     * que siempre vende en la misma sucursal no elige nada cada mañana.
     */
    it("sin `warehouseId` usa el almacén ASIGNADO del usuario", async () => {
      const { token, tenantId, propio } = await escenario();
      await prisma.withTenantContext(tenantId, (tx) =>
        tx.user.updateMany({ where: { tenantId }, data: { defaultWarehouseId: propio } }),
      );

      const res = await abrir(token).expect(201);

      expect((res.body as { warehouseId: string }).warehouseId).toBe(propio);
    });

    it("con `warehouseId` explícito abre ahí: el que rota entre sucursales lo elige", async () => {
      const { token, otro } = await escenario();

      const res = await abrir(token, { warehouseId: otro }).expect(201);

      expect((res.body as { warehouseId: string }).warehouseId).toBe(otro);
    });

    /**
     * Adivinar "el primero del tenant" pondría a vender desde una sucursal que
     * el cajero no eligió, y el error se descubriría al cuadrar la caja.
     */
    it("sin asignado y sin `warehouseId` explícito, pide elegir en vez de adivinar", async () => {
      const { token, tenantId } = await escenario();
      await prisma.withTenantContext(tenantId, (tx) =>
        tx.user.updateMany({ where: { tenantId }, data: { defaultWarehouseId: null } }),
      );

      const res = await abrir(token).expect(404);

      expect((res.body as { message: string }).message).toContain("almacén asignado");
    });

    /**
     * ⚠ LA INVARIANTE DEL MÓDULO. El 409 sale del UNIQUE parcial de la base y
     * no de un `if`: entre leer "¿ya tiene turno?" y escribir caben dos
     * pestañas, y el resultado serían dos arqueos que se pisan.
     */
    it("abrir un segundo turno con uno vivo da 409, no un segundo turno", async () => {
      const { token } = await escenario();
      await abrir(token).expect(201);

      const res = await abrir(token).expect(409);

      expect((res.body as { message: string }).message).toContain("turno de caja abierto");
    });

    it("cerrado el anterior, se puede abrir otro: un turno viejo no encierra a nadie", async () => {
      const { token, tenantId } = await escenario();
      const primero = await abrir(token).expect(201);
      const primeroId = (primero.body as { id: string }).id;

      await prisma.withTenantContext(tenantId, async (tx) => {
        const usuario = await tx.user.findFirstOrThrow({ select: { id: true } });
        await tx.cashboxSession.update({
          where: { id: primeroId },
          data: { status: "closed", closedBy: usuario.id, closedAt: new Date() },
        });
      });

      const segundo = await abrir(token).expect(201);

      expect((segundo.body as { id: string }).id).not.toBe(primeroId);
    });

    it("un almacén de otro tenant no existe para este: 404, no 403", async () => {
      const { token } = await escenario();
      const ajeno = await escenario();

      await abrir(token, { warehouseId: ajeno.propio }).expect(404);
    });

    // 422 y no 409: es el código que ya usa todo el inventario para un almacén
    // inactivo (`inventory.warehouse_inactive`). Coherencia sobre preferencia.
    it("un almacén desactivado no abre turno", async () => {
      const { token, tenantId, otro } = await escenario();
      await prisma.withTenantContext(tenantId, (tx) =>
        tx.warehouse.update({ where: { id: otro }, data: { isActive: false } }),
      );

      await abrir(token, { warehouseId: otro }).expect(422);
    });
  });

  describe("permisos", () => {
    it("sin `pos:sell` no se abre ni se consulta el turno", async () => {
      const { tokenSinPermiso } = await (async () => {
        const { tenantId } = await escenario();
        const tokenService = app.get(TokenService);
        const userId = await prisma.withTenantContext(tenantId, async (tx) => {
          const owner = await tx.user.findFirstOrThrow({ select: { id: true } });
          return owner.id;
        });
        return {
          tokenSinPermiso: await tokenService.signAccessToken({
            sub: userId,
            tenantId,
            permissions: ["inventory:read"],
            locale: "es",
          }),
        };
      })();

      await consultar(tokenSinPermiso).expect(403);
      await abrir(tokenSinPermiso).expect(403);
    });
  });

  /**
   * F4-SALE-01 — la transacción del cobro.
   *
   * La venta es LLAMADORA del ledger, nunca escritora: hereda de F3 el
   * `FOR UPDATE` ordenado, el reparto FEFO, la expansión de compuestos y el
   * bloqueo de lotes vencidos sin una línea nueva.
   */
  describe("Vender (F4-SALE-01)", () => {
    /** Carga stock por el camino real: entrada confirmada, no INSERT a mano. */
    async function conStock(token: string, tenantId: string, cantidad = 100) {
      const { productoId, almacenId, sku } = await prisma.withTenantContext(
        tenantId,
        async (tx) => {
          const almacen = await tx.warehouse.findFirstOrThrow({ select: { id: true } });
          const producto = await tx.product.create({
            data: { tenantId, sku: `V-${randomUUID().slice(0, 8)}`, name: "Paracetamol" },
          });
          await tx.productPresentation.create({
            data: {
              tenantId,
              productId: producto.id,
              name: "Pieza",
              factor: "1",
              price: "15.00",
              isDefaultSale: true,
              allowFractionalInput: false,
            },
          });
          return { productoId: producto.id, almacenId: almacen.id, sku: producto.sku };
        },
      );

      const doc = await request(app.getHttpServer())
        .post("/inventory/documents")
        .set("Authorization", bearer(token))
        .send({ type: "entry", warehouseId: almacenId })
        .expect(201);
      const docId = (doc.body as { id: string }).id;
      await request(app.getHttpServer())
        .patch(`/inventory/documents/${docId}`)
        .set("Authorization", bearer(token))
        .send({ reasonCode: "adjustment", reasonNote: "carga inicial" })
        .expect(200);
      await request(app.getHttpServer())
        .post(`/inventory/documents/${docId}/lines`)
        .set("Authorization", bearer(token))
        .send({ productId: productoId, quantity: cantidad })
        .expect(201);
      await request(app.getHttpServer())
        .post(`/inventory/documents/${docId}/confirm`)
        .set("Authorization", bearer(token))
        .send({})
        .expect(201);

      return { productoId, almacenId, sku };
    }

    const vender = (token: string, body: Record<string, unknown>) =>
      request(app.getHttpServer())
        .post("/pos/sales")
        .set("Authorization", bearer(token))
        .send(body);

    /** El saldo de un producto en un almacén, leído de la tabla de saldos. */
    async function saldo(tenantId: string, productId: string, warehouseId: string) {
      const fila = await prisma.withTenantContext(tenantId, (tx) =>
        tx.stockByWarehouse.findFirst({
          where: { tenantId, productId, warehouseId },
          select: { quantity: true },
        }),
      );
      return fila?.quantity?.toString() ?? "0";
    }

    /** Un servicio vendible en ese almacén. No tiene existencias: ese es el punto. */
    async function conServicio(token: string, tenantId: string, warehouseId: string) {
      const creado = await request(app.getHttpServer())
        .post("/services")
        .set("Authorization", bearer(token))
        .send({
          code: `SRV-${randomUUID().slice(0, 8)}`,
          name: "Fotocopia",
          price: 5,
          warehouseIds: [warehouseId],
        })
        .expect(201);
      return (creado.body as { id: string }).id;
    }

    /**
     * Un COMPUESTO con su receta: lleva `porUnidad` gr del componente que
     * `conStock` acaba de cargar.
     */
    async function conCompuesto(
      token: string,
      tenantId: string,
      componenteId: string,
      porUnidad = 20,
    ) {
      const compuestoId = await prisma.withTenantContext(tenantId, async (tx) => {
        const compuesto = await tx.product.create({
          data: { tenantId, sku: `C-${randomUUID().slice(0, 8)}`, name: "Café servido" },
        });
        await tx.productPresentation.create({
          data: {
            tenantId,
            productId: compuesto.id,
            name: "Pieza",
            factor: "1",
            price: "30.00",
            isDefaultSale: true,
            allowFractionalInput: false,
          },
        });
        return compuesto.id;
      });

      // Por el camino REAL: el endpoint deja `is_composite` en sincronía.
      await request(app.getHttpServer())
        .post(`/products/${compuestoId}/composition`)
        .set("Authorization", bearer(token))
        .send({ lines: [{ componentId: componenteId, quantity: porUnidad }] })
        .expect(200);

      return compuestoId;
    }

    /**
     * ⚠ EL CRITERIO 1 DE LA FASE 4 (verificación de cierre, 2026-08-25).
     *
     * «vende un carrito mixto —producto simple, compuesto, servicio— y el
     * ledger descuenta exactamente lo vendido: componentes del compuesto
     * incluidos».
     *
     * Se descubrió ejecutándolo contra PRODUCCIÓN: vender un compuesto
     * respondía 422 «no hay suficiente existencia» del compuesto mismo, que
     * por definición nunca tiene saldo — se arma al venderlo. El docblock de
     * este describe decía que la venta hereda «la expansión de compuestos» y
     * ningún test lo probaba: ahí se coló.
     */
    /**
     * ⚠ EL CRITERIO 2 DE LA FASE 4: «dos tenants arrancan su serie en 1».
     *
     * Que un tenant nuevo empiece en `VTA-000001` ya lo cubren otros tests
     * —cada uno crea el suyo—, pero eso NO demuestra lo que este criterio
     * pide: que la serie sea POR TENANT. Con un contador global, el segundo
     * negocio en dar de alta el sistema vería su primera venta numerada
     * `VTA-000002` y no tendría forma de explicar el hueco.
     *
     * Verificado acá y no contra producción porque ese folio ya se gastó: los
     * folios no tienen huecos por diseño, así que el primer número de un
     * negocio se emite UNA vez y no vuelve.
     */
    it("dos tenants arrancan su serie en VTA-000001, cada uno la suya", async () => {
      const primero = await escenario();
      const segundo = await escenario();

      const stockA = await conStock(primero.token, primero.tenantId, 10);
      const stockB = await conStock(segundo.token, segundo.tenantId, 10);
      await abrir(primero.token).expect(201);
      await abrir(segundo.token).expect(201);

      const ventaA = await vender(primero.token, {
        paymentMethod: "cash",
        lines: [{ productId: stockA.productoId, quantity: 1 }],
      }).expect(201);
      const ventaB = await vender(segundo.token, {
        paymentMethod: "cash",
        lines: [{ productId: stockB.productoId, quantity: 1 }],
      }).expect(201);

      expect((ventaA.body as { folio: string }).folio).toBe("VTA-000001");
      expect((ventaB.body as { folio: string }).folio).toBe("VTA-000001");
    });

    it("vender un COMPUESTO descuenta sus componentes, no el compuesto", async () => {
      const { token, tenantId } = await escenario();
      const { productoId: componenteId, almacenId } = await conStock(token, tenantId, 500);
      const compuestoId = await conCompuesto(token, tenantId, componenteId, 20);
      await abrir(token).expect(201);

      const antes = await saldo(tenantId, componenteId, almacenId);

      await vender(token, {
        paymentMethod: "cash",
        lines: [{ productId: compuestoId, quantity: 3 }],
      }).expect(201);

      // 3 cafés × 20 gr = 60 gr del COMPONENTE.
      expect(Number(await saldo(tenantId, componenteId, almacenId))).toBe(Number(antes) - 60);
    });

    /**
     * El compuesto no deja rastro propio en el kardex: sus componentes sí, y
     * cada movimiento sabe de qué compuesto salió (`parent_product_id`). Si el
     * compuesto tuviera movimientos, tendría saldo — y eso es justo lo que no
     * puede pasar.
     */
    it("el compuesto no genera movimientos propios; sus componentes los llevan marcados", async () => {
      const { token, tenantId } = await escenario();
      const { productoId: componenteId } = await conStock(token, tenantId, 500);
      const compuestoId = await conCompuesto(token, tenantId, componenteId, 20);
      await abrir(token).expect(201);

      await vender(token, {
        paymentMethod: "cash",
        lines: [{ productId: compuestoId, quantity: 2 }],
      }).expect(201);

      const movimientos = await prisma.withTenantContext(tenantId, (tx) =>
        tx.stockMovement.findMany({
          where: { tenantId, reasonCode: "sale" },
          select: { productId: true, parentProductId: true, quantity: true },
        }),
      );

      expect(movimientos.some((m) => m.productId === compuestoId)).toBe(false);
      const delComponente = movimientos.find((m) => m.productId === componenteId);
      expect(delComponente?.parentProductId).toBe(compuestoId);
      expect(Number(delComponente?.quantity)).toBe(40);
    });

    /**
     * El carrito MIXTO completo del criterio: simple + compuesto + servicio.
     * El servicio no puede dejar NI UN movimiento — no tiene existencias, y
     * que no aparezca es la forma de decirlo.
     */
    it("carrito mixto: el simple descuenta, el compuesto expande y el servicio no toca el stock", async () => {
      const { token, tenantId } = await escenario();
      const { productoId: simpleId, almacenId } = await conStock(token, tenantId, 100);
      const { productoId: componenteId } = await conStock(token, tenantId, 500);
      const compuestoId = await conCompuesto(token, tenantId, componenteId, 20);
      const servicioId = await conServicio(token, tenantId, almacenId);
      await abrir(token).expect(201);

      const antes = {
        simple: Number(await saldo(tenantId, simpleId, almacenId)),
        componente: Number(await saldo(tenantId, componenteId, almacenId)),
      };

      const venta = await vender(token, {
        paymentMethod: "cash",
        lines: [
          { productId: simpleId, quantity: 2 },
          { productId: compuestoId, quantity: 3 },
          { serviceId: servicioId, quantity: 4 },
        ],
      }).expect(201);

      expect(Number(await saldo(tenantId, simpleId, almacenId))).toBe(antes.simple - 2);
      expect(Number(await saldo(tenantId, componenteId, almacenId))).toBe(antes.componente - 60);

      // Tres renglones en el papel, dos productos en el ledger.
      expect((venta.body as { items: unknown[] }).items).toHaveLength(3);
      const movimientos = await prisma.withTenantContext(tenantId, (tx) =>
        tx.stockMovement.count({ where: { tenantId, reasonCode: "sale" } }),
      );
      expect(movimientos).toBe(2);
    });

    /**
     * ⚠ EL CRITERIO 11 DE LA FASE 4: «el numpad esconde el `.` en
     * presentaciones enteras Y EL BACKEND REVALIDA».
     *
     * El numpad ya no pinta el punto —eso tiene sus tests en el front—, pero
     * esconder un botón no es validar: un `curl`, un script de importación o
     * un bug del cliente pueden mandar 1.5 igual. F3 lo revalida en su
     * `line-resolver` (`inventory.integer_only_presentation`) y el POS no lo
     * hacía: aceptaba vender media pieza y dejaba el saldo en decimales que
     * ningún conteo físico puede cuadrar.
     *
     * Descubierto ejecutando el criterio contra producción (2026-08-25).
     */
    it("una cantidad DECIMAL en presentación entera se rechaza, aunque el numpad ya la esconda", async () => {
      const { token, tenantId } = await escenario();
      const { productoId } = await conStock(token, tenantId, 10);
      await abrir(token).expect(201);

      const res = await vender(token, {
        paymentMethod: "cash",
        lines: [{ productId: productoId, quantity: 1.5 }],
      }).expect(422);

      expect((res.body as { code: string }).code).toBe("pos.integer_only_presentation");
    });

    /** Y una cantidad entera sigue pasando: la guarda no puede estorbar. */
    it("la misma presentación acepta cantidades enteras", async () => {
      const { token, tenantId } = await escenario();
      const { productoId } = await conStock(token, tenantId, 10);
      await abrir(token).expect(201);

      await vender(token, {
        paymentMethod: "cash",
        lines: [{ productId: productoId, quantity: 2 }],
      }).expect(201);
    });

    it("sin turno abierto no se vende", async () => {
      const { token, tenantId } = await escenario();
      const { productoId } = await conStock(token, tenantId);

      const res = await vender(token, {
        paymentMethod: "cash",
        lines: [{ productId: productoId, quantity: 1 }],
      }).expect(409);

      expect((res.body as { message: string }).message).toContain("turno de caja");
    });

    it("con turno, cobra: folio VTA, total del catálogo y stock descontado", async () => {
      const { token, tenantId } = await escenario();
      const { productoId, almacenId } = await conStock(token, tenantId);
      await abrir(token).expect(201);

      const res = await vender(token, {
        paymentMethod: "cash",
        lines: [{ productId: productoId, quantity: 3 }],
      }).expect(201);
      const venta = res.body as { folio: string; total: string; items: { unitPrice: string }[] };

      expect(venta.folio).toMatch(/^VTA-\d{6}$/);
      expect(venta.total).toBe("45");
      expect(venta.items[0]?.unitPrice).toBe("15");

      const saldo = await prisma.withTenantContext(tenantId, (tx) =>
        tx.stockByWarehouse.findFirstOrThrow({
          where: { productId: productoId, warehouseId: almacenId },
        }),
      );
      expect(saldo.quantity.toString()).toBe("97");
    });

    /**
     * ⚠ EL CRITERIO DE CIERRE DE LA FASE: alterar el POST no altera un precio.
     * El carrito manda ids y cantidades; el precio sale del catálogo.
     */
    it("un precio en el POST se IGNORA: lo pone el servidor", async () => {
      const { token, tenantId } = await escenario();
      const { productoId } = await conStock(token, tenantId);
      await abrir(token).expect(201);

      const res = await vender(token, {
        paymentMethod: "cash",
        lines: [{ productId: productoId, quantity: 1, unitPrice: "0.01" }],
      });

      // El `.strict()` del DTO lo rechaza de plano: un campo que no existe no
      // se ignora en silencio, se denuncia.
      expect(res.status).toBe(400);
    });

    it("una línea de SERVICIO cobra pero no toca el ledger", async () => {
      const { token, tenantId } = await escenario();
      await abrir(token).expect(201);
      const servicioId = await prisma.withTenantContext(tenantId, async (tx) => {
        const s = await tx.service.create({
          data: {
            tenantId,
            code: `SV-${randomUUID().slice(0, 6)}`,
            name: "Consulta",
            price: "250.00",
          },
        });
        return s.id;
      });

      const res = await vender(token, {
        paymentMethod: "card",
        lines: [{ serviceId: servicioId, quantity: 1 }],
      }).expect(201);
      const venta = res.body as { id: string; total: string };

      expect(venta.total).toBe("250");

      const movimientos = await prisma.withTenantContext(tenantId, (tx) =>
        tx.stockMovement.count({ where: { saleId: venta.id } }),
      );
      expect(movimientos).toBe(0);
    });

    /**
     * El movimiento cuelga de la VENTA, no de un documento (decisión de
     * Carlos, 2026-08-21). Y el kardex tiene que seguir viéndolo: con el INNER
     * JOIN anterior habría desaparecido sin un solo error.
     */
    it("el movimiento apunta a la venta y el KARDEX lo muestra con su folio VTA", async () => {
      const { token, tenantId } = await escenario();
      const { productoId } = await conStock(token, tenantId);
      await abrir(token).expect(201);

      const res = await vender(token, {
        paymentMethod: "cash",
        lines: [{ productId: productoId, quantity: 2 }],
      }).expect(201);
      const venta = res.body as { id: string; folio: string };

      const movimiento = await prisma.withTenantContext(tenantId, (tx) =>
        tx.stockMovement.findFirstOrThrow({ where: { saleId: venta.id } }),
      );
      expect(movimiento.documentId).toBeNull();
      expect(movimiento.saleId).toBe(venta.id);

      const kardex = await request(app.getHttpServer())
        .get(`/products/${productoId}/kardex`)
        .set("Authorization", bearer(token))
        .expect(200);
      const filas = (kardex.body as { rows: { document: { folio: string; type: string } }[] }).rows;

      expect(filas.some((r) => r.document.folio === venta.folio)).toBe(true);
      expect(filas.find((r) => r.document.folio === venta.folio)?.document.type).toBe("sale");
    });

    it("sin stock suficiente la venta falla ENTERA: ni folio gastado ni media venta", async () => {
      const { token, tenantId } = await escenario();
      const { productoId } = await conStock(token, tenantId, 2);
      await abrir(token).expect(201);

      await vender(token, {
        paymentMethod: "cash",
        lines: [{ productId: productoId, quantity: 50 }],
      }).expect(422);

      const ventas = await prisma.withTenantContext(tenantId, (tx) => tx.sale.count());
      expect(ventas).toBe(0);
    });

    /**
     * F4-UI-02 — el rechazo tiene que decir DE QUÉ línea habla.
     *
     * El carrito del POS tiene varios renglones y el cajero está de pie con el
     * cliente enfrente: un «no hay suficiente existencia» que no señala cuál
     * obliga a revisarlos uno por uno. El `sku` viaja en el CUERPO, aparte del
     * mensaje traducido, porque la alternativa —que el front parsee el texto
     * para sacarlo— se rompe al cambiar de idioma o al retocar una coma.
     */
    it("el rechazo por stock nombra el SKU culpable en el cuerpo, no solo en el texto", async () => {
      const { token, tenantId } = await escenario();
      const { productoId, sku } = await conStock(token, tenantId, 2);
      await abrir(token).expect(201);

      const res = await vender(token, {
        paymentMethod: "cash",
        lines: [{ productId: productoId, quantity: 50 }],
      }).expect(422);

      const body = res.body as { code: string; message: string; sku?: string };
      expect(body.code).toBe("inventory.insufficient_stock");
      // El dato, no el texto: `sku` es lo que deja al carrito pintar el error
      // SOBRE el renglón en vez de arriba de todo.
      expect(body.sku).toBe(sku);
      // Y el mensaje sigue siendo legible por su cuenta.
      expect(body.message).toContain(sku);
    });

    /**
     * Cierra el `TODO(F4)` que `services.remove` arrastraba desde F3. La FK
     * RESTRICT ya lo hace imposible en la base; esta guarda existe para que el
     * usuario reciba un mensaje que nombra la alternativa en vez de un 500.
     */
    it("un servicio ya VENDIDO no se puede borrar: 409 que nombra desactivar", async () => {
      const { token, tenantId } = await escenario();
      await abrir(token).expect(201);
      const servicioId = await prisma.withTenantContext(tenantId, async (tx) => {
        const s = await tx.service.create({
          data: {
            tenantId,
            code: `SD-${randomUUID().slice(0, 6)}`,
            name: "Consulta",
            price: "100.00",
          },
        });
        return s.id;
      });

      await vender(token, {
        paymentMethod: "cash",
        lines: [{ serviceId: servicioId, quantity: 1 }],
      }).expect(201);

      const res = await request(app.getHttpServer())
        .delete(`/services/${servicioId}`)
        .set("Authorization", bearer(token))
        .expect(409);

      expect((res.body as { message: string }).message).toContain("Desactívalo");
    });

    /**
     * La moneda se congela con UNA venta, aunque sea de servicio puro y no
     * haya movido stock: los importes ya cobrados no tienen unidad propia, la
     * heredan del tenant.
     */
    it("una venta de SERVICIO congela la moneda del tenant", async () => {
      const { token, tenantId } = await escenario();
      await abrir(token).expect(201);
      const servicioId = await prisma.withTenantContext(tenantId, async (tx) => {
        const s = await tx.service.create({
          data: {
            tenantId,
            code: `MC-${randomUUID().slice(0, 6)}`,
            name: "Consulta",
            price: "100.00",
          },
        });
        return s.id;
      });

      await vender(token, {
        paymentMethod: "cash",
        lines: [{ serviceId: servicioId, quantity: 1 }],
      }).expect(201);

      const movimientos = await prisma.withTenantContext(tenantId, (tx) =>
        tx.stockMovement.count(),
      );
      expect(movimientos).toBe(0);

      // 403 y no 409: es lo que lanza `TenantCurrencyChangeableGuard` desde
      // F1-LOCALE-06. Lo que se afirma acá no es el número sino que el gate
      // AHORA cuenta ventas — antes, con cero movimientos, habría dejado pasar.
      const res = await request(app.getHttpServer())
        .patch("/tenants/me")
        .set("Authorization", bearer(token))
        .send({ currency: "USD" })
        .expect(403);

      expect((res.body as { message: string }).message).toContain("moneda");
    });

    /**
     * F4-SALE-02 — el doble tap del cajero sobre un botón lento.
     *
     * El COBRAR tarda: bloquea saldos, reparte FEFO y asienta movimientos. En
     * una tablet lenta, medio segundo sin respuesta invita a volver a tocar.
     */
    describe("Idempotencia (F4-SALE-02)", () => {
      const venderCon = (token: string, clave: string, body: Record<string, unknown>) =>
        request(app.getHttpServer())
          .post("/pos/sales")
          .set("Authorization", bearer(token))
          .set("Idempotency-Key", clave)
          .send(body);

      it("dos POST con la MISMA clave dan una sola venta y descuentan una vez", async () => {
        const { token, tenantId } = await escenario();
        const { productoId, almacenId } = await conStock(token, tenantId, 10);
        await abrir(token).expect(201);
        const clave = randomUUID();
        const cuerpo = { paymentMethod: "cash", lines: [{ productId: productoId, quantity: 2 }] };

        const primera = await venderCon(token, clave, cuerpo).expect(201);
        const segunda = await venderCon(token, clave, cuerpo);

        // La MISMA venta, no un 409: el cajero no hizo nada malo.
        expect(segunda.status).toBe(201);
        expect((segunda.body as { id: string }).id).toBe((primera.body as { id: string }).id);

        const ventas = await prisma.withTenantContext(tenantId, (tx) => tx.sale.count());
        expect(ventas).toBe(1);

        const saldo = await prisma.withTenantContext(tenantId, (tx) =>
          tx.stockByWarehouse.findFirstOrThrow({
            where: { productId: productoId, warehouseId: almacenId },
          }),
        );
        expect(saldo.quantity.toString()).toBe("8");
      });

      it("claves DISTINTAS son dos ventas: vender dos veces lo mismo es legítimo", async () => {
        const { token, tenantId } = await escenario();
        const { productoId } = await conStock(token, tenantId, 10);
        await abrir(token).expect(201);
        const cuerpo = { paymentMethod: "cash", lines: [{ productId: productoId, quantity: 1 }] };

        await venderCon(token, randomUUID(), cuerpo).expect(201);
        await venderCon(token, randomUUID(), cuerpo).expect(201);

        const ventas = await prisma.withTenantContext(tenantId, (tx) => tx.sale.count());
        expect(ventas).toBe(2);
      });

      it("sin la cabecera, el comportamiento es el de siempre", async () => {
        const { token, tenantId } = await escenario();
        const { productoId } = await conStock(token, tenantId, 10);
        await abrir(token).expect(201);
        const cuerpo = { paymentMethod: "cash", lines: [{ productId: productoId, quantity: 1 }] };

        await vender(token, cuerpo).expect(201);
        await vender(token, cuerpo).expect(201);

        const ventas = await prisma.withTenantContext(tenantId, (tx) => tx.sale.count());
        expect(ventas).toBe(2);
      });
    });

    /**
     * F4-SALE-03 — anular NO borra: revierte. El sistema es append-only, así
     * que deshacer una venta es asentar su contrario con motivo `sale_return`.
     */
    describe("Anular (F4-SALE-03)", () => {
      const anular = (token: string, id: string, reason: string) =>
        request(app.getHttpServer())
          .post(`/pos/sales/${id}/cancel`)
          .set("Authorization", bearer(token))
          .send({ reason });

      it("restaura el stock exacto y deja el reverso en el kardex", async () => {
        const { token, tenantId } = await escenario();
        const { productoId, almacenId } = await conStock(token, tenantId, 10);
        await abrir(token).expect(201);
        const venta = await vender(token, {
          paymentMethod: "cash",
          lines: [{ productId: productoId, quantity: 4 }],
        }).expect(201);
        const ventaId = (venta.body as { id: string }).id;

        await anular(token, ventaId, "el cliente se arrepintió").expect(200);

        const saldo = await prisma.withTenantContext(tenantId, (tx) =>
          tx.stockByWarehouse.findFirstOrThrow({
            where: { productId: productoId, warehouseId: almacenId },
          }),
        );
        expect(saldo.quantity.toString()).toBe("10");

        // El reverso EXISTE como movimiento: el saldo correcto con la historia
        // muda sería exactamente lo que no queremos.
        const reversos = await prisma.withTenantContext(tenantId, (tx) =>
          tx.stockMovement.count({ where: { saleId: ventaId, reasonCode: "sale_return" } }),
        );
        expect(reversos).toBe(1);
      });

      it("la venta queda marcada, con quién la anuló y por qué", async () => {
        const { token, tenantId } = await escenario();
        const { productoId } = await conStock(token, tenantId, 10);
        await abrir(token).expect(201);
        const venta = await vender(token, {
          paymentMethod: "cash",
          lines: [{ productId: productoId, quantity: 1 }],
        }).expect(201);
        const ventaId = (venta.body as { id: string }).id;

        await anular(token, ventaId, "cobro duplicado").expect(200);

        const fila = await prisma.withTenantContext(tenantId, (tx) =>
          tx.sale.findUniqueOrThrow({ where: { id: ventaId } }),
        );
        expect(fila.status).toBe("canceled");
        expect(fila.cancelReason).toBe("cobro duplicado");
        expect(fila.canceledBy).not.toBeNull();
        expect(fila.canceledAt).not.toBeNull();
      });

      it("anular dos veces da 409: el stock no vuelve dos veces", async () => {
        const { token, tenantId } = await escenario();
        const { productoId, almacenId } = await conStock(token, tenantId, 10);
        await abrir(token).expect(201);
        const venta = await vender(token, {
          paymentMethod: "cash",
          lines: [{ productId: productoId, quantity: 3 }],
        }).expect(201);
        const ventaId = (venta.body as { id: string }).id;

        await anular(token, ventaId, "primera").expect(200);
        await anular(token, ventaId, "segunda").expect(409);

        const saldo = await prisma.withTenantContext(tenantId, (tx) =>
          tx.stockByWarehouse.findFirstOrThrow({
            where: { productId: productoId, warehouseId: almacenId },
          }),
        );
        expect(saldo.quantity.toString()).toBe("10");
      });

      it("sin justificación no se anula", async () => {
        const { token, tenantId } = await escenario();
        const { productoId } = await conStock(token, tenantId, 10);
        await abrir(token).expect(201);
        const venta = await vender(token, {
          paymentMethod: "cash",
          lines: [{ productId: productoId, quantity: 1 }],
        }).expect(201);

        await anular(token, (venta.body as { id: string }).id, "").expect(400);
      });

      it("el CAJERO no anula: es decisión de gestión", async () => {
        const { token, tenantId } = await escenario();
        const { productoId } = await conStock(token, tenantId, 10);
        await abrir(token).expect(201);
        const venta = await vender(token, {
          paymentMethod: "cash",
          lines: [{ productId: productoId, quantity: 1 }],
        }).expect(201);

        const tokenService = app.get(TokenService);
        const userId = await prisma.withTenantContext(tenantId, async (tx) => {
          const owner = await tx.user.findFirstOrThrow({ select: { id: true } });
          return owner.id;
        });
        const tokenCajero = await tokenService.signAccessToken({
          sub: userId,
          tenantId,
          permissions: ["pos:sell", "pos:view"],
          locale: "es",
        });

        await anular(tokenCajero, (venta.body as { id: string }).id, "quiero").expect(403);
      });
    });

    /**
     * F4-SALE-04 — el historial. Las anuladas se ven MARCADAS, no desaparecen.
     */
    describe("Historial (F4-SALE-04)", () => {
      const historial = (token: string, query = "") =>
        request(app.getHttpServer()).get(`/pos/sales${query}`).set("Authorization", bearer(token));

      /**
       * ── EL RANGO SON DÍAS DEL NEGOCIO (2026-08-24) ──────────────────
       *
       * Mismo contrato que el kardex y los documentos: `from`/`to` llegan
       * como `YYYY-MM-DD` y el servidor los traduce con la zona del tenant.
       * Antes el DTO exigía fecha-hora ISO con offset, así que el front
       * tenía que armar el instante — y ahí es donde nace el bug de
       * «los de hoy no salen».
       */
      const hoyEnCdmx = () =>
        new Intl.DateTimeFormat("en-CA", {
          timeZone: "America/Mexico_City",
          year: "numeric",
          month: "2-digit",
          day: "2-digit",
        }).format(new Date());

      it("una venta de HOY entra en el rango que termina hoy", async () => {
        const { token, tenantId } = await escenario();
        const { productoId } = await conStock(token, tenantId, 10);
        await abrir(token).expect(201);
        await vender(token, {
          paymentMethod: "cash",
          lines: [{ productId: productoId, quantity: 1 }],
        }).expect(201);

        const hoy = hoyEnCdmx();
        const res = await historial(token, `?from=${hoy}&to=${hoy}`).expect(200);

        expect((res.body as { total: number }).total).toBe(1);
      });

      it("un rango que termina AYER no la trae", async () => {
        const { token, tenantId } = await escenario();
        const { productoId } = await conStock(token, tenantId, 10);
        await abrir(token).expect(201);
        await vender(token, {
          paymentMethod: "cash",
          lines: [{ productId: productoId, quantity: 1 }],
        }).expect(201);

        const ayer = new Intl.DateTimeFormat("en-CA", {
          timeZone: "America/Mexico_City",
          year: "numeric",
          month: "2-digit",
          day: "2-digit",
        }).format(new Date(Date.now() - 86_400_000));
        const res = await historial(token, `?to=${ayer}`).expect(200);

        // La otra mitad: si el rango se estirara «por las dudas», el filtro
        // dejaría de filtrar y este test lo caza.
        expect((res.body as { total: number }).total).toBe(0);
      });

      /**
       * ── BUSCAR POR FOLIO (2026-08-24) ───────────────────────────────
       *
       * Nace junto al código de barras del ticket: escanear el papel (o
       * dictarlo por teléfono) tiene que encontrar la venta para reimprimir
       * o anular. `contains` insensitive, el MISMO contrato que el folio de
       * cotizaciones — quien dicta dice «cero cero uno», no «VTA-000001».
       */
      /**
       * ── EL CÓDIGO DE BARRAS DIARIO (2026-08-24, diseño de Carlos) ────
       *
       * 12 dígitos: `YYYYMMDD` (día del NEGOCIO, no UTC) + consecutivo de 4
       * que «reinicia» cada día — sin reset: cada fecha es una serie nueva
       * de tenant_sequences. El folio VTA sigue intacto: identidad contable
       * y etiqueta de escaneo son campos distintos.
       */
      it("la venta nace con su código de 12 dígitos: fecha del negocio + 0001", async () => {
        const { token, tenantId } = await escenario();
        const { productoId } = await conStock(token, tenantId, 10);
        await abrir(token).expect(201);
        const venta = await vender(token, {
          paymentMethod: "cash",
          lines: [{ productId: productoId, quantity: 1 }],
        }).expect(201);

        const hoy = hoyEnCdmx().replaceAll("-", "");
        expect((venta.body as { barcode: string }).barcode).toBe(`${hoy}0001`);
      });

      it("la segunda venta del día es la 0002 — y el folio VTA sigue su propia cuenta", async () => {
        const { token, tenantId } = await escenario();
        const { productoId } = await conStock(token, tenantId, 10);
        await abrir(token).expect(201);
        await vender(token, {
          paymentMethod: "cash",
          lines: [{ productId: productoId, quantity: 1 }],
        }).expect(201);
        const segunda = await vender(token, {
          paymentMethod: "cash",
          lines: [{ productId: productoId, quantity: 1 }],
        }).expect(201);

        const cuerpo = segunda.body as { barcode: string; folio: string };
        expect(cuerpo.barcode.endsWith("0002")).toBe(true);
        expect(cuerpo.folio).toBe("VTA-000002");
      });

      it("el buscador del historial encuentra por el CÓDIGO, no solo por folio", async () => {
        const { token, tenantId } = await escenario();
        const { productoId } = await conStock(token, tenantId, 10);
        await abrir(token).expect(201);
        await vender(token, {
          paymentMethod: "cash",
          lines: [{ productId: productoId, quantity: 1 }],
        }).expect(201);

        // El año del código: lo que un escaneo parcial o tecleo dictado trae.
        const res = await historial(token, `?folio=${hoyEnCdmx().slice(0, 4)}`).expect(200);

        expect((res.body as { total: number }).total).toBe(1);
      });

      it("el folio PARCIAL encuentra la venta", async () => {
        const { token, tenantId } = await escenario();
        const { productoId } = await conStock(token, tenantId, 10);
        await abrir(token).expect(201);
        await vender(token, {
          paymentMethod: "cash",
          lines: [{ productId: productoId, quantity: 1 }],
        }).expect(201);

        const res = await historial(token, "?folio=000001").expect(200);

        expect((res.body as { total: number }).total).toBe(1);
        expect((res.body as { rows: { folio: string }[] }).rows[0]?.folio).toBe("VTA-000001");
      });

      it("un folio ajeno no trae nada", async () => {
        const { token, tenantId } = await escenario();
        const { productoId } = await conStock(token, tenantId, 10);
        await abrir(token).expect(201);
        await vender(token, {
          paymentMethod: "cash",
          lines: [{ productId: productoId, quantity: 1 }],
        }).expect(201);

        const res = await historial(token, "?folio=999999").expect(200);

        expect((res.body as { total: number }).total).toBe(0);
      });

      it("lista las ventas del turno, con sus líneas y su vendedor", async () => {
        const { token, tenantId } = await escenario();
        const { productoId } = await conStock(token, tenantId, 10);
        await abrir(token).expect(201);
        await vender(token, {
          paymentMethod: "cash",
          lines: [{ productId: productoId, quantity: 1 }],
        }).expect(201);

        const res = await historial(token).expect(200);
        const body = res.body as {
          rows: { folio: string; seller: { name: string }; items: unknown[] }[];
          total: number;
        };

        expect(body.total).toBe(1);
        expect(body.rows[0]?.folio).toMatch(/^VTA-/);
        expect(body.rows[0]?.seller.name).toContain("Ana");
        expect(body.rows[0]?.items).toHaveLength(1);
      });

      /**
       * Esconderlas por defecto sería tentador —"ruido"— y es justo lo
       * contrario de lo que necesita quien busca una venta que no cuadra.
       */
      it("una venta ANULADA sigue en el listado, marcada", async () => {
        const { token, tenantId } = await escenario();
        const { productoId } = await conStock(token, tenantId, 10);
        await abrir(token).expect(201);
        const venta = await vender(token, {
          paymentMethod: "cash",
          lines: [{ productId: productoId, quantity: 1 }],
        }).expect(201);
        await request(app.getHttpServer())
          .post(`/pos/sales/${(venta.body as { id: string }).id}/cancel`)
          .set("Authorization", bearer(token))
          .send({ reason: "prueba" })
          .expect(200);

        const res = await historial(token).expect(200);
        const body = res.body as { rows: { status: string }[]; total: number };

        expect(body.total).toBe(1);
        expect(body.rows[0]?.status).toBe("canceled");
      });

      it("filtra por estado", async () => {
        const { token, tenantId } = await escenario();
        const { productoId } = await conStock(token, tenantId, 10);
        await abrir(token).expect(201);
        await vender(token, {
          paymentMethod: "cash",
          lines: [{ productId: productoId, quantity: 1 }],
        }).expect(201);

        const canceladas = await historial(token, "?status=canceled").expect(200);
        expect((canceladas.body as { total: number }).total).toBe(0);

        const completas = await historial(token, "?status=completed").expect(200);
        expect((completas.body as { total: number }).total).toBe(1);
      });

      it("una venta de otro tenant NO existe: 404, no 403", async () => {
        const { token, tenantId } = await escenario();
        const { productoId } = await conStock(token, tenantId, 10);
        await abrir(token).expect(201);
        const venta = await vender(token, {
          paymentMethod: "cash",
          lines: [{ productId: productoId, quantity: 1 }],
        }).expect(201);

        const ajeno = await escenario();
        await request(app.getHttpServer())
          .get(`/pos/sales/${(venta.body as { id: string }).id}`)
          .set("Authorization", bearer(ajeno.token))
          .expect(404);
      });

      it("sin `pos:view` no se ve el historial", async () => {
        const { tenantId } = await escenario();
        const tokenService = app.get(TokenService);
        const userId = await prisma.withTenantContext(tenantId, async (tx) => {
          const owner = await tx.user.findFirstOrThrow({ select: { id: true } });
          return owner.id;
        });
        const sinPermiso = await tokenService.signAccessToken({
          sub: userId,
          tenantId,
          permissions: ["pos:sell"],
          locale: "es",
        });

        await historial(sinPermiso).expect(403);
      });
    });

    /**
     * F4-CASHBOX-02 — el arqueo.
     *
     * Cuadrar la caja es tarea humana. El sistema calcula, la persona cuenta, y
     * la diferencia se REGISTRA — no se bloquea.
     */
    describe("Cerrar el turno (F4-CASHBOX-02)", () => {
      const cerrar = (token: string, body: Record<string, unknown>) =>
        request(app.getHttpServer())
          .post("/pos/session/close")
          .set("Authorization", bearer(token))
          .send(body);

      it("suma POR MÉTODO: efectivo, tarjeta y transferencia por separado", async () => {
        const { token, tenantId } = await escenario();
        const { productoId } = await conStock(token, tenantId, 50);
        await abrir(token).expect(201);
        await vender(token, {
          paymentMethod: "cash",
          lines: [{ productId: productoId, quantity: 2 }],
        }).expect(201);
        await vender(token, {
          paymentMethod: "card",
          lines: [{ productId: productoId, quantity: 4 }],
        }).expect(201);

        const res = await cerrar(token, { declaredCash: 30 }).expect(200);
        const { totals } = res.body as {
          totals: { method: string; total: string; count: number }[];
        };

        expect(totals.find((t) => t.method === "cash")).toMatchObject({ total: "30", count: 1 });
        expect(totals.find((t) => t.method === "card")).toMatchObject({ total: "60", count: 1 });
        expect(totals.find((t) => t.method === "transfer")).toMatchObject({ total: "0", count: 0 });
      });

      /** Su dinero no está en el cajón: no puede sumar al arqueo. */
      it("una venta ANULADA no suma al arqueo", async () => {
        const { token, tenantId } = await escenario();
        const { productoId } = await conStock(token, tenantId, 50);
        await abrir(token).expect(201);
        const venta = await vender(token, {
          paymentMethod: "cash",
          lines: [{ productId: productoId, quantity: 2 }],
        }).expect(201);
        await request(app.getHttpServer())
          .post(`/pos/sales/${(venta.body as { id: string }).id}/cancel`)
          .set("Authorization", bearer(token))
          .send({ reason: "error de cobro" })
          .expect(200);

        const res = await cerrar(token, { declaredCash: 0 }).expect(200);
        const { totals } = res.body as { totals: { method: string; total: string }[] };

        expect(totals.find((t) => t.method === "cash")?.total).toBe("0");
      });

      /**
       * ⚠ LO QUE MÁS IMPORTA. Bloquear un turno descuadrado obligaría al
       * cajero a "encontrar" el número que el sistema quiere — y lo
       * encontraría, escribiendo el calculado en vez de lo que contó. El
       * descuadre escondido se repite; el visible se investiga.
       */
      it("con FALTANTE cierra igual y guarda las TRES cifras", async () => {
        const { token, tenantId } = await escenario();
        const { productoId } = await conStock(token, tenantId, 50);
        await abrir(token).expect(201);
        await vender(token, {
          paymentMethod: "cash",
          lines: [{ productId: productoId, quantity: 10 }],
        }).expect(201);

        // Vendió 150 en efectivo pero en el cajón hay 130: faltan 20.
        const res = await cerrar(token, { declaredCash: 130, note: "faltó un billete" }).expect(
          200,
        );
        const { session } = res.body as {
          session: { declaredCash: string; calculatedCash: string; cashDifference: string };
        };

        expect(session.calculatedCash).toBe("150");
        expect(session.declaredCash).toBe("130");
        expect(session.cashDifference).toBe("-20");
      });

      it("con SOBRANTE también, y la diferencia sale positiva", async () => {
        const { token, tenantId } = await escenario();
        const { productoId } = await conStock(token, tenantId, 50);
        await abrir(token).expect(201);
        await vender(token, {
          paymentMethod: "cash",
          lines: [{ productId: productoId, quantity: 2 }],
        }).expect(201);

        const res = await cerrar(token, { declaredCash: 35 }).expect(200);

        expect((res.body as { session: { cashDifference: string } }).session.cashDifference).toBe(
          "5",
        );
      });

      it("un turno CERRADO no vende: 409", async () => {
        const { token, tenantId } = await escenario();
        const { productoId } = await conStock(token, tenantId, 50);
        await abrir(token).expect(201);
        await cerrar(token, { declaredCash: 0 }).expect(200);

        await vender(token, {
          paymentMethod: "cash",
          lines: [{ productId: productoId, quantity: 1 }],
        }).expect(409);
      });

      it("cerrar dos veces da 409: dos arqueos no se escriben sobre el mismo turno", async () => {
        const { token } = await escenario();
        await abrir(token).expect(201);
        await cerrar(token, { declaredCash: 0 }).expect(200);

        await cerrar(token, { declaredCash: 999 }).expect(409);
      });

      it("cerrado el turno, se puede abrir otro y vender de nuevo", async () => {
        const { token, tenantId } = await escenario();
        const { productoId } = await conStock(token, tenantId, 50);
        await abrir(token).expect(201);
        await cerrar(token, { declaredCash: 0 }).expect(200);

        await abrir(token).expect(201);
        await vender(token, {
          paymentMethod: "cash",
          lines: [{ productId: productoId, quantity: 1 }],
        }).expect(201);
      });

      it("los totales se pueden consultar ANTES de cerrar", async () => {
        const { token, tenantId } = await escenario();
        const { productoId } = await conStock(token, tenantId, 50);
        await abrir(token).expect(201);
        await vender(token, {
          paymentMethod: "cash",
          lines: [{ productId: productoId, quantity: 3 }],
        }).expect(201);

        const res = await request(app.getHttpServer())
          .get("/pos/session/totals")
          .set("Authorization", bearer(token))
          .expect(200);
        const { totals } = res.body as { totals: { method: string; total: string }[] };

        expect(totals.find((t) => t.method === "cash")?.total).toBe("45");
      });
    });
  });
});
