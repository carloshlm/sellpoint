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
  type TenantFixture,
} from "./support/billing-scenario";
import { usuarioConRol } from "./support/medical-clinic-scenario";
import { startTestApp } from "./support/start-test-app";

/**
 * Quién puede sacar el ticket de una venta (Carlos, 2026-10-31).
 *
 * En la farmacia, el Administrador dejó al Encargado con «Vender en caja» pero
 * sin «Ver historial de ventas»: cobraba, y el ticket respondía 403. Ahora
 * quien cobra siempre puede imprimir el ticket de la venta que cobró él; el de
 * las ventas de otros sigue pidiendo «Ver historial de ventas».
 */
describe("El ticket de la venta: quién lo puede sacar", () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let negocio: TenantFixture;
  let almacen: string;
  let productoId: string;

  const como = (token: string) => ({
    post: (url: string, body: object = {}) =>
      request(app.getHttpServer()).post(url).set("Authorization", bearer(token)).send(body),
    ticket: (ventaId: string) =>
      request(app.getHttpServer())
        .get(`/pos/sales/${ventaId}/ticket`)
        .query({ width: "80mm" })
        .set("Authorization", bearer(token)),
  });

  /** Le quita un permiso a un rol de fábrica del negocio, como lo haría su Administrador. */
  async function quitarPermiso(systemKey: string, code: string) {
    await prisma.withTenantContext(negocio.tenantId, (tx) =>
      tx.rolePermission.deleteMany({
        where: { role: { tenantId: negocio.tenantId, systemKey }, permission: { code } },
      }),
    );
  }

  /** Abre su turno de caja (una vez por persona) y cobra una pieza; devuelve el id de la venta. */
  const conTurno = new Set<string>();
  async function cobrarComo(token: string): Promise<string> {
    if (!conTurno.has(token)) {
      await como(token).post("/pos/session", { warehouseId: almacen }).expect(201);
      conTurno.add(token);
    }
    const venta = await como(token)
      .post("/pos/sales", {
        paymentMethod: "cash",
        lines: [{ productId: productoId, quantity: 1 }],
      })
      .expect(201);
    return (venta.body as { id: string }).id;
  }

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(MAILER)
      .useClass(NoopMailer)
      .compile();
    app = moduleFixture.createNestApplication();
    await startTestApp(app);
    prisma = app.get(PrismaService);

    negocio = await registerTenant(app, "ticket-permiso");
    almacen = await almacenInicial(prisma, negocio.tenantId);
    productoId = (await crearProducto(app, negocio.token, 14)).id;
    await cargarStock(app, negocio.token, almacen, productoId, 100);
  });

  afterAll(async () => {
    await app.close();
  });

  it("quien cobra sin «Ver historial de ventas» imprime el ticket de SU venta, y no el de otra", async () => {
    await quitarPermiso("seller", "pos:view");
    const cajero = await usuarioConRol(app, negocio, "seller", "ticket-sin-historial");
    const ventaDelDueno = await cobrarComo(negocio.token);

    const suya = await cobrarComo(cajero);
    const papel = await como(cajero).ticket(suya).expect(200);
    expect(papel.headers["content-type"]).toBe("application/pdf");
    expect((papel.body as Buffer).subarray(0, 5).toString()).toBe("%PDF-");

    const ajena = await como(cajero).ticket(ventaDelDueno).expect(403);
    expect(ajena.body).toMatchObject({ code: "auth.forbidden" });
  });

  it("con «Ver historial de ventas» se saca el ticket de cualquier venta, aunque no cobre", async () => {
    const ventaDelDueno = await cobrarComo(negocio.token);
    const auditor = await usuarioConRol(app, negocio, "viewer", "ticket-auditor");

    await como(auditor).ticket(ventaDelDueno).expect(200);
  });

  it("sin ninguno de los dos permisos, el ticket sigue cerrado", async () => {
    const ventaDelDueno = await cobrarComo(negocio.token);
    await quitarPermiso("viewer", "pos:view");
    const sinPermiso = await usuarioConRol(app, negocio, "viewer", "ticket-sin-nada");

    const res = await como(sinPermiso).ticket(ventaDelDueno).expect(403);
    expect(res.body).toMatchObject({ code: "auth.forbidden" });
  });
});
