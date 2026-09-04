import { ReceptionSettingsService } from "./reception-settings.service";

/**
 * F9-RECEP-17 — la configuración de Recepción.
 *
 * Sin fila, todo visible y sin palabra propia. `get` NO crea la fila;
 * `update` hace upsert, NORMALIZA la palabra (una, Capitalizada) y audita con
 * antes/después. `null` en la palabra vuelve a la de fábrica.
 */
const TENANT = "11111111-1111-1111-1111-111111111111";
const USER = { userId: "u-1", tenantId: TENANT, permissions: [], locale: "es" as const };
const META = { ip: "127.0.0.1", userAgent: "jest" };
type Mock = jest.Mock;

describe("ReceptionSettingsService (F9-RECEP-17)", () => {
  let tx: { receptionSettings: { findUnique: Mock; upsert: Mock } };
  let prisma: { withTenantContext: Mock };
  let audit: { record: Mock };
  let service: ReceptionSettingsService;

  beforeEach(() => {
    tx = {
      receptionSettings: {
        findUnique: jest.fn().mockResolvedValue(null),
        upsert: jest.fn().mockImplementation(({ create, update }) =>
          Promise.resolve({
            tenantId: TENANT,
            customerLabel: null,
            showCustomers: true,
            showTurns: true,
            ...create,
            ...update,
          }),
        ),
      },
    };
    prisma = { withTenantContext: jest.fn((_t: string, fn: (t: typeof tx) => unknown) => fn(tx)) };
    audit = { record: jest.fn() };
    // biome-ignore lint/suspicious/noExplicitAny: mocks parciales a propósito
    service = new ReceptionSettingsService(prisma as any, audit as any);
  });

  it("sin fila: todo visible y sin palabra propia — y no la crea", async () => {
    await expect(service.get(USER)).resolves.toEqual({
      customerLabel: null,
      showCustomers: true,
      showTurns: true,
    });
    expect(tx.receptionSettings.upsert).not.toHaveBeenCalled();
  });

  it("la palabra se guarda Capitalizada aunque llegue en mayúsculas, y audita antes/después", async () => {
    const res = await service.update(USER, { customerLabel: "PACIENTE" }, META);
    const args = tx.receptionSettings.upsert.mock.calls[0][0];
    expect(args.where).toEqual({ tenantId: TENANT });
    expect(args.create).toMatchObject({
      tenantId: TENANT,
      customerLabel: "Paciente",
      updatedBy: "u-1",
    });
    expect(args.update).toEqual({ customerLabel: "Paciente", updatedBy: "u-1" });
    expect(res).toEqual({ customerLabel: "Paciente", showCustomers: true, showTurns: true });
    expect(audit.record).toHaveBeenCalledWith(
      tx,
      expect.objectContaining({
        action: "reception.settings.update",
        before: { customerLabel: null, showCustomers: true, showTurns: true },
        after: { customerLabel: "Paciente", showCustomers: true, showTurns: true },
      }),
    );
  });

  it("null en la palabra vuelve a la de fábrica (se guarda NULL, no la cadena «null»)", async () => {
    tx.receptionSettings.findUnique.mockResolvedValue({
      tenantId: TENANT,
      customerLabel: "Paciente",
      showCustomers: true,
      showTurns: true,
    });
    const res = await service.update(USER, { customerLabel: null }, META);
    expect(tx.receptionSettings.upsert.mock.calls[0][0].update).toEqual({
      customerLabel: null,
      updatedBy: "u-1",
    });
    expect(res.customerLabel).toBeNull();
  });

  it("apagar los turnos solo toca esa columna", async () => {
    await service.update(USER, { showTurns: false }, META);
    expect(tx.receptionSettings.upsert.mock.calls[0][0].update).toEqual({
      showTurns: false,
      updatedBy: "u-1",
    });
  });

  it("con fila, get devuelve lo guardado", async () => {
    tx.receptionSettings.findUnique.mockResolvedValue({
      tenantId: TENANT,
      customerLabel: "Alumno",
      showCustomers: false,
      showTurns: true,
      updatedBy: "u-9",
    });
    await expect(service.get(USER)).resolves.toEqual({
      customerLabel: "Alumno",
      showCustomers: false,
      showTurns: true,
    });
  });
});
