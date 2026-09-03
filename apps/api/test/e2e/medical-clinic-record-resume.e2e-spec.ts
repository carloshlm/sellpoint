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
  vencerExpediente,
} from "./support/medical-clinic-scenario";
import { startTestApp } from "./support/start-test-app";

/**
 * F9-CLINIC-28 — continuar la consulta de hoy, vencer la de ayer.
 *
 * Dos reglas que solo se ven juntas de punta a punta: una consulta abierta
 * HOY se continúa (el segundo intento devuelve el folio a retomar, no un
 * folio nuevo) y una abierta de OTRO DÍA se lee pero no se captura, así que
 * el paciente que vuelve estrena expediente.
 */
describe("Consultorio Médico — continuar y vencer (F9-CLINIC-28)", () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let negocio: TenantFixture;
  let customerId: string;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(MAILER)
      .useClass(NoopMailer)
      .compile();
    app = moduleFixture.createNestApplication();
    await startTestApp(app);
    prisma = app.get(PrismaService);
    const admin = await adminDePlataforma(app, prisma, "resume-admin");
    negocio = await consultorio(app, prisma, "resume", admin);
    const paciente = await post(negocio.token, "/medical-clinic/patients", {
      firstName: "Rosa",
      lastNamePaternal: "Luna",
      birthDate: "1990-09-02",
    }).expect(201);
    customerId = (paciente.body as { id: string }).id;
  });

  afterAll(async () => {
    await app.close();
  });

  const get = (token: string, url: string) =>
    request(app.getHttpServer()).get(url).set("Authorization", bearer(token));
  const post = (token: string, url: string, body: object = {}) =>
    request(app.getHttpServer()).post(url).set("Authorization", bearer(token)).send(body);
  const put = (token: string, url: string, body: object) =>
    request(app.getHttpServer()).put(url).set("Authorization", bearer(token)).send(body);

  const abrir = () => post(negocio.token, "/medical-clinic/records", { customerId });
  const buscar = async () => {
    const res = await get(negocio.token, "/medical-clinic/patients/search?mode=name&q=luna").expect(
      200,
    );
    return (res.body as { customerId: string; lastRecord: unknown }[]).find(
      (p) => p.customerId === customerId,
    );
  };

  it("la de hoy se continúa, la de ayer se vence y el paciente estrena folio", async () => {
    // ── Una consulta abierta hoy ────────────────────────────────────────
    const primera = await abrir().expect(201);
    const A = primera.body as { id: string; folio: string; editable: boolean };
    expect(A).toMatchObject({ folio: "HCL-000001", editable: true, lockReason: null });

    // Intentar otra devuelve a DÓNDE ir, no un folio nuevo.
    const choque = await abrir().expect(409);
    expect(choque.body).toMatchObject({
      message: expect.any(String),
      recordId: A.id,
      folio: A.folio,
    });

    // La búsqueda ya sabe que se puede continuar.
    expect((await buscar())?.lastRecord).toMatchObject({
      folio: "HCL-000001",
      status: "open",
      lockReason: null,
    });

    // Se captura con normalidad.
    await put(negocio.token, `/medical-clinic/records/${A.id}/sections/chief_complaint`, {
      complaint: "Dolor de garganta",
    }).expect(200);

    // ── Amanece: la consulta de ayer ya no acepta captura ───────────────
    await vencerExpediente(prisma, negocio.tenantId, A.id);
    const vencida = await get(negocio.token, `/medical-clinic/records/${A.id}`).expect(200);
    expect(vencida.body).toMatchObject({
      status: "open",
      editable: false,
      lockReason: "expired",
    });
    await put(negocio.token, `/medical-clinic/records/${A.id}/sections/chief_complaint`, {
      complaint: "Otra cosa",
    }).expect(409);
    await post(negocio.token, `/medical-clinic/records/${A.id}/orders`, {
      kind: "lab_order",
      lines: [{ labStudyId: "00000000-0000-0000-0000-000000000000" }],
    }).expect(409);
    expect((await buscar())?.lastRecord).toMatchObject({ lockReason: "expired" });

    // ── El paciente vuelve: folio nuevo con Datos Generales heredados ───
    const segunda = await abrir().expect(201);
    const B = segunda.body as { id: string; folio: string };
    expect(B.folio).toBe("HCL-000002");
    expect(segunda.body).toMatchObject({ editable: true, lockReason: null });
    // Y la nueva vuelve a ser única del día.
    await abrir().expect(409);

    // ── Cerrar la vencida sigue siendo cosa del médico ──────────────────
    const cerrada = await post(negocio.token, `/medical-clinic/records/${A.id}/close`).expect(200);
    expect(cerrada.body).toMatchObject({ status: "closed", lockReason: "closed" });

    // Cerrada la de hoy, el paciente puede volver por la tarde: otro folio.
    await post(negocio.token, `/medical-clinic/records/${B.id}/close`).expect(200);
    const tercera = await abrir().expect(201);
    expect((tercera.body as { folio: string }).folio).toBe("HCL-000003");
  });

  it("dos médicos que abren a la vez dejan UNA consulta y un 409 con su folio", async () => {
    const otro = await post(negocio.token, "/medical-clinic/patients", {
      firstName: "Mario",
      lastNamePaternal: "Ríos",
    }).expect(201);
    const id = (otro.body as { id: string }).id;
    const dos = await Promise.all([
      post(negocio.token, "/medical-clinic/records", { customerId: id }),
      post(negocio.token, "/medical-clinic/records", { customerId: id }),
    ]);
    const codigos = dos.map((r) => r.status).sort();
    expect(codigos).toEqual([201, 409]);
    const conflicto = dos.find((r) => r.status === 409);
    expect(conflicto?.body).toMatchObject({ recordId: expect.any(String) });
  });
});
