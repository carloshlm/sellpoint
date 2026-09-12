import type { INestApplication } from "@nestjs/common";
import { Test, type TestingModule } from "@nestjs/testing";
import request from "supertest";
import type { App } from "supertest/types";
import { AppModule } from "../../src/app.module";
import { serializeSpreadsheet } from "../../src/common/spreadsheet/spreadsheet";
import { PrismaService } from "../../src/infrastructure/prisma/prisma.service";
import { MAILER } from "../../src/modules/mail/mailer.port";
import { NoopMailer } from "../../src/modules/mail/noop.mailer";
import { registerTenant, setTenantMarket, type TenantFixture } from "./support/billing-scenario";
import { startTestApp } from "./support/start-test-app";

/**
 * Importar PROVEEDORES por Excel (Carlos, 2026-09-12) — el mismo contrato de
 * almacenes: plantilla con lo existente, dry-run que reporta por fila, match
 * por CÓDIGO, una fila sin código es un alta numerada (PROV-NNN), y las
 * validaciones de la ficha aplican también a la planilla (un RFC o un
 * teléfono que el formulario rechaza no entra por Excel).
 */
describe("Importación de proveedores (F9-SUPPCAT, 2026-09-12)", () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let negocio: TenantFixture;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(MAILER)
      .useClass(NoopMailer)
      .compile();
    app = moduleFixture.createNestApplication();
    await startTestApp(app);
    prisma = app.get(PrismaService);
    negocio = await registerTenant(app, "suppl-import");
    await setTenantMarket(prisma, negocio.tenantId, "MX");
  });

  afterAll(async () => {
    await app.close();
  });

  const bearer = (t: string) => `Bearer ${t}`;

  async function xlsxBase64(rows: string[][]): Promise<string> {
    const file = await serializeSpreadsheet(rows, "xlsx");
    return file.body.toString("base64");
  }

  const importar = (token: string, content: string, extra: Record<string, unknown> = {}) =>
    request(app.getHttpServer())
      .post("/suppliers/import")
      .set("Authorization", bearer(token))
      .send({ content, ...extra });

  const listar = async (token: string) =>
    (
      await request(app.getHttpServer())
        .get("/suppliers?pageSize=100")
        .set("Authorization", bearer(token))
        .expect(200)
    ).body as {
      rows: { code: string; name: string; taxId: string | null; phone: string | null }[];
    };

  it("la plantilla se descarga como Excel", async () => {
    const res = await request(app.getHttpServer())
      .get("/suppliers/import/template")
      .set("Authorization", bearer(negocio.token))
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

  it("dry-run reporta altas y actualizaciones por código sin escribir; aplicar escribe y numera las filas sin código", async () => {
    const propio = await registerTenant(app, "suppl-import-run");
    await setTenantMarket(prisma, propio.tenantId, "MX");
    await request(app.getHttpServer())
      .post("/suppliers")
      .set("Authorization", bearer(propio.token))
      .send({ name: "Distribuidora Norte" })
      .expect(201); // PROV-001

    const contenido = await xlsxBase64([
      [
        "codigo",
        "nombre",
        "registro_fiscal",
        "contacto",
        "telefono",
        "email",
        "direccion",
        "notas",
      ],
      // Existente por código: actualiza (el código en minúsculas encuentra igual).
      ["prov-001", "Norte renombrada", "dno900101ab1", "Rosa Luna", "+525512345678", "", "", ""],
      // Código propio nuevo: alta con ese código.
      ["acme", "Acme", "", "", "", "ventas@acme.mx", "Av. 1", "Paga a 30 días"],
      // Sin código: alta numerada por la serie.
      ["", "Sin código", "", "", "", "", "", ""],
    ]);

    const dry = await importar(propio.token, contenido, { dryRun: true }).expect(200);
    expect(dry.body).toMatchObject({ valid: 3, failed: 0, created: 2, updated: 1, applied: false });
    expect((await listar(propio.token)).rows.map((r) => r.code)).toEqual(["PROV-001"]);

    const res = await importar(propio.token, contenido).expect(200);
    expect(res.body).toMatchObject({ created: 2, updated: 1, applied: true });
    const filas = (await listar(propio.token)).rows;
    expect(filas.map((r) => r.code).sort()).toEqual(["ACME", "PROV-001", "PROV-002"]);
    expect(filas.find((r) => r.code === "PROV-001")).toMatchObject({
      name: "Norte renombrada",
      taxId: "DNO900101AB1",
      phone: "+525512345678",
    });
    expect(filas.find((r) => r.code === "PROV-002")?.name).toBe("Sin código");
  });

  it("un RFC mal formado, un teléfono sin prefijo o un código repetido fallan SU fila, no la planilla", async () => {
    const contenido = await xlsxBase64([
      ["codigo", "nombre", "registro_fiscal", "telefono"],
      ["BAD-1", "Fiscal malo", "NOPE", ""],
      ["BAD-2", "Teléfono malo", "", "5512345678"],
      ["DUP", "Uno", "", ""],
      ["DUP", "Dos", "", ""],
      ["OK-1", "Correcto", "", "+525512345678"],
    ]);
    const res = await importar(negocio.token, contenido, { dryRun: true }).expect(200);
    const cuerpo = res.body as {
      valid: number;
      failed: number;
      errors: { row: number; field?: string; itemCode?: string; code?: string }[];
    };
    expect(cuerpo).toMatchObject({ valid: 2, failed: 3 });
    expect(cuerpo.errors).toEqual([
      expect.objectContaining({ row: 2, field: "registro_fiscal", itemCode: "BAD-1" }),
      expect.objectContaining({ row: 3, field: "telefono", itemCode: "BAD-2" }),
      expect.objectContaining({ row: 5, field: "codigo", itemCode: "DUP" }),
    ]);
  });

  it("los campos propios del catálogo de proveedores entran por su columna y se validan", async () => {
    const propio = await registerTenant(app, "suppl-import-campos");
    const catalogos = (
      await request(app.getHttpServer())
        .get("/catalogs")
        .set("Authorization", bearer(propio.token))
        .expect(200)
    ).body as { id: string; systemKey: string | null }[];
    const deProveedores = catalogos.find((c) => c.systemKey === "suppliers");
    await request(app.getHttpServer())
      .post(`/catalogs/${deProveedores?.id}/fields`)
      .set("Authorization", bearer(propio.token))
      .send({ label: "Días de crédito", fieldType: "number", required: true })
      .expect(201);

    const contenido = await xlsxBase64([
      ["codigo", "nombre", "Días de crédito"],
      ["A-1", "Con crédito", "30"],
      ["A-2", "Sin crédito", ""],
    ]);
    const res = await importar(propio.token, contenido, { dryRun: true }).expect(200);
    const cuerpo = res.body as { valid: number; failed: number; errors: { field?: string }[] };
    expect(cuerpo).toMatchObject({ valid: 1, failed: 1 });
    // La columna se nombra como la persona la ve en SU planilla.
    expect(cuerpo.errors[0]).toMatchObject({ field: "Días de crédito" });
  });
});
