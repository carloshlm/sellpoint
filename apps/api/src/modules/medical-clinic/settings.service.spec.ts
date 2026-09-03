import { SettingsService } from "./settings.service";

/**
 * F9-CLINIC-22 — qué vende el consultorio.
 *
 * Sin fila, el negocio vende solo medicamentos (Carlos, 2026-09-03: la
 * mayoría de los consultorios no vende estudios). `get` NO crea la fila;
 * `update` hace upsert con quién y audita con antes/después.
 */
const TENANT = "11111111-1111-1111-1111-111111111111";
const USER = { userId: "u-1", tenantId: TENANT, permissions: [], locale: "es" as const };
const META = { ip: "127.0.0.1", userAgent: "jest" };
type Mock = jest.Mock;

describe("SettingsService (F9-CLINIC-22)", () => {
  let tx: { medicalClinicSettings: { findUnique: Mock; upsert: Mock } };
  let prisma: { withTenantContext: Mock };
  let audit: { record: Mock };
  let service: SettingsService;

  beforeEach(() => {
    tx = {
      medicalClinicSettings: {
        findUnique: jest.fn().mockResolvedValue(null),
        upsert: jest.fn().mockImplementation(({ create, update }) =>
          Promise.resolve({
            tenantId: TENANT,
            sellsMedications: true,
            sellsLabStudies: false,
            sellsDiagnosticStudies: false,
            ...create,
            ...update,
          }),
        ),
      },
    };
    prisma = { withTenantContext: jest.fn((_t: string, fn: (t: typeof tx) => unknown) => fn(tx)) };
    audit = { record: jest.fn() };
    // biome-ignore lint/suspicious/noExplicitAny: mocks parciales a propósito
    service = new SettingsService(prisma as any, audit as any);
  });

  it("sin fila: medicamentos sí, estudios no — y no la crea", async () => {
    await expect(service.get(USER)).resolves.toEqual({
      sellsMedications: true,
      sellsLabStudies: false,
      sellsDiagnosticStudies: false,
    });
    expect(tx.medicalClinicSettings.upsert).not.toHaveBeenCalled();
  });

  it("marcar laboratorio crea la fila con los defaults del resto y audita antes/después", async () => {
    const res = await service.update(USER, { sellsLabStudies: true }, META);
    const args = tx.medicalClinicSettings.upsert.mock.calls[0][0];
    expect(args.where).toEqual({ tenantId: TENANT });
    expect(args.create).toMatchObject({
      tenantId: TENANT,
      sellsLabStudies: true,
      updatedBy: "u-1",
    });
    expect(args.update).toEqual({ sellsLabStudies: true, updatedBy: "u-1" });
    expect(res).toEqual({
      sellsMedications: true,
      sellsLabStudies: true,
      sellsDiagnosticStudies: false,
    });
    expect(audit.record).toHaveBeenCalledWith(
      tx,
      expect.objectContaining({
        action: "medical_clinic.settings.update",
        before: { sellsMedications: true, sellsLabStudies: false, sellsDiagnosticStudies: false },
        after: { sellsMedications: true, sellsLabStudies: true, sellsDiagnosticStudies: false },
      }),
    );
  });

  it("con fila, get devuelve lo guardado", async () => {
    tx.medicalClinicSettings.findUnique.mockResolvedValue({
      tenantId: TENANT,
      sellsMedications: false,
      sellsLabStudies: true,
      sellsDiagnosticStudies: true,
    });
    await expect(service.get(USER)).resolves.toEqual({
      sellsMedications: false,
      sellsLabStudies: true,
      sellsDiagnosticStudies: true,
    });
  });
});
