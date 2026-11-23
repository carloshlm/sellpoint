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
  });
});
