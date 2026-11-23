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
 * F10-CASHMOV-02 — las entradas y los retiros de efectivo del turno, de punta
 * a punta: con `pos:sell` (el Cajero de fábrica también), la forma exacta del
 * contrato con el web (L5 de `odd/tasks/f10-cashmov.md`), el código de
 * autorización del negocio y su candado compartido con el descuento, y los
 * totales del turno que ya los cuentan.
 */
describe("Entradas y retiros de efectivo (F10-CASHMOV-02)", () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let negocio: TenantFixture;
  let principal: string;
  const http = () => request(app.getHttpServer());

  const FILA = [
    "id",
    "type",
    "reason",
    "amount",
    "note",
    "authorized",
    "status",
    "createdAt",
    "createdBy",
    "canceledAt",
    "canceledBy",
    "cancelReason",
  ];

  const abrir = (token: string, openingCash = 500) =>
    http()
      .post("/pos/session")
      .set("Authorization", bearer(token))
      .send({ warehouseId: principal, openingCash });
  const listar = (token: string) =>
    http().get("/pos/session/movements").set("Authorization", bearer(token));
  const registrar = (token: string, body: Record<string, unknown>) =>
    http().post("/pos/session/movements").set("Authorization", bearer(token)).send(body);
  const anular = (token: string, id: string, body: Record<string, unknown>) =>
    http()
      .post(`/pos/session/movements/${id}/cancel`)
      .set("Authorization", bearer(token))
      .send(body);
  const totales = (token: string) =>
    http().get("/pos/session/totals").set("Authorization", bearer(token));
  const mensaje = (res: { body: unknown }) => (res.body as { message: string }).message;
  const espera = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));
  const cerrarTurno = (token: string, declaredCash: number) =>
    http().post("/pos/session/close").set("Authorization", bearer(token)).send({ declaredCash });

  /** Un cajero nuevo con SOLO el rol de fábrica Seller («Cajero»): cada uno con su cuenta de intentos. */
  const cajeroNuevo = (prefijo: string) => usuarioConRol(app, negocio, "seller", prefijo);

  beforeAll(async () => {
    const moduleRef: TestingModule = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(MAILER)
      .useValue(new NoopMailer())
      .compile();
    app = moduleRef.createNestApplication<INestApplication<App>>();
    await startTestApp(app);
    prisma = app.get(PrismaService);
    negocio = await registerTenant(app, "cashmov");
    principal = await almacenInicial(prisma, negocio.tenantId);
  });

  afterAll(async () => {
    await app.close();
  });

  it("sin `pos:sell`, los tres endpoints dan 403", async () => {
    const sinPermiso = await app.get(TokenService).signAccessToken({
      sub: negocio.userId,
      tenantId: negocio.tenantId,
      permissions: ["inventory:read"],
      locale: "es",
    });

    await listar(sinPermiso).expect(403);
    await registrar(sinPermiso, { type: "in", reason: "change_fund", amount: 10 }).expect(403);
    await anular(sinPermiso, randomUUID(), { reason: "Nada" }).expect(403);
  });

  it("sin turno abierto, la lista viene vacía y registrar da 409", async () => {
    const cajero = await cajeroNuevo("cashmov-sin-turno");

    expect((await listar(cajero).expect(200)).body).toEqual({ movements: [] });
    const res = await registrar(cajero, { type: "in", reason: "change_fund", amount: 10 }).expect(
      409,
    );
    expect(mensaje(res)).toBe("Abre un turno antes de vender.");
  });

  it("el Cajero de fábrica registra, lista y anula, con la forma del contrato, y los totales lo cuentan", async () => {
    const cajero = await cajeroNuevo("cashmov-cajero");
    await abrir(cajero).expect(201);

    const alta = await registrar(cajero, { type: "out", reason: "safe", amount: 200 }).expect(201);
    const fila = alta.body as Record<string, unknown> & { id: string };
    expect(Object.keys(fila)).toEqual(FILA);
    expect(fila).toEqual({
      id: expect.any(String),
      type: "out",
      reason: "safe",
      amount: "200",
      note: null,
      authorized: false,
      status: "active",
      createdAt: expect.any(String),
      createdBy: { id: expect.any(String), name: "Vera Vista" },
      canceledAt: null,
      canceledBy: null,
      cancelReason: null,
    });

    const lista = await listar(cajero).expect(200);
    expect(lista.body).toEqual({ movements: [fila] });
    expect((await totales(cajero).expect(200)).body).toMatchObject({
      expectedCash: "300",
      cashIn: "0",
      cashOut: "200",
    });

    const baja = await anular(cajero, fila.id, { reason: "Se capturó dos veces" }).expect(200);
    expect(Object.keys(baja.body as object)).toEqual(FILA);
    expect(baja.body).toMatchObject({
      id: fila.id,
      status: "canceled",
      canceledAt: expect.any(String),
      // Quien anula es la misma cajera que lo registró.
      canceledBy: fila.createdBy,
      cancelReason: "Se capturó dos veces",
    });
    expect((await totales(cajero).expect(200)).body).toMatchObject({
      expectedCash: "500",
      cashOut: "0",
    });
  });

  it("la lista va del más nuevo al más viejo", async () => {
    const cajero = await cajeroNuevo("cashmov-orden");
    await abrir(cajero).expect(201);
    const a = await registrar(cajero, { type: "in", reason: "change_fund", amount: 1 }).expect(201);
    const b = await registrar(cajero, { type: "out", reason: "owner", amount: 2 }).expect(201);

    const { movements } = (await listar(cajero).expect(200)).body as {
      movements: { id: string }[];
    };

    expect(movements.map((m) => m.id)).toEqual([
      (b.body as { id: string }).id,
      (a.body as { id: string }).id,
    ]);
  });

  it("un motivo cruzado, «Otro» sin nota o un importe con tres decimales: 400 con su mensaje", async () => {
    const cajero = await cajeroNuevo("cashmov-dto");
    await abrir(cajero).expect(201);

    const cruzado = await registrar(cajero, { type: "in", reason: "safe", amount: 10 }).expect(400);
    expect(mensaje(cruzado)).toBe("Ese motivo no corresponde al tipo de movimiento.");
    const sinNota = await registrar(cajero, { type: "out", reason: "other", amount: 10 }).expect(
      400,
    );
    expect(mensaje(sinNota)).toBe("Con el motivo «Otro», escribe una nota.");
    const centavos = await registrar(cajero, {
      type: "out",
      reason: "safe",
      amount: 10.005,
    }).expect(400);
    expect(mensaje(centavos)).toBe("El importe debe ser mayor que cero, con hasta 2 decimales.");
    const sinMotivo = await anular(cajero, randomUUID(), { reason: "  " }).expect(400);
    expect(mensaje(sinMotivo)).toBe("Explica por qué se anula el movimiento.");
  });

  it("un retiro mayor que lo que hay en el cajón: 422 y dice cuánto hay", async () => {
    const cajero = await cajeroNuevo("cashmov-tope");
    await abrir(cajero, 300).expect(201);

    const res = await registrar(cajero, { type: "out", reason: "safe", amount: 300.01 }).expect(
      422,
    );

    expect(mensaje(res)).toBe("El efectivo del cajón no puede quedar debajo de cero: hay $300.00.");
  });

  /**
   * F10-PEND-01 — la carrera de verdad, por HTTP: un retiro y el cierre a la
   * vez, con unos milisegundos de desfase. En la base, el cierre quedaba ANTES
   * del retiro que contó en 8 de 40 rondas (verificador de F10-PEND).
   */
  it("un retiro que gana la fila queda antes de la hora del cierre que lo cuenta (carrera real)", async () => {
    const cajero = await cajeroNuevo("cashmov-cierre-carrera");
    for (let i = 0; i < 30; i += 1) {
      await abrir(cajero, 500).expect(201);
      const [mov, cierre] = await Promise.all([
        registrar(cajero, { type: "out", reason: "safe", amount: 40 }),
        espera((i % 8) * 2).then(() => cerrarTurno(cajero, 460)),
      ]);
      expect(cierre.status).toBe(200);
      if (mov.status === 201) {
        expect(cierre.body).toMatchObject({ cashOut: "40", expectedCash: "460" });
        expect(new Date(cierre.body.session.closedAt).getTime()).toBeGreaterThanOrEqual(
          new Date(mov.body.createdAt).getTime(),
        );
      } else {
        expect(mov.status).toBe(409);
        expect(cierre.body).toMatchObject({ cashOut: "0", expectedCash: "500" });
      }
    }
  });

  /**
   * F10-PEND-08 — el cobro revisaba el turno ANTES de abrir su transacción y
   * guardaba la venta sin volver a mirarlo: un cobro que coincidía con el
   * cierre del mismo turno quedaba en un turno cerrado cuyo esperado no lo
   * contaba (el verificador de F10-PEND lo midió en 14 de 40 rondas).
   */
  describe("el cobro y el cierre del mismo turno", () => {
    const cobrar = (cajero: string, productId: string) =>
      http()
        .post("/pos/sales")
        .set("Authorization", bearer(cajero))
        .send({ paymentMethod: "cash", lines: [{ productId, quantity: 1 }] });
    const ventasDelTurno = (sessionId: string) =>
      prisma.withTenantContext(negocio.tenantId, (tx) =>
        tx.sale.count({ where: { cashboxSessionId: sessionId } }),
      );

    it("un cobro que llega mientras el cierre tiene la fila lo espera y rebota con 409", async () => {
      const cajero = await cajeroNuevo("cashmov-cobro-cierre");
      const turno = (await abrir(cajero, 100).expect(201)).body as { id: string; openedBy: string };
      const producto = await crearProducto(app, negocio.token, 300);
      await cargarStock(app, negocio.token, principal, producto.id, 1);

      // El cierre: aparta el turno y se queda con la fila hasta que se suelte.
      let soltar = () => {};
      const suelta = new Promise<void>((resolve) => {
        soltar = resolve;
      });
      let avisarCerrado = () => {};
      const cerrado = new Promise<void>((resolve) => {
        avisarCerrado = resolve;
      });
      const cierre = prisma.withTenantContext(negocio.tenantId, async (tx) => {
        await tx.$executeRaw`
          UPDATE cashbox_sessions
             SET status = 'closed', closed_by = ${turno.openedBy}::uuid, closed_at = now()
           WHERE id = ${turno.id}::uuid`;
        avisarCerrado();
        await suelta;
      });
      await cerrado;

      let llego = false;
      const cobro = cobrar(cajero, producto.id).then((res) => {
        llego = true;
        return res;
      });
      await espera(400);
      // Mientras el cierre tiene la fila, el cobro espera: no se guarda en un turno que se cierra.
      expect(llego).toBe(false);
      soltar();
      await cierre;
      const res = await cobro;

      expect(res.status).toBe(409);
      expect(mensaje(res)).toBe("Abre un turno antes de vender.");
      expect(await ventasDelTurno(turno.id)).toBe(0);
    });

    it("cobrar y cerrar a la vez: el cierre cuenta la venta o la venta rebota (carrera real)", async () => {
      const cajero = await cajeroNuevo("cashmov-cobro-carrera");
      const producto = await crearProducto(app, negocio.token, 300);
      await cargarStock(app, negocio.token, principal, producto.id, 20);
      for (let i = 0; i < 20; i += 1) {
        const turno = (await abrir(cajero, 0).expect(201)).body as { id: string };
        const [venta, cierre] = await Promise.all([
          cobrar(cajero, producto.id),
          espera((i % 8) * 2).then(() => cerrarTurno(cajero, 0)),
        ]);
        expect(cierre.status).toBe(200);
        if (venta.status === 201) {
          expect(cierre.body).toMatchObject({ expectedCash: "300" });
          expect(await ventasDelTurno(turno.id)).toBe(1);
        } else {
          expect(venta.status).toBe(409);
          expect(cierre.body).toMatchObject({ expectedCash: "0" });
          expect(await ventasDelTurno(turno.id)).toBe(0);
        }
      }
    });
  });

  /**
   * F10-PEND-03 — la regla del retiro se revisaba solo al retirar: cancelar
   * después una venta en efectivo del turno dejaba el esperado debajo de cero.
   * Ahora la cancelación también la revisa, con la fila del turno tomada.
   */
  describe("cancelar una venta en efectivo revisa el cajón del turno", () => {
    const vender = async (cajero: string, paymentMethod: "cash" | "card") => {
      const producto = await crearProducto(app, negocio.token, 300);
      await cargarStock(app, negocio.token, principal, producto.id, 1);
      const venta = await http()
        .post("/pos/sales")
        .set("Authorization", bearer(cajero))
        .send({ paymentMethod, lines: [{ productId: producto.id, quantity: 1 }] })
        .expect(201);
      return venta.body as { id: string; total: string };
    };
    const cancelarVenta = (id: string) =>
      http()
        .post(`/pos/sales/${id}/cancel`)
        .set("Authorization", bearer(negocio.token))
        .send({ reason: "Cobro duplicado" });
    const esperado = async (cajero: string) =>
      Number((await totales(cajero).expect(200)).body.expectedCash);

    it("si no alcanza, 422 y la venta sigue cobrada; con una entrada antes, se cancela", async () => {
      const cajero = await cajeroNuevo("cashmov-cancela-venta");
      await abrir(cajero, 100).expect(201);
      const venta = await vender(cajero, "cash");
      expect(Number(venta.total)).toBe(300);
      // Fondo 100 + venta 300 = 400; a la caja fuerte se van 350: quedan 50.
      await registrar(cajero, { type: "out", reason: "safe", amount: 350 }).expect(201);

      const rebota = await cancelarVenta(venta.id).expect(422);

      expect(mensaje(rebota)).toBe(
        "El cajón del turno no alcanza para devolver $300.00 en efectivo: hay $50.00. Quien tiene el turno debe registrar primero una entrada de efectivo.",
      );
      expect(await esperado(cajero)).toBe(50);
      const fila = await prisma.withTenantContext(negocio.tenantId, (tx) =>
        tx.sale.findUniqueOrThrow({ where: { id: venta.id }, select: { status: true } }),
      );
      expect(fila.status).toBe("completed");

      await registrar(cajero, { type: "in", reason: "change_fund", amount: 250 }).expect(201);
      await cancelarVenta(venta.id).expect(200);
      expect(await esperado(cajero)).toBe(0);
    });

    // En la base, 25 de 40 rondas dejaban el cajón en negativo (verificador de F10-PEND).
    it("cancelar y retirar a la vez nunca dejan el cajón debajo de cero", async () => {
      const cajero = await cajeroNuevo("cashmov-cancela-carrera");
      for (let i = 0; i < 16; i += 1) {
        await abrir(cajero, 0).expect(201);
        const venta = await vender(cajero, "cash");
        const desfase = (i % 8) * 2;
        const [cancelada, retiro] = await Promise.all([
          espera(i % 2 === 0 ? desfase : 0).then(() => cancelarVenta(venta.id)),
          espera(i % 2 === 1 ? desfase : 0).then(() =>
            registrar(cajero, { type: "out", reason: "safe", amount: 200 }),
          ),
        ]);
        expect([cancelada.status, retiro.status].sort()).toEqual(
          cancelada.status === 200 ? [200, 422] : [201, 422],
        );
        expect(await esperado(cajero)).toBeGreaterThanOrEqual(0);
        await cerrarTurno(cajero, 0).expect(200);
      }
    });

    it("una venta con tarjeta, o de un turno ya cerrado, se cancela como siempre", async () => {
      const cajero = await cajeroNuevo("cashmov-cancela-otras");
      await abrir(cajero, 0).expect(201);
      const conTarjeta = await vender(cajero, "card");
      const enEfectivo = await vender(cajero, "cash");
      await registrar(cajero, { type: "out", reason: "safe", amount: 300 }).expect(201);

      await cancelarVenta(conTarjeta.id).expect(200);
      expect(await esperado(cajero)).toBe(0);

      await http()
        .post("/pos/session/close")
        .set("Authorization", bearer(cajero))
        .send({ declaredCash: 0 })
        .expect(200);
      await cancelarVenta(enEfectivo.id).expect(200);
    });
  });

  /**
   * ⚠ El orden importa en este bloque: el código se define una vez y se queda.
   * Cada caso usa un cajero nuevo, porque la cuenta de intentos es por persona.
   */
  describe("con el código de autorización del negocio", () => {
    beforeAll(async () => {
      await http()
        .patch("/tenants/me")
        .set("Authorization", bearer(negocio.token))
        .send({ discountCode: "1234" })
        .expect(200);
    });

    it("un retiro sin código da 422; con el bueno pasa autorizado", async () => {
      const cajero = await cajeroNuevo("cashmov-codigo");
      await abrir(cajero).expect(201);

      const sinCodigo = await registrar(cajero, { type: "out", reason: "safe", amount: 10 }).expect(
        422,
      );
      expect(mensaje(sinCodigo)).toBe(
        "Este movimiento pide el código de autorización del negocio.",
      );
      const bueno = await registrar(cajero, {
        type: "out",
        reason: "safe",
        amount: 10,
        code: "1234",
      }).expect(201);
      expect(bueno.body).toMatchObject({ authorized: true });
    });

    it("cinco códigos malos en retiros cierran el candado, también para el descuento", async () => {
      const cajero = await cajeroNuevo("cashmov-candado");
      await abrir(cajero).expect(201);
      const producto = await crearProducto(app, negocio.token, 100);

      for (let i = 0; i < 5; i += 1) {
        const malo = await registrar(cajero, {
          type: "out",
          reason: "safe",
          amount: 10,
          code: "0000",
        }).expect(403);
        expect(mensaje(malo)).toBe("El código de autorización no es correcto.");
      }

      // El descuento comparte la cuenta: el sexto intento, aunque sea el bueno, es 429.
      const descuento = await http()
        .post("/pos/sales")
        .set("Authorization", bearer(cajero))
        .send({
          paymentMethod: "cash",
          lines: [{ productId: producto.id, quantity: 1 }],
          discount: { amount: 5, code: "1234" },
        })
        .expect(429);
      expect(mensaje(descuento)).toBe(
        "Demasiados intentos con el código de autorización. Espera 15 minutos.",
      );
      await registrar(cajero, { type: "out", reason: "safe", amount: 10, code: "1234" }).expect(
        429,
      );
    });

    it("anular una entrada pide el código; anular un retiro no", async () => {
      const cajero = await cajeroNuevo("cashmov-anular");
      await abrir(cajero).expect(201);
      const entrada = await registrar(cajero, {
        type: "in",
        reason: "change_fund",
        amount: 50,
      }).expect(201);
      expect(entrada.body).toMatchObject({ authorized: false });
      const retiro = await registrar(cajero, {
        type: "out",
        reason: "bank_deposit",
        amount: 20,
        code: "1234",
      }).expect(201);

      await anular(cajero, (entrada.body as { id: string }).id, { reason: "Duplicada" }).expect(
        422,
      );
      await anular(cajero, (entrada.body as { id: string }).id, {
        reason: "Duplicada",
        code: "1234",
      }).expect(200);
      await anular(cajero, (retiro.body as { id: string }).id, { reason: "No se hizo" }).expect(
        200,
      );
    });

    /**
     * F10-PEND-02 — un código mal escrito rebotaba aunque el movimiento no lo
     * pidiera. Ahora su forma se revisa solo donde se pide, y sin gastar un
     * intento, como antes.
     */
    it("un código mal escrito solo rebota donde se pide, y no gasta intentos", async () => {
      const cajero = await cajeroNuevo("cashmov-codigo-malformado");
      await abrir(cajero).expect(201);

      const entrada = await registrar(cajero, {
        type: "in",
        reason: "change_fund",
        amount: 50,
        code: "12ab",
      }).expect(201);
      expect(entrada.body).toMatchObject({ authorized: false });

      for (let i = 0; i < 5; i += 1) {
        const malo = await registrar(cajero, {
          type: "out",
          reason: "safe",
          amount: 10,
          code: "12ab",
        }).expect(400);
        expect(mensaje(malo)).toBe("El código de autorización no es correcto.");
        expect(malo.body).toMatchObject({
          errors: [{ key: "code", message: "El código de autorización no es correcto." }],
        });
      }
      // Cinco mal escritos no cierran el candado: el bueno pasa.
      const retiro = await registrar(cajero, {
        type: "out",
        reason: "safe",
        amount: 10,
        code: "1234",
      }).expect(201);

      await anular(cajero, (retiro.body as { id: string }).id, {
        reason: "No se hizo",
        code: "12ab",
      }).expect(200);
    });
  });
});
