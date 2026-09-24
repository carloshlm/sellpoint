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
  cargarStock,
  crearProducto,
  registerTenant,
  setTenantMarket,
  type TenantFixture,
} from "./support/billing-scenario";
import { textoDelPdf } from "./support/pdf-text";
import { startTestApp } from "./support/start-test-app";

/**
 * Lo que dice el papel que el cliente se lleva, leído del PDF que baja el
 * mostrador: el renderer lo prueba sobre la definición; esto prueba que el
 * servicio le pasa los datos correctos del negocio y de la venta.
 */
describe("El papel del ticket", () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let negocio: TenantFixture;
  let productoId: string;

  const post = (url: string, body: object = {}) =>
    request(app.getHttpServer()).post(url).set("Authorization", bearer(negocio.token)).send(body);

  /** El texto del papel en 80 mm: cada renglón del encabezado cabe entero. */
  const papel = async (ruta: string): Promise<string> => {
    const res = await request(app.getHttpServer())
      .get(ruta)
      .query({ width: "80mm" })
      .set("Authorization", bearer(negocio.token))
      .expect(200);
    return textoDelPdf(res.body as Buffer);
  };

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(MAILER)
      .useClass(NoopMailer)
      .compile();
    app = moduleFixture.createNestApplication();
    await startTestApp(app);
    prisma = app.get(PrismaService);

    // El negocio del manual: una persona física con nombre comercial.
    negocio = await registerTenant(app, "ticket-paper");
    await setTenantMarket(prisma, negocio.tenantId, "MX");
    await prisma.tenant.update({
      where: { id: negocio.tenantId },
      data: {
        name: "Abarrotes La Esquina",
        legalName: "Ana Pérez",
        taxId: "PEAA850315AB3",
        timezone: "America/Mexico_City",
      },
    });
    const almacen = await almacenInicial(prisma, negocio.tenantId);
    productoId = (await crearProducto(app, negocio.token, 14)).id;
    await cargarStock(app, negocio.token, almacen, productoId, 100);
    await post("/pos/session", { warehouseId: almacen }).expect(201);
  });

  afterAll(async () => {
    await app.close();
  });

  /**
   * F10-MANFIX-14 — arriba, el nombre que el cliente conoce; el nombre legal,
   * junto al RFC. Antes el encabezado era `legalName ?? name` y el ticket de
   * «Abarrotes La Esquina» decía «Ana Pérez».
   */
  describe("el nombre del negocio (F10-MANFIX-14)", () => {
    const encabezadoEsperado = (texto: string) => {
      // Sin logotipo, el papel EMPIEZA por el nombre del negocio…
      expect(texto.startsWith("Abarrotes La Esquina")).toBe(true);
      // …y el nombre legal aparece por primera vez en el renglón del RFC. (Más
      // abajo vuelve a salir, pero como quien atendió: la dueña es Ana Pérez.)
      const fiscalEn = texto.indexOf("Ana Pérez · RFC: PEAA850315AB3");
      expect(fiscalEn).toBeGreaterThan(0);
      expect(texto.indexOf("Ana Pérez")).toBe(fiscalEn);
    };

    it("el ticket de venta dice el negocio arriba y el nombre legal junto al RFC", async () => {
      const venta = await post("/pos/sales", {
        paymentMethod: "card",
        lines: [{ productId: productoId, quantity: 1 }],
      }).expect(201);

      encabezadoEsperado(await papel(`/pos/sales/${(venta.body as { id: string }).id}/ticket`));
    });

    it("la cotización lleva el mismo encabezado", async () => {
      const cotizacion = await post("/pos/quotes", {
        lines: [{ productId: productoId, quantity: 2 }],
      }).expect(201);

      encabezadoEsperado(
        await papel(`/pos/quotes/${(cotizacion.body as { id: string }).id}/ticket`),
      );
    });
  });

  /**
   * F10-MANFIX-15 — el renderer y las traducciones ya traían Recibido y
   * Cambio, pero el servicio los mandaba en null: la venta no guardaba con
   * cuánto pagó el cliente. Ahora lo guarda, así que el papel los imprime al
   * cobrar Y al reimprimir desde el historial, que es el mismo PDF leído de
   * la base.
   */
  describe("Recibido y Cambio (F10-MANFIX-15)", () => {
    it("la venta en efectivo imprime lo recibido y el cambio, también al reimprimir", async () => {
      // 3 aguas de $14 = $42, pagadas con un billete de $50.
      const venta = await post("/pos/sales", {
        paymentMethod: "cash",
        lines: [{ productId: productoId, quantity: 3 }],
        cashReceived: 50,
      }).expect(201);
      const ruta = `/pos/sales/${(venta.body as { id: string }).id}/ticket`;

      const alCobrar = await papel(ruta);
      expect(alCobrar).toMatch(/Recibido\s*\$50\.00/);
      expect(alCobrar).toMatch(/Cambio\s*\$8\.00/);

      // Otra venta después, y la reimpresión dice lo mismo que el papel original.
      await post("/pos/sales", {
        paymentMethod: "card",
        lines: [{ productId: productoId, quantity: 1 }],
      }).expect(201);
      expect(await papel(ruta)).toBe(alCobrar);
    });

    it("con tarjeta, o en efectivo sin lo recibido, el papel no inventa esas líneas", async () => {
      const tarjeta = await post("/pos/sales", {
        paymentMethod: "card",
        lines: [{ productId: productoId, quantity: 1 }],
      }).expect(201);
      const sinDato = await post("/pos/sales", {
        paymentMethod: "cash",
        lines: [{ productId: productoId, quantity: 1 }],
      }).expect(201);

      for (const venta of [tarjeta, sinDato]) {
        const texto = await papel(`/pos/sales/${(venta.body as { id: string }).id}/ticket`);
        expect(texto).not.toContain("Recibido");
        expect(texto).not.toContain("Cambio");
      }
    });
  });
});
