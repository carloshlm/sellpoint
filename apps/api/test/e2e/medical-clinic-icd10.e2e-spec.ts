import type { INestApplication } from "@nestjs/common";
import { Test, type TestingModule } from "@nestjs/testing";
import request from "supertest";
import type { App } from "supertest/types";
import { AppModule } from "../../src/app.module";
import { PrismaService } from "../../src/infrastructure/prisma/prisma.service";
import { MAILER } from "../../src/modules/mail/mailer.port";
import { NoopMailer } from "../../src/modules/mail/noop.mailer";
import { bearer, registerTenant, type TenantFixture } from "./support/billing-scenario";
import { adminDePlataforma, consultorio, usuarioConRol } from "./support/medical-clinic-scenario";
import { startTestApp } from "./support/start-test-app";

/**
 * F9-CLINIC-HC-22 — `GET /medical-clinic/icd10?q=`: el catálogo CIE-10 de
 * México (DGIS), global, gateado por módulo y por `medical_clinic:attend`.
 * Lo que fija: código por prefijo (con o sin punto), texto sin acentos,
 * solo códigos vigentes para codificar, y los mismos resultados para
 * cualquier negocio (no hay tenant en el catálogo).
 */
describe("Consultorio Médico — catálogo CIE-10 (F9-CLINIC-HC-22)", () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let admin: TenantFixture;
  let negocio: TenantFixture;
  let otro: TenantFixture;
  let sinModulo: TenantFixture;
  let viewerToken: string;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(MAILER)
      .useClass(NoopMailer)
      .compile();
    app = moduleFixture.createNestApplication();
    await startTestApp(app);
    prisma = app.get(PrismaService);

    admin = await adminDePlataforma(app, prisma, "icd10-admin");
    negocio = await consultorio(app, prisma, "icd10", admin, ["medical_clinic"]);
    otro = await consultorio(app, prisma, "icd10-otro", admin, ["medical_clinic"]);
    sinModulo = await registerTenant(app, "icd10-sin");
    viewerToken = await usuarioConRol(app, negocio, "Viewer", "icd10-viewer");
  });

  afterAll(async () => {
    await app.close();
  });

  const get = (token: string, url: string) =>
    request(app.getHttpServer()).get(url).set("Authorization", bearer(token));
  type Hit = { code: string; title: string; chapter: string | null; sex: string | null };

  it("sin el módulo es 402; un Viewer (solo lectura de catálogos) es 403; sin q es 400", async () => {
    await get(sinModulo.token, "/medical-clinic/icd10?q=J06").expect(402);
    await get(viewerToken, "/medical-clinic/icd10?q=J06").expect(403);
    await get(negocio.token, "/medical-clinic/icd10").expect(400);
    await get(negocio.token, "/medical-clinic/icd10?q=").expect(400);
  });

  it("un código busca por prefijo, con o sin punto y en minúsculas, y solo devuelve vigentes", async () => {
    const res = await get(negocio.token, "/medical-clinic/icd10?q=j069").expect(200);
    expect(res.body).toEqual([
      {
        code: "J06.9",
        title: "INFECCIÓN AGUDA DE LAS VÍAS RESPIRATORIAS SUPERIORES, NO ESPECIFICADA",
        chapter: "X",
        sex: null,
      },
    ]);
    const conPunto = await get(negocio.token, "/medical-clinic/icd10?q=J06.9").expect(200);
    expect(conPunto.body).toEqual(res.body);

    // `E11` es una categoría con subcategorías: no es vigente para codificar
    // y no se ofrece; sus hijas sí, ordenadas por código.
    const diabetes = (await get(negocio.token, "/medical-clinic/icd10?q=E11").expect(200))
      .body as Hit[];
    const codigos = diabetes.map((h) => h.code);
    expect(codigos).not.toContain("E11");
    expect(codigos[0]).toBe("E11.0");
    expect(codigos).toContain("E11.9");
    expect(codigos).toEqual([...codigos].sort());
  });

  it("un texto busca en el título sin acentos, y la categoría con X vuelve como tres caracteres", async () => {
    const sinAcento = (
      await get(
        negocio.token,
        "/medical-clinic/icd10?q=infeccion%20aguda%20de%20las%20vias",
      ).expect(200)
    ).body as Hit[];
    expect(sinAcento.map((h) => h.code)).toContain("J06.9");

    const tetanos = (
      await get(negocio.token, "/medical-clinic/icd10?q=tetanos%20neonatal").expect(200)
    ).body as Hit[];
    // En la DGIS es `A33X` (presentación a cuatro caracteres); el código de la OMS es `A33`.
    expect(tetanos).toContainEqual(
      expect.objectContaining({ code: "A33", title: "TÉTANOS NEONATAL" }),
    );

    // El sexo restringido viaja: el parto es de MUJER.
    const parto = (await get(negocio.token, "/medical-clinic/icd10?q=O80.0").expect(200))
      .body as Hit[];
    expect(parto[0]).toMatchObject({ code: "O80.0", sex: "F" });
  });

  it("un texto se ordena por relevancia: la coincidencia al inicio y el título corto primero", async () => {
    const hits = (await get(negocio.token, "/medical-clinic/icd10?q=faringitis").expect(200))
      .body as Hit[];
    // Todo lo que EMPIEZA con «faringitis» va antes que «RINOFARINGITIS…».
    const inicio = hits.findIndex((h) => !h.title.startsWith("FARINGITIS"));
    expect(inicio).toBeGreaterThan(0);
    expect(hits.slice(0, inicio).every((h) => h.title.startsWith("FARINGITIS"))).toBe(true);
    expect(hits.map((h) => h.code)).toContain("J02.9");
  });

  it("el catálogo es el mismo para cualquier negocio, y `limit` acota", async () => {
    const a = (await get(negocio.token, "/medical-clinic/icd10?q=faringitis&limit=3").expect(200))
      .body as Hit[];
    const b = (await get(otro.token, "/medical-clinic/icd10?q=faringitis&limit=3").expect(200))
      .body as Hit[];
    expect(a).toEqual(b);
    expect(a).toHaveLength(3);
  });
});
