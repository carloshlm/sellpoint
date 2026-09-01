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
 * Importar registros de un SUBCATÁLOGO por Excel (Carlos, 2026-09-01) —
 * cualquier subcatálogo (laboratorios, proveedores, unidades…), con su único
 * campo estándar (el código) más sus campos personalizados. El match es por
 * código, igual que productos, servicios y almacenes.
 */
describe("Importación de registros de subcatálogo (2026-09-01)", () => {
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
    const email = `rec-import-${randomUUID()}@example.com`;
    await request(app.getHttpServer())
      .post("/auth/register-tenant")
      .send({
        tenantName: `Tenant rec import ${randomUUID()}`,
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
    return (login.body as { accessToken: string }).accessToken;
  }

  /** Un subcatálogo «Laboratorios» con dos campos: nombre (texto) y teléfono (texto). */
  async function laboratorios(token: string): Promise<string> {
    const creado = await request(app.getHttpServer())
      .post("/catalogs")
      .set("Authorization", bearer(token))
      .send({ name: `Laboratorios ${randomUUID().slice(0, 6)}` })
      .expect(201);
    const catalogId = (creado.body as { id: string }).id;
    for (const label of ["Nombre", "Teléfono"]) {
      await request(app.getHttpServer())
        .post(`/catalogs/${catalogId}/fields`)
        .set("Authorization", bearer(token))
        .send({ label, fieldType: "text" })
        .expect(201);
    }
    return catalogId;
  }

  async function xlsxBase64(rows: string[][]): Promise<string> {
    const file = await serializeSpreadsheet(rows, "xlsx");
    return file.body.toString("base64");
  }

  const importar = (
    token: string,
    catalogId: string,
    content: string,
    extra: Record<string, unknown> = {},
  ) =>
    request(app.getHttpServer())
      .post(`/catalogs/${catalogId}/records/import`)
      .set("Authorization", bearer(token))
      .send({ content, ...extra });

  it("la plantilla es un Excel con el código y los campos personalizados", async () => {
    const token = await ownerToken();
    const catalogId = await laboratorios(token);

    const res = await request(app.getHttpServer())
      .get(`/catalogs/${catalogId}/records/import/template`)
      .set("Authorization", bearer(token))
      .buffer(true)
      .parse((r, cb) => {
        const chunks: Buffer[] = [];
        r.on("data", (c: Buffer) => chunks.push(c));
        r.on("end", () => cb(null, Buffer.concat(chunks)));
      })
      .expect(200);

    expect(res.headers["content-type"]).toContain("spreadsheetml");
    expect((res.body as Buffer).subarray(0, 2).toString()).toBe("PK");
  });

  it("dry-run reporta altas y actualizaciones por código; aplicar las escribe con sus campos", async () => {
    const token = await ownerToken();
    const catalogId = await laboratorios(token);
    // Uno existente, para que la planilla lo ACTUALICE.
    await request(app.getHttpServer())
      .post(`/catalogs/${catalogId}/records`)
      .set("Authorization", bearer(token))
      .send({ code: "PFIZER001", attributes: { nombre: "Pfizer", telefono: "" } })
      .expect(201);
    const contenido = await xlsxBase64([
      ["codigo", "nombre", "telefono"],
      ["PFIZER001", "PFIZER, S.A. de C.V.", "5555555555"],
      ["EXFARMA001", "EXFARMA, S.A. de C.V.", "5555555555"],
    ]);

    const previa = await importar(token, catalogId, contenido, { dryRun: true }).expect(200);
    expect(previa.body).toMatchObject({
      valid: 2,
      failed: 0,
      created: 1,
      updated: 1,
      applied: false,
    });

    const aplicado = await importar(token, catalogId, contenido).expect(200);
    expect(aplicado.body).toMatchObject({ created: 1, updated: 1, applied: true });

    const lista = await request(app.getHttpServer())
      .get(`/catalogs/${catalogId}/records`)
      .set("Authorization", bearer(token))
      .expect(200);
    const filas = (lista.body as { rows: { code: string; attributes: Record<string, unknown> }[] })
      .rows;
    expect(filas.map((r) => r.code).sort()).toEqual(["EXFARMA001", "PFIZER001"]);
    expect(filas.find((r) => r.code === "PFIZER001")?.attributes).toMatchObject({
      nombre: "PFIZER, S.A. de C.V.",
    });
  });

  it("un catálogo del SISTEMA no se importa por acá: tiene su propio importador", async () => {
    const token = await ownerToken();
    const catalogs = await request(app.getHttpServer())
      .get("/catalogs")
      .set("Authorization", bearer(token))
      .expect(200);
    const productos = (catalogs.body as { id: string; systemKey: string | null }[]).find(
      (c) => c.systemKey === "products",
    );
    const contenido = await xlsxBase64([["codigo"], ["X-1"]]);

    const res = await importar(token, productos?.id ?? "", contenido, { dryRun: true }).expect(400);
    expect((res.body as { message: string }).message).toContain("propio");
  });

  it("una fila sin código falla con su número; un código repetido en el archivo también", async () => {
    const token = await ownerToken();
    const catalogId = await laboratorios(token);
    const contenido = await xlsxBase64([
      ["codigo", "nombre"],
      ["", "Sin código"],
      ["DUP", "Uno"],
      ["DUP", "Dos"],
    ]);

    const res = await importar(token, catalogId, contenido, { dryRun: true }).expect(200);

    expect(res.body).toMatchObject({ valid: 1, failed: 2 });
    const errors = (res.body as { errors: { row: number; message: string; itemCode?: string }[] })
      .errors;
    expect(errors[0]).toMatchObject({ row: 2, message: "catalogs.import_missing_required" });
    expect(errors[1]).toMatchObject({
      row: 4,
      message: "catalogs.import_duplicate_code",
      itemCode: "DUP",
    });
  });
});
