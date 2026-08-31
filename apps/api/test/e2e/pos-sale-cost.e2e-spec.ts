import { randomUUID } from "node:crypto";
import type { INestApplication } from "@nestjs/common";
import { Test, TestingModule } from "@nestjs/testing";
import request from "supertest";
import type { App } from "supertest/types";
import { AppModule } from "../../src/app.module";
import { PrismaService } from "../../src/infrastructure/prisma/prisma.service";
import { MAILER } from "../../src/modules/mail/mailer.port";
import { NoopMailer } from "../../src/modules/mail/noop.mailer";
import { extractTokenFromLink } from "./support/extract-token-from-link";
import { startTestApp } from "./support/start-test-app";

/**
 * F5-DASH-01 — el snapshot de costo en la venta.
 *
 * `sale_items` guarda precio pero no costo, así que la utilidad de una venta
 * pasada era incalculable. Desde ahora, al cobrar, cada línea congela el
 * costo promedio ponderado VIGENTE (F5-COST-01) — la decisión de Carlos
 * (2026-08-31) fue exactitud sobre historia: nada de rellenar ventas viejas
 * con el promedio de hoy y llamarlo margen.
 *
 * El costo se guarda POR LA UNIDAD VENDIDA (la presentación), igual que el
 * precio: si el promedio base es $10 y se vende una Caja ×12, la línea dice
 * 120 — así `(unitPrice − unitCost) × quantity` funciona sin saber de
 * factores. Esa simetría es el contrato.
 */
