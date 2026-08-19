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
 * F3-TRANSFER-01 — el listado de traspasos.
 *
 * **Lo que esta pantalla resuelve es una pregunta de responsabilidad**: qué
 * salió de mi almacén y todavía no llegó, y qué viene hacia mí y no confirmé.
 * Por eso `direction` no es un filtro cosmético — define de qué lado del
 * problema está parado quien mira, y sale del ALCANCE del usuario, no de un
 * parámetro que el cliente pueda mentir.
 *
 * El traspaso NO tiene folio propio: el suyo es el de su documento de
 * despacho, un `SAL-…`.
 */
describe("Listado de traspasos (F3-TRANSFER-01)", () => {
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
    const email = `owner-${randomUUID()}@example.com`;
    const registered = await request(app.getHttpServer())
      .post("/auth/register-tenant")
      .send({
        tenantName: `Tenant tr ${randomUUID()}`,
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

    return {
      token: (login.body as { accessToken: string }).accessToken,
      tenantId: (registered.body as { tenantId: string }).tenantId,
    };
  }

  /**
   * Monta un traspaso por el camino REAL: entrada para cargar stock, salida
   * con motivo traspaso, confirmar. Insertar las filas a mano probaría el
   * listado contra datos que el sistema nunca produciría.
   */
  async function escenario() {
    const { token, tenantId } = await registerAndLogin();

    const { productId, central, norte, sur } = await prisma.withTenantContext(
      tenantId,
      async (tx) => {
        const product = await tx.product.create({
          data: { tenantId, sku: `TR-${randomUUID().slice(0, 8)}`, name: "Caja" },
        });
        const [a, b, c] = await Promise.all([
          tx.warehouse.create({ data: { tenantId, name: `Central ${randomUUID().slice(0, 6)}` } }),
          tx.warehouse.create({ data: { tenantId, name: `Norte ${randomUUID().slice(0, 6)}` } }),
          tx.warehouse.create({ data: { tenantId, name: `Sur ${randomUUID().slice(0, 6)}` } }),
        ]);
        return { productId: product.id, central: a.id, norte: b.id, sur: c.id };
      },
    );

    const auth = () => ({ Authorization: bearer(token) });

    async function documento(
      type: "entry" | "exit",
      header: Record<string, unknown>,
      warehouse: string,
    ): Promise<string> {
      const res = await request(app.getHttpServer())
        .post("/inventory/documents")
        .set(auth())
        .send({ type, warehouseId: warehouse })
        .expect(201);
      const id = (res.body as { id: string }).id;
      await request(app.getHttpServer())
        .patch(`/inventory/documents/${id}`)
        .set(auth())
        .send(header)
        .expect(200);
      return id;
    }

    /** Despacha `cantidad` de `origen` hacia `destino` y devuelve el traspaso. */
    async function despachar(origen: string, destino: string, cantidad: number) {
      const carga = await documento(
        "entry",
        { reasonCode: "adjustment", reasonNote: "carga" },
        origen,
      );
      await request(app.getHttpServer())
        .post(`/inventory/documents/${carga}/lines`)
        .set(auth())
        .send({ productId, quantity: cantidad })
        .expect(201);
      await request(app.getHttpServer())
        .post(`/inventory/documents/${carga}/confirm`)
        .set(auth())
        .send({})
        .expect(201);

      const salida = await documento(
        "exit",
        { reasonCode: "transfer", linkedWarehouseId: destino },
        origen,
      );
      await request(app.getHttpServer())
        .post(`/inventory/documents/${salida}/lines`)
        .set(auth())
        .send({ productId, quantity: cantidad })
        .expect(201);
      const res = await request(app.getHttpServer())
        .post(`/inventory/documents/${salida}/confirm`)
        .set(auth())
        .send({})
        .expect(201);

      return res.body as {
        transfer: { id: string };
        document: { id: string; folio: string };
      };
    }

    return { token, tenantId, productId, central, norte, sur, despachar };
  }

  /** Un token con permisos reducidos: fuerza el camino de scope por DB. */
  async function tokenConAlcance(tenantId: string, warehouseIds: string[]): Promise<string> {
    const tokenService = app.get(TokenService);
    const userId = await prisma.withTenantContext(tenantId, async (tx) => {
      const owner = await tx.user.findFirstOrThrow({ select: { id: true } });
      for (const warehouseId of warehouseIds) {
        await tx.userWarehouseScope.create({ data: { userId: owner.id, warehouseId, tenantId } });
      }
      return owner.id;
    });
    return tokenService.signAccessToken({
      sub: userId,
      tenantId,
      permissions: ["inventory:read"],
      locale: "es",
    });
  }

  const listar = (token: string, query = "") =>
    request(app.getHttpServer())
      .get(`/transfers${query}`)
      .set("Authorization", bearer(token))
      .expect(200);

  describe("la fila", () => {
    it("lleva el folio de SU documento de despacho, un SAL-", async () => {
      const { token, central, norte, despachar } = await escenario();
      const { document } = await despachar(central, norte, 10);

      const res = await listar(token);
      const filas = res.body.rows as { folio: string }[];

      expect(filas).toHaveLength(1);
      // El traspaso NO tiene serie propia: su folio es el de la salida.
      expect(filas[0]?.folio).toBe(document.folio);
      expect(filas[0]?.folio).toMatch(/^SAL-/);
    });

    it("dice origen, destino, quién lo hizo y cuántas líneas lleva", async () => {
      const { token, central, norte, despachar } = await escenario();
      await despachar(central, norte, 10);

      const res = await listar(token);
      const fila = (res.body.rows as Record<string, unknown>[])[0];

      expect(fila).toEqual(
        expect.objectContaining({
          status: "in_transit",
          origin: expect.objectContaining({ id: central }),
          destination: expect.objectContaining({ id: norte }),
          createdBy: expect.objectContaining({ name: expect.stringContaining("Ana") }),
          lineCount: 1,
          daysInTransit: 0,
          isStale: false,
        }),
      );
    });
  });

  describe("el alcance decide de qué lado está cada uno", () => {
    it("con alcance en el DESTINO, el traspaso es entrante y no saliente", async () => {
      const { tenantId, central, norte, despachar } = await escenario();
      await despachar(central, norte, 10);
      const scoped = await tokenConAlcance(tenantId, [norte]);

      const entrantes = await listar(scoped, "?direction=incoming");
      const salientes = await listar(scoped, "?direction=outgoing");

      expect(entrantes.body.rows).toHaveLength(1);
      expect(salientes.body.rows).toHaveLength(0);
    });

    it("con alcance en el ORIGEN, es al revés", async () => {
      const { tenantId, central, norte, despachar } = await escenario();
      await despachar(central, norte, 10);
      const scoped = await tokenConAlcance(tenantId, [central]);

      const entrantes = await listar(scoped, "?direction=incoming");
      const salientes = await listar(scoped, "?direction=outgoing");

      expect(entrantes.body.rows).toHaveLength(0);
      expect(salientes.body.rows).toHaveLength(1);
    });

    /**
     * Con alcance `"all"` (el default permisivo de un negocio que nunca asignó
     * alcances) los dos tabs muestran todo: no hay "mi almacén" contra el que
     * contrastar.
     */
    it("sin alcance asignado, ambos tabs ven el traspaso", async () => {
      const { token, central, norte, despachar } = await escenario();
      await despachar(central, norte, 10);

      const entrantes = await listar(token, "?direction=incoming");
      const salientes = await listar(token, "?direction=outgoing");

      expect(entrantes.body.rows).toHaveLength(1);
      expect(salientes.body.rows).toHaveLength(1);
    });

    it("un traspaso entre dos almacenes AJENOS no se ve en ninguno de los dos tabs", async () => {
      const { tenantId, central, norte, sur, despachar } = await escenario();
      await despachar(central, norte, 10);
      const scoped = await tokenConAlcance(tenantId, [sur]);

      const sinFiltro = await listar(scoped);

      expect(sinFiltro.body.rows).toHaveLength(0);
    });

    it("`meta` trae los contadores de los dos tabs", async () => {
      const { tenantId, central, norte, despachar } = await escenario();
      await despachar(central, norte, 10);
      const scoped = await tokenConAlcance(tenantId, [norte]);

      const res = await listar(scoped);

      expect(res.body.meta).toEqual({ incomingCount: 1, outgoingCount: 0 });
    });
  });

  describe("filtros", () => {
    it("por defecto solo muestra lo que está EN TRÁNSITO", async () => {
      const { token, tenantId, central, norte, despachar } = await escenario();
      const { transfer } = await despachar(central, norte, 10);
      // La base tiene un CHECK que ata el estado a sus campos: un `completed`
      // sin quién y cuándo lo recibió es un estado imposible, y lo rechaza.
      await prisma.withTenantContext(tenantId, async (tx) => {
        const owner = await tx.user.findFirstOrThrow({ select: { id: true } });
        await tx.transfer.update({
          where: { id: transfer.id },
          data: { status: "completed", receivedBy: owner.id, receivedAt: new Date() },
        });
      });

      const porDefecto = await listar(token);
      const completados = await listar(token, "?status=completed");

      expect(porDefecto.body.rows).toHaveLength(0);
      expect(completados.body.rows).toHaveLength(1);
    });

    it("`olderThanDays=7` deja fuera lo que salió hoy", async () => {
      const { token, central, norte, despachar } = await escenario();
      await despachar(central, norte, 10);

      const res = await listar(token, "?olderThanDays=7");

      expect(res.body.rows).toHaveLength(0);
    });

    /** Más de una semana en tránsito se marca: es el aviso de "revisá si llegó". */
    it("un traspaso viejo sale con `isStale` y sus días", async () => {
      const { token, tenantId, central, norte, despachar } = await escenario();
      const { transfer } = await despachar(central, norte, 10);
      const hace10 = new Date();
      hace10.setDate(hace10.getDate() - 10);
      await prisma.withTenantContext(
        tenantId,
        (tx) =>
          tx.$executeRaw`UPDATE transfers SET created_at = ${hace10} WHERE id = ${transfer.id}::uuid`,
      );

      const res = await listar(token, "?olderThanDays=7");
      const fila = (res.body.rows as { daysInTransit: number; isStale: boolean }[])[0];

      expect(fila?.daysInTransit).toBe(10);
      expect(fila?.isStale).toBe(true);
    });

    it("`destinationWarehouseId` acota", async () => {
      const { token, central, norte, sur, despachar } = await escenario();
      await despachar(central, norte, 10);
      await despachar(central, sur, 5);

      const res = await listar(token, `?destinationWarehouseId=${sur}`);

      expect(res.body.rows).toHaveLength(1);
      expect((res.body.rows as { destination: { id: string } }[])[0]?.destination.id).toBe(sur);
    });
  });

  describe("paginación", () => {
    /**
     * Dos filas del MISMO instante: sin el desempate por `id` el orden lo
     * decide Postgres y una fila podría aparecer en dos páginas —o en
     * ninguna—. Es el mismo criterio que el orden de presentaciones en F2.
     */
    it("con varios traspasos del mismo instante, el orden es determinista", async () => {
      const { token, tenantId, central, norte, sur, despachar } = await escenario();
      const hechos = [
        await despachar(central, norte, 3),
        await despachar(central, sur, 4),
        await despachar(central, norte, 5),
      ];
      const mismoInstante = new Date();
      const ids = hechos.map((h) => h.transfer.id);
      await prisma.withTenantContext(tenantId, (tx) =>
        tx.transfer.updateMany({
          where: { id: { in: ids } },
          data: { createdAt: mismoInstante },
        }),
      );

      const res = await listar(token, "?pageSize=10");
      const devueltos = (res.body.rows as { id: string }[]).map((r) => r.id);

      // Empatados en `created_at`, el desempate por `id DESC` es lo único que
      // define el orden de forma ESTABLE entre consultas.
      //
      // Honestidad sobre el alcance de este test: **no logra caer** si se le
      // quita el desempate al service, porque con el índice
      // `(tenant_id, status, created_at DESC)` que ya existe, Postgres devuelve
      // estas filas en un orden que coincide con `id DESC`. La garantía que el
      // desempate da —el MISMO orden en dos consultas distintas— no se puede
      // forzar desde acá; lo que este test sí fija es el contrato del orden, y
      // caza cualquier cambio que lo rompa de verdad.
      expect(devueltos).toEqual([...ids].sort().reverse());
      expect(res.body.total).toBe(3);
    });
  });
});
