import { randomUUID } from "node:crypto";
import type { INestApplication } from "@nestjs/common";
import { Test, type TestingModule } from "@nestjs/testing";
import sharp from "sharp";
import request from "supertest";
import type { App } from "supertest/types";
import { AppModule } from "../../src/app.module";
import { PrismaService } from "../../src/infrastructure/prisma/prisma.service";
import { MAILER } from "../../src/modules/mail/mailer.port";
import { NoopMailer } from "../../src/modules/mail/noop.mailer";
import { extractTokenFromLink } from "./support/extract-token-from-link";
import { textoDelPdf, tieneImagen } from "./support/pdf-text";
import { startTestApp } from "./support/start-test-app";

/**
 * F4-QUOTE — la cotización.
 *
 * **Una lista con folio, no una operación.** Lo que se protege acá es
 * exactamente eso: que cotizar no exija caja, no mueva un solo gramo de stock,
 * y que al cargarla en el POS los precios se RELEAN del catálogo vigente en
 * vez de copiarse del papel.
 */
describe("Cotización (F4-QUOTE)", () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  const OWNER_PASSWORD = "twelve-characters";

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(MAILER)
      .useClass(NoopMailer)
      .compile();
    app = moduleFixture.createNestApplication();
    await startTestApp(app);
    prisma = app.get(PrismaService);
  });

  afterAll(async () => {
    await app.close();
  });

  const bearer = (t: string) => `Bearer ${t}`;

  async function registerAndLogin(): Promise<{ token: string; tenantId: string }> {
    const email = `quote-${randomUUID()}@example.com`;
    await request(app.getHttpServer())
      .post("/auth/register-tenant")
      .send({
        tenantName: `Tenant quote ${randomUUID()}`,
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

  /** Un producto con stock cargado por el camino REAL: entrada confirmada. */
  async function escenario(cantidad = 100) {
    const { token, tenantId } = await registerAndLogin();

    const { productoId, almacenId, presentacionId, sku } = await prisma.withTenantContext(
      tenantId,
      async (tx) => {
        const almacen = await tx.warehouse.findFirstOrThrow({ select: { id: true } });
        const producto = await tx.product.create({
          data: { tenantId, sku: `Q-${randomUUID().slice(0, 8)}`, name: "Paracetamol" },
        });
        const presentacion = await tx.productPresentation.create({
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
        // El almacén asignado: sin él la cotización pide elegir uno.
        await tx.user.updateMany({ where: { tenantId }, data: { defaultWarehouseId: almacen.id } });
        return {
          productoId: producto.id,
          almacenId: almacen.id,
          presentacionId: presentacion.id,
          sku: producto.sku,
        };
      },
    );

    if (cantidad > 0) {
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
    }

    return { token, tenantId, productoId, almacenId, presentacionId, sku };
  }

  const cotizar = (token: string, body: Record<string, unknown>) =>
    request(app.getHttpServer()).post("/pos/quotes").set("Authorization", bearer(token)).send(body);

  const abrirTurno = (token: string) =>
    request(app.getHttpServer()).post("/pos/session").set("Authorization", bearer(token)).send({});

  describe("crear (F4-QUOTE-01)", () => {
    /**
     * ⚠ LA INVARIANTE DEL MÓDULO. Cotizar es responder "¿cuánto me sale?", y
     * eso pasa en el mostrador, por teléfono o caminando por el pasillo.
     * Exigir caja abierta para contestar una pregunta sería burocracia pura.
     */
    it("cotizar SIN turno abierto funciona", async () => {
      const e = await escenario();

      const res = await cotizar(e.token, {
        lines: [{ productId: e.productoId, quantity: 2 }],
      }).expect(201);

      expect((res.body as { status: string }).status).toBe("open");
    });

    it("toma el folio COT y la serie avanza", async () => {
      const e = await escenario();

      const primera = await cotizar(e.token, {
        lines: [{ productId: e.productoId, quantity: 1 }],
      }).expect(201);
      const segunda = await cotizar(e.token, {
        lines: [{ productId: e.productoId, quantity: 1 }],
      }).expect(201);

      expect((primera.body as { folio: string }).folio).toBe("COT-000001");
      expect((segunda.body as { folio: string }).folio).toBe("COT-000002");
    });

    /**
     * ⚠ Una cotización es una LISTA, no una operación: no reserva, no
     * descuenta, no escribe un solo movimiento.
     */
    it("el stock NO cambia y no queda ningún movimiento", async () => {
      const e = await escenario(50);

      await cotizar(e.token, { lines: [{ productId: e.productoId, quantity: 30 }] }).expect(201);

      const { saldo, movimientos } = await prisma.withTenantContext(e.tenantId, async (tx) => ({
        saldo: await tx.stockByWarehouse.findFirstOrThrow({
          where: { productId: e.productoId, warehouseId: e.almacenId },
          select: { quantity: true },
        }),
        // Solo el de la carga inicial: la cotización no agrega ninguno.
        movimientos: await tx.stockMovement.count({ where: { productId: e.productoId } }),
      }));

      expect(saldo.quantity.toString()).toBe("50");
      expect(movimientos).toBe(1);
    });

    it("el precio sale del CATÁLOGO, no del cuerpo del POST", async () => {
      const e = await escenario();

      const res = await cotizar(e.token, {
        // Ni siquiera se manda un precio: el DTO es `.strict()` y lo rechazaría.
        lines: [{ productId: e.productoId, quantity: 3 }],
      }).expect(201);

      const body = res.body as { total: string; lines: { unitPrice: string }[] };
      expect(body.lines[0]?.unitPrice).toBe("15");
      expect(body.total).toBe("45");
    });

    it("la línea guarda una descripción que sobrevive al renombre del producto", async () => {
      const e = await escenario();
      const res = await cotizar(e.token, {
        lines: [{ productId: e.productoId, quantity: 1 }],
      }).expect(201);
      const quoteId = (res.body as { id: string }).id;

      await prisma.withTenantContext(e.tenantId, (tx) =>
        tx.product.update({ where: { id: e.productoId }, data: { name: "OTRO NOMBRE" } }),
      );

      const detalle = await request(app.getHttpServer())
        .get(`/pos/quotes/${quoteId}`)
        .set("Authorization", bearer(e.token))
        .expect(200);

      // El papel que el cliente se llevó decía esto.
      expect(
        (detalle.body as { lines: { description: string }[] }).lines[0]?.description,
      ).toContain("Paracetamol");
    });

    /**
     * ⚠ LA REGLA DE CARLOS (2026-08-20), el lado que F3 no pudo cerrar. La
     * VENTA lo hereda del ledger —FEFO se niega a tomar un lote caducado— pero
     * la cotización no genera movimiento, así que su bloqueo vive en la
     * disponibilidad.
     */
    it("un producto cuyo único stock está VENCIDO no se puede cotizar", async () => {
      const e = await escenario(0);
      const ayer = new Date();
      ayer.setUTCDate(ayer.getUTCDate() - 1);

      await prisma.withTenantContext(e.tenantId, async (tx) => {
        await tx.product.update({ where: { id: e.productoId }, data: { tracksLots: true } });
        const lote = await tx.productLot.create({
          data: { tenantId: e.tenantId, productId: e.productoId, lotCode: "cad", expiresAt: ayer },
        });
        await tx.stockLot.create({
          data: {
            tenantId: e.tenantId,
            lotId: lote.id,
            warehouseId: e.almacenId,
            location: "",
            quantity: 40,
          },
        });
        await tx.stockByWarehouse.create({
          data: {
            tenantId: e.tenantId,
            productId: e.productoId,
            warehouseId: e.almacenId,
            quantity: 40,
          },
        });
      });

      const res = await cotizar(e.token, {
        lines: [{ productId: e.productoId, quantity: 1 }],
      }).expect(422);

      // Hay 40 en el anaquel y ninguna vendible: el mensaje tiene que nombrar
      // cuál, no decir un "no se puede" que nadie sabe interpretar.
      expect((res.body as { sku: string }).sku).toBe(e.sku);
    });

    /**
     * F4-CONCEPT-04 — el concepto: descripción + precio, sin catálogo ni
     * stock. Se suma al total con el precio que trae, y el producto de al
     * lado sigue pasando por la regla de siempre.
     */
    it("una cotización mixta producto + concepto suma bien y el concepto no toca stock", async () => {
      const { token, productoId } = await escenario(10);

      const res = await cotizar(token, {
        lines: [
          { productId: productoId, quantity: 2 },
          { concept: { description: "Flete a domicilio", unitPrice: 150 }, quantity: 1 },
        ],
      }).expect(201);

      const body = res.body as {
        total: string;
        lines: { kind: string; description: string; unitPrice: string; productId: string | null }[];
      };
      // 2 × 15.00 del catálogo + 150.00 del concepto.
      expect(body.total).toBe("180");
      expect(body.lines[1]).toMatchObject({
        kind: "concept",
        description: "Flete a domicilio",
        unitPrice: "150",
        productId: null,
      });
      expect(body.lines[0]?.kind).toBe("product");
    });

    it("un concepto se cotiza aunque el almacén esté vacío: no depende del stock", async () => {
      const { token } = await escenario(0);
      await cotizar(token, {
        lines: [{ concept: { description: "Anticipo", unitPrice: 200 }, quantity: 1 }],
      }).expect(201);
    });

    it("un producto SIN stock en ese almacén tampoco se cotiza", async () => {
      const e = await escenario(0);

      await cotizar(e.token, { lines: [{ productId: e.productoId, quantity: 1 }] }).expect(422);
    });
  });

  describe("listar, ver y cancelar (F4-QUOTE-01)", () => {
    /**
     * El rango de fechas, con el mismo contrato que ventas, kardex y
     * documentos: días del calendario del NEGOCIO (`YYYY-MM-DD`), traducidos
     * a instantes por el servidor con la zona del tenant.
     */
    const hoyEnCdmx = () =>
      new Intl.DateTimeFormat("en-CA", {
        timeZone: "America/Mexico_City",
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
      }).format(new Date());

    it("una cotización de HOY entra en el rango que termina hoy", async () => {
      const e = await escenario();
      await cotizar(e.token, { lines: [{ productId: e.productoId, quantity: 1 }] }).expect(201);

      const hoy = hoyEnCdmx();
      const res = await request(app.getHttpServer())
        .get("/pos/quotes")
        .query({ from: hoy, to: hoy })
        .set("Authorization", bearer(e.token))
        .expect(200);

      expect((res.body as { total: number }).total).toBe(1);
    });

    it("un rango que termina AYER no la trae", async () => {
      const e = await escenario();
      await cotizar(e.token, { lines: [{ productId: e.productoId, quantity: 1 }] }).expect(201);

      const ayer = new Intl.DateTimeFormat("en-CA", {
        timeZone: "America/Mexico_City",
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
      }).format(new Date(Date.now() - 86_400_000));
      const res = await request(app.getHttpServer())
        .get("/pos/quotes")
        .query({ to: ayer })
        .set("Authorization", bearer(e.token))
        .expect(200);

      expect((res.body as { total: number }).total).toBe(0);
    });

    it("busca por folio PARCIAL: el cliente dicta el número por teléfono", async () => {
      const e = await escenario();
      await cotizar(e.token, { lines: [{ productId: e.productoId, quantity: 1 }] }).expect(201);

      const res = await request(app.getHttpServer())
        .get("/pos/quotes")
        .query({ folio: "00001" })
        .set("Authorization", bearer(e.token))
        .expect(200);

      expect((res.body as { rows: { folio: string }[] }).rows[0]?.folio).toBe("COT-000001");
    });

    it("cancelar la deja `canceled` con su fecha", async () => {
      const e = await escenario();
      const creada = await cotizar(e.token, {
        lines: [{ productId: e.productoId, quantity: 1 }],
      }).expect(201);
      const id = (creada.body as { id: string }).id;

      const res = await request(app.getHttpServer())
        .post(`/pos/quotes/${id}/cancel`)
        .set("Authorization", bearer(e.token))
        .send({ reason: "el cliente se arrepintió" })
        .expect(200);

      expect((res.body as { status: string }).status).toBe("canceled");
      const fila = await prisma.withTenantContext(e.tenantId, (tx) =>
        tx.quote.findUniqueOrThrow({ where: { id }, select: { canceledAt: true } }),
      );
      // El CHECK `quotes_status_coherent` lo exige y el test lo fija.
      expect(fila.canceledAt).not.toBeNull();
    });

    it("cancelar dos veces da 409, no una segunda cancelación", async () => {
      const e = await escenario();
      const creada = await cotizar(e.token, {
        lines: [{ productId: e.productoId, quantity: 1 }],
      }).expect(201);
      const id = (creada.body as { id: string }).id;
      await request(app.getHttpServer())
        .post(`/pos/quotes/${id}/cancel`)
        .set("Authorization", bearer(e.token))
        .send({})
        .expect(200);

      await request(app.getHttpServer())
        .post(`/pos/quotes/${id}/cancel`)
        .set("Authorization", bearer(e.token))
        .send({})
        .expect(409);
    });

    it("una cotización de otro tenant no existe para este: 404", async () => {
      const e = await escenario();
      const ajeno = await escenario();
      const suya = await cotizar(ajeno.token, {
        lines: [{ productId: ajeno.productoId, quantity: 1 }],
      }).expect(201);

      await request(app.getHttpServer())
        .get(`/pos/quotes/${(suya.body as { id: string }).id}`)
        .set("Authorization", bearer(e.token))
        .expect(404);
    });
  });

  describe("cargar en la venta (F4-QUOTE-02)", () => {
    const paraVender = (token: string, folio: string) =>
      request(app.getHttpServer())
        .get(`/pos/quotes/folio/${folio}/for-sale`)
        .set("Authorization", bearer(token));

    it("sin turno abierto no se carga: la disponibilidad no tiene contra qué resolverse", async () => {
      const e = await escenario();
      await cotizar(e.token, { lines: [{ productId: e.productoId, quantity: 1 }] }).expect(201);

      await paraVender(e.token, "COT-000001").expect(409);
    });

    /**
     * ⚠ LA DECISIÓN DE CARLOS: la cotización NO congela precios. Un papel de
     * hace un mes no puede obligar al negocio a un precio que ya no existe.
     */
    it("un precio cambiado entre cotizar y cargar: manda el NUEVO", async () => {
      const e = await escenario();
      await cotizar(e.token, { lines: [{ productId: e.productoId, quantity: 2 }] }).expect(201);
      await abrirTurno(e.token).expect(201);

      await prisma.withTenantContext(e.tenantId, (tx) =>
        tx.productPresentation.update({
          where: { id: e.presentacionId },
          data: { price: "20.00" },
        }),
      );

      const res = await paraVender(e.token, "COT-000001").expect(200);
      const linea = (res.body as { lines: { unitPrice: string; quotedUnitPrice: string }[] })
        .lines[0];

      expect(linea?.unitPrice).toBe("20");
      // Y el del papel viaja igual, para poder EXPLICAR la diferencia en vez
      // de descubrirla en la caja.
      expect(linea?.quotedUnitPrice).toBe("15");
    });

    it("lo que no alcanza viene MARCADO, no escondido", async () => {
      const e = await escenario(5);
      await cotizar(e.token, { lines: [{ productId: e.productoId, quantity: 3 }] }).expect(201);
      await abrirTurno(e.token).expect(201);

      // Se vende casi todo por otro lado: la cotización queda sin cubrir.
      await request(app.getHttpServer())
        .post("/pos/sales")
        .set("Authorization", bearer(e.token))
        .send({ paymentMethod: "cash", lines: [{ productId: e.productoId, quantity: 4 }] })
        .expect(201);

      const res = await paraVender(e.token, "COT-000001").expect(200);
      const linea = (res.body as { lines: { shortfall: string | null }[] }).lines[0];

      // La línea SIGUE ahí; lo que cambia es que dice cuánto falta.
      expect(linea?.shortfall).toBe("2");
    });

    /**
     * F4-CONCEPT-05 — el concepto es la única línea con precio CONGELADO: no
     * hay catálogo que releer. Vuelve como `LookupConceptItem` con el id de
     * la línea de la cotización, que es lo que la venta va a mandar.
     */
    it("un concepto vuelve disponible, con el precio del papel y el id de su línea", async () => {
      const e = await escenario();
      const creada = await cotizar(e.token, {
        lines: [
          { productId: e.productoId, quantity: 1 },
          { concept: { description: "Flete a domicilio", unitPrice: 150 }, quantity: 1 },
        ],
      }).expect(201);
      const lineaConcepto = (creada.body as { lines: { id: string }[] }).lines[1];
      await abrirTurno(e.token).expect(201);

      const res = await paraVender(e.token, "COT-000001").expect(200);
      const linea = (
        res.body as {
          lines: {
            unavailable: boolean;
            unitPrice: string | null;
            shortfall: string | null;
            item: { type: string; id: string; description?: string; unitPrice?: string } | null;
          }[];
        }
      ).lines[1];

      expect(linea?.unavailable).toBe(false);
      expect(linea?.unitPrice).toBe("150");
      expect(linea?.shortfall).toBeNull();
      expect(linea?.item).toMatchObject({
        type: "concept",
        id: lineaConcepto?.id,
        description: "Flete a domicilio",
        unitPrice: "150",
      });
    });

    it("al cobrarla, la venta queda vinculada y la cotización pasa a `loaded`", async () => {
      const e = await escenario();
      const creada = await cotizar(e.token, {
        lines: [{ productId: e.productoId, quantity: 2 }],
      }).expect(201);
      const quoteId = (creada.body as { id: string }).id;
      await abrirTurno(e.token).expect(201);

      const venta = await request(app.getHttpServer())
        .post("/pos/sales")
        .set("Authorization", bearer(e.token))
        .send({
          paymentMethod: "cash",
          quoteId,
          lines: [{ productId: e.productoId, quantity: 2 }],
        })
        .expect(201);

      expect((venta.body as { quoteId: string }).quoteId).toBe(quoteId);
      const fila = await prisma.withTenantContext(e.tenantId, (tx) =>
        tx.quote.findUniqueOrThrow({
          where: { id: quoteId },
          select: { status: true, loadedAt: true },
        }),
      );
      expect(fila.status).toBe("loaded");
      expect(fila.loadedAt).not.toBeNull();
    });

    /**
     * ⚠ El papel se canjea UNA vez. Sin esto, un cliente con el folio en la
     * mano podría cobrarlo dos veces.
     */
    it("una cotización ya cargada no se cobra de nuevo", async () => {
      const e = await escenario();
      const creada = await cotizar(e.token, {
        lines: [{ productId: e.productoId, quantity: 1 }],
      }).expect(201);
      const quoteId = (creada.body as { id: string }).id;
      await abrirTurno(e.token).expect(201);
      await request(app.getHttpServer())
        .post("/pos/sales")
        .set("Authorization", bearer(e.token))
        .send({ paymentMethod: "cash", quoteId, lines: [{ productId: e.productoId, quantity: 1 }] })
        .expect(201);

      const segunda = await request(app.getHttpServer())
        .post("/pos/sales")
        .set("Authorization", bearer(e.token))
        .send({ paymentMethod: "cash", quoteId, lines: [{ productId: e.productoId, quantity: 1 }] })
        .expect(409);

      expect((segunda.body as { message: string }).message).toContain("ya se usó");
      // Y el rechazo no dejó media venta ni gastó stock de más.
      const ventas = await prisma.withTenantContext(e.tenantId, (tx) => tx.sale.count());
      expect(ventas).toBe(1);
    });

    it("una cotización CANCELADA tampoco se carga", async () => {
      const e = await escenario();
      const creada = await cotizar(e.token, {
        lines: [{ productId: e.productoId, quantity: 1 }],
      }).expect(201);
      await request(app.getHttpServer())
        .post(`/pos/quotes/${(creada.body as { id: string }).id}/cancel`)
        .set("Authorization", bearer(e.token))
        .send({})
        .expect(200);
      await abrirTurno(e.token).expect(201);

      await paraVender(e.token, "COT-000001").expect(409);
    });

    it("el folio en minúsculas resuelve igual: el cajero no teclea mayúsculas", async () => {
      const e = await escenario();
      await cotizar(e.token, { lines: [{ productId: e.productoId, quantity: 1 }] }).expect(201);
      await abrirTurno(e.token).expect(201);

      await paraVender(e.token, "cot-000001").expect(200);
    });
  });

  /**
   * F4-TICKET-01 — el papel.
   *
   * El e2e verifica el TRANSPORTE (que baje un `application/pdf` de verdad);
   * QUÉ dice el papel lo fija `ticket.renderer.spec.ts` sobre la definición,
   * que es donde se puede leer en vez de comparar bytes.
   */
  describe("el ticket (F4-TICKET-01)", () => {
    it("la cotización baja un PDF con su folio en el nombre", async () => {
      const e = await escenario();
      const creada = await cotizar(e.token, {
        lines: [{ productId: e.productoId, quantity: 2 }],
      }).expect(201);

      const res = await request(app.getHttpServer())
        .get(`/pos/quotes/${(creada.body as { id: string }).id}/ticket`)
        .set("Authorization", bearer(e.token))
        .expect(200);

      expect(res.headers["content-type"]).toContain("application/pdf");
      expect(res.headers["content-disposition"]).toContain("COT-000001.pdf");
      // Un PDF real empieza con `%PDF`. Sin esto, un cuerpo vacío con el header
      // correcto pasaría el test.
      expect(res.body.subarray(0, 4).toString()).toBe("%PDF");
    });

    it("obedece la configuración: logotipo incrustado, RFC apagado y mensaje propio (F4-TICKETCFG-05)", async () => {
      const e = await escenario();
      await request(app.getHttpServer())
        .patch("/tenants/me")
        .set("Authorization", bearer(e.token))
        .send({ taxId: "XAXX010101000" })
        .expect(200);
      await request(app.getHttpServer())
        .put("/tenants/me/ticket-settings")
        .set("Authorization", bearer(e.token))
        .send({ showTaxId: false, footerMessage: "Vuelva pronto" })
        .expect(200);
      const png = await sharp({
        create: { width: 300, height: 120, channels: 3, background: "#444" },
      })
        .png()
        .toBuffer();
      await request(app.getHttpServer())
        .put("/tenants/me/ticket-settings/logo")
        .set("Authorization", bearer(e.token))
        .send({ content: png.toString("base64") })
        .expect(200);
      await abrirTurno(e.token).expect(201);
      const venta = await request(app.getHttpServer())
        .post("/pos/sales")
        .set("Authorization", bearer(e.token))
        .send({ paymentMethod: "cash", lines: [{ productId: e.productoId, quantity: 1 }] })
        .expect(201);

      const res = await request(app.getHttpServer())
        .get(`/pos/sales/${(venta.body as { id: string }).id}/ticket`)
        .set("Authorization", bearer(e.token))
        .expect(200);
      const pdf = res.body as Buffer;
      // El papel, no sus cabeceras: lleva la imagen, dice el mensaje propio y
      // NO dice el RFC que el negocio apagó.
      expect(tieneImagen(pdf)).toBe(true);
      const texto = textoDelPdf(pdf);
      expect(texto).toContain("Vuelva pronto");
      expect(texto).not.toContain("XAXX010101000");

      // La cotización también lleva el logotipo, y su leyenda no se apaga.
      const creada = await cotizar(e.token, {
        lines: [{ productId: e.productoId, quantity: 1 }],
      }).expect(201);
      const cot = await request(app.getHttpServer())
        .get(`/pos/quotes/${(creada.body as { id: string }).id}/ticket`)
        .set("Authorization", bearer(e.token))
        .expect(200);
      expect(tieneImagen(cot.body as Buffer)).toBe(true);
      expect(textoDelPdf(cot.body as Buffer)).toContain("Vuelva pronto");
    });

    it("la venta también, y en el ancho pedido", async () => {
      const e = await escenario();
      await abrirTurno(e.token).expect(201);
      const venta = await request(app.getHttpServer())
        .post("/pos/sales")
        .set("Authorization", bearer(e.token))
        .send({ paymentMethod: "cash", lines: [{ productId: e.productoId, quantity: 1 }] })
        .expect(201);

      const res = await request(app.getHttpServer())
        .get(`/pos/sales/${(venta.body as { id: string }).id}/ticket`)
        .query({ width: "80mm" })
        .set("Authorization", bearer(e.token))
        .expect(200);

      expect(res.headers["content-type"]).toContain("application/pdf");
      expect(res.body.subarray(0, 4).toString()).toBe("%PDF");
    });

    /**
     * Un ancho que no existe cae a 58 mm en vez de reventar: un ticket angosto
     * se lee, un 500 en la caja no.
     */
    it("un ancho inválido no rompe la caja", async () => {
      const e = await escenario();
      const creada = await cotizar(e.token, {
        lines: [{ productId: e.productoId, quantity: 1 }],
      }).expect(201);

      await request(app.getHttpServer())
        .get(`/pos/quotes/${(creada.body as { id: string }).id}/ticket`)
        .query({ width: "300mm" })
        .set("Authorization", bearer(e.token))
        .expect(200);
    });

    it("un ticket de otro tenant no existe para este", async () => {
      const e = await escenario();
      const ajeno = await escenario();
      const suya = await cotizar(ajeno.token, {
        lines: [{ productId: ajeno.productoId, quantity: 1 }],
      }).expect(201);

      await request(app.getHttpServer())
        .get(`/pos/quotes/${(suya.body as { id: string }).id}/ticket`)
        .set("Authorization", bearer(e.token))
        .expect(404);
    });
  });
});
