import type { INestApplication } from "@nestjs/common";
import { Test, type TestingModule } from "@nestjs/testing";
import request from "supertest";
import type { App } from "supertest/types";
import { AppModule } from "../../src/app.module";
import { parseCsv } from "../../src/common/spreadsheet/csv";
import { parseSpreadsheet } from "../../src/common/spreadsheet/spreadsheet";
import { PrismaService } from "../../src/infrastructure/prisma/prisma.service";
import { MAILER } from "../../src/modules/mail/mailer.port";
import { NoopMailer } from "../../src/modules/mail/noop.mailer";
import {
  bearer,
  makePlatformAdmin,
  registerTenant,
  setTenantMarket,
  type TenantFixture,
} from "./support/billing-scenario";
import { activarModulo } from "./support/medical-clinic-scenario";
import { startTestApp } from "./support/start-test-app";

/**
 * F4-TAX-11 — la columna `impuesto` en las plantillas: bajar → subir sin tocar
 * nada deja el catálogo IDÉNTICO (vacío = hereda el default, código = el
 * override), un código desconocido es un error de fila con el código del
 * artículo, y el encabezado en inglés (`tax`) se reconoce.
 */
describe("la columna impuesto en las plantillas (F4-TAX-11)", () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let negocio: TenantFixture;
  let exento: string;
  const http = () => request(app.getHttpServer());
  /** Un binario (xlsx) tal cual llega, como en `import-templates-i18n`. */
  const descargar = (ruta: string) =>
    http()
      .get(ruta)
      .set("Authorization", bearer(negocio.token))
      .buffer(true)
      .parse((r, cb) => {
        const chunks: Buffer[] = [];
        r.on("data", (c: Buffer) => chunks.push(c));
        r.on("end", () => cb(null, Buffer.concat(chunks)));
      });

  beforeAll(async () => {
    const moduleRef: TestingModule = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(MAILER)
      .useValue(new NoopMailer())
      .compile();
    app = moduleRef.createNestApplication<INestApplication<App>>();
    await startTestApp(app);
    prisma = app.get(PrismaService);
    const admin = await registerTenant(app, "tax-import-admin");
    await makePlatformAdmin(app, prisma, admin);
    negocio = await registerTenant(app, "tax-import");
    await setTenantMarket(prisma, negocio.tenantId, "MX");
    await activarModulo(app, admin, negocio.tenantId, "medical_clinic");
    await prisma.withTenantContext(negocio.tenantId, async (tx) => {
      await tx.taxGroup.create({
        data: { tenantId: negocio.tenantId, code: "VAT16", name: "IVA 16%", isDefault: true },
      });
      exento = (
        await tx.taxGroup.create({
          data: { tenantId: negocio.tenantId, code: "EXEMPT", name: "Exento" },
        })
      ).id;
    });
  });

  afterAll(async () => {
    await app.close();
  });

  it("productos: viaje redondo sin pérdida, y el código desconocido es error de fila", async () => {
    await http()
      .post("/products")
      .set("Authorization", bearer(negocio.token))
      .send({ sku: "HEREDA", name: "Hereda el default", baseUnit: "unit", price: 10 })
      .expect(201);
    await http()
      .post("/products")
      .set("Authorization", bearer(negocio.token))
      .send({
        sku: "EXENTO",
        name: "Medicina exenta",
        baseUnit: "unit",
        price: 20,
        taxGroupId: exento,
      })
      .expect(201);

    const plantilla = await http()
      .get("/products/import/template?format=csv")
      .set("Authorization", bearer(negocio.token))
      .expect(200);
    const filas = parseCsv(plantilla.text);
    const encabezado = filas[0] as string[];
    const col = encabezado.indexOf("impuesto");
    expect(col).toBeGreaterThan(0);
    const porSku = new Map(filas.slice(1).map((f) => [f[encabezado.indexOf("sku")], f]));
    expect(porSku.get("HEREDA")?.[col]).toBe("");
    expect(porSku.get("EXENTO")?.[col]).toBe("EXEMPT");

    // Se sube tal cual bajó: nada cambia.
    const subida = await http()
      .post("/products/import")
      .set("Authorization", bearer(negocio.token))
      .send({ content: plantilla.text, format: "csv", dryRun: false, skipErrors: false })
      .expect(200);
    expect((subida.body as { failed: number; updated: number }).failed).toBe(0);
    const despues = await prisma.withTenantContext(negocio.tenantId, (tx) =>
      tx.product.findMany({
        where: { sku: { in: ["HEREDA", "EXENTO"] } },
        select: { sku: true, taxGroupId: true },
        orderBy: { sku: "asc" },
      }),
    );
    expect(despues).toEqual([
      { sku: "EXENTO", taxGroupId: exento },
      { sku: "HEREDA", taxGroupId: null },
    ]);

    // Un código que no existe: error de fila, con el SKU para encontrarla.
    const mala =
      [...encabezado].join(",") +
      "\n" +
      [
        "",
        "MALO",
        "Malo",
        "unit",
        "",
        "5",
        "0",
        "",
        "NO",
        "NO",
        "IVA99",
        ...encabezado.slice(11).map(() => ""),
      ].join(",") +
      "\n";
    const rechazo = await http()
      .post("/products/import")
      .set("Authorization", bearer(negocio.token))
      .send({ content: mala, format: "csv", dryRun: true, skipErrors: false })
      .expect(200);
    const errores = (
      rechazo.body as {
        errors: { code?: string; message: string; itemCode?: string; field?: string }[];
      }
    ).errors;
    expect(errores).toHaveLength(1);
    expect(errores[0]).toMatchObject({ field: "impuesto", itemCode: "MALO" });
    expect(errores[0]?.message).toMatch(/grupo de impuesto/i);

    // En inglés: el encabezado `tax` se reconoce como `impuesto`.
    const enIngles =
      [...encabezado.map((h) => (h === "impuesto" ? "tax" : h === "sku" ? "sku" : h))].join(",") +
      "\n" +
      [
        "",
        "EXENTO",
        "Medicina exenta",
        "unit",
        "",
        "20",
        "0",
        "",
        "NO",
        "NO",
        "EXEMPT",
        ...encabezado.slice(11).map(() => ""),
      ].join(",") +
      "\n";
    const ok = await http()
      .post("/products/import")
      .set("Authorization", bearer(negocio.token))
      .send({ content: enIngles, format: "csv", dryRun: true, skipErrors: false })
      .expect(200);
    expect((ok.body as { failed: number }).failed).toBe(0);
  });

  it("servicios y estudios: la fila de ejemplo trae el código del default y el vacío hereda", async () => {
    const servicios = await descargar("/services/import/template").expect(200);
    const filasSrv = await parseSpreadsheet((servicios.body as Buffer).toString("base64"), "xlsx");
    const encSrv = filasSrv[0] as string[];
    expect(encSrv).toContain("impuesto");
    expect(filasSrv[1]?.[encSrv.indexOf("impuesto")]).toBe("VAT16");

    const estudios = await descargar("/medical-clinic/lab-studies/import/template").expect(200);
    const filasLab = await parseSpreadsheet((estudios.body as Buffer).toString("base64"), "xlsx");
    const encLab = filasLab[0] as string[];
    expect(encLab).toEqual(["codigo", "nombre", "descripcion", "costo", "precio", "impuesto"]);
    expect(filasLab[1]?.[5]).toBe("VAT16");
  });
});
