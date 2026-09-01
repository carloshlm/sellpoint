import { randomUUID } from "node:crypto";
import type { INestApplication } from "@nestjs/common";
import { Test, TestingModule } from "@nestjs/testing";
import request from "supertest";
import type { App } from "supertest/types";
import { AppModule } from "../../src/app.module";
import { MAILER } from "../../src/modules/mail/mailer.port";
import { NoopMailer } from "../../src/modules/mail/noop.mailer";
import { extractTokenFromLink } from "./support/extract-token-from-link";
import { startTestApp } from "./support/start-test-app";

/**
 * F2-IMPORT de SERVICIOS (Carlos, 2026-09-01) — solo Excel, match por
 * `codigo`, columnas: codigo, nombre, costo, precio + personalizados.
 */
describe("Importar servicios por Excel", () => {
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
    const email = `svc-${randomUUID()}@example.com`;
    await request(app.getHttpServer())
      .post("/auth/register-tenant")
      .send({
        tenantName: `Tenant svc ${randomUUID()}`,
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

  /** Un xlsx en memoria con estas filas, como base64 — igual que viaja del front. */
  async function xlsxBase64(rows: string[][]): Promise<string> {
    const ExcelJS = (await import("exceljs")).default;
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet("Servicios");
    for (const row of rows) {
      sheet.addRow(row);
    }
    const buffer = await workbook.xlsx.writeBuffer();
    return Buffer.from(buffer).toString("base64");
  }

  async function celdas(body: Buffer): Promise<string[][]> {
    const ExcelJS = (await import("exceljs")).default;
    const workbook = new ExcelJS.Workbook();
    type XlsxInput = Parameters<typeof workbook.xlsx.load>[0];
    await workbook.xlsx.load(body as unknown as XlsxInput);
    const rows: string[][] = [];
    workbook.worksheets[0]?.eachRow((row) => {
      const values = Array.isArray(row.values) ? row.values.slice(1) : [];
      rows.push(values.map((v) => (v == null ? "" : String(v))));
    });
    return rows;
  }

  it("la plantilla trae las columnas de Carlos, en su orden", async () => {
    const token = await ownerToken();

    const res = await request(app.getHttpServer())
      .get("/services/import/template")
      .set("Authorization", bearer(token))
      .buffer(true)
      .parse((response, callback) => {
        const chunks: Buffer[] = [];
        response.on("data", (chunk: Buffer) => chunks.push(chunk));
        response.on("end", () => callback(null, Buffer.concat(chunks)));
      })
      .expect(200);

    const rows = await celdas(res.body as Buffer);
    expect(rows[0]).toEqual(["codigo", "nombre", "costo", "precio"]);
  });

  it("crea por código nuevo (ofrecido en todos los almacenes) y actualiza por código existente", async () => {
    const token = await ownerToken();

    // Dry-run primero: reporta sin escribir.
    const contenido = await xlsxBase64([
      ["codigo", "nombre", "costo", "precio"],
      ["CONS-01", "Consulta general", "50", "250"],
      ["LIMP-01", "Limpieza dental", "80", "400"],
    ]);
    const dry = await request(app.getHttpServer())
      .post("/services/import")
      .set("Authorization", bearer(token))
      .send({ content: contenido, dryRun: true })
      .expect(200);
    expect(dry.body).toMatchObject({ valid: 2, created: 2, updated: 0, applied: false });

    await request(app.getHttpServer())
      .post("/services/import")
      .set("Authorization", bearer(token))
      .send({ content: contenido })
      .expect(200);

    const lista = await request(app.getHttpServer())
      .get("/services")
      .set("Authorization", bearer(token))
      .expect(200);
    const servicios = (lista.body as { rows: { code: string; price: string | null }[] }).rows;
    expect(servicios.map((s) => s.code).sort()).toEqual(["CONS-01", "LIMP-01"]);

    // Segunda pasada: el MISMO código actualiza — el match es por código.
    const actualizacion = await xlsxBase64([
      ["codigo", "nombre", "costo", "precio"],
      ["CONS-01", "Consulta general renovada", "60", "300"],
    ]);
    const segunda = await request(app.getHttpServer())
      .post("/services/import")
      .set("Authorization", bearer(token))
      .send({ content: actualizacion })
      .expect(200);
    expect(segunda.body).toMatchObject({ created: 0, updated: 1, applied: true });

    const tras = await request(app.getHttpServer())
      .get("/services")
      .set("Authorization", bearer(token))
      .expect(200);
    const renovada = (tras.body as { rows: { code: string; name: string }[] }).rows.find(
      (s) => s.code === "CONS-01",
    );
    expect(renovada?.name).toBe("Consulta general renovada");
  });

  it("un código repetido en el archivo es error por fila, no una intención", async () => {
    const token = await ownerToken();
    const contenido = await xlsxBase64([
      ["codigo", "nombre", "costo", "precio"],
      ["DUP-01", "Uno", "10", "20"],
      ["DUP-01", "Dos", "10", "20"],
    ]);

    const res = await request(app.getHttpServer())
      .post("/services/import")
      .set("Authorization", bearer(token))
      .send({ content: contenido, dryRun: true })
      .expect(200);

    expect(res.body).toMatchObject({ valid: 1, failed: 1 });
    expect((res.body as { errors: { field?: string; message: string }[] }).errors[0]).toMatchObject(
      { field: "codigo", message: "services.import_duplicate_code" },
    );
  });
});
