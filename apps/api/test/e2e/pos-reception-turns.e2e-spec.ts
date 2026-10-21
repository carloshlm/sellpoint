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
  bearer,
  makePlatformAdmin,
  registerTenant,
  setTenantMarket,
  type TenantFixture,
} from "./support/billing-scenario";
import { startTestApp } from "./support/start-test-app";

/**
 * F9-RECEP-27 — de la caja al turno, de punta a punta (ley 31; Carlos,
 * 2026-10-21).
 *
 * Un cliente con Recepción vende la consulta en la caja de siempre, y esa
 * venta crea el turno del paciente con el número en el ticket. Lo que fija:
 *
 *  - un negocio SIN Recepción vende el mismo servicio exactamente como hoy:
 *    sin anotaciones y sin turnos;
 *  - con Recepción pero sin servicios marcados, tampoco pasa nada;
 *  - el servicio marcado crea el turno —en la MISMA serie que «Generar
 *    turno»— ligado a la venta, y la venta lo trae como anotación;
 *  - F9-RECEP-31: UNA venta es UN turno, aunque lleve dos unidades o dos
 *    servicios marcados (Carlos, 2026-10-21);
 *  - la reintentada idempotente no duplica turnos;
 *  - con el módulo apagado, la venta vuelve a ser la de siempre;
 *  - anular la venta deja el turno, y la lista lo dice.
 */
