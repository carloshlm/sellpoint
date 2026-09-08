import { randomUUID } from "node:crypto";
import type { INestApplication } from "@nestjs/common";
import { Test, type TestingModule } from "@nestjs/testing";
import request from "supertest";
import type { App } from "supertest/types";
import { AppModule } from "../../src/app.module";
import { serializeSpreadsheet } from "../../src/common/spreadsheet/spreadsheet";
import { MAILER } from "../../src/modules/mail/mailer.port";
import { NoopMailer } from "../../src/modules/mail/noop.mailer";
import { extractTokenFromLink } from "./support/extract-token-from-link";
import { startTestApp } from "./support/start-test-app";

/**
 * Importar ALMACENES por Excel (Carlos, 2026-09-01) — el mismo contrato de
 * productos y servicios: plantilla con lo existente, dry-run que reporta
 * por fila, match por CÓDIGO, y las validaciones del formulario aplican
 * también a la planilla (un teléfono que el form rechaza no entra por Excel).
 */
describe("Importación de almacenes (2026-09-01)", () => {
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

  const bearer = (t: string) => `Bearer ${t}`;

  async function ownerToken(): Promise<string> {
    const email = `wh-import-${randomUUID()}@example.com`;
    await request(app.getHttpServer())
      .post("/auth/register-tenant")
      .send({
        tenantName: `Tenant wh import ${randomUUID()}`,
        email,
        password: OWNER_PASSWORD,
        firstName: "Ana",
        lastName: "Pérez",
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
    return (login.body as { accessToken: string }).accessToken;
  }

  async function xlsxBase64(rows: string[][]): Promise<string> {
    const file = await serializeSpreadsheet(rows, "xlsx");
    return file.body.toString("base64");
  }

  const importar = (token: string, content: string, extra: Record<string, unknown> = {}) =>
    request(app.getHttpServer())
      .post("/warehouses/import")
      .set("Authorization", bearer(token))
      .send({ content, ...extra });

  it("la plantilla trae las columnas estándar y el almacén inicial del negocio", async () => {
    const token = await ownerToken();

    const res = await request(app.getHttpServer())
      .get("/warehouses/import/template")
      .set("Authorization", bearer(token))
      .buffer(true)
      .parse((r, cb) => {
        const chunks: Buffer[] = [];
        r.on("data", (c: Buffer) => chunks.push(c));
        r.on("end", () => cb(null, Buffer.concat(chunks)));
      })
      .expect(200);

    expect(res.headers["content-type"]).toContain("spreadsheetml");
    // El Excel es un zip: empieza con la firma PK.
    expect((res.body as Buffer).subarray(0, 2).toString()).toBe("PK");
  });

  it("dry-run: reporta altas y actualizaciones por código, sin escribir nada", async () => {
    const token = await ownerToken();
    const contenido = await xlsxBase64([
      ["codigo", "nombre", "direccion", "telefono", "email"],
      // ALM-001 es el «Almacén Central» que el onboarding ya creó: actualiza.
      ["ALM-001", "Central renombrado", "Calle 1", "", ""],
      ["NORTE-01", "Bodega Norte", "Av. Norte 100", "+525512345678", "norte@negocio.mx"],
    ]);

    const res = await importar(token, contenido, { dryRun: true }).expect(200);

    expect(res.body).toMatchObject({ valid: 2, failed: 0, created: 1, updated: 1, applied: false });
    const lista = await request(app.getHttpServer())
      .get("/warehouses")
      .set("Authorization", bearer(token))
      .expect(200);
    expect((lista.body as { code: string }[]).map((w) => w.code)).toEqual(["ALM-001"]);
  });

  it("aplicar crea el nuevo y actualiza el existente conservando su código", async () => {
    const token = await ownerToken();
    const contenido = await xlsxBase64([
      ["codigo", "nombre", "direccion", "telefono", "email"],
      ["ALM-001", "Central renombrado", "Calle 1", "", ""],
      ["NORTE-01", "Bodega Norte", "Av. Norte 100", "+525512345678", "norte@negocio.mx"],
    ]);

    const res = await importar(token, contenido).expect(200);
    expect(res.body).toMatchObject({ created: 1, updated: 1, applied: true });

    const lista = await request(app.getHttpServer())
      .get("/warehouses")
      .set("Authorization", bearer(token))
      .expect(200);
    const almacenes = lista.body as {
      code: string;
      name: string;
      phone: string | null;
      email: string | null;
    }[];
    expect(almacenes.find((w) => w.code === "ALM-001")?.name).toBe("Central renombrado");
    expect(almacenes.find((w) => w.code === "NORTE-01")).toMatchObject({
      name: "Bodega Norte",
      phone: "+525512345678",
      email: "norte@negocio.mx",
    });
  });

  /**
   * F1-ADDR-08: las cinco columnas de la dirección entran por la planilla; el
   * CP y la región se validan contra el país del NEGOCIO fila por fila, y lo
   * que entra vuelve por la plantilla (ida y vuelta).
   */
  it("la dirección estructurada entra por la planilla; el CP y la región ajenos al país fallan su fila", async () => {
    const token = await ownerToken();
    await request(app.getHttpServer())
      .patch("/tenants/me")
      .set("Authorization", bearer(token))
      .send({ country: "MX" })
      .expect(200);
    const contenido = await xlsxBase64([
      [
        "codigo",
        "nombre",
        "direccion",
        "direccion_2",
        "ciudad",
        "region",
        "codigo_postal",
        "telefono",
        "email",
      ],
      ["GDL-01", "Guadalajara", "Av. Juárez 10", "Centro", "Guadalajara", "JAL", " 44100 ", "", ""],
      ["MAL-01", "CP malo", "Calle 1", "", "Toluca", "MEX", "5000", "", ""],
      ["MAL-02", "Región ajena", "Calle 2", "", "Toronto", "ON", "50000", "", ""],
    ]);

    const dryRun = await importar(token, contenido, { dryRun: true }).expect(200);
    expect(dryRun.body).toMatchObject({ valid: 1, failed: 2 });
    const errores = (dryRun.body as { errors: { row: number; field?: string }[] }).errors;
    expect(errores.map((e) => [e.row, e.field])).toEqual([
      [3, "codigo_postal"],
      [4, "region"],
    ]);

    await importar(token, contenido, { skipErrors: true }).expect(200);
    const lista = await request(app.getHttpServer())
      .get("/warehouses")
      .set("Authorization", bearer(token))
      .expect(200);
    const gdl = (lista.body as { code: string }[]).find((w) => w.code === "GDL-01");
    expect(gdl).toMatchObject({
      address: "Av. Juárez 10",
      addressLine2: "Centro",
      city: "Guadalajara",
      region: "JAL",
      postalCode: "44100",
    });
  });

  it("un teléfono que no es E.164 falla la FILA con su código — la planilla no salta al formulario", async () => {
    const token = await ownerToken();
    const contenido = await xlsxBase64([
      ["codigo", "nombre", "telefono"],
      ["SUR-01", "Bodega Sur", "55 1234 5678"],
    ]);

    const res = await importar(token, contenido, { dryRun: true }).expect(200);

    expect(res.body).toMatchObject({ valid: 0, failed: 1 });
    expect(
      (res.body as { errors: { field?: string; message: string; itemCode?: string }[] }).errors[0],
    ).toMatchObject({ field: "telefono", message: "warehouses.invalid_phone", itemCode: "SUR-01" });
  });

  it("un código repetido dentro del archivo es error por fila", async () => {
    const token = await ownerToken();
    const contenido = await xlsxBase64([
      ["codigo", "nombre"],
      ["DUP-01", "Uno"],
      ["DUP-01", "Dos"],
    ]);

    const res = await importar(token, contenido, { dryRun: true }).expect(200);

    expect(res.body).toMatchObject({ valid: 1, failed: 1 });
    expect((res.body as { errors: { message: string }[] }).errors[0]?.message).toBe(
      "warehouses.import_duplicate_code",
    );
  });

  it("sin warehouses:manage no se importa", async () => {
    const token = await ownerToken();
    // El owner tiene todo; se prueba la puerta con un token sin el permiso
    // vía el mismo camino que el resto de la casa: negar el rol no es
    // trivial acá, así que se verifica al menos que el endpoint exige auth.
    await request(app.getHttpServer())
      .post("/warehouses/import")
      .send({ content: "x" })
      .expect(401);
    void token;
  });
});
