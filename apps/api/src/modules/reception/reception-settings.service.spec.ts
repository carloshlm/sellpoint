import { Prisma } from "../../generated/prisma/client";
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
  let tx: {
    receptionSettings: { findUnique: Mock; upsert: Mock };
    receptionTurnService: { findMany: Mock; deleteMany: Mock; createMany: Mock };
    service: { count: Mock };
  };
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
      receptionTurnService: {
        findMany: jest.fn().mockResolvedValue([]),
        deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
        createMany: jest.fn().mockResolvedValue({ count: 0 }),
      },
      service: { count: jest.fn().mockResolvedValue(0) },
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
      turnServices: [],
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
    expect(res).toEqual({
      customerLabel: "Paciente",
      showCustomers: true,
      showTurns: true,
      turnServices: [],
    });
    expect(audit.record).toHaveBeenCalledWith(
      tx,
      expect.objectContaining({
        action: "reception.settings.update",
        before: { customerLabel: null, showCustomers: true, showTurns: true, turnServices: [] },
        after: {
          customerLabel: "Paciente",
          showCustomers: true,
          showTurns: true,
          turnServices: [],
        },
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
      turnServices: [],
    });
  });

  /**
   * F9-RECEP-25 — los servicios que generan turno al venderse (ley 31). Se
   * mandan COMPLETOS: lo que no viene, se quita. Cada uno tiene que ser un
   * servicio activo del negocio.
   */
  describe("los servicios que generan turno (F9-RECEP-25)", () => {
    const CONSULTA = "11111111-1111-4111-8111-111111111111";
    const ESPECIALIDAD = "22222222-2222-4222-8222-222222222222";

    const fila = (id: string, code: string, name: string, price: string | null) => ({
      service: { id, code, name, price: price === null ? null : new Prisma.Decimal(price) },
    });

    /**
     * F9-RECEP-32 — con su nombre, código y precio, para que la tarjeta pinte
     * la lista sin pedir el catálogo entero; solo los ACTIVOS (uno inactivo no
     * se puede vender) y por nombre, que es como se buscan.
     */
    it("get los devuelve con nombre, código y precio: solo los activos, por nombre", async () => {
      tx.receptionTurnService.findMany.mockResolvedValue([
        fila(CONSULTA, "CONS", "Consulta médica", "500.00"),
        fila(ESPECIALIDAD, "ESP", "Consulta de especialidad", null),
      ]);

      await expect(service.get(USER)).resolves.toMatchObject({
        turnServices: [
          { id: CONSULTA, code: "CONS", name: "Consulta médica", price: "500" },
          { id: ESPECIALIDAD, code: "ESP", name: "Consulta de especialidad", price: null },
        ],
      });
      expect(tx.receptionTurnService.findMany).toHaveBeenCalledWith({
        where: { tenantId: TENANT, service: { isActive: true } },
        select: { service: { select: { id: true, code: true, name: true, price: true } } },
        orderBy: [{ service: { name: "asc" } }, { serviceId: "asc" }],
      });
    });

    it("guardarlos deja EXACTAMENTE esos: quita los que no vienen y agrega los nuevos", async () => {
      tx.service.count.mockResolvedValue(2);
      await service.update(USER, { turnServiceIds: [CONSULTA, ESPECIALIDAD] }, META);

      expect(tx.service.count).toHaveBeenCalledWith({
        where: { tenantId: TENANT, id: { in: [CONSULTA, ESPECIALIDAD] }, isActive: true },
      });
      expect(tx.receptionTurnService.deleteMany).toHaveBeenCalledWith({
        where: { tenantId: TENANT, serviceId: { notIn: [CONSULTA, ESPECIALIDAD] } },
      });
      expect(tx.receptionTurnService.createMany).toHaveBeenCalledWith({
        data: [
          { tenantId: TENANT, serviceId: CONSULTA },
          { tenantId: TENANT, serviceId: ESPECIALIDAD },
        ],
        skipDuplicates: true,
      });
      // No es una columna de la fila: el upsert no la lleva.
      expect(tx.receptionSettings.upsert.mock.calls[0][0].update).toEqual({ updatedBy: "u-1" });
    });

    it("un servicio inactivo o de otro negocio rebota con 400 y no toca la lista", async () => {
      tx.service.count.mockResolvedValue(1);
      await expect(
        service.update(USER, { turnServiceIds: [CONSULTA, ESPECIALIDAD] }, META),
      ).rejects.toMatchObject({
        response: { message: "reception.turn_service_invalid" },
      });
      expect(tx.receptionTurnService.deleteMany).not.toHaveBeenCalled();
    });

    it("una lista vacía los quita todos, sin consultar servicios", async () => {
      await service.update(USER, { turnServiceIds: [] }, META);

      expect(tx.service.count).not.toHaveBeenCalled();
      expect(tx.receptionTurnService.deleteMany).toHaveBeenCalledWith({
        where: { tenantId: TENANT, serviceId: { notIn: [] } },
      });
    });

    it("cambiar otra cosa NO toca la lista de servicios", async () => {
      await service.update(USER, { showTurns: false }, META);

      expect(tx.receptionTurnService.deleteMany).not.toHaveBeenCalled();
      expect(tx.receptionTurnService.createMany).not.toHaveBeenCalled();
    });

    it("la auditoría guarda la lista antes y después", async () => {
      tx.service.count.mockResolvedValue(1);
      tx.receptionTurnService.findMany
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([fila(CONSULTA, "CONS", "Consulta médica", "500.00")]);
      await service.update(USER, { turnServiceIds: [CONSULTA] }, META);

      expect(audit.record).toHaveBeenCalledWith(
        tx,
        expect.objectContaining({
          before: expect.objectContaining({ turnServices: [] }),
          after: expect.objectContaining({
            turnServices: [{ id: CONSULTA, code: "CONS", name: "Consulta médica", price: "500" }],
          }),
        }),
      );
    });
  });
});