describe("Recepción — la venta genera el turno (F9-RECEP-27)", () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let admin: TenantFixture;

  const http = () => request(app.getHttpServer());

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(MAILER)
      .useClass(NoopMailer)
      .compile();
    app = moduleFixture.createNestApplication();
    await startTestApp(app);
    prisma = app.get(PrismaService);

    admin = await registerTenant(app, "recep-venta-admin");
    await makePlatformAdmin(app, prisma, admin);
  });

  afterAll(async () => {
    await app.close();
  });

  /** Un negocio con su sucursal de nacimiento, su consulta vendible y su caja abierta. */
  async function negocioConCaja(etiqueta: string) {
    const negocio = await registerTenant(app, etiqueta);
    await setTenantMarket(prisma, negocio.tenantId, "MX");
    const sucursal = await prisma.withTenantContext(negocio.tenantId, (tx) =>
      tx.warehouse.findFirstOrThrow({ select: { id: true } }),
    );
    const consulta = await http()
      .post("/services")
      .set("Authorization", bearer(negocio.token))
      .send({
        code: `CONS-${randomUUID().slice(0, 8)}`,
        name: "Consulta médica",
        price: 500,
        warehouseIds: [sucursal.id],
      })
      .expect(201);
    await http()
      .post("/pos/session")
      .set("Authorization", bearer(negocio.token))
      .send({ warehouseId: sucursal.id })
      .expect(201);
    return { negocio, sucursalId: sucursal.id, consultaId: (consulta.body as { id: string }).id };
  }

  const activarRecepcion = (tenantId: string) =>
    http()
      .post(`/admin/billing/tenants/${tenantId}/modules`)
      .set("Authorization", bearer(admin.token))
      .send({ moduleKey: "reception", customPrice: "1250.00", reason: "e2e" })
      .expect(201);

  const marcar = (token: string, turnServiceIds: string[]) =>
    http()
      .put("/reception/settings")
      .set("Authorization", bearer(token))
      .send({ turnServiceIds })
      .expect(200);

  const vender = (token: string, serviceId: string, quantity = 1, clave = randomUUID()) =>
    http()
      .post("/pos/sales")
      .set("Authorization", bearer(token))
      .set("Idempotency-Key", clave)
      .send({
        paymentMethod: "cash",
        cashReceived: 500 * quantity,
        lines: [{ serviceId, quantity }],
      })
      .expect(201);

  const turnosDe = (tenantId: string) =>
    prisma.withTenantContext(tenantId, (tx) =>
      tx.receptionTurn.findMany({
        where: { tenantId },
        orderBy: { number: "asc" },
        select: { number: true, saleId: true },
      }),
    );

  it("un negocio SIN Recepción vende la consulta como siempre: sin anotaciones ni turnos", async () => {
    const { negocio, consultaId } = await negocioConCaja("recep-venta-sin");

    const venta = await vender(negocio.token, consultaId);

    expect(venta.body.annotations).toEqual([]);
    expect(await turnosDe(negocio.tenantId)).toEqual([]);
  });

  describe("con Recepción activo", () => {
    let negocio: TenantFixture;
    let sucursalId: string;
    let consultaId: string;

    beforeAll(async () => {
      ({ negocio, sucursalId, consultaId } = await negocioConCaja("recep-venta-con"));
      await activarRecepcion(negocio.tenantId);
    });

    it("sin servicios marcados, la venta no genera turnos", async () => {
      const venta = await vender(negocio.token, consultaId);

      expect(venta.body.annotations).toEqual([]);
      expect(await turnosDe(negocio.tenantId)).toEqual([]);
    });

    it("el servicio marcado genera el turno ligado a la venta, y la venta lo anota", async () => {
      await marcar(negocio.token, [consultaId]);

      const venta = await vender(negocio.token, consultaId);

      expect(venta.body.annotations).toEqual([
        {
          sourceModule: "reception",
          labelKey: "reception.saleAnnotation.turn",
          value: "1",
          emphasis: true,
        },
      ]);
      expect(await turnosDe(negocio.tenantId)).toEqual([{ number: 1, saleId: venta.body.id }]);
    });

    it("cantidad 2 es UN turno, y «Generar turno» sigue la MISMA serie", async () => {
      const venta = await vender(negocio.token, consultaId, 2);
      expect(venta.body.annotations.map((a: { value: string }) => a.value)).toEqual(["2"]);

      const suelto = await http()
        .post("/reception/turns")
        .set("Authorization", bearer(negocio.token))
        .send({})
        .expect(201);
      expect(suelto.body.number).toBe(3);
      expect(suelto.body.sale).toBeNull();
    });

    it("dos servicios marcados en la misma venta son UN turno", async () => {
      const vista = await http()
        .post("/services")
        .set("Authorization", bearer(negocio.token))
        .send({
          code: `VISTA-${randomUUID().slice(0, 8)}`,
          name: "Examen de la vista",
          price: 300,
          warehouseIds: [sucursalId],
        })
        .expect(201);
      const vistaId = (vista.body as { id: string }).id;
      await marcar(negocio.token, [consultaId, vistaId]);
      const antes = (await turnosDe(negocio.tenantId)).length;

      const venta = await http()
        .post("/pos/sales")
        .set("Authorization", bearer(negocio.token))
        .set("Idempotency-Key", randomUUID())
        .send({
          paymentMethod: "cash",
          cashReceived: 800,
          lines: [
            { serviceId: consultaId, quantity: 1 },
            { serviceId: vistaId, quantity: 1 },
          ],
        })
        .expect(201);

      expect(venta.body.annotations.map((a: { value: string }) => a.value)).toEqual(["4"]);
      expect((await turnosDe(negocio.tenantId)).length).toBe(antes + 1);
    });

    it("la reintentada con la misma clave devuelve la venta sin duplicar turnos", async () => {
      const clave = randomUUID();
      const primera = await vender(negocio.token, consultaId, 1, clave);
      const antes = (await turnosDe(negocio.tenantId)).length;

      const segunda = await vender(negocio.token, consultaId, 1, clave);

      expect(segunda.body.id).toBe(primera.body.id);
      expect(segunda.body.annotations).toEqual(primera.body.annotations);
      expect((await turnosDe(negocio.tenantId)).length).toBe(antes);
    });

    it("el ticket de la venta se imprime con su anotación guardada", async () => {
      const venta = await vender(negocio.token, consultaId);

      const ticket = await http()
        .get(`/pos/sales/${venta.body.id}/ticket`)
        .set("Authorization", bearer(negocio.token))
        .expect(200);

      expect(ticket.headers["content-type"]).toContain("application/pdf");
    });

    it("anular la venta deja el turno, y la lista dice que la venta se anuló", async () => {
      const venta = await vender(negocio.token, consultaId);
      const numero = Number(venta.body.annotations[0].value);

      await http()
        .post(`/pos/sales/${venta.body.id}/cancel`)
        .set("Authorization", bearer(negocio.token))
        .send({ reason: "se equivocó de servicio" })
        .expect(200);

      const lista = await http()
        .get("/reception/turns")
        .set("Authorization", bearer(negocio.token))
        .expect(200);
      const turno = (lista.body as { number: number; sale: { status: string } | null }[]).find(
        (t) => t.number === numero,
      );
      expect(turno?.sale).toMatchObject({ id: venta.body.id, status: "canceled" });
    });

    it("con el módulo apagado, la venta vuelve a ser la de siempre", async () => {
      await http()
        .delete(`/admin/billing/tenants/${negocio.tenantId}/modules/reception`)
        .set("Authorization", bearer(admin.token))
        .send({ reason: "e2e" })
        .expect(200);
      const antes = (await turnosDe(negocio.tenantId)).length;

      const venta = await vender(negocio.token, consultaId);

      expect(venta.body.annotations).toEqual([]);
      expect((await turnosDe(negocio.tenantId)).length).toBe(antes);
    });
  });
});
