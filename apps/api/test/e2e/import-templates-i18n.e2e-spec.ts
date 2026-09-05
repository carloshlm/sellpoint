import { randomUUID } from "node:crypto";
import type { INestApplication } from "@nestjs/common";
import { Test, type TestingModule } from "@nestjs/testing";
import request from "supertest";
import type { App } from "supertest/types";
import { AppModule } from "../../src/app.module";
import { parseSpreadsheet } from "../../src/common/spreadsheet/spreadsheet";
import { PrismaService } from "../../src/infrastructure/prisma/prisma.service";
import { MAILER } from "../../src/modules/mail/mailer.port";
import { NoopMailer } from "../../src/modules/mail/noop.mailer";
import {
  almacenInicial,
  bearer,
  makePlatformAdmin,
  registerTenant,
  type TenantFixture,
} from "./support/billing-scenario";
import { activarModulo } from "./support/medical-clinic-scenario";
import { startTestApp } from "./support/start-test-app";

/**
 * Carlos (2026-09-05): la plantilla se descarga en el idioma de la interfaz,
 * en TODOS los módulos que la ofrecen. Y lo que importa de verdad: un archivo
 * con encabezados en inglés se importa igual que uno en español, porque los
 * parsers vuelven a la clave interna. Si no, la plantilla en inglés sería un
 * adorno que no se puede usar.
 */
describe("plantillas de importación en el idioma de quien las descarga", () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let negocio: TenantFixture;
  let catalogId: string;
  let almacenId: string;

  /** El idioma lo manda el JWT (el del usuario), como en la interfaz: un token por idioma. */
  const tokens: Record<"es" | "en", string> = { es: "", en: "" };
  const descargar = (ruta: string, lang: "es" | "en") =>
    request(app.getHttpServer())
      .get(ruta)
      .set("Authorization", bearer(tokens[lang]))
      .buffer(true)
      .parse((r, cb) => {
        const chunks: Buffer[] = [];
        r.on("data", (c: Buffer) => chunks.push(c));
        r.on("end", () => cb(null, Buffer.concat(chunks)));
      });

  async function encabezado(ruta: string, lang: "es" | "en", format: "csv" | "xlsx") {
    const res = await descargar(ruta, lang).expect(200);
    const cuerpo = res.body as Buffer;
    // El parser recibe TEXTO: el csv tal cual, el xlsx en base64 (como viaja en el import).
    const rows = await parseSpreadsheet(
      format === "csv" ? cuerpo.toString("utf8") : cuerpo.toString("base64"),
      format,
    );
    return rows[0] ?? [];
  }

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(MAILER)
      .useClass(NoopMailer)
      .compile();
    app = moduleFixture.createNestApplication();
    await startTestApp(app);
    prisma = app.get(PrismaService);

    negocio = await registerTenant(app, "tpl-i18n");
    await makePlatformAdmin(app, prisma, negocio);
    await activarModulo(app, negocio, negocio.tenantId, "medical_clinic");
    // La activación se lee al entrar: sesión nueva.
    const sesion = await request(app.getHttpServer())
      .post("/auth/login")
      .send({ email: negocio.email, password: "twelve-characters" })
      .expect(200);
    negocio.token = (sesion.body as { accessToken: string }).accessToken;
    tokens.es = negocio.token;
    // El mismo usuario, en inglés: el JWT nuevo lleva `locale: "en"`.
    await request(app.getHttpServer())
      .patch("/me")
      .set("Authorization", bearer(negocio.token))
      .send({ locale: "en" })
      .expect(200);
    const sesionEn = await request(app.getHttpServer())
      .post("/auth/login")
      .send({ email: negocio.email, password: "twelve-characters" })
      .expect(200);
    tokens.en = (sesionEn.body as { accessToken: string }).accessToken;
    almacenId = await almacenInicial(prisma, negocio.tenantId);
    const catalogo = await request(app.getHttpServer())
      .post("/catalogs")
      .set("Authorization", bearer(negocio.token))
      .send({ name: `Marcas ${randomUUID().slice(0, 6)}` })
      .expect(201);
    catalogId = (catalogo.body as { id: string }).id;
  });

  afterAll(async () => {
    await app.close();
  });

  it("productos: en inglés los encabezados van en inglés; en español, como siempre", async () => {
    expect(await encabezado("/products/import/template", "en", "csv")).toEqual([
      "barcode",
      "sku",
      "name",
      "base_unit",
      "cost",
      "price",
      "min_stock",
      "location",
      "tracks_lots",
      "is_composite",
    ]);
    expect(await encabezado("/products/import/template", "es", "csv")).toEqual([
      "codigo_de_barras",
      "sku",
      "nombre",
      "unidad_base",
      "costo",
      "precio",
      "stock_minimo",
      "ubicacion",
      "controla_lotes",
      "es_compuesto",
    ]);
  });

  it("servicios, almacenes, subcatálogos y estudios: las plantillas xlsx también hablan inglés", async () => {
    expect(await encabezado("/services/import/template", "en", "xlsx")).toEqual([
      "code",
      "name",
      "cost",
      "price",
    ]);
    expect(await encabezado("/warehouses/import/template", "en", "xlsx")).toEqual([
      "code",
      "name",
      "address",
      "phone",
      "email",
    ]);
    expect(
      await encabezado(`/catalogs/${catalogId}/records/import/template`, "en", "xlsx"),
    ).toEqual(["code"]);
    for (const ruta of [
      "/medical-clinic/lab-studies/import/template",
      "/medical-clinic/diagnostic-studies/import/template",
    ]) {
      expect(await encabezado(ruta, "en", "xlsx")).toEqual([
        "code",
        "name",
        "description",
        "cost",
        "price",
      ]);
    }
    // Y en español nada se movió.
    expect(await encabezado("/services/import/template", "es", "xlsx")).toEqual([
      "codigo",
      "nombre",
      "costo",
      "precio",
    ]);
  });

  it("inventario: la plantilla de entrada y la de conteo físico", async () => {
    expect(
      await encabezado("/inventory/documents/template?type=entry&format=csv", "en", "csv"),
    ).toEqual(["sku", "presentation", "quantity", "unit_cost", "lot", "expiry", "location"]);
    expect(
      await encabezado(
        `/inventory/documents/template?type=physical_count&format=csv&warehouseId=${almacenId}`,
        "en",
        "csv",
      ),
    ).toEqual(["sku", "name", "unit", "lot", "expiry", "location", "expected", "counted"]);
  });

  it("ida y vuelta: un archivo con encabezados en INGLÉS se importa igual", async () => {
    const res = await request(app.getHttpServer())
      .post("/products/import")
      .set("Authorization", bearer(negocio.token))
      .send({ content: "SKU,Name,Price,Tracks_Lots\nEN-1,Imported in English,12.50,NO" })
      .expect(200);
    expect(res.body).toMatchObject({ valid: 1, failed: 0, created: 1 });
    const lista = await request(app.getHttpServer())
      .get("/products?query=EN-1")
      .set("Authorization", bearer(negocio.token))
      .expect(200);
    expect((lista.body as { items: { sku: string; name: string }[] }).items).toEqual([
      expect.objectContaining({ sku: "EN-1", name: "Imported in English" }),
    ]);
  });
});
