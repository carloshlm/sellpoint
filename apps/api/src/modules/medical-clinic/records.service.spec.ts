import { RecordsService } from "./records.service";

jest.mock("../inventory/folio", () => ({
  nextFolio: jest.fn().mockResolvedValue("HCL-000001"),
}));

/**
 * F9-CLINIC-10/12 — UN expediente por visita, con copy-forward de Datos
 * Generales y el estado de las 32 secciones derivado (existe fila ⇔
 * Completado). Cerrar es idempotente.
 */
const TENANT = "11111111-1111-1111-1111-111111111111";
const USER = { userId: "dr-1", tenantId: TENANT, permissions: [], locale: "es" as const };
const META = { ip: "127.0.0.1", userAgent: "jest" };
const CDMX = "America/Mexico_City";
type Mock = jest.Mock;

const cliente = {
  id: "c-1",
  firstName: "Ana",
  lastNamePaternal: "Pérez",
  lastNameMaternal: "Luna",
  birthDate: new Date("1990-09-03"),
};

const expediente = (extra: Record<string, unknown> = {}) => ({
  id: "r-1",
  tenantId: TENANT,
  folio: "HCL-000001",
  patientCustomerId: "c-1",
  patientName: "Ana Pérez Luna",
  patientBirthDate: new Date("1990-09-03"),
  patientSex: null,
  turnId: null,
  turnNumber: null,
  doctorUserId: "dr-1",
  consultationDate: new Date("2026-09-03"),
  status: "open",
  closedAt: null,
  closedBy: null,
  createdAt: new Date("2026-09-03T15:00:00.000Z"),
  updatedAt: new Date("2026-09-03T15:00:00.000Z"),
  doctor: { id: "dr-1", firstName: "Gregorio", lastNamePaternal: "House" },
  sections: [],
  orders: [],
  ...extra,
});

