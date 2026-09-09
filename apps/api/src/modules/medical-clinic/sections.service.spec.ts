import { MEDICAL_RECORD_SECTION_SCHEMAS } from "@sellpoint/shared";
import { SectionsService } from "./sections.service";

/**
 * F9-CLINIC-11 — guardar una sección: zod por clave, 400 clave desconocida,
 * 422 sin formulario, 409 expediente cerrado, upsert por (record, clave),
 * y Datos Generales proyecta el sexo al encabezado. Guardar vacío no deja
 * una fila «Completada» mintiendo: borra.
 */
const TENANT = "11111111-1111-1111-1111-111111111111";
const USER = { userId: "dr-1", tenantId: TENANT, permissions: [], locale: "es" as const };
const META = { ip: "127.0.0.1", userAgent: "jest" };
type Mock = jest.Mock;

describe("SectionsService (F9-CLINIC-11)", () => {
  let tx: {
    medicalClinicRecord: { findFirst: Mock; update: Mock };
    medicalClinicRecordSection: { upsert: Mock; deleteMany: Mock; findFirst: Mock };
  };
  let prisma: { withTenantContext: Mock };
  let audit: { record: Mock };
  let service: SectionsService;

  beforeEach(() => {
    tx = {
      medicalClinicRecord: {
        findFirst: jest
          .fn()
          .mockResolvedValue({ id: "r-1", status: "open", consultationDate: new Date() }),
        update: jest.fn().mockResolvedValue({}),
      },
      medicalClinicRecordSection: {
        upsert: jest.fn().mockImplementation(({ create }) =>
          Promise.resolve({
            id: "s-1",
            ...create,
            updatedAt: new Date("2026-09-03T15:00:00.000Z"),
          }),
        ),
        deleteMany: jest.fn().mockResolvedValue({ count: 1 }),
        findFirst: jest.fn().mockResolvedValue(null),
      },
    };
    // La zona del negocio decide qué día es «hoy»: UTC para que el spec no dependa del reloj.
    (tx as Record<string, unknown>).tenant = {
      findUniqueOrThrow: jest.fn().mockResolvedValue({ timezone: "UTC" }),
    };
    prisma = { withTenantContext: jest.fn((_t: string, fn: (t: typeof tx) => unknown) => fn(tx)) };
    audit = { record: jest.fn() };
    // biome-ignore lint/suspicious/noExplicitAny: mocks parciales a propósito
    service = new SectionsService(prisma as any, audit as any);
  });

  it("las tres claves funcionales guardan por upsert y devuelven la sección completada", async () => {
    const res = await service.save(USER, "r-1", "chief_complaint", { complaint: "Dolor" }, META);
    const args = tx.medicalClinicRecordSection.upsert.mock.calls[0][0];
    expect(args.where).toEqual({
      recordId_sectionKey: { recordId: "r-1", sectionKey: "chief_complaint" },
    });
    expect(args.create).toMatchObject({
      tenantId: TENANT,
      data: { complaint: "Dolor" },
      updatedBy: "dr-1",
    });
    expect(args.update).toMatchObject({ data: { complaint: "Dolor" }, updatedBy: "dr-1" });
    expect(res).toMatchObject({
      key: "chief_complaint",
      status: "completed",
      data: { complaint: "Dolor" },
    });
    expect(audit.record).toHaveBeenCalledWith(
      tx,
      expect.objectContaining({ action: "medical_clinic.section.save" }),
    );
  });

  it("una clave fuera del catálogo es 400, y una retirada del catálogo también", async () => {
    await expect(service.save(USER, "r-1", "no_existe", {}, META)).rejects.toMatchObject({
      response: { message: "medical_clinic.section_unknown" },
    });
    // F9-CLINIC-DOC-01: «Archivos Adjuntos» se retiró; ya no es «sin
    // formulario», simplemente no existe.
    await expect(service.save(USER, "r-1", "attachments", {}, META)).rejects.toMatchObject({
      response: { message: "medical_clinic.section_unknown" },
    });
    expect(tx.medicalClinicRecordSection.upsert).not.toHaveBeenCalled();
  });

  /**
   * F9-CLINIC-DOC-01 — con todo el catálogo funcional ya no hay una clave
   * real sin schema, pero la ley sigue: sin schema no es funcional y el API
   * dice 422 antes de tocar la base. Se prueba quitando un schema del mapa
   * (es un `Partial<Record>` mutable exportado) y devolviéndolo al final.
   */
  it("una clave del catálogo sin schema es 422 y no toca la base", async () => {
    const guardado = MEDICAL_RECORD_SECTION_SCHEMAS.general_data;
    MEDICAL_RECORD_SECTION_SCHEMAS.general_data = undefined;
    try {
      await expect(service.save(USER, "r-1", "general_data", {}, META)).rejects.toMatchObject({
        response: { message: "medical_clinic.section_not_available" },
      });
    } finally {
      MEDICAL_RECORD_SECTION_SCHEMAS.general_data = guardado;
    }
    expect(tx.medicalClinicRecordSection.upsert).not.toHaveBeenCalled();
  });

  /**
   * F9-CLINIC-DOC-08 — la bitácora guarda lo que decía y lo que dice: una
   * sección sobrescrita ya no tiene «antes» en ningún otro lado.
   */
  it("audita el antes y el después con los datos; borrar audita el después como pendiente", async () => {
    await service.save(USER, "r-1", "chief_complaint", { complaint: "Dolor" }, META);
    expect(audit.record.mock.calls[0][1]).toMatchObject({
      action: "medical_clinic.section.save",
      before: { sectionKey: "chief_complaint", data: null },
      after: { sectionKey: "chief_complaint", status: "completed", data: { complaint: "Dolor" } },
    });

    tx.medicalClinicRecordSection.findFirst.mockResolvedValue({ data: { complaint: "Dolor" } });
    await service.save(USER, "r-1", "chief_complaint", { complaint: "Tos seca" }, META);
    expect(audit.record.mock.calls[1][1]).toMatchObject({
      before: { data: { complaint: "Dolor" } },
      after: { status: "completed", data: { complaint: "Tos seca" } },
    });

    await service.save(USER, "r-1", "chief_complaint", {}, META);
    expect(audit.record.mock.calls[2][1]).toMatchObject({
      before: { data: { complaint: "Dolor" } },
      after: { status: "pending", data: {} },
    });
  });

  it("datos que no cumplen el schema son 400 con la clave del cuerpo", async () => {
    await expect(
      service.save(USER, "r-1", "general_data", { sex: "Q" }, META),
    ).rejects.toMatchObject({
      response: { message: "medical_clinic.invalid_body" },
    });
  });

  it("un expediente cerrado no acepta escrituras (409) y uno ajeno es 404", async () => {
    tx.medicalClinicRecord.findFirst.mockResolvedValue({
      id: "r-1",
      status: "closed",
      consultationDate: new Date(),
    });
    await expect(
      service.save(USER, "r-1", "general_data", { sex: "F" }, META),
    ).rejects.toMatchObject({
      response: { message: "medical_clinic.record_closed" },
    });
    tx.medicalClinicRecord.findFirst.mockResolvedValue(null);
    await expect(
      service.save(USER, "r-x", "general_data", { sex: "F" }, META),
    ).rejects.toMatchObject({
      response: { message: "medical_clinic.record_not_found" },
    });
  });

  it("Datos Generales proyecta el sexo al encabezado en la misma tx", async () => {
    await service.save(USER, "r-1", "general_data", { sex: "F", occupation: "Docente" }, META);
    expect(tx.medicalClinicRecord.update).toHaveBeenCalledWith({
      where: { id: "r-1" },
      data: { patientSex: "F" },
    });
  });

  it("guardar todo vacío borra la fila y deja la sección pendiente", async () => {
    const res = await service.save(USER, "r-1", "current_illness", {}, META);
    expect(tx.medicalClinicRecordSection.upsert).not.toHaveBeenCalled();
    expect(tx.medicalClinicRecordSection.deleteMany).toHaveBeenCalledWith({
      where: { recordId: "r-1", sectionKey: "current_illness" },
    });
    expect(res).toMatchObject({ key: "current_illness", status: "pending", data: {} });
  });

  /** F9-CLINIC-26 — una consulta abierta de otro día ya no acepta captura. */
  it("un expediente abierto de OTRO DÍA rebota con 409 record_expired", async () => {
    tx.medicalClinicRecord.findFirst.mockResolvedValue({
      id: "r-1",
      status: "open",
      consultationDate: new Date("2020-01-01"),
    });
    await expect(
      service.save(USER, "r-1", "general_data", { sex: "F" }, META),
    ).rejects.toMatchObject({
      response: { message: "medical_clinic.record_expired" },
    });
    expect(tx.medicalClinicRecordSection.upsert).not.toHaveBeenCalled();
  });
});
