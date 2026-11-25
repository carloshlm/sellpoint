import { randomUUID } from "node:crypto";
import type { INestApplication } from "@nestjs/common";
import { Test, type TestingModule } from "@nestjs/testing";
import request from "supertest";
import type { App } from "supertest/types";
import { AppModule } from "../../src/app.module";
import { MAILER } from "../../src/modules/mail/mailer.port";
import { NoopMailer } from "../../src/modules/mail/noop.mailer";
import { extractTokenFromLink } from "./support/extract-token-from-link";
import { startTestApp } from "./support/start-test-app";

/**
 * F10-BULK-07 — el buscador de Entradas, Salidas y Traspasos ofrece cada
 * presentación del producto como un botón («Kilogramo · Bolsa 1 Kg · Bolsa
 * 10 Kg»). Para pintarlos sin pedir el detalle de cada resultado, `GET
 * /products` trae las presentaciones de cada producto de la página: id,
 * nombre, factor y si está activa.
 *
 * Carlos (2026-11-25): «entrada de 2 Bolsas de 1 Kg de queso, 1 Bolsa de 10Kg
 * de Queso, 600 gramos de queso … sea consistente el sistema además fácil e
 * intuitivo para el tenant».
 */
describe("El listado de productos trae sus presentaciones (F10-BULK-07)", () => {
  let app: INestApplication<App>;
  const OWNER_PASSWORD = "twelve-characters";

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(MAILER)
      .useClass(NoopMailer)
      .compile();
    app = moduleFixture.createNestApplication();
    await startTestApp(app);
  });

  afterAll(async () => {
    await app.close();
  });

  async function registerAndLogin(): Promise<string> {
    const email = `owner-${randomUUID()}@example.com`;
    await request(app.getHttpServer())
      .post("/auth/register-tenant")
      .send({
        tenantName: `Tenant bulk07 ${randomUUID()}`,
        email,
        password: OWNER_PASSWORD,
        firstName: "Ana",
        lastName: "Pérez",
        locale: "es",
      })
      .expect(201);

    const mailer = app.get<NoopMailer>(MAILER);
    const token = extractTokenFromLink(mailer.sent.find((m) => m.to === email)?.vars.link);
    await request(app.getHttpServer()).post("/auth/verify-email").send({ token }).expect(200);

    const login = await request(app.getHttpServer())
      .post("/auth/login")
      .send({ email, password: OWNER_PASSWORD })
      .expect(200);
    return (login.body as { accessToken: string }).accessToken;
  }

  const bearer = (token: string) => `Bearer ${token}`;

  async function crearProducto(token: string, body: Record<string, unknown>) {
    const res = await request(app.getHttpServer())
      .post("/products")
      .set("Authorization", bearer(token))
      .send({ baseUnit: "kg", price: 185, ...body })
      .expect(201);
    return res.body as { id: string };
  }

  async function crearPresentacion(
    token: string,
    productId: string,
    body: Record<string, unknown>,
  ) {
    const res = await request(app.getHttpServer())
      .post(`/products/${productId}/presentations`)
      .set("Authorization", bearer(token))
      .send(body)
      .expect(201);
    return res.body as { id: string };
  }

  type Listed = {
    id: string;
    price: string | null;
    matchedPresentation: { id: string; name: string } | null;
    presentations: {
      id: string;
      name: string;
      factor: string;
      isActive: boolean;
      isBase: boolean;
    }[];
  };

  const buscar = (token: string, query?: string) =>
    request(app.getHttpServer())
      .get("/products")
      .query(query === undefined ? {} : { query })
      .set("Authorization", bearer(token))
      .expect(200)
      .then((res) => (res.body as { items: Listed[] }).items);

  it("cada resultado trae sus presentaciones con id, nombre, factor, si está activa y si es la base, de la menor a la mayor", async () => {
    const token = await registerAndLogin();
    const queso = await crearProducto(token, { sku: "QUESO-OAX", name: "Queso Oaxaca" });
    const diez = await crearPresentacion(token, queso.id, { name: "Bolsa 10 Kg", factor: 10 });
    const uno = await crearPresentacion(token, queso.id, { name: "Bolsa 1 Kg", factor: 1 });
    const vieja = await crearPresentacion(token, queso.id, { name: "Bolsa 5 Kg", factor: 5 });
    await request(app.getHttpServer())
      .patch(`/products/${queso.id}/presentations/${vieja.id}`)
      .set("Authorization", bearer(token))
      .send({ isActive: false })
      .expect(200);

    const [item] = await buscar(token, "queso");

    // La presentación base nace con el producto y con el nombre de su unidad.
    // Solo ella lleva `isBase`: «Bolsa 1 Kg» también vale 1, pero es un empaque.
    const base = item?.presentations.find((p) => p.name === "Kilogramo");
    expect(item?.presentations).toEqual([
      { id: base?.id, name: "Kilogramo", factor: "1", isActive: true, isBase: true },
      { id: uno.id, name: "Bolsa 1 Kg", factor: "1", isActive: true, isBase: false },
      { id: vieja.id, name: "Bolsa 5 Kg", factor: "5", isActive: false, isBase: false },
      { id: diez.id, name: "Bolsa 10 Kg", factor: "10", isActive: true, isBase: false },
    ]);
  });

  it("el precio y la presentación encontrada por su código siguen como antes", async () => {
    const token = await registerAndLogin();
    const queso = await crearProducto(token, { sku: "QUESO-OAX", name: "Queso Oaxaca" });
    const diez = await crearPresentacion(token, queso.id, {
      name: "Bolsa 10 Kg",
      factor: 10,
      code: "BOLSA10K",
    });

    const [porNombre] = await buscar(token, "queso");
    expect(porNombre).toEqual(
      expect.objectContaining({ id: queso.id, price: "185", matchedPresentation: null }),
    );

    const [porCodigo] = await buscar(token, "BOLSA10K");
    expect(porCodigo).toEqual(
      expect.objectContaining({
        id: queso.id,
        matchedPresentation: { id: diez.id, name: "Bolsa 10 Kg" },
      }),
    );
    expect(porCodigo?.presentations.map((p) => p.name)).toEqual(["Kilogramo", "Bolsa 10 Kg"]);
  });

  it("sin término también las trae, y cada producto solo las suyas", async () => {
    const token = await registerAndLogin();
    const queso = await crearProducto(token, { sku: "QUESO-OAX", name: "Queso Oaxaca" });
    await crearPresentacion(token, queso.id, { name: "Bolsa 10 Kg", factor: 10 });
    const agua = await crearProducto(token, { sku: "AGUA-1L", name: "Agua 1 L", baseUnit: "unit" });

    const items = await buscar(token);

    expect(items.find((i) => i.id === queso.id)?.presentations.map((p) => p.name)).toEqual([
      "Kilogramo",
      "Bolsa 10 Kg",
    ]);
    expect(items.find((i) => i.id === agua.id)?.presentations.map((p) => p.name)).toEqual([
      "Pieza",
    ]);
  });
});
