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
    expect(rows[0]).toEqual(["codigo", "nombre", "descripcion", "costo", "precio", "impuesto"]);
  });

  /**
   * Carlos (2026-11-01): la plantilla no traía la descripción, que el formulario
   * sí tiene. Va después del nombre, se exporta y se importa. Un archivo viejo,
   * SIN la columna, no toca la descripción que ya tenía el servicio.
   */
  it("la descripción va después del nombre: se exporta, se importa y un archivo viejo no la borra", async () => {
    const token = await ownerToken();
    const subir = async (filas: string[][]) =>
      request(app.getHttpServer())
        .post("/services/import")
        .set("Authorization", bearer(token))
        .send({ content: await xlsxBase64(filas) })
        .expect(200);
    const descripcionDe = async (code: string) => {
      const lista = await request(app.getHttpServer())
        .get("/services")
        .set("Authorization", bearer(token))
        .expect(200);
      const filas = (lista.body as { rows: { code: string; description: string | null }[] }).rows;
      return filas.find((s) => s.code === code)?.description;
    };

    await subir([
      ["codigo", "nombre", "descripcion", "costo", "precio", "impuesto"],
      ["DESC-01", "Consulta", "Valoración inicial con signos vitales", "50", "250"],
    ]);
    expect(await descripcionDe("DESC-01")).toBe("Valoración inicial con signos vitales");

    const plantilla = await request(app.getHttpServer())
      .get("/services/import/template")
      .set("Authorization", bearer(token))
      .buffer(true)
      .parse((response, callback) => {
        const chunks: Buffer[] = [];
        response.on("data", (chunk: Buffer) => chunks.push(chunk));
        response.on("end", () => callback(null, Buffer.concat(chunks)));
      })
      .expect(200);
    const filas = await celdas(plantilla.body as Buffer);
    expect(filas.find((f) => f[0] === "DESC-01")?.[2]).toBe(
      "Valoración inicial con signos vitales",
    );

    // Un archivo de antes, sin la columna: actualiza el precio y la descripción sigue.
    await subir([
      ["codigo", "nombre", "costo", "precio", "impuesto"],
      ["DESC-01", "Consulta", "50", "300"],
    ]);
    expect(await descripcionDe("DESC-01")).toBe("Valoración inicial con signos vitales");

    // Con la columna, la celda manda: se cambia, y vacía la borra.
    await subir([
      ["codigo", "nombre", "descripcion", "costo", "precio", "impuesto"],
      ["DESC-01", "Consulta", "Incluye receta", "50", "300"],
    ]);
    expect(await descripcionDe("DESC-01")).toBe("Incluye receta");
    await subir([
      ["codigo", "nombre", "descripcion", "costo", "precio", "impuesto"],
      ["DESC-01", "Consulta", "", "50", "300"],
    ]);
    expect(await descripcionDe("DESC-01")).toBeNull();
  });

  it("una descripción de más de 2000 caracteres es error de su fila, como en el formulario", async () => {
    const token = await ownerToken();
    const res = await request(app.getHttpServer())
      .post("/services/import")
      .set("Authorization", bearer(token))
      .send({
        content: await xlsxBase64([
          ["codigo", "nombre", "descripcion", "costo", "precio", "impuesto"],
          ["LARGA-01", "Consulta", "x".repeat(2001), "50", "250"],
        ]),
        dryRun: true,
      })
      .expect(200);

    expect(res.body).toMatchObject({ valid: 0, failed: 1 });
    expect((res.body as { errors: { field?: string; message: string }[] }).errors[0]).toMatchObject(
      {
        field: "descripcion",
        message: "services.import_description_too_long",
        itemCode: "LARGA-01",
      },
    );
  });

  it("crea por código nuevo (ofrecido en todos los almacenes) y actualiza por código existente", async () => {
    const token = await ownerToken();

    // Dry-run primero: reporta sin escribir.
    const contenido = await xlsxBase64([
      ["codigo", "nombre", "costo", "precio", "impuesto"],
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
      ["codigo", "nombre", "costo", "precio", "impuesto"],
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

  /**
   * Carlos (2026-10-31): costo, precio y los campos propios de tipo número
   * van como NÚMERO en el xlsx; el código, el nombre y los campos de texto,
   * con formato Texto. Y la plantilla se vuelve a subir sin perder nada: el
   * 8.5 sigue siendo 8.5 y el código conserva sus ceros.
   */
  it("la plantilla lleva números y texto donde van, y se reimporta igual", async () => {
    const token = await ownerToken();
    const catalogos = await request(app.getHttpServer())
      .get("/catalogs")
      .set("Authorization", bearer(token))
      .expect(200);
    const catalogId = (catalogos.body as { id: string; systemKey: string | null }[]).find(
      (c) => c.systemKey === "services",
    )?.id;
    for (const campo of [
      { label: "Grupo", fieldType: "text" },
      { label: "Duración", fieldType: "number" },
    ]) {
      await request(app.getHttpServer())
        .post(`/catalogs/${catalogId}/fields`)
        .set("Authorization", bearer(token))
        .send(campo)
        .expect(201);
    }
    await request(app.getHttpServer())
      .post("/services/import")
      .set("Authorization", bearer(token))
      .send({
        content: await xlsxBase64([
          ["codigo", "nombre", "costo", "precio", "impuesto", "Grupo", "Duración"],
          ["001000000018", "Consulta general", "8.5", "250", "", "0042", "30"],
        ]),
      })
      .expect(200);

    const plantilla = await request(app.getHttpServer())
      .get("/services/import/template")
      .set("Authorization", bearer(token))
      .buffer(true)
      .parse((response, callback) => {
        const chunks: Buffer[] = [];
        response.on("data", (chunk: Buffer) => chunks.push(chunk));
        response.on("end", () => callback(null, Buffer.concat(chunks)));
      })
      .expect(200);

    const ExcelJS = (await import("exceljs")).default;
    const workbook = new ExcelJS.Workbook();
    type XlsxInput = Parameters<typeof workbook.xlsx.load>[0];
    await workbook.xlsx.load(plantilla.body as unknown as XlsxInput);
    const sheet = workbook.worksheets[0];
    const celda = (nombre: string) =>
      sheet?.getRow(2).getCell((sheet.getRow(1).values as unknown[]).indexOf(nombre));

    for (const [nombre, valor] of [
      ["costo", 8.5],
      ["precio", 250],
      ["Duración", 30],
    ] as const) {
      expect({ nombre, type: celda(nombre)?.type, value: celda(nombre)?.value }).toEqual({
        nombre,
        type: ExcelJS.ValueType.Number,
        value: valor,
      });
    }
    for (const [nombre, valor] of [
      ["codigo", "001000000018"],
      ["nombre", "Consulta general"],
      ["Grupo", "0042"],
    ] as const) {
      expect({ nombre, value: celda(nombre)?.value, numFmt: celda(nombre)?.numFmt }).toEqual({
        nombre,
        value: valor,
        numFmt: "@",
      });
    }
    expect(celda("impuesto")?.numFmt).toBe("@");

    const reimportada = await request(app.getHttpServer())
      .post("/services/import")
      .set("Authorization", bearer(token))
      .send({ content: (plantilla.body as Buffer).toString("base64") })
      .expect(200);
    expect(reimportada.body).toMatchObject({ failed: 0, created: 0, updated: 1 });

    const lista = await request(app.getHttpServer())
      .get("/services")
      .set("Authorization", bearer(token))
      .expect(200);
    const servicios = (
      lista.body as {
        rows: {
          code: string;
          cost: string | null;
          price: string | null;
          attributes: Record<string, unknown>;
        }[];
      }
    ).rows;
    expect(servicios).toHaveLength(1);
    expect(servicios[0]).toMatchObject({
      code: "001000000018",
      cost: "8.5",
      price: "250",
      attributes: { grupo: "0042", duracion: 30 },
    });
  });

  it("un código repetido en el archivo es error por fila, no una intención", async () => {
    const token = await ownerToken();
    const contenido = await xlsxBase64([
      ["codigo", "nombre", "costo", "precio", "impuesto"],
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
      // `itemCode`: el código de la fila, para que el error se encuentre en el
      // Excel sin contar renglones (Carlos, 2026-09-01).
      { field: "codigo", message: "services.import_duplicate_code", itemCode: "DUP-01" },
    );
  });
});
