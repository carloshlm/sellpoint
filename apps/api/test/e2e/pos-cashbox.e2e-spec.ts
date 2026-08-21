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
});
