import { randomUUID } from "node:crypto";
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
  crearProducto,
  makePlatformAdmin,
  registerTenant,
  setTenantMarket,
  type TenantFixture,
} from "./support/billing-scenario";
import { startTestApp } from "./support/start-test-app";

/**
 * F9-PLANLIST — los candados que la lista comercial promete (Carlos, 2026-09-15).
 *
 * La vitrina decía que los compuestos son de Pro y que los catálogos
 * personalizados y los roles propios son de Plus, y NADA lo bloqueaba: un
 * Basic con el permiso los usaba igual. Vender un plan por algo que el de
 * abajo también recibe no se sostiene. Y las órdenes de compra, que viajaban
 * dentro del módulo Compras (Pro), pasan a ser el escalón de Plus.
 *
 * La regla del guard no cambia: el flag solo frena MUTACIONES. Un negocio
 * que bajó de plan sigue leyendo lo que hizo; lo que no puede es crear más.
 */
describe("Los candados de la lista comercial (F9-PLANLIST)", () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let admin: TenantFixture;

  const PRECIO_MX: Record<"basic" | "pro" | "plus", string> = {
    basic: "199.00",
    pro: "349.00",
    plus: "499.00",
  };

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(MAILER)
      .useClass(NoopMailer)
      .compile();
    app = moduleFixture.createNestApplication();
    await startTestApp(app);
    prisma = app.get(PrismaService);

    admin = await registerTenant(app, "gates-admin");
    await makePlatformAdmin(app, prisma, admin);
  });

  afterAll(async () => {
    await app.close();
  });

  const api = (token: string) => ({
    get: (url: string) => request(app.getHttpServer()).get(url).set("Authorization", bearer(token)),
    post: (url: string, body: object = {}) =>
      request(app.getHttpServer()).post(url).set("Authorization", bearer(token)).send(body),
    patch: (url: string, body: object = {}) =>
      request(app.getHttpServer()).patch(url).set("Authorization", bearer(token)).send(body),
  });

  /**
   * El pago de ESE plan: el negocio deja el trial Plus con el que nació y
   * queda en el plan contratado. Pagar Pro después de probar Plus es,
   * justamente, bajar de plan.
   */
  async function contratar(negocio: TenantFixture, planCode: "basic" | "pro" | "plus") {
    await request(app.getHttpServer())
      .post(`/admin/billing/tenants/${negocio.tenantId}/payments`)
      .set("Authorization", bearer(admin.token))
      .send({
        billingCycle: "monthly",
        method: "transfer",
        paidAt: new Date().toISOString(),
        planCode,
        amountReceived: PRECIO_MX[planCode],
      })
      .expect(201);
  }

  /** Un negocio que contrató y pagó ESE plan: el trial Plus no cuenta. */
  async function negocioConPlan(planCode: "basic" | "pro" | "plus") {
    const negocio = await registerTenant(app, `gates-${planCode}`);
    await setTenantMarket(prisma, negocio.tenantId, "MX");
    await contratar(negocio, planCode);
    const proveedor = await prisma.withTenantContext(negocio.tenantId, (tx) =>
      tx.supplier.create({
        data: {
          tenantId: negocio.tenantId,
          code: `PROV-${randomUUID().slice(0, 6).toUpperCase()}`,
          name: "Distribuidora Norte",
        },
      }),
    );
    return { ...negocio, proveedorId: proveedor.id };
  }

  const esCandado = (respuesta: request.Response) => {
    expect(respuesta.status).toBe(402);
    expect(respuesta.body).toMatchObject({ code: "billing.feature_not_in_plan" });
  };

  /** El alta desde el formulario con la casilla de lotes encendida. */
  const altaConLote = (token: string) =>
    api(token).post("/products", {
      sku: `LOTE-${randomUUID().slice(0, 8)}`,
      name: "Suero oral 500 ml",
      baseUnit: "unit",
      price: 25,
      tracksLots: true,
    });

  /** La planilla de importación, en dry-run: el reporte dice qué pasaría. */
  const importarEnSeco = (token: string, filas: string[]) =>
    api(token).post("/products/import", {
      content: ["sku,nombre,controla_lotes", ...filas].join("\n"),
      dryRun: true,
    });

  describe("Basic: vende y lleva gastos; no arma, no personaliza, no administra roles", () => {
    it("armar un compuesto es 402, aunque el cuerpo sea válido", async () => {
      const negocio = await negocioConPlan("basic");
      const padre = await crearProducto(app, negocio.token);
      const hijo = await crearProducto(app, negocio.token);

      esCandado(
        await api(negocio.token).post(`/products/${padre.id}/composition`, {
          lines: [{ componentId: hijo.id, quantity: 2 }],
        }),
      );
      // Leerlo sigue abierto: la historia propia siempre se ve.
      await api(negocio.token).get(`/products/${padre.id}/composition`).expect(200);
    });

    it("subcatálogos, campos propios y sus registros son 402; leer los catálogos, 200", async () => {
      const negocio = await negocioConPlan("basic");

      esCandado(await api(negocio.token).post("/catalogs", { name: "Marcas" }));
      const catalogos = (await api(negocio.token).get("/catalogs").expect(200)).body as {
        id: string;
      }[];
      const productos = catalogos[0];
      expect(productos).toBeDefined();
      esCandado(
        await api(negocio.token).post(`/catalogs/${productos?.id}/fields`, {
          label: "Color",
          fieldType: "text",
        }),
      );
      esCandado(
        await api(negocio.token).post(`/catalogs/${productos?.id}/records`, { code: "ROJO" }),
      );
    });

    it("crear o editar un rol es 402; la lista de roles del sistema sigue ahí para asignar", async () => {
      const negocio = await negocioConPlan("basic");

      esCandado(await api(negocio.token).post("/roles", { name: "Cajero nocturno" }));
      esCandado(await api(negocio.token).patch(`/roles/${randomUUID()}`, { name: "Otro" }));
      const roles = (await api(negocio.token).get("/roles").expect(200)).body as unknown[];
      expect(roles.length).toBeGreaterThan(0);
    });
  });

  describe("Pro: arma compuestos y compra con factura; no planea con órdenes", () => {
    it("el compuesto ya no es candado", async () => {
      const negocio = await negocioConPlan("pro");
      const padre = await crearProducto(app, negocio.token);
      const hijo = await crearProducto(app, negocio.token);

      await api(negocio.token)
        .post(`/products/${padre.id}/composition`, {
          lines: [{ componentId: hijo.id, quantity: 2 }],
        })
        .expect(200);
    });

    it("con el ajuste de órdenes encendido, crear una orden es 402 y leerlas 200", async () => {
      const negocio = await negocioConPlan("pro");
      await api(negocio.token).patch("/tenants/me", { usesPurchaseOrders: true }).expect(200);

      esCandado(
        await api(negocio.token).post("/purchase-orders", {
          supplierId: negocio.proveedorId,
          orderDate: "2026-09-10",
        }),
      );
      await api(negocio.token).get("/purchase-orders").expect(200);
      // Y la recepción de una orden, por el mismo pasillo.
      esCandado(await api(negocio.token).post(`/purchase-orders/${randomUUID()}/receipts`, {}));
    });

    it("la compra directa (el módulo) no es candado de plan", async () => {
      const negocio = await negocioConPlan("pro");

      const compra = await api(negocio.token).post("/purchases", {
        supplierId: negocio.proveedorId,
        invoiceDate: "2026-09-10",
      });
      expect(compra.status).not.toBe(402);
    });
  });

  describe("Plus: todo lo anterior más órdenes, catálogos y roles propios", () => {
    it("crea la orden, el subcatálogo y el rol", async () => {
      const negocio = await negocioConPlan("plus");
      await api(negocio.token).patch("/tenants/me", { usesPurchaseOrders: true }).expect(200);

      await api(negocio.token)
        .post("/purchase-orders", { supplierId: negocio.proveedorId, orderDate: "2026-09-10" })
        .expect(201);
      await api(negocio.token).post("/catalogs", { name: "Marcas" }).expect(201);
      await api(negocio.token).post("/roles", { name: "Cajero nocturno" }).expect(201);
    });
  });

  /**
   * F10-MANFIX-06 — el flag `lots` solo frenaba corregir un lote: la casilla
   * del producto se guardaba en todos los planes. El candado mira el CAMBIO:
   * encender (dar de alta con lote o pasar la casilla de apagada a encendida)
   * es de Plus; lo que ya lleva lote se sigue operando en cualquier plan.
   */
  describe("Lotes: encender el control es de Plus (F10-MANFIX-06)", () => {
    it("Pro: dar de alta con lote o encenderlo en un producto es 402; leerlo, 200", async () => {
      const negocio = await negocioConPlan("pro");

      esCandado(await altaConLote(negocio.token));

      const producto = await crearProducto(app, negocio.token);
      esCandado(await api(negocio.token).patch(`/products/${producto.id}`, { tracksLots: true }));
      const ficha = await api(negocio.token).get(`/products/${producto.id}`).expect(200);
      expect(ficha.body).toMatchObject({ tracksLots: false });
    });

    it("Pro: la planilla que enciende lotes marca la fila; la que no, pasa", async () => {
      const negocio = await negocioConPlan("pro");

      const reporte = await importarEnSeco(negocio.token, [
        "SUERO-1,Suero oral,si",
        "AGUA-1,Agua natural,no",
      ]).expect(200);

      expect(reporte.body).toMatchObject({ valid: 1, failed: 1 });
      expect((reporte.body as { errors: unknown[] }).errors).toEqual([
        expect.objectContaining({
          row: 2,
          field: "controla_lotes",
          code: "products.lots_not_in_plan",
          itemCode: "SUERO-1",
        }),
      ]);
    });

    it("Plus: dar de alta con lote y encenderlo en otro producto, 2xx", async () => {
      const negocio = await negocioConPlan("plus");

      await altaConLote(negocio.token).expect(201);
      const producto = await crearProducto(app, negocio.token);
      await api(negocio.token).patch(`/products/${producto.id}`, { tracksLots: true }).expect(200);
      const reporte = await importarEnSeco(negocio.token, ["SUERO-1,Suero oral,si"]).expect(200);
      expect(reporte.body).toMatchObject({ valid: 1, failed: 0 });
    });

    /**
     * La LEY de F9-PLANLIST: el negocio probó Plus, encendió lotes y contrató
     * Pro. Lo que ya lleva lote sigue entrando por lote y saliendo por FEFO;
     * lo que no puede es encenderlo en otro producto.
     */
    it("el Pro que bajó de Plus sigue operando sus productos con lote", async () => {
      const negocio = await registerTenant(app, "gates-downgrade");
      await setTenantMarket(prisma, negocio.tenantId, "MX");
      const conLote = (await altaConLote(negocio.token).expect(201)).body as {
        id: string;
        sku: string;
      };
      const otro = (await altaConLote(negocio.token).expect(201)).body as { id: string };
      await contratar(negocio, "pro");

      // Guardar la ficha manda la casilla tal como está: no es encender nada.
      await api(negocio.token)
        .patch(`/products/${conLote.id}`, { name: "Suero oral 1 L", tracksLots: true })
        .expect(200);

      // Una entrada con dos lotes: el que vence antes es el que sale primero.
      const almacen = await almacenInicial(prisma, negocio.tenantId);
      const entrada = (
        await api(negocio.token)
          .post("/inventory/documents", { type: "entry", warehouseId: almacen })
          .expect(201)
      ).body as { id: string };
      await api(negocio.token)
        .patch(`/inventory/documents/${entrada.id}`, {
          reasonCode: "adjustment",
          reasonNote: "Llegó el pedido",
        })
        .expect(200);
      for (const [lotCode, expiresAt] of [
        ["TARDE-01", "2027-12-31"],
        ["PRONTO-01", "2027-03-31"],
      ]) {
        await api(negocio.token)
          .post(`/inventory/documents/${entrada.id}/lines`, {
            productId: conLote.id,
            quantity: 5,
            lotCode,
            expiresAt,
          })
          .expect(201);
      }
      await api(negocio.token).post(`/inventory/documents/${entrada.id}/confirm`).expect(201);

      // La venta sale por FEFO: del lote que vence primero.
      await api(negocio.token).post("/pos/session").expect(201);
      await api(negocio.token)
        .post("/pos/sales", {
          paymentMethod: "cash",
          lines: [{ productId: conLote.id, quantity: 1 }],
        })
        .expect(201);
      const lotes = (await api(negocio.token).get(`/products/${conLote.id}/lots`).expect(200))
        .body as { lotCode: string; totalQuantity: string }[];
      const saldo = Object.fromEntries(lotes.map((l) => [l.lotCode, Number(l.totalQuantity)]));
      expect(saldo).toEqual({ "PRONTO-01": 4, "TARDE-01": 5 });

      // La planilla que conserva su lote pasa sin marca.
      const reporte = await importarEnSeco(negocio.token, [
        `${conLote.sku},Suero oral 1 L,si`,
      ]).expect(200);
      expect(reporte.body).toMatchObject({ valid: 1, failed: 0 });

      // Apagarlo se permite; volver a encenderlo ya es encender.
      await api(negocio.token).patch(`/products/${otro.id}`, { tracksLots: false }).expect(200);
      esCandado(await api(negocio.token).patch(`/products/${otro.id}`, { tracksLots: true }));
      esCandado(await altaConLote(negocio.token));
    });
  });
});
