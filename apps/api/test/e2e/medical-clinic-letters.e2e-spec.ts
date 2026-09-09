import type { INestApplication } from "@nestjs/common";
import { Test, type TestingModule } from "@nestjs/testing";
import request from "supertest";
import type { App } from "supertest/types";
import { AppModule } from "../../src/app.module";
import { PrismaService } from "../../src/infrastructure/prisma/prisma.service";
import { MAILER } from "../../src/modules/mail/mailer.port";
import { NoopMailer } from "../../src/modules/mail/noop.mailer";
import { bearer, type TenantFixture } from "./support/billing-scenario";
import {
  adminDePlataforma,
  consultorio,
  usuarioConRol,
  vencerExpediente,
} from "./support/medical-clinic-scenario";
import { textoDelPdf } from "./support/pdf-text";
import { startTestApp } from "./support/start-test-app";

/**
 * F9-CLINIC-DOC-05 — la carta de una referencia o interconsulta, por índice,
 * de punta a punta: el papel dice a quién, con qué urgencia, por qué y con
 * qué diagnóstico; se imprime aunque la consulta ya venció (es lectura);
 * un índice que no existe es 404; una sección que no es carta, 422; una
 * clave inventada, 400; sin el módulo, 402; sin `medical_clinic:attend`,
 * 403.
 */
describe("Consultorio Médico — la carta de referencia e interconsulta (F9-CLINIC-DOC-05)", () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let admin: TenantFixture;
  let negocio: TenantFixture;
  let sinModulo: TenantFixture;
  let viewerToken: string;
  let recordId: string;
  let folio: string;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(MAILER)
      .useClass(NoopMailer)
      .compile();
    app = moduleFixture.createNestApplication();
    await startTestApp(app);
    prisma = app.get(PrismaService);
    admin = await adminDePlataforma(app, prisma, "letters-admin");
    negocio = await consultorio(app, prisma, "letters", admin);
    sinModulo = await consultorio(app, prisma, "letters-nomod", admin, ["reception"]);
    viewerToken = await usuarioConRol(app, negocio, "Viewer", "letters-viewer");

    const paciente = await post(negocio.token, "/medical-clinic/patients", {
      firstName: "Rosa",
      lastName: "Luna",
      birthDate: "1988-05-10",
    }).expect(201);
    const creado = await post(negocio.token, "/medical-clinic/records", {
      customerId: (paciente.body as { id: string }).id,
    }).expect(201);
    recordId = (creado.body as { id: string }).id;
    folio = (creado.body as { folio: string }).folio;

    await put(negocio.token, seccion("referrals"), {
      items: [
        {
          priority: "urgent",
          facility: "Hospital General",
          service: "Cardiología",
          doctorName: "Dra. Ruiz",
          reason: "Soplo sistólico de reciente aparición",
          clinicalSummary: "Fiebre de tres días con dolor torácico",
          diagnosis: "Soplo cardiaco",
          icd10Code: "R01.1",
          treatment: "Paracetamol 500 mg",
        },
      ],
    }).expect(200);
    await put(negocio.token, seccion("interconsultations"), {
      items: [{ service: "Nefrología", reason: "¿Requiere biopsia renal?" }],
    }).expect(200);
    await put(negocio.token, seccion("medical_notes"), {
      items: [{ time: "09:00", kind: "evolution", text: "Mejoría" }],
    }).expect(200);
  });

  afterAll(async () => {
    await app.close();
  });

  const post = (token: string, url: string, body: object = {}) =>
    request(app.getHttpServer()).post(url).set("Authorization", bearer(token)).send(body);
  const put = (token: string, url: string, body: object) =>
    request(app.getHttpServer()).put(url).set("Authorization", bearer(token)).send(body);
  const seccion = (key: string) => `/medical-clinic/records/${recordId}/sections/${key}`;
  const carta = (key: string, index: number | string) => `${seccion(key)}/items/${index}/document`;
  const pdf = (token: string, ruta: string) =>
    request(app.getHttpServer())
      .get(ruta)
      .set("Authorization", bearer(token))
      .buffer(true)
      .parse((r, cb) => {
        const chunks: Buffer[] = [];
        r.on("data", (c: Buffer) => chunks.push(c));
        r.on("end", () => cb(null, Buffer.concat(chunks)));
      });

  it("la nota de referencia dice a quién va, con qué urgencia, el motivo y el diagnóstico con su CIE-10", async () => {
    const res = await pdf(negocio.token, carta("referrals", 0)).expect(200);
    expect(res.headers["content-type"]).toMatch(/application\/pdf/);
    expect(res.headers["content-disposition"]).toContain(`${folio}-REF-1.pdf`);
    const texto = textoDelPdf(res.body as Buffer);
    expect(texto).toContain("NOTA DE REFERENCIA");
    expect(texto).toContain("Referencia 1");
    expect(texto).toContain(folio);
    expect(texto).toContain("Rosa Luna");
    expect(texto).toContain("Hospital General");
    expect(texto).toContain("Cardiología");
    expect(texto).toContain("Dra. Ruiz");
    expect(texto).toContain("Urgente");
    expect(texto).toContain("Soplo sistólico de reciente aparición");
    expect(texto).toContain("Fiebre de tres días con dolor torácico");
    expect(texto).toContain("R01.1 Soplo cardiaco");
    expect(texto).toContain("Paracetamol 500 mg");
    // Nada de dinero: este papel es del paciente y del otro médico.
    expect(texto).not.toMatch(/\$/);
  });

  it("la solicitud de interconsulta lleva su título, su número y prioridad ordinaria", async () => {
    const res = await pdf(negocio.token, carta("interconsultations", 0)).expect(200);
    expect(res.headers["content-disposition"]).toContain(`${folio}-INT-1.pdf`);
    const texto = textoDelPdf(res.body as Buffer);
    expect(texto).toContain("SOLICITUD DE INTERCONSULTA");
    expect(texto).toContain("Interconsulta 1");
    expect(texto).toContain("Nefrología");
    expect(texto).toContain("Ordinaria");
    expect(texto).toContain("biopsia renal");
  });

  it("índice inexistente 404; sección que no es carta 422; clave inventada 400; índice malo 400", async () => {
    await pdf(negocio.token, carta("referrals", 5)).expect(404);
    await pdf(negocio.token, carta("medical_notes", 0)).expect(422);
    await pdf(negocio.token, carta("no_existe", 0)).expect(400);
    await pdf(negocio.token, carta("referrals", -1)).expect(400);
    await pdf(negocio.token, carta("referrals", "x")).expect(400);
  });

  it("sin el módulo es 402 y sin atender es 403", async () => {
    await pdf(sinModulo.token, carta("referrals", 0)).expect(402);
    await pdf(viewerToken, carta("referrals", 0)).expect(403);
  });

  /**
   * El caso más común: el paciente vuelve al día siguiente por su hoja. La
   * consulta ya venció (se lee, no se captura) y la carta se imprime igual.
   */
  it("la consulta vencida se sigue imprimiendo: la carta es lectura, el candado es de captura", async () => {
    await vencerExpediente(prisma, negocio.tenantId, recordId);
    await put(negocio.token, seccion("referrals"), {
      items: [{ facility: "x", service: "y", reason: "z" }],
    }).expect(409);
    const res = await pdf(negocio.token, carta("referrals", 0)).expect(200);
    expect(textoDelPdf(res.body as Buffer)).toContain("NOTA DE REFERENCIA");
  });
});
