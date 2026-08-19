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

  /**
   * F3-TRANSFER-02 — el detalle.
   *
   * Es lo que mira quien va a recibir: qué viene, cuánto se envió y —una vez
   * confirmado— cuánto llegó de verdad. `difference` se DERIVA de
   * `sent - received` y no se guarda: una sola verdad, sin JSONB, igual que
   * decidió F3-DB-02.
   */
  describe("GET /transfers/:id (F3-TRANSFER-02)", () => {
    const detalle = (token: string, id: string) =>
      request(app.getHttpServer()).get(`/transfers/${id}`).set("Authorization", bearer(token));

    it("trae la cabecera completa y las líneas con lo enviado", async () => {
      const { token, central, norte, productId, despachar } = await escenario();
      const { transfer, document } = await despachar(central, norte, 10);

      const res = await detalle(token, transfer.id).expect(200);
      const body = res.body as Record<string, unknown>;

      expect(body).toEqual(
        expect.objectContaining({
          id: transfer.id,
          status: "in_transit",
          folio: document.folio,
          origin: expect.objectContaining({ id: central }),
          destination: expect.objectContaining({ id: norte }),
          createdBy: expect.objectContaining({ name: "Ana Pérez" }),
          receivedBy: null,
          canceledBy: null,
          discrepancyNote: null,
        }),
      );
      expect(body.lines).toEqual([
        expect.objectContaining({
          productId,
          quantitySent: "10",
          // Todavía nadie recibió: `null` NO es lo mismo que recibir 0, que
          // sería "llegó vacío". Confundirlos borraría una pérdida real.
          quantityReceived: null,
          difference: null,
        }),
      ]);
    });

    it("la línea dice qué producto es, no solo su id", async () => {
      const { token, central, norte, despachar } = await escenario();
      const { transfer } = await despachar(central, norte, 7);

      const res = await detalle(token, transfer.id).expect(200);
      const linea = (res.body as { lines: Record<string, unknown>[] }).lines[0];

      expect(linea).toEqual(
        expect.objectContaining({
          sku: expect.stringContaining("TR-"),
          name: "Caja",
          baseUnit: "unit",
        }),
      );
    });

    it("tras recibir, `difference` es lo enviado menos lo recibido", async () => {
      const { token, tenantId, central, norte, despachar } = await escenario();
      const { transfer } = await despachar(central, norte, 10);

      await prisma.withTenantContext(tenantId, async (tx) => {
        const owner = await tx.user.findFirstOrThrow({ select: { id: true } });
        await tx.transferLine.updateMany({
          where: { transferId: transfer.id },
          data: { quantityReceived: 8 },
        });
        await tx.transfer.update({
          where: { id: transfer.id },
          data: {
            status: "completed",
            receivedBy: owner.id,
            receivedAt: new Date(),
            discrepancyNote: "Faltó una caja",
          },
        });
      });

      const res = await detalle(token, transfer.id).expect(200);
      const body = res.body as { lines: { difference: string }[]; discrepancyNote: string };

      expect(body.lines[0]?.difference).toBe("2");
      expect(body.discrepancyNote).toBe("Faltó una caja");
    });

    /**
     * Las DOS puntas lo ven: al destino le importa que le llegue, y al origen
     * que llegue — sigue siendo su mercancía hasta que alguien la confirme.
     */
    it("el usuario del ORIGEN también lo ve", async () => {
      const { tenantId, central, norte, despachar } = await escenario();
      const { transfer } = await despachar(central, norte, 10);
      const scoped = await tokenConAlcance(tenantId, [central]);

      await detalle(scoped, transfer.id).expect(200);
    });

    it("el usuario del DESTINO lo ve", async () => {
      const { tenantId, central, norte, despachar } = await escenario();
      const { transfer } = await despachar(central, norte, 10);
      const scoped = await tokenConAlcance(tenantId, [norte]);

      await detalle(scoped, transfer.id).expect(200);
    });

    /**
     * 404 y no 403: para quien no está en ninguna de las dos puntas, ese
     * traspaso simplemente no existe. Un 403 confirmaría que sí — y de paso
     * revelaría que hay movimiento entre dos bodegas que no le tocan.
     */
    it("un usuario ajeno a las dos puntas recibe 404", async () => {
      const { tenantId, central, norte, sur, despachar } = await escenario();
      const { transfer } = await despachar(central, norte, 10);
      const scoped = await tokenConAlcance(tenantId, [sur]);

      await detalle(scoped, transfer.id).expect(404);
    });

    it("un traspaso de otro tenant no existe", async () => {
      const { central, norte, despachar } = await escenario();
      const { transfer } = await despachar(central, norte, 10);
      const ajeno = await registerAndLogin();

      await detalle(ajeno.token, transfer.id).expect(404);
    });
  });

  /**
   * F3-TRANSFER-03 — la recepción, donde el ciclo se cierra.
   *
   * **La recepción es una ENTRADA normal**, no una pantalla aparte: el
   * borrador nace con motivo `transfer`, el almacén destino y las líneas
   * precargadas con lo enviado, y el usuario solo corrige lo que llegó de
   * menos. Así usa exactamente la misma pantalla que cualquier entrada.
   *
   * La regla de negocio que más cuesta explicar y hay que respetar: la
   * diferencia `enviado − recibido` **no entra** al destino y **no genera una
   * merma automática**. Ya salió del origen; qué pasó en el camino lo decide
   * una persona, no el sistema.
   */
  describe("Recepción de un traspaso (F3-TRANSFER-03)", () => {
    const pedirBorrador = (token: string, transferId: string) =>
      request(app.getHttpServer())
        .post(`/transfers/${transferId}/receipt-draft`)
        .set("Authorization", bearer(token))
        .send({});

    const confirmarDoc = (token: string, documentId: string) =>
      request(app.getHttpServer())
        .post(`/inventory/documents/${documentId}/confirm`)
        .set("Authorization", bearer(token))
        .send({});

    /**
     * El PATCH pide el ID de la línea, no su número. Se resuelve desde el
     * detalle —que es de donde lo saca la pantalla real— en vez de fabricarlo.
     */
    async function editarLinea(
      token: string,
      documentId: string,
      lineNo: number,
      body: Record<string, unknown>,
      esperado = 200,
    ) {
      const detalle = await request(app.getHttpServer())
        .get(`/inventory/documents/${documentId}`)
        .set("Authorization", bearer(token))
        .expect(200);
      const fila = (detalle.body as { rows: { id: string; lineNo: number }[] }).rows.find(
        (r) => r.lineNo === lineNo,
      );
      return request(app.getHttpServer())
        .patch(`/inventory/documents/${documentId}/lines/${fila?.id}`)
        .set("Authorization", bearer(token))
        .send(body)
        .expect(esperado);
    }

    describe("el borrador", () => {
      it("nace como ENT con motivo traspaso, en el DESTINO y precargado", async () => {
        const { token, central, norte, productId, despachar } = await escenario();
        const { transfer } = await despachar(central, norte, 10);

        const res = await pedirBorrador(token, transfer.id).expect(201);
        const doc = res.body as {
          id: string;
          folio: string;
          type: string;
          warehouse: { id: string };
        };

        expect(doc.folio).toMatch(/^ENT-/);
        expect(doc.type).toBe("entry");
        expect(doc.warehouse.id).toBe(norte);

        const detalleDoc = await request(app.getHttpServer())
          .get(`/inventory/documents/${doc.id}`)
          .set("Authorization", bearer(token))
          .expect(200);
        const cuerpo = detalleDoc.body as {
          reasonCode: string;
          linkedWarehouseId: string;
          rows: { productId: string; quantityInput: string }[];
        };
        expect(cuerpo.reasonCode).toBe("transfer");
        // El origen lo completa el servidor: quien recibe no tiene por qué
        // saber de dónde vino, y dejarlo elegir sería dejarlo equivocarse.
        expect(cuerpo.linkedWarehouseId).toBe(central);
        expect(cuerpo.rows).toEqual([expect.objectContaining({ productId, quantityInput: "10" })]);
      });

      /** Pedirlo dos veces devuelve el MISMO: lo garantiza el UNIQUE parcial. */
      it("es idempotente", async () => {
        const { token, central, norte, despachar } = await escenario();
        const { transfer } = await despachar(central, norte, 10);

        const uno = await pedirBorrador(token, transfer.id).expect(201);
        const dos = await pedirBorrador(token, transfer.id).expect(201);

        expect((dos.body as { id: string }).id).toBe((uno.body as { id: string }).id);
      });

      it("un traspaso ya recibido no da borrador", async () => {
        const { token, tenantId, central, norte, despachar } = await escenario();
        const { transfer } = await despachar(central, norte, 10);
        await prisma.withTenantContext(tenantId, async (tx) => {
          const owner = await tx.user.findFirstOrThrow({ select: { id: true } });
          await tx.transfer.update({
            where: { id: transfer.id },
            data: { status: "completed", receivedBy: owner.id, receivedAt: new Date() },
          });
        });

        await pedirBorrador(token, transfer.id).expect(409);
      });
    });

    describe("confirmar la recepción", () => {
      it("recepción exacta: el destino sube y el traspaso queda completado", async () => {
        const { token, central, norte, productId, despachar } = await escenario();
        const { transfer, document: despacho } = await despachar(central, norte, 10);
        const borrador = (await pedirBorrador(token, transfer.id).expect(201)).body as {
          id: string;
          folio: string;
        };

        const res = await confirmarDoc(token, borrador.id).expect(201);
        const body = res.body as {
          stock: { productId: string; warehouseId: string; quantity: string }[];
          transfer: { id: string; status: string; dispatchFolio: string };
        };

        expect(body.transfer.status).toBe("completed");
        // El folio del DESPACHO viaja en la respuesta: es como el usuario
        // conoce a ese traspaso.
        expect(body.transfer.dispatchFolio).toBe(despacho.folio);
        const enDestino = body.stock.find(
          (s) => s.warehouseId === norte && s.productId === productId,
        );
        expect(Number(enDestino?.quantity)).toBe(10);

        const detalleTr = await request(app.getHttpServer())
          .get(`/transfers/${transfer.id}`)
          .set("Authorization", bearer(token))
          .expect(200);
        const tr = detalleTr.body as { status: string; lines: { quantityReceived: string }[] };
        expect(tr.status).toBe("completed");
        expect(tr.lines[0]?.quantityReceived).toBe("10");
      });

      it("con faltante y nota: guarda la nota y la diferencia NO entra al destino", async () => {
        const { token, central, norte, productId, despachar } = await escenario();
        const { transfer } = await despachar(central, norte, 10);
        const borrador = (await pedirBorrador(token, transfer.id).expect(201)).body as {
          id: string;
        };

        await editarLinea(token, borrador.id, 1, { quantity: 8 });
        await request(app.getHttpServer())
          .patch(`/inventory/documents/${borrador.id}`)
          .set("Authorization", bearer(token))
          .send({ reasonNote: "Faltó una caja en el camión" })
          .expect(200);

        const res = await confirmarDoc(token, borrador.id).expect(201);
        const body = res.body as {
          stock: { warehouseId: string; productId: string; quantity: string }[];
        };

        // Entran 8, no 10. Los 2 que faltan NO se convierten en merma
        // automática: ya salieron del origen, y qué pasó lo decide una persona.
        const enDestino = body.stock.find(
          (s) => s.warehouseId === norte && s.productId === productId,
        );
        expect(Number(enDestino?.quantity)).toBe(8);

        const detalleTr = await request(app.getHttpServer())
          .get(`/transfers/${transfer.id}`)
          .set("Authorization", bearer(token))
          .expect(200);
        const tr = detalleTr.body as {
          discrepancyNote: string;
          lines: { quantitySent: string; quantityReceived: string; difference: string }[];
        };
        expect(tr.discrepancyNote).toBe("Faltó una caja en el camión");
        expect(tr.lines[0]).toEqual(
          expect.objectContaining({ quantitySent: "10", quantityReceived: "8", difference: "2" }),
        );
      });

      /** Sin explicación no hay faltante: alguien tiene que hacerse cargo. */
      it("con faltante y SIN nota, 400 sobre `reasonNote`", async () => {
        const { token, central, norte, despachar } = await escenario();
        const { transfer } = await despachar(central, norte, 10);
        const borrador = (await pedirBorrador(token, transfer.id).expect(201)).body as {
          id: string;
        };

        await editarLinea(token, borrador.id, 1, { quantity: 8 });

        await confirmarDoc(token, borrador.id).expect(400);
      });

      it("recibir MÁS de lo enviado se rechaza y no cambia nada", async () => {
        const { token, central, norte, productId, despachar } = await escenario();
        const { transfer } = await despachar(central, norte, 10);
        const borrador = (await pedirBorrador(token, transfer.id).expect(201)).body as {
          id: string;
        };

        await editarLinea(token, borrador.id, 1, { quantity: 11 });

        await confirmarDoc(token, borrador.id).expect(422);

        // Nada se movió: el traspaso sigue en tránsito y el destino en cero.
        const detalleTr = await request(app.getHttpServer())
          .get(`/transfers/${transfer.id}`)
          .set("Authorization", bearer(token))
          .expect(200);
        expect((detalleTr.body as { status: string }).status).toBe("in_transit");
        const lotes = await request(app.getHttpServer())
          .get(`/products/${productId}/lots`)
          .set("Authorization", bearer(token))
          .expect(200);
        expect(lotes.body).toEqual([]);
      });

      /**
       * El escenario que protege el lock DEL TRASPASO, y que el lock del
       * documento no cubre: el borrador se creó con el traspaso en tránsito, y
       * para cuando alguien lo confirma el traspaso ya cambió de estado (lo
       * canceló un admin, o lo recibió otra persona por otra vía).
       *
       * Sin el `WHERE status='in_transit'` del UPDATE, esa confirmación
       * entraría igual y sumaría al destino mercancía de un traspaso que ya no
       * está en viaje.
       */
      it("si el traspaso deja de estar en tránsito entre el borrador y el confirm, 409", async () => {
        const { token, tenantId, central, norte, productId, despachar } = await escenario();
        const { transfer } = await despachar(central, norte, 10);
        const borrador = (await pedirBorrador(token, transfer.id).expect(201)).body as {
          id: string;
        };

        await prisma.withTenantContext(tenantId, async (tx) => {
          const owner = await tx.user.findFirstOrThrow({ select: { id: true } });
          await tx.transfer.update({
            where: { id: transfer.id },
            data: {
              status: "canceled",
              canceledBy: owner.id,
              canceledAt: new Date(),
              cancelReason: "El camión nunca salió",
            },
          });
        });

        await confirmarDoc(token, borrador.id).expect(409);

        // Y el destino sigue sin recibir nada.
        const lotes = await request(app.getHttpServer())
          .get(`/products/${productId}/lots`)
          .set("Authorization", bearer(token))
          .expect(200);
        expect(lotes.body).toEqual([]);
      });

      /**
       * El lock lógico: `UPDATE … WHERE status='in_transit'` con `rowCount = 1`.
       * Sin él, dos personas confirmando a la vez duplicarían el saldo del
       * destino — el mismo bug que `markConfirmed` evita en el documento.
       */
      it("dos recepciones simultáneas: una pasa y la otra da 409", async () => {
        const { token, central, norte, despachar } = await escenario();
        const { transfer } = await despachar(central, norte, 10);
        const borrador = (await pedirBorrador(token, transfer.id).expect(201)).body as {
          id: string;
        };

        const resultados = await Promise.allSettled([
          confirmarDoc(token, borrador.id),
          confirmarDoc(token, borrador.id),
        ]);
        const codigos = resultados
          .map((r) => (r.status === "fulfilled" ? r.value.status : 0))
          .sort();

        expect(codigos).toEqual([201, 409]);
      });
    });
  });
});
