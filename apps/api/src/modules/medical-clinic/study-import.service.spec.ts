import { LabStudyImportService } from "./study-import.service";

/**
 * F9-CLINIC — importar el catálogo de estudios desde Excel, con el MISMO
 * molde que servicios (Carlos, 2026-09-04): la plantilla trae lo ya dado de
 * alta, el match es por código y una corrida en seco no escribe nada.
 */
const TENANT = "11111111-1111-1111-1111-111111111111";
const USER = { userId: "u-1", tenantId: TENANT, permissions: [], locale: "es" as const };
const META = { ip: "127.0.0.1", userAgent: "jest" };
type Mock = jest.Mock;

/** Un Excel de verdad, armado con la misma utilidad que lo lee. */
async function excel(filas: string[][]): Promise<string> {
  const { serializeSpreadsheet } = await import("../../common/spreadsheet/spreadsheet.js");
  const { body } = await serializeSpreadsheet(filas, "xlsx", {
    sheetName: "Estudios",
    filenameBase: "estudios",
  });
  return body.toString("base64");
}

const CABECERA = ["codigo", "nombre", "descripcion", "costo", "precio"];

describe("StudyImportService (F9-CLINIC)", () => {
  let delegate: { findMany: Mock; create: Mock; update: Mock };
  let prisma: { withTenantContext: Mock };
  let audit: { record: Mock };
  let i18n: { translate: Mock };
  let service: LabStudyImportService;

  beforeEach(() => {
    delegate = {
      findMany: jest.fn().mockResolvedValue([]),
      create: jest.fn().mockResolvedValue({ id: "e-1" }),
      update: jest.fn().mockResolvedValue({ id: "e-1" }),
    };
    prisma = {
      withTenantContext: jest.fn((_t: string, fn: (tx: unknown) => unknown) =>
        fn({ medicalClinicLabStudy: delegate }),
      ),
    };
    audit = { record: jest.fn() };
    i18n = { translate: jest.fn((key: string) => key) };
    // biome-ignore lint/suspicious/noExplicitAny: mocks parciales a propósito
    service = new LabStudyImportService(prisma as any, audit as any, i18n as any);
  });

  const correr = async (filas: string[][], opciones = {}) =>
    service.run(
      USER,
      await excel([CABECERA, ...filas]),
      { dryRun: false, skipErrors: false, locale: "es" as const, ...opciones },
      META,
    );

  it("la plantilla trae los estudios ya dados de alta, con su cabecera", async () => {
    delegate.findMany.mockResolvedValue([
      { id: "e-1", code: "BH", name: "Biometría", description: null, cost: "120", price: "350" },
    ]);
    const { body, filename } = await service.template(USER);
    expect(filename).toContain("estudios");
    expect(body.byteLength).toBeGreaterThan(0);
  });

  it("da de alta lo nuevo y actualiza por CÓDIGO lo que ya existe", async () => {
    delegate.findMany.mockResolvedValue([{ id: "e-9", code: "BH" }]);
    const reporte = await correr([
      ["BH", "Biometría hemática", "", "120", "350"],
      ["QS", "Química sanguínea", "6 elementos", "150", "420"],
    ]);
    expect(reporte).toMatchObject({ valid: 2, failed: 0, created: 1, updated: 1, applied: true });
    expect(delegate.update).toHaveBeenCalledWith({
      where: { id: "e-9" },
      data: expect.objectContaining({ name: "Biometría hemática" }),
    });
    expect(delegate.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ code: "QS", name: "Química sanguínea", tenantId: TENANT }),
    });
    expect(audit.record).toHaveBeenCalled();
  });

  it("una fila sin código o sin nombre, un código repetido y un monto inválido se reportan", async () => {
    const reporte = await correr(
      [
        ["", "Sin código", "", "", ""],
        ["BH", "Biometría", "", "", ""],
        ["BH", "Repetida", "", "", ""],
        ["EGO", "Orina", "", "-5", ""],
      ],
      { skipErrors: true },
    );
    expect(reporte.failed).toBe(3);
    expect(reporte.errors.map((e) => e.message)).toEqual([
      "medical_clinic.import_missing_required",
      "medical_clinic.import_duplicate_code",
      "medical_clinic.import_invalid_money",
    ]);
    // Con `skipErrors` lo bueno entra igual.
    expect(reporte.created).toBe(1);
    expect(reporte.applied).toBe(true);
  });

  it("con errores y sin skipErrors no escribe NADA", async () => {
    const reporte = await correr([
      ["BH", "Biometría", "", "", ""],
      ["", "Sin código", "", "", ""],
    ]);
    expect(reporte.applied).toBe(false);
    expect(delegate.create).not.toHaveBeenCalled();
  });

  it("una corrida en seco reporta pero no toca la base", async () => {
    const reporte = await correr([["BH", "Biometría", "", "", ""]], { dryRun: true });
    expect(reporte).toMatchObject({ valid: 1, created: 1, applied: false });
    expect(delegate.create).not.toHaveBeenCalled();
  });
});