describe("El snapshot de costo en la venta (F5-DASH-01)", () => {
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
    const email = `cost-${randomUUID()}@example.com`;
    await request(app.getHttpServer())
      .post("/auth/register-tenant")
      .send({
        tenantName: `Tenant costo ${randomUUID()}`,
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

  /** Producto con presentación Pieza (factor 1) vendible a $50. */
  async function producto(tenantId: string) {
    return prisma.withTenantContext(tenantId, async (tx) => {
      const almacen = await tx.warehouse.findFirstOrThrow({ select: { id: true } });
      const creado = await tx.product.create({
        data: { tenantId, sku: `C-${randomUUID().slice(0, 8)}`, name: "Ibuprofeno" },
      });
      await tx.productPresentation.create({
        data: {
          tenantId,
          productId: creado.id,
          name: "Pieza",
          factor: "1",
          price: "50.00",
          isDefaultSale: true,
          allowFractionalInput: false,
        },
      });
      return { productoId: creado.id, almacenId: almacen.id };
    });
  }

  /** Una COMPRA real: entrada confirmada con motivo factura y costo unitario. */
  async function comprar(
    token: string,
    almacenId: string,
    productoId: string,
    cantidad: number,
    costo: number,
  ) {
    const doc = await request(app.getHttpServer())
      .post("/inventory/documents")
      .set("Authorization", bearer(token))
      .send({ type: "entry", warehouseId: almacenId })
      .expect(201);
    const docId = (doc.body as { id: string }).id;
    await request(app.getHttpServer())
      .patch(`/inventory/documents/${docId}`)
      .set("Authorization", bearer(token))
      .send({ reasonCode: "invoice", reference: `F-${randomUUID().slice(0, 6)}` })
      .expect(200);
    await request(app.getHttpServer())
      .post(`/inventory/documents/${docId}/lines`)
      .set("Authorization", bearer(token))
      .send({ productId: productoId, quantity: cantidad, unitCost: costo })
      .expect(201);
    await request(app.getHttpServer())
      .post(`/inventory/documents/${docId}/confirm`)
      .set("Authorization", bearer(token))
      .send({})
      .expect(201);
  }

  const vender = (token: string, body: Record<string, unknown>) =>
    request(app.getHttpServer()).post("/pos/sales").set("Authorization", bearer(token)).send(body);

  /** El unit_cost guardado en las líneas de la última venta del tenant. */
  async function costosGuardados(tenantId: string): Promise<(string | null)[]> {
    const venta = await prisma.withTenantContext(tenantId, (tx) =>
      tx.sale.findFirstOrThrow({
        orderBy: { createdAt: "desc" },
        include: { items: { orderBy: { lineNo: "asc" } } },
      }),
    );
    return venta.items.map((item) => item.unitCost?.toString() ?? null);
  }

  it("sin costo en el catálogo, la RED es el promedio ponderado de compras", async () => {
    const { token, tenantId } = await registerAndLogin();
    const { productoId, almacenId } = await producto(tenantId);
    // 10 piezas a $10 y 10 a $20 → promedio $15. Las facturas dejan el
    // catálogo en $20 (la última) — se borra a propósito para probar la red:
    // un catálogo sin costo no deja la utilidad ciega si hay historial.
    await comprar(token, almacenId, productoId, 10, 10);
    await comprar(token, almacenId, productoId, 10, 20);
    await prisma.withTenantContext(tenantId, (tx) =>
      tx.productPresentation.updateMany({
        where: { productId: productoId },
        data: { cost: null },
      }),
    );
    await request(app.getHttpServer())
      .post("/pos/session")
      .set("Authorization", bearer(token))
      .send({})
      .expect(201);

    await vender(token, {
      paymentMethod: "cash",
      lines: [{ productId: productoId, quantity: 1 }],
    }).expect(201);

    expect(await costosGuardados(tenantId)).toEqual(["15"]);
  });

  it("el costo se guarda por la unidad VENDIDA: una Caja ×12 congela el promedio ×12", async () => {
    const { token, tenantId } = await registerAndLogin();
    const { productoId, almacenId } = await producto(tenantId);
    const cajaId = await prisma.withTenantContext(tenantId, async (tx) => {
      const caja = await tx.productPresentation.create({
        data: {
          tenantId,
          productId: productoId,
          name: "Caja ×12",
          factor: "12",
          price: "540.00",
          allowFractionalInput: false,
        },
      });
      return caja.id;
    });
    await comprar(token, almacenId, productoId, 100, 10);
    await request(app.getHttpServer())
      .post("/pos/session")
      .set("Authorization", bearer(token))
      .send({})
      .expect(201);

    await vender(token, {
      paymentMethod: "cash",
      lines: [{ productId: productoId, presentationId: cajaId, quantity: 1 }],
    }).expect(201);

    // Promedio base $10 × factor 12 = $120: la misma unidad que unitPrice.
    expect(await costosGuardados(tenantId)).toEqual(["120"]);
  });

  it("un producto jamás comprado con costo guarda null, no un 0 fingido", async () => {
    const { token, tenantId } = await registerAndLogin();
    const { productoId, almacenId } = await producto(tenantId);
    // Stock por AJUSTE, sin costo: hay qué vender pero no hay historial de compra.
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
      .send({ productId: productoId, quantity: 5 })
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

    // La venta NO se bloquea por no tener costo: sale, y el costo queda null.
    await vender(token, {
      paymentMethod: "cash",
      lines: [{ productId: productoId, quantity: 1 }],
    }).expect(201);

    expect(await costosGuardados(tenantId)).toEqual([null]);
  });

  it("un servicio congela el costo de SU catálogo: ahí es donde vive (Carlos, 2026-09-01)", async () => {
    const { token, tenantId } = await registerAndLogin();
    const almacenId = await prisma.withTenantContext(tenantId, async (tx) => {
      const almacen = await tx.warehouse.findFirstOrThrow({ select: { id: true } });
      return almacen.id;
    });
    const servicio = await request(app.getHttpServer())
      .post("/services")
      .set("Authorization", bearer(token))
      .send({
        code: `SRV-${randomUUID().slice(0, 8)}`,
        name: "Consulta Médica Básica",
        cost: 10,
        price: 50,
        warehouseIds: [almacenId],
      })
      .expect(201);
    await request(app.getHttpServer())
      .post("/pos/session")
      .set("Authorization", bearer(token))
      .send({})
      .expect(201);

    await vender(token, {
      paymentMethod: "cash",
      lines: [{ serviceId: (servicio.body as { id: string }).id, quantity: 1 }],
    }).expect(201);

    expect(await costosGuardados(tenantId)).toEqual(["10"]);
  });

  it("el costo de CATÁLOGO de la presentación gana al promedio de compras", async () => {
    const { token, tenantId } = await registerAndLogin();
    const { productoId, almacenId } = await producto(tenantId);
    // Compras a $10 y $20 (promedio 15)… pero el catálogo declara $12: el
    // catálogo es la fuente que el dueño ve y edita — manda (Carlos,
    // 2026-09-01). El promedio queda de red para catálogos sin costo.
    await comprar(token, almacenId, productoId, 10, 10);
    await comprar(token, almacenId, productoId, 10, 20);
    await prisma.withTenantContext(tenantId, (tx) =>
      tx.productPresentation.updateMany({
        where: { productId: productoId },
        data: { cost: "12" },
      }),
    );
    await request(app.getHttpServer())
      .post("/pos/session")
      .set("Authorization", bearer(token))
      .send({})
      .expect(201);

    await vender(token, {
      paymentMethod: "cash",
      lines: [{ productId: productoId, quantity: 1 }],
    }).expect(201);

    expect(await costosGuardados(tenantId)).toEqual(["12"]);
  });

  it("la entrada por FACTURA actualiza el costo del catálogo", async () => {
    const { token, tenantId } = await registerAndLogin();
    const { productoId, almacenId } = await producto(tenantId);

    await comprar(token, almacenId, productoId, 5, 18);

    const presentacion = await prisma.withTenantContext(tenantId, (tx) =>
      tx.productPresentation.findFirstOrThrow({
        where: { productId: productoId },
        select: { cost: true },
      }),
    );
    // La factura es la verdad más fresca del costo: el catálogo se actualiza
    // solo — y la siguiente venta congela este número.
    expect(presentacion.cost?.toString()).toBe("18");
  });

  it("una venta de servicio SIN costo en catálogo guarda null: no hay 0 fingido", async () => {
    const { token, tenantId } = await registerAndLogin();
    const almacenId = await prisma.withTenantContext(tenantId, async (tx) => {
      const almacen = await tx.warehouse.findFirstOrThrow({ select: { id: true } });
      return almacen.id;
    });
    const servicio = await request(app.getHttpServer())
      .post("/services")
      .set("Authorization", bearer(token))
      .send({
        code: `SRV-${randomUUID().slice(0, 8)}`,
        name: "Consulta",
        price: 200,
        warehouseIds: [almacenId],
      })
      .expect(201);
    await request(app.getHttpServer())
      .post("/pos/session")
      .set("Authorization", bearer(token))
      .send({})
      .expect(201);

    await vender(token, {
      paymentMethod: "cash",
      lines: [{ serviceId: (servicio.body as { id: string }).id, quantity: 1 }],
    }).expect(201);

    expect(await costosGuardados(tenantId)).toEqual([null]);
  });
});
