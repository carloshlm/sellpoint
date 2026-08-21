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
    await app.init();
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
      const { productoId, almacenId } = await prisma.withTenantContext(tenantId, async (tx) => {
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
        return { productoId: producto.id, almacenId: almacen.id };
      });

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

      return { productoId, almacenId };
    }

    const vender = (token: string, body: Record<string, unknown>) =>
      request(app.getHttpServer())
        .post("/pos/sales")
        .set("Authorization", bearer(token))
        .send(body);

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
  });
});
