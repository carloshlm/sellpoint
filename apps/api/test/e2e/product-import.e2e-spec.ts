import { randomUUID } from "node:crypto";
import type { INestApplication } from "@nestjs/common";
import type { NestExpressApplication } from "@nestjs/platform-express";
import { Test, type TestingModule } from "@nestjs/testing";
import request from "supertest";
import type { App } from "supertest/types";
import { AppModule } from "../../src/app.module";
import { MAILER } from "../../src/modules/mail/mailer.port";
import { NoopMailer } from "../../src/modules/mail/noop.mailer";
import { extractTokenFromLink } from "./support/extract-token-from-link";

/**
 * F2-IMPORT. El flujo obligatorio es dos pasos: dry-run que reporta fila por
 * fila, y recién después la importación real.
 */
describe("Importación de productos (F2-IMPORT)", () => {
  let app: INestApplication<App> & NestExpressApplication;
  const OWNER_PASSWORD = "twelve-characters";

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(MAILER)
      .useClass(NoopMailer)
      .compile();
    app = moduleFixture.createNestApplication<NestExpressApplication>();
    // `createNestApplication()` no pasa por `main.ts`, así que la config del
    // body parser hay que repetirla acá — mismo patrón que otros e2e con
    // `cookieParser`. Sin esto el límite es el default de 100 kB y el test del
    // archivo grande mediría al parser, no a la regla de negocio.
    (app as NestExpressApplication).useBodyParser("json", { limit: "6mb" });
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  async function registerAndLogin(): Promise<string> {
    const email = `owner-${randomUUID()}@example.com`;
    await request(app.getHttpServer())
      .post("/auth/register-tenant")
      .send({
        tenantName: `Tenant import ${randomUUID()}`,
        email,
        password: OWNER_PASSWORD,
        firstName: "Ana",
        lastNamePaternal: "Pérez",
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

  it("la plantilla incluye los campos VIGENTES del catálogo", async () => {
    const token = await registerAndLogin();
    const catalogs = await request(app.getHttpServer())
      .get("/catalogs")
      .set("Authorization", bearer(token))
      .expect(200);
    const productsCatalog = (catalogs.body as { id: string; isSystem: boolean }[]).find(
      (catalog) => catalog.isSystem,
    );

    await request(app.getHttpServer())
      .post(`/catalogs/${productsCatalog?.id}/fields`)
      .set("Authorization", bearer(token))
      .send({ label: "Laboratorio", fieldType: "text" })
      .expect(201);

    const template = await request(app.getHttpServer())
      .get("/products/import/template")
      .set("Authorization", bearer(token))
      .expect(200);

    // La columna nueva aparece sin que nadie mantenga una lista aparte.
    expect(template.text).toContain("laboratorio");
    expect(template.text).toContain("sku");
    // BOM para que Excel muestre bien los acentos.
    expect(template.text.charCodeAt(0)).toBe(0xfeff);
  });

  it("el dry-run reporta sin escribir NADA", async () => {
    const token = await registerAndLogin();
    const content = "sku,nombre\nPAR-500,Paracetamol\n,,\nSIN-NOMBRE,";

    const report = await request(app.getHttpServer())
      .post("/products/import")
      .set("Authorization", bearer(token))
      .send({ content, dryRun: true })
      .expect(200);

    expect(report.body).toMatchObject({ valid: 1, failed: 1, imported: 0 });

    const list = await request(app.getHttpServer())
      .get("/products")
      .set("Authorization", bearer(token))
      .expect(200);
    expect((list.body as { total: number }).total).toBe(0);
  });

  it("sin skipErrors es TODO O NADA: un archivo con errores no importa nada", async () => {
    const token = await registerAndLogin();
    const content = "sku,nombre\nOK-1,Bueno\nSIN-NOMBRE,";

    await request(app.getHttpServer())
      .post("/products/import")
      .set("Authorization", bearer(token))
      .send({ content })
      .expect(400);

    const list = await request(app.getHttpServer())
      .get("/products")
      .set("Authorization", bearer(token))
      .expect(200);
    expect((list.body as { total: number }).total).toBe(0);
  });

  it("con skipErrors importa las válidas y reporta las fallidas", async () => {
    const token = await registerAndLogin();
    const content = "sku,nombre,precio\nOK-1,Bueno,10\nSIN-NOMBRE,\nOK-2,Otro,20";

    const result = await request(app.getHttpServer())
      .post("/products/import")
      .set("Authorization", bearer(token))
      .send({ content, skipErrors: true })
      .expect(200);

    expect(result.body).toMatchObject({ imported: 2, failed: 1 });

    const list = await request(app.getHttpServer())
      .get("/products")
      .set("Authorization", bearer(token))
      .expect(200);
    expect((list.body as { total: number }).total).toBe(2);
  });

  it("detecta SKU repetido DENTRO del archivo, no solo contra la base", async () => {
    // La DB no lo vería hasta el segundo INSERT, y para entonces el primero
    // ya entró.
    const token = await registerAndLogin();
    const content = "sku,nombre\nDUP,Uno\nDUP,Dos";

    const report = await request(app.getHttpServer())
      .post("/products/import")
      .set("Authorization", bearer(token))
      .send({ content, dryRun: true })
      .expect(200);

    expect(report.body).toMatchObject({ valid: 1, failed: 1 });
    expect((report.body as { errors: { row: number }[] }).errors[0]?.row).toBe(3);
  });

  it("el número de fila que se reporta es el que el usuario ve en Excel", async () => {
    const token = await registerAndLogin();
    // Fila 1 = encabezado, fila 2 = primer producto, fila 3 = el que falla.
    const content = "sku,nombre\nOK,Bueno\n,Sin sku";

    const report = await request(app.getHttpServer())
      .post("/products/import")
      .set("Authorization", bearer(token))
      .send({ content, dryRun: true })
      .expect(200);

    expect((report.body as { errors: { row: number }[] }).errors[0]?.row).toBe(3);
  });

  it("un archivo de más de 5 MB se rechaza con 413", async () => {
    const token = await registerAndLogin();
    const huge = `sku,nombre\n${"X".repeat(5 * 1024 * 1024 + 10)},Grande`;

    await request(app.getHttpServer())
      .post("/products/import")
      .set("Authorization", bearer(token))
      .send({ content: huge, dryRun: true })
      .expect(413);
  });

  it("la plantilla trae los productos ya dados de alta, no solo los encabezados", async () => {
    const token = await registerAndLogin();
    await request(app.getHttpServer())
      .post("/products/import")
      .set("Authorization", bearer(token))
      .send({ content: "sku,nombre,precio\nEXIST-1,Ya existe,33.50" })
      .expect(200);

    const template = await request(app.getHttpServer())
      .get("/products/import/template")
      .set("Authorization", bearer(token))
      .expect(200);

    expect(template.text).toContain("EXIST-1");
    expect(template.text).toContain("Ya existe");
    // El precio vive en la presentación default: si no viajara, bajar la
    // plantilla y volver a subirla borraría los precios.
    expect(template.text).toContain("33.5");
  });

  it("volver a subir la plantilla ACTUALIZA en vez de fallar por SKU repetido", async () => {
    const token = await registerAndLogin();
    await request(app.getHttpServer())
      .post("/products/import")
      .set("Authorization", bearer(token))
      .send({ content: "sku,nombre,precio\nUP-1,Nombre viejo,10" })
      .expect(200);

    const result = await request(app.getHttpServer())
      .post("/products/import")
      .set("Authorization", bearer(token))
      .send({ content: "sku,nombre,precio\nUP-1,Nombre nuevo,25" })
      .expect(200);

    // Se reconoce como actualización ANTES de escribir: el usuario lo ve en el
    // dry-run, no se entera después.
    expect(result.body).toMatchObject({ created: 0, updated: 1, imported: 1 });

    const list = await request(app.getHttpServer())
      .get("/products")
      .set("Authorization", bearer(token))
      .expect(200);
    const body = list.body as { total: number; items: { name: string; price: string }[] };
    // Sigue habiendo UNO: se actualizó, no se duplicó.
    expect(body.total).toBe(1);
    expect(body.items[0]?.name).toBe("Nombre nuevo");
    expect(body.items[0]?.price).toBe("25");
  });

  it("la plantilla xlsx se descarga y se vuelve a subir tal cual (round-trip binario)", async () => {
    const token = await registerAndLogin();
    await request(app.getHttpServer())
      .post("/products/import")
      .set("Authorization", bearer(token))
      .send({ content: "sku,nombre,precio\nXLS-1,Producto Excel,15" })
      .expect(200);

    const template = await request(app.getHttpServer())
      .get("/products/import/template?format=xlsx")
      .set("Authorization", bearer(token))
      .responseType("blob")
      .expect(200);

    expect(template.headers["content-type"]).toContain("spreadsheetml");
    // Firma de un ZIP: un .xlsx es un ZIP. Si saliera CSV, esto no coincide.
    expect((template.body as Buffer).subarray(0, 2).toString()).toBe("PK");

    const report = await request(app.getHttpServer())
      .post("/products/import")
      .set("Authorization", bearer(token))
      .send({
        content: (template.body as Buffer).toString("base64"),
        format: "xlsx",
        dryRun: true,
      })
      .expect(200);

    // La fila del producto existente se lee y se reconoce como actualización.
    expect(report.body).toMatchObject({ valid: 1, failed: 0, created: 0, updated: 1 });
  });

  it("un xlsx recortado se rechaza con 400, no revienta el proceso", async () => {
    const token = await registerAndLogin();

    await request(app.getHttpServer())
      .post("/products/import")
      .set("Authorization", bearer(token))
      .send({ content: Buffer.from("no soy un xlsx").toString("base64"), format: "xlsx" })
      .expect(400);
  });

  it("los productos importados nacen con su presentación base y su precio", async () => {
    const token = await registerAndLogin();

    await request(app.getHttpServer())
      .post("/products/import")
      .set("Authorization", bearer(token))
      .send({ content: "sku,nombre,precio,unidad_base\nGR-1,Café molido,120,gr" })
      .expect(200);

    const list = await request(app.getHttpServer())
      .get("/products")
      .set("Authorization", bearer(token))
      .expect(200);
    const item = (list.body as { items: { id: string; price: string }[] }).items[0];
    expect(item?.price).toBe("120");

    const detail = await request(app.getHttpServer())
      .get(`/products/${item?.id}`)
      .set("Authorization", bearer(token))
      .expect(200);
    // `gr` es categoría weight: admite decimales.
    expect(
      (detail.body as { presentations: { allowFractionalInput: boolean }[] }).presentations[0]
        ?.allowFractionalInput,
    ).toBe(true);
  });
});
