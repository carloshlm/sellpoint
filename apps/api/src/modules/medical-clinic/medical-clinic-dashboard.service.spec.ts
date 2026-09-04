import { MedicalClinicDashboardService } from "./medical-clinic-dashboard.service";

/**
 * F9-CLINIC-30 — «lo más vendido del consultorio».
 *
 * Dos reglas que no se pueden negociar: se agrupa por ID de catálogo (un
 * estudio renombrado es el MISMO estudio, y dos con el mismo nombre son dos) y
 * una venta anulada no cuenta. Lo demás es pintar.
 */
const TENANT = "11111111-1111-1111-1111-111111111111";
const USER = { userId: "dr-1", tenantId: TENANT, permissions: [], locale: "es" as const };
type Mock = jest.Mock;

describe("MedicalClinicDashboardService (F9-CLINIC-30)", () => {
  let queryRaw: Mock;
  let prisma: { withTenantContext: Mock; tenant: { findUnique: Mock } };
  let service: MedicalClinicDashboardService;

  beforeEach(() => {
    jest.useFakeTimers().setSystemTime(new Date("2026-09-04T15:00:00.000Z"));
    queryRaw = jest.fn().mockResolvedValue([]);
    prisma = {
      withTenantContext: jest.fn((_t: string, fn: (tx: unknown) => unknown) =>
        fn({ $queryRaw: queryRaw }),
      ),
      tenant: { findUnique: jest.fn().mockResolvedValue({ timezone: "America/Mexico_City" }) },
    };
    service = new MedicalClinicDashboardService(
      // biome-ignore lint/suspicious/noExplicitAny: mocks parciales a propósito
      prisma as any,
      { now: () => new Date("2026-09-04T15:00:00.000Z") },
    );
  });

  afterEach(() => jest.useRealTimers());

  /** El SQL de la consulta, como texto plano, para leer sus reglas. */
  const sqlDe = (llamada: number): string => {
    const args = queryRaw.mock.calls[llamada]?.[0] as { strings?: string[] } | string[];
    const partes = Array.isArray(args) ? args : (args.strings ?? []);
    return partes.join(" ");
  };

  it("sin ventas devuelve las tres listas vacías, no un 404", async () => {
    await expect(service.top(USER, "month")).resolves.toEqual({
      medications: [],
      labStudies: [],
      diagnosticStudies: [],
    });
  });

  it("una consulta por tipo, siempre sobre la vista y sin ventas anuladas", async () => {
    await service.top(USER, "month");
    expect(queryRaw).toHaveBeenCalledTimes(3);
    for (let i = 0; i < 3; i++) {
      const sql = sqlDe(i);
      expect(sql).toContain("medical_clinic_sold_items");
      expect(sql).toContain("sale_status = 'completed'");
    }
  });

  it("agrupa por ID de catálogo y toma el nombre VIGENTE, nunca el del ticket", async () => {
    await service.top(USER, "month");
    const medicamentos = sqlDe(0);
    const laboratorio = sqlDe(1);
    const diagnostico = sqlDe(2);
    expect(medicamentos).toContain("v.product_id");
    expect(laboratorio).toContain("v.lab_study_id");
    expect(diagnostico).toContain("v.diagnostic_study_id");
    // El nombre sale del catálogo por JOIN, no de la descripción congelada.
    expect(laboratorio).toContain("medical_clinic_lab_studies");
    expect(laboratorio).not.toContain("v.description");
  });

  it("el período se resuelve en la zona del NEGOCIO", async () => {
    await service.top(USER, "today");
    const [, desde, hasta] = queryRaw.mock.calls[0] as [unknown, Date, Date];
    // 4-sep 00:00 de CDMX es el 4-sep 06:00 UTC.
    expect(desde.toISOString()).toBe("2026-09-04T06:00:00.000Z");
    expect(hasta.getTime()).toBeGreaterThan(desde.getTime());
  });

  it("devuelve cada lista con su id, código, nombre, unidades e ingreso", async () => {
    queryRaw
      .mockResolvedValueOnce([
        { id: "p-1", code: "PARA", name: "Paracetamol", units: "12.0000", revenue: "540.00" },
      ])
      .mockResolvedValueOnce([
        { id: "s-1", code: "BH", name: "Biometría hemática", units: "3.0000", revenue: "1050.00" },
      ])
      .mockResolvedValueOnce([]);
    await expect(service.top(USER, "month")).resolves.toEqual({
      medications: [
        { id: "p-1", code: "PARA", name: "Paracetamol", units: "12.0000", revenue: "540.00" },
      ],
      labStudies: [
        { id: "s-1", code: "BH", name: "Biometría hemática", units: "3.0000", revenue: "1050.00" },
      ],
      diagnosticStudies: [],
    });
  });
});
