import type { INestApplication } from "@nestjs/common";
import { Test, type TestingModule } from "@nestjs/testing";
import { ageFromBirthDate, localCalendarDate } from "@sellpoint/shared";
import request from "supertest";
import type { App } from "supertest/types";
import { AppModule } from "../../src/app.module";
import { PrismaService } from "../../src/infrastructure/prisma/prisma.service";
import { MAILER } from "../../src/modules/mail/mailer.port";
import { NoopMailer } from "../../src/modules/mail/noop.mailer";
import { bearer, type TenantFixture } from "./support/billing-scenario";
import { adminDePlataforma, consultorio, usuarioConRol } from "./support/medical-clinic-scenario";
import { startTestApp } from "./support/start-test-app";

/**
 * F9-CLINIC-19 — el ciclo del expediente de punta a punta.
 *
 * Turno de Recepción → búsqueda por número → expediente HCL-000001 con
 * encabezado completo → tres secciones → 29 + 3 → SEGUNDA visita con Datos
 * Generales copiados → cerrar → 409. Y quien no tiene `:attend` no lee nada.
 */
describe("Consultorio Médico — expediente (F9-CLINIC-19)", () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let admin: TenantFixture;
  let negocio: TenantFixture;
  let viewerToken: string;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(MAILER)
      .useClass(NoopMailer)
      .compile();
    app = moduleFixture.createNestApplication();
    await startTestApp(app);
    prisma = app.get(PrismaService);
    admin = await adminDePlataforma(app, prisma, "record-admin");
    negocio = await consultorio(app, prisma, "record", admin);
    viewerToken = await usuarioConRol(app, negocio, "Viewer", "record-viewer");
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

  it("del turno al expediente, con secciones, segunda visita y cierre", async () => {
    // Paciente nuevo desde el consultorio (delega en Recepción).
    const paciente = await post(negocio.token, "/medical-clinic/patients", {
      firstName: "Ana",
      lastNamePaternal: "Pérez",
      lastNameMaternal: "Luna",
      birthDate: "1990-09-03",
    }).expect(201);
    const customerId = (paciente.body as { id: string }).id;

    // El turno de Recepción de hoy, y la búsqueda por su número.
    const turno = await post(negocio.token, "/reception/turns", { customerId }).expect(201);
    const { id: turnId, number } = turno.body as { id: string; number: number };
    const busqueda = await get(
      negocio.token,
      `/medical-clinic/patients/search?mode=turn&q=${number}`,
    ).expect(200);
    expect(busqueda.body).toHaveLength(1);
    expect(busqueda.body[0]).toMatchObject({
      customerId,
      name: "Ana Pérez Luna",
      turnNumber: number,
      lastRecord: null,
    });
    // Por nombre también, y el turno de un número inexistente es 404.
    const porNombre = await get(
      negocio.token,
      "/medical-clinic/patients/search?mode=name&q=luna",
    ).expect(200);
    expect((porNombre.body as { customerId: string }[]).map((p) => p.customerId)).toContain(
      customerId,
    );
    await get(negocio.token, "/medical-clinic/patients/search?mode=turn&q=999").expect(404);

    // El expediente: HCL-000001 con encabezado completo.
    const creado = await post(negocio.token, "/medical-clinic/records", {
      customerId,
      turnId,
    }).expect(201);
    const expediente = creado.body as {
      id: string;
      folio: string;
      status: string;
      turnNumber: number;
      consultationDate: string;
      patient: { name: string; age: number; sex: string | null; birthDate: string };
      doctor: { name: string };
      sections: { key: string; status: string }[];
    };
    const zona = "America/Mexico_City";
    const hoy = localCalendarDate(zona, new Date());
    expect(expediente).toMatchObject({
      folio: "HCL-000001",
      status: "open",
      turnNumber: number,
      consultationDate: hoy,
      patient: {
        name: "Ana Pérez Luna",
        birthDate: "1990-09-03",
        sex: null,
        age: ageFromBirthDate("1990-09-03", hoy),
      },
      doctor: { name: "Ana Pérez" },
    });
    expect(expediente.sections).toHaveLength(32);
    expect(expediente.sections.every((s) => s.status === "pending")).toBe(true);

    // Las tres secciones funcionales.
    const base = `/medical-clinic/records/${expediente.id}`;
    await put(negocio.token, `${base}/sections/general_data`, {
      sex: "F",
      occupation: "Docente",
    }).expect(200);
    await put(negocio.token, `${base}/sections/chief_complaint`, {
      complaint: "Dolor de garganta",
      onsetValue: 3,
      onsetUnit: "days",
    }).expect(200);
    await put(negocio.token, `${base}/sections/current_illness`, {
      narrative: "Inicia hace 3 días…",
    }).expect(200);
    // Una sin formulario todavía es 422; una desconocida, 400; datos inválidos, 400.
    await put(negocio.token, `${base}/sections/family_history`, {}).expect(422);
    await put(negocio.token, `${base}/sections/no_existe`, {}).expect(400);
    await put(negocio.token, `${base}/sections/general_data`, { sex: "Q" }).expect(400);

    const detalle = await get(negocio.token, base).expect(200);
    const d = detalle.body as typeof expediente;
    expect(d.sections.filter((s) => s.status === "completed").map((s) => s.key)).toEqual([
      "general_data",
      "chief_complaint",
      "current_illness",
    ]);
    expect(d.sections.filter((s) => s.status === "pending")).toHaveLength(29);
    expect(d.patient.sex).toBe("F");

    // SEGUNDA visita: hay que cerrar la de hoy antes (F9-CLINIC-27: un
    // paciente no tiene dos consultas abiertas el mismo día).
    await post(negocio.token, `${base}/close`).expect(200);
    const segunda = await post(negocio.token, "/medical-clinic/records", { customerId }).expect(
      201,
    );
    const s2 = segunda.body as typeof expediente & {
      sections: { key: string; status: string; data: unknown }[];
    };
    expect(s2.folio).toBe("HCL-000002");
    expect(s2.patient.sex).toBe("F");
    const generales = s2.sections.find((s) => s.key === "general_data");
    expect(generales).toMatchObject({
      status: "completed",
      data: { sex: "F", occupation: "Docente" },
    });
    expect(s2.sections.find((s) => s.key === "chief_complaint")?.status).toBe("pending");
    // La búsqueda ya conoce el último expediente.
    const otra = await get(
      negocio.token,
      `/medical-clinic/patients/search?mode=turn&q=${number}`,
    ).expect(200);
    expect(otra.body[0].lastRecord).toMatchObject({ folio: "HCL-000002" });

    // Cerrar es idempotente; después no se escribe.
    const cerrado = await post(negocio.token, `${base}/close`).expect(200);
    expect((cerrado.body as { status: string }).status).toBe("closed");
    await put(negocio.token, `${base}/sections/chief_complaint`, { complaint: "x" }).expect(409);
  });

  it("el turno sin cliente queda ligado Y con nombre en la lista de Recepción", async () => {
    // El caso que Carlos vio roto (2026-09-04): la recepcionista solo da el
    // número y el paciente se registra al iniciar la consulta. La lista de
    // turnos NO lee el cliente vinculado, pinta el snapshot `customer_name`;
    // ligar solo el id la dejaba diciendo «Sin cliente» con el paciente ya
    // adentro. Por eso se asevera contra el LISTADO, no contra la columna.
    const turno = await post(negocio.token, "/reception/turns", {}).expect(201);
    const { id: turnId, number } = turno.body as { id: string; number: number };

    const hallazgo = await get(
      negocio.token,
      `/medical-clinic/patients/search?mode=turn&q=${number}`,
    ).expect(200);
    expect((hallazgo.body as { customerId: string | null }[])[0]).toMatchObject({
      customerId: null,
      turnId,
    });

    const paciente = await post(negocio.token, "/medical-clinic/patients", {
      firstName: "Sin",
      lastNamePaternal: "Turno",
      lastNameMaternal: "Previo",
    }).expect(201);
    await post(negocio.token, "/medical-clinic/records", {
      customerId: (paciente.body as { id: string }).id,
      turnId,
    }).expect(201);

    const hoy = localCalendarDate("America/Mexico_City", new Date());
    const lista = await get(negocio.token, `/reception/turns?date=${hoy}`).expect(200);
    const fila = (lista.body as { id: string; customerName: string | null; status: string }[]).find(
      (t) => t.id === turnId,
    );
    expect(fila).toMatchObject({ customerName: "Sin Turno Previo", status: "attended" });
  });

  it("sin :attend no se lee ni se busca nada del consultorio", async () => {
    await get(viewerToken, "/medical-clinic/records").expect(403);
    await get(viewerToken, "/medical-clinic/patients/search?mode=name&q=ana").expect(403);
    await post(viewerToken, "/medical-clinic/records", {
      customerId: "00000000-0000-0000-0000-000000000000",
    }).expect(403);
    await get(viewerToken, "/medical-clinic/stock-search?q=para").expect(403);
  });

  it("un paciente ajeno no existe para este negocio (404)", async () => {
    await post(negocio.token, "/medical-clinic/records", {
      customerId: "00000000-0000-0000-0000-000000000000",
    }).expect(404);
  });
});