describe("RecordsService (F9-CLINIC-10/12)", () => {
  let tx: {
    customer: { findFirst: Mock };
    receptionTurn: { findFirst: Mock };
    medicalClinicRecord: {
      findFirst: Mock;
      create: Mock;
      updateMany: Mock;
      findMany: Mock;
      count: Mock;
    };
    medicalClinicRecordSection: { create: Mock; findMany: Mock };
  };
  let prisma: { withTenantContext: Mock; tenant: { findUnique: Mock } };
  let audit: { record: Mock };
  let service: RecordsService;

  beforeEach(() => {
    jest.useFakeTimers().setSystemTime(new Date("2026-09-03T15:00:00.000Z"));
    tx = {
      customer: { findFirst: jest.fn().mockResolvedValue(cliente) },
      receptionTurn: { findFirst: jest.fn().mockResolvedValue(null) },
      medicalClinicRecord: {
        // Primera llamada: el expediente ANTERIOR del paciente (ninguno);
        // después, el recién creado con sus relaciones.
        findFirst: jest.fn().mockResolvedValueOnce(null).mockResolvedValue(expediente()),
        create: jest.fn().mockImplementation(({ data }) => Promise.resolve(expediente(data))),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        findMany: jest.fn().mockResolvedValue([expediente()]),
        count: jest.fn().mockResolvedValue(1),
      },
      medicalClinicRecordSection: {
        create: jest.fn().mockImplementation(({ data }) => Promise.resolve({ id: "s-1", ...data })),
        findMany: jest.fn().mockResolvedValue([]),
      },
    };
    prisma = {
      withTenantContext: jest.fn((_t: string, fn: (t: typeof tx) => unknown) => fn(tx)),
      tenant: { findUnique: jest.fn().mockResolvedValue({ timezone: CDMX }) },
    };
    audit = { record: jest.fn() };
    // biome-ignore lint/suspicious/noExplicitAny: mocks parciales a propósito
    service = new RecordsService(prisma as any, audit as any);
  });

  afterEach(() => jest.useRealTimers());

  describe("crear", () => {
    it("el primer expediente nace con snapshots, el día del negocio, sin Datos Generales ni sexo", async () => {
      await service.create(USER, { customerId: "c-1" }, META);
      const data = tx.medicalClinicRecord.create.mock.calls[0][0].data;
      expect(data).toMatchObject({
        tenantId: TENANT,
        folio: "HCL-000001",
        patientCustomerId: "c-1",
        patientName: "Ana Pérez Luna",
        doctorUserId: "dr-1",
        patientSex: null,
      });
      expect(data.consultationDate.toISOString().slice(0, 10)).toBe("2026-09-03");
      expect(tx.medicalClinicRecordSection.create).not.toHaveBeenCalled();
      expect(audit.record).toHaveBeenCalledWith(
        tx,
        expect.objectContaining({
          action: "medical_clinic.record.create",
          resourceType: "medical_record",
        }),
      );
    });

    it("el segundo copia SOLO Datos Generales del anterior y proyecta el sexo", async () => {
      tx.medicalClinicRecord.findFirst
        .mockReset()
        .mockResolvedValueOnce(
          expediente({
            id: "r-0",
            folio: "HCL-000000",
            sections: [
              { sectionKey: "general_data", data: { sex: "F", occupation: "Docente" } },
              { sectionKey: "chief_complaint", data: { complaint: "Dolor" } },
            ],
          }),
        )
        .mockResolvedValue(expediente());
      await service.create(USER, { customerId: "c-1" }, META);

      expect(tx.medicalClinicRecord.create.mock.calls[0][0].data.patientSex).toBe("F");
      expect(tx.medicalClinicRecordSection.create).toHaveBeenCalledTimes(1);
      expect(tx.medicalClinicRecordSection.create.mock.calls[0][0].data).toMatchObject({
        sectionKey: "general_data",
        data: { sex: "F", occupation: "Docente" },
      });
    });

    it("con turno, guarda el número como snapshot; un paciente ajeno es 404", async () => {
      tx.receptionTurn.findFirst.mockResolvedValue({ id: "t-1", number: 7 });
      await service.create(USER, { customerId: "c-1", turnId: "t-1" }, META);
      expect(tx.medicalClinicRecord.create.mock.calls[0][0].data).toMatchObject({
        turnId: "t-1",
        turnNumber: 7,
      });

      tx.customer.findFirst.mockResolvedValue(null);
      await expect(service.create(USER, { customerId: "ajeno" }, META)).rejects.toMatchObject({
        response: { message: "medical_clinic.patient_not_found" },
      });
    });
  });

  describe("detalle y cierre", () => {
    // Acá no hay «expediente anterior» que buscar: la primera lectura ya es el detalle.
    beforeEach(() => {
      tx.medicalClinicRecord.findFirst.mockReset().mockResolvedValue(expediente());
    });

    it("recién creado: 32 secciones pendientes, edad contra la fecha de consulta, médico con nombre", async () => {
      const d = await service.detail(USER, "r-1");
      expect(d.sections).toHaveLength(32);
      expect(d.sections.every((s) => s.status === "pending")).toBe(true);
      expect(d.sections[0]).toMatchObject({
        key: "general_data",
        group: "interrogation",
        functional: true,
      });
      expect(d.patient).toMatchObject({ name: "Ana Pérez Luna", age: 36, sex: null });
      expect(d.doctor).toEqual({ id: "dr-1", name: "Gregorio House" });
      expect(d.status).toBe("open");
    });

    it("con Motivo de Consulta guardado: 31 pendientes y 1 completada, con sus datos", async () => {
      tx.medicalClinicRecord.findFirst.mockResolvedValue(
        expediente({
          sections: [
            { sectionKey: "chief_complaint", data: { complaint: "Dolor" }, updatedAt: new Date() },
          ],
        }),
      );
      const d = await service.detail(USER, "r-1");
      expect(d.sections.filter((s) => s.status === "completed").map((s) => s.key)).toEqual([
        "chief_complaint",
      ]);
      expect(d.sections.find((s) => s.key === "chief_complaint")?.data).toEqual({
        complaint: "Dolor",
      });
      expect(d.sections.filter((s) => s.status === "pending")).toHaveLength(31);
    });

    it("cerrar es idempotente: la segunda vez no falla y devuelve el mismo estado", async () => {
      await service.close(USER, "r-1", META);
      expect(tx.medicalClinicRecord.updateMany.mock.calls[0][0].where).toMatchObject({
        id: "r-1",
        tenantId: TENANT,
        status: "open",
      });
      tx.medicalClinicRecord.updateMany.mockResolvedValue({ count: 0 });
      tx.medicalClinicRecord.findFirst.mockResolvedValue(
        expediente({ status: "closed", closedAt: new Date() }),
      );
      await expect(service.close(USER, "r-1", META)).resolves.toMatchObject({ status: "closed" });
    });
  });
});
