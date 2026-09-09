import type { INestApplication } from "@nestjs/common";
import { Test, type TestingModule } from "@nestjs/testing";
import request from "supertest";
import type { App } from "supertest/types";
import { AppModule } from "../../src/app.module";
import { PrismaService } from "../../src/infrastructure/prisma/prisma.service";
import { MAILER } from "../../src/modules/mail/mailer.port";
import { NoopMailer } from "../../src/modules/mail/noop.mailer";
import { bearer, type TenantFixture } from "./support/billing-scenario";
import { adminDePlataforma, consultorio } from "./support/medical-clinic-scenario";
import { startTestApp } from "./support/start-test-app";

/**
 * F9-CLINIC-HC-24 — las 16 secciones nuevas de la historia clínica contra
 * sus schemas de shared, de punta a punta: un cuerpo válido guarda y vuelve
 * Completado; uno inválido es 400 con `errors[]`; el detalle trae las 19
 * con datos; lo NEGADO se guarda explícito y solo; los antecedentes se
 * heredan a la segunda consulta con la seña de la primera, y lo del día
 * (signos, exploración, diagnósticos) no.
 */
describe("Consultorio Médico — las secciones de la historia clínica (F9-CLINIC-HC-24)", () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let admin: TenantFixture;
  let negocio: TenantFixture;
  let customerId: string;
  let recordId: string;
  let folio: string;
  let consultationDate: string;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(MAILER)
      .useClass(NoopMailer)
      .compile();
    app = moduleFixture.createNestApplication();
    await startTestApp(app);
    prisma = app.get(PrismaService);
    admin = await adminDePlataforma(app, prisma, "sections-admin");
    negocio = await consultorio(app, prisma, "sections", admin);

    const paciente = await post(negocio.token, "/medical-clinic/patients", {
      firstName: "Rosa",
      lastName: "Luna",
      birthDate: "1988-05-10",
    }).expect(201);
    customerId = (paciente.body as { id: string }).id;
    const creado = await post(negocio.token, "/medical-clinic/records", { customerId }).expect(201);
    const cuerpo = creado.body as { id: string; folio: string; consultationDate: string };
    recordId = cuerpo.id;
    folio = cuerpo.folio;
    consultationDate = cuerpo.consultationDate;
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
  const seccion = (key: string) => `/medical-clinic/records/${recordId}/sections/${key}`;

  type Vista = { key: string; status: string; data: Record<string, unknown> };
  const guardar = async (key: string, body: object) => {
    const res = await put(negocio.token, seccion(key), body).expect(200);
    return res.body as Vista;
  };
  // El API traduce la clave al idioma del usuario («Revisa los datos del
  // consultorio.»): lo que se afirma es el 400 y la lista de errores por campo.
  const rechazar = async (key: string, body: object) => {
    const res = await put(negocio.token, seccion(key), body).expect(400);
    expect((res.body as { errors: unknown[] }).errors.length).toBeGreaterThan(0);
  };

  /** Cada sección nueva: un cuerpo que guarda tal cual, y uno que rebota. */
  const CASOS: [string, Record<string, unknown>, Record<string, unknown>][] = [
    ["general_data", { sex: "F", ethnicGroup: "Náhuatl", religion: "Católica" }, { sex: "Q" }],
    [
      "family_history",
      { conditions: [{ condition: "diabetes", relatives: ["mother"] }] },
      { conditions: [{ condition: "diabetes", relatives: [] }] },
    ],
    [
      "pathological_history",
      { surgeries: [{ procedure: "Apendicectomía", year: 2015 }], transfusions: { had: false } },
      { surgeries: [{ procedure: "x", year: 2999 }] },
    ],
    [
      "non_pathological_history",
      { smoking: { status: "current", cigarettesPerDay: 20, years: 10 }, bloodType: "O+" },
      { smoking: { status: "never", cigarettesPerDay: 5 } },
    ],
    [
      "gyneco_obstetric_history",
      { menarcheAge: 12, gestations: 2, births: 1, cesareans: 1, contraception: "iud" },
      { menarcheAge: 7 },
    ],
    [
      "allergies",
      { items: [{ kind: "drug", substance: "Penicilina", severity: "severe" }] },
      { items: [] },
    ],
    [
      "current_medications",
      { items: [{ name: "Metformina", dose: "850 mg" }] },
      { none: true, items: [{ name: "x" }] },
    ],
    [
      "systems_review",
      { systems: { respiratory: { normal: true }, digestive: { findings: "Dolor epigástrico" } } },
      { systems: { liver: { normal: true } } },
    ],
    ["anthropometry", { weightKg: 68.5, heightCm: 165 }, { weightKg: "68" }],
    [
      "vital_signs",
      { systolic: 120, diastolic: 80, heartRate: 72, temperatureC: 36.6, oxygenSaturation: 98 },
      { systolic: 80, diastolic: 120 },
    ],
    [
      "physical_exam",
      { habitus: "Íntegra, cooperadora", regions: { abdomen: { findings: "Dolor en FID" } } },
      { regions: { abdomen: { findings: "" } } },
    ],
    [
      "study_results",
      {
        items: [
          { kind: "lab", name: "Biometría hemática", result: "Hb 13.5", interpretation: "normal" },
        ],
      },
      { items: [{ kind: "lab", name: "BH", result: "" }] },
    ],
    ["diagnostic_impression", { impression: "Probable IVRS" }, { impression: 5 }],
    [
      "diagnoses",
      {
        items: [
          {
            role: "primary",
            description: "Faringitis aguda",
            icd10Code: "J02.9",
            certainty: "confirmed",
          },
          { role: "differential", description: "Mononucleosis" },
        ],
      },
      {
        items: [
          { role: "primary", description: "A" },
          { role: "primary", description: "B" },
        ],
      },
    ],
    ["treatment", { nonPharmacological: "Reposo e hidratación" }, { pharmacological: 1 }],
    [
      "management_plan",
      { prognosis: "good", plan: "Control en 2 semanas" },
      { prognosis: "Bueno" },
    ],
  ];

  it.each(CASOS)(
    "%s: guarda lo válido tal cual y rebota lo inválido con errors[]",
    async (key, valido, invalido) => {
      const vista = await guardar(key, valido);
      expect(vista).toMatchObject({ key, status: "completed", data: valido });
      await rechazar(key, invalido);
      // Un cuerpo con una clave inventada tampoco entra: los schemas son .strict().
      await rechazar(key, { ...valido, foo: 1 });
    },
  );

  it("seguimiento: la próxima cita no es anterior a la consulta, pero el mismo día sí", async () => {
    const ayer = new Date(`${consultationDate}T12:00:00Z`);
    ayer.setUTCDate(ayer.getUTCDate() - 1);
    await rechazar("follow_up", { nextAppointmentDate: ayer.toISOString().slice(0, 10) });
    const vista = await guardar("follow_up", {
      nextAppointmentDate: consultationDate,
      alarmSigns: "Fiebre mayor a 39",
    });
    expect(vista.data).toEqual({
      nextAppointmentDate: consultationDate,
      alarmSigns: "Fiebre mayor a 39",
    });
  });

  it("lo negado se guarda explícito y solo: con datos al lado rebota", async () => {
    for (const key of ["family_history", "pathological_history", "allergies", "systems_review"]) {
      await rechazar(key, { negated: true, notes: "x" });
    }
    await rechazar("current_medications", { none: true, notes: "x" });
    // `{}` sigue valiendo: guardar nada es Pendiente (borra la fila).
    const vacio = await guardar("diagnostic_impression", {});
    expect(vacio).toMatchObject({ status: "pending", data: {} });
    await guardar("diagnostic_impression", { impression: "Probable IVRS" });
  });

  it("el detalle trae las 19 funcionales capturadas, y las siete de Documentos siguen pendientes", async () => {
    const detalle = (await get(negocio.token, `/medical-clinic/records/${recordId}`).expect(200))
      .body as {
      sections: (Vista & { functional: boolean })[];
    };
    const funcionales = detalle.sections.filter((s) => s.functional);
    expect(funcionales).toHaveLength(19);
    // Motivo y Padecimiento no se capturaron en este spec: 17 completadas.
    expect(funcionales.filter((s) => s.status === "completed")).toHaveLength(17);
    expect(detalle.sections.filter((s) => !s.functional)).toHaveLength(7);
    expect(detalle.sections.find((s) => s.key === "allergies")?.data).toEqual({
      items: [{ kind: "drug", substance: "Penicilina", severity: "severe" }],
    });
  });

  it("la segunda consulta hereda los siete antecedentes con la seña de la primera; lo del día no", async () => {
    await post(negocio.token, `/medical-clinic/records/${recordId}/close`).expect(200);
    const segunda = (
      await post(negocio.token, "/medical-clinic/records", { customerId }).expect(201)
    ).body as { id: string; sections: (Vista & { carriedFrom: { folio: string } | null })[] };
    const heredadas = segunda.sections.filter((s) => s.carriedFrom !== null).map((s) => s.key);
    expect(heredadas.sort()).toEqual(
      [
        "general_data",
        "family_history",
        "pathological_history",
        "non_pathological_history",
        "gyneco_obstetric_history",
        "allergies",
        "current_medications",
      ].sort(),
    );
    for (const key of heredadas) {
      expect(segunda.sections.find((s) => s.key === key)?.carriedFrom).toEqual(
        expect.objectContaining({ recordId, folio }),
      );
    }
    for (const key of [
      "vital_signs",
      "anthropometry",
      "physical_exam",
      "diagnoses",
      "systems_review",
      "follow_up",
    ]) {
      expect(segunda.sections.find((s) => s.key === key)).toMatchObject({
        status: "pending",
        carriedFrom: null,
      });
    }
    // Confirmarla la hace suya.
    const confirmada = await put(
      negocio.token,
      `/medical-clinic/records/${segunda.id}/sections/allergies`,
      {
        negated: true,
      },
    ).expect(200);
    expect(confirmada.body).toMatchObject({ status: "completed", data: { negated: true } });
    const detalle = (await get(negocio.token, `/medical-clinic/records/${segunda.id}`).expect(200))
      .body as {
      sections: (Vista & { carriedFrom: unknown })[];
    };
    expect(detalle.sections.find((s) => s.key === "allergies")?.carriedFrom).toBeNull();
    expect(detalle.sections.find((s) => s.key === "family_history")?.carriedFrom).not.toBeNull();
  });
});
