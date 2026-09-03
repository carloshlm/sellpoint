import { randomUUID } from "node:crypto";
import type { INestApplication } from "@nestjs/common";
import { Test, type TestingModule } from "@nestjs/testing";
import request from "supertest";
import type { App } from "supertest/types";
import { AppModule } from "../../src/app.module";
import { PrismaService } from "../../src/infrastructure/prisma/prisma.service";
import { MAILER } from "../../src/modules/mail/mailer.port";
import { NoopMailer } from "../../src/modules/mail/noop.mailer";
import { extractTokenFromLink } from "./support/extract-token-from-link";
import { startTestApp } from "./support/start-test-app";

/**
 * F4-CONCEPT-09 — la línea de concepto de punta a punta.
 *
 * Lo que se protege: que un concepto («Flete a domicilio») se cotice, se
 * cargue por folio y se cobre SIN tocar el stock, y que la venta jamás acepte
 * un concepto que no venga de su propia cotización — ni un precio del
 * cliente. La cotización es el documento que AUTORIZA el precio.
 */
describe("Línea de concepto (F4-CONCEPT)", () => {
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
    const email = `concept-${randomUUID()}@example.com`;
    await request(app.getHttpServer())
      .post("/auth/register-tenant")
      .send({
        tenantName: `Tenant concept ${randomUUID()}`,
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

  /** Un producto con stock por el camino real (entrada confirmada) y caja abierta. */
  async function escenario(cantidad = 10) {
    const { token, tenantId } = await registerAndLogin();
    const { productoId, almacenId } = await prisma.withTenantContext(tenantId, async (tx) => {
      const almacen = await tx.warehouse.findFirstOrThrow({ select: { id: true } });
      const producto = await tx.product.create({
        data: { tenantId, sku: `C-${randomUUID().slice(0, 8)}`, name: "Paracetamol" },
      });
      await tx.productPresentation.create({
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
      await tx.user.updateMany({ where: { tenantId }, data: { defaultWarehouseId: almacen.id } });
      return { productoId: producto.id, almacenId: almacen.id };
    });

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
    await request(app.getHttpServer())
      .post("/pos/session")
      .set("Authorization", bearer(token))
      .send({})
      .expect(201);

    return { token, tenantId, productoId };
  }

  const cotizar = (token: string, body: Record<string, unknown>) =>
    request(app.getHttpServer()).post("/pos/quotes").set("Authorization", bearer(token)).send(body);
  const vender = (token: string, body: Record<string, unknown>) =>
    request(app.getHttpServer()).post("/pos/sales").set("Authorization", bearer(token)).send(body);

  /** Cotización producto ×2 + «Flete a domicilio» 150.00: devuelve ids. */
  async function cotizacionMixta(token: string, productoId: string, cantidadConcepto = 1) {
    const creada = await cotizar(token, {
      lines: [
        { productId: productoId, quantity: 2 },
        {
          concept: { description: "Flete a domicilio", unitPrice: 150 },
          quantity: cantidadConcepto,
        },
      ],
    }).expect(201);
    const body = creada.body as { id: string; folio: string; lines: { id: string }[] };
    return { quoteId: body.id, folio: body.folio, conceptLineId: body.lines[1]?.id as string };
  }

  it("se cotiza, se carga por folio y se cobra: el concepto queda en la venta y NO en el stock", async () => {
    const e = await escenario();
    const q = await cotizacionMixta(e.token, e.productoId);

    const paraVender = await request(app.getHttpServer())
      .get(`/pos/quotes/folio/${q.folio}/for-sale`)
      .set("Authorization", bearer(e.token))
      .expect(200);
    const lineas = (paraVender.body as { lines: { item: { type: string; id: string } | null }[] })
      .lines;
    expect(lineas[1]?.item).toMatchObject({ type: "concept", id: q.conceptLineId });

    const venta = await vender(e.token, {
      paymentMethod: "cash",
      quoteId: q.quoteId,
      lines: [
        { productId: e.productoId, quantity: 2 },
        { quoteLineId: q.conceptLineId, quantity: 1 },
      ],
    }).expect(201);
    const body = venta.body as {
      id: string;
      total: string;
      items: {
        kind: string;
        conceptDescription: string | null;
        unitPrice: string;
        unitCost: string | null;
        lineTotal: string;
        sourceModule: string | null;
      }[];
    };
    // 2 × 15.00 del catálogo + 150.00 del concepto, con el precio del PAPEL.
    expect(body.total).toBe("180");
    expect(body.items[1]).toMatchObject({
      kind: "concept",
      conceptDescription: "Flete a domicilio",
      unitPrice: "150",
      unitCost: null,
      lineTotal: "150",
    });

    // El stock solo se movió por el producto: el flete no sale de ningún anaquel.
    const movimientos = await prisma.withTenantContext(e.tenantId, (tx) =>
      tx.stockMovement.findMany({ where: { saleId: body.id }, select: { productId: true } }),
    );
    expect(movimientos.map((m) => m.productId)).toEqual([e.productoId]);

    // Y el ticket imprime el concepto como un renglón más.
    const ticket = await request(app.getHttpServer())
      .get(`/pos/sales/${body.id}/ticket`)
      .set("Authorization", bearer(e.token))
      .expect(200);
    expect(ticket.headers["content-type"]).toContain("application/pdf");
  });

  it("cobrar menos de lo cotizado se permite; más, no", async () => {
    const e = await escenario();
    const q = await cotizacionMixta(e.token, e.productoId, 2);

    const deMas = await vender(e.token, {
      paymentMethod: "cash",
      quoteId: q.quoteId,
      lines: [{ quoteLineId: q.conceptLineId, quantity: 3 }],
    });
    expect(deMas.status).toBe(422);
    expect((deMas.body as { message: string }).message).toContain("cotiz");

    const parcial = await vender(e.token, {
      paymentMethod: "cash",
      quoteId: q.quoteId,
      lines: [{ quoteLineId: q.conceptLineId, quantity: 1 }],
    }).expect(201);
    expect((parcial.body as { total: string }).total).toBe("150");
  });

  it("un quoteLineId sin quoteId no se cobra: sin cotización no hay precio autorizado", async () => {
    const e = await escenario();
    const q = await cotizacionMixta(e.token, e.productoId);

    const res = await vender(e.token, {
      paymentMethod: "cash",
      lines: [{ quoteLineId: q.conceptLineId, quantity: 1 }],
    });
    expect(res.status).toBe(422);
  });

  it("la línea tiene que ser de ESA cotización: otra cotización u otro negocio dan el mismo 422", async () => {
    const a = await escenario();
    const b = await escenario();
    const qa = await cotizacionMixta(a.token, a.productoId);
    const qa2 = await cotizacionMixta(a.token, a.productoId);
    const qb = await cotizacionMixta(b.token, b.productoId);

    // Línea de la primera cotización con el id de la segunda.
    const cruzada = await vender(a.token, {
      paymentMethod: "cash",
      quoteId: qa2.quoteId,
      lines: [{ quoteLineId: qa.conceptLineId, quantity: 1 }],
    });
    expect(cruzada.status).toBe(422);

    // Línea de OTRO negocio: mismo 422, sin revelar que existe.
    const ajena = await vender(a.token, {
      paymentMethod: "cash",
      quoteId: qa.quoteId,
      lines: [{ quoteLineId: qb.conceptLineId, quantity: 1 }],
    });
    expect(ajena.status).toBe(422);
    expect((ajena.body as { message: string }).message).toBe(
      (cruzada.body as { message: string }).message,
    );
    // Y la cotización sigue abierta: un intento fallido no la gasta.
    const fila = await prisma.withTenantContext(a.tenantId, (tx) =>
      tx.quote.findUniqueOrThrow({ where: { id: qa.quoteId }, select: { status: true } }),
    );
    expect(fila.status).toBe("open");
  });

  it("el mismo folio no se cobra dos veces", async () => {
    const e = await escenario();
    const q = await cotizacionMixta(e.token, e.productoId);
    const lines = [{ quoteLineId: q.conceptLineId, quantity: 1 }];

    await vender(e.token, { paymentMethod: "cash", quoteId: q.quoteId, lines }).expect(201);
    await vender(e.token, { paymentMethod: "cash", quoteId: q.quoteId, lines }).expect(409);
  });
});
