import { PatientsService } from "./patients.service";

/**
 * F9-CLINIC-09 — buscar al paciente por nombre o por turno de HOY.
 *
 * Por nombre se reusa `CustomersService.list` (una sola verdad de búsqueda);
 * por turno se mira `reception_turns` del día del negocio, y SOLO de hoy: el
 * turno 5 de ayer no es el 5 de hoy. La edad usa la zona del negocio.
 */
const TENANT = "11111111-1111-1111-1111-111111111111";
const USER = { userId: "u-1", tenantId: TENANT, permissions: [], locale: "es" as const };
const CDMX = "America/Mexico_City";
type Mock = jest.Mock;

describe("PatientsService (F9-CLINIC-09)", () => {
  let tx: {
    receptionTurn: { findFirst: Mock };
    customer: { findFirst: Mock };
    medicalClinicRecord: { findMany: Mock };
  };
  let prisma: { withTenantContext: Mock; tenant: { findUnique: Mock } };
  let customers: { list: Mock; create: Mock };
  let service: PatientsService;

  const cliente = {
    id: "c-1",
    firstName: "Ana",
    lastNamePaternal: "Pérez",
    lastNameMaternal: null,
    birthDate: new Date("1990-09-03"),
  };

  beforeEach(() => {
    jest.useFakeTimers().setSystemTime(new Date("2026-09-03T15:00:00.000Z"));
    tx = {
      receptionTurn: { findFirst: jest.fn().mockResolvedValue(null) },
      customer: { findFirst: jest.fn().mockResolvedValue(cliente) },
      medicalClinicRecord: {
        findMany: jest.fn().mockResolvedValue([
          {
            patientCustomerId: "c-1",
            id: "r-9",
            folio: "HCL-000009",
            consultationDate: new Date("2026-08-01"),
            status: "open",
          },
        ]),
      },
    };
    prisma = {
      withTenantContext: jest.fn((_t: string, fn: (t: typeof tx) => unknown) => fn(tx)),
      tenant: { findUnique: jest.fn().mockResolvedValue({ timezone: CDMX }) },
    };
    customers = {
      list: jest.fn().mockResolvedValue({
        rows: [
          {
            id: "c-1",
            firstName: "Ana",
            lastNamePaternal: "Pérez",
            lastNameMaternal: null,
            birthDate: "1990-09-03",
            age: 36,
          },
        ],
        total: 1,
        page: 1,
        pageSize: 20,
      }),
      create: jest.fn(),
    };
    // biome-ignore lint/suspicious/noExplicitAny: mocks parciales a propósito
    service = new PatientsService(prisma as any, customers as any);
  });

  afterEach(() => jest.useRealTimers());

  it("por nombre delega en Recepción y agrega el último expediente", async () => {
    const res = await service.search(USER, { mode: "name", q: "ana" });
    expect(customers.list).toHaveBeenCalledWith(USER, { query: "ana", page: 1, pageSize: 20 });
    expect(res).toEqual([
      {
        customerId: "c-1",
        name: "Ana Pérez",
        age: 36,
        birthDate: "1990-09-03",
        turnNumber: null,
        turnId: null,
        // De agosto: se lee, pero ya no se captura (F9-CLINIC-27).
        lastRecord: {
          id: "r-9",
          folio: "HCL-000009",
          consultationDate: "2026-08-01",
          status: "open",
          lockReason: "expired",
        },
      },
    ]);
  });

  it("por turno busca SOLO el día del negocio de hoy", async () => {
    tx.receptionTurn.findFirst.mockResolvedValue({ id: "t-1", number: 5, customerId: "c-1" });
    const res = await service.search(USER, { mode: "turn", q: "5" });
    const where = tx.receptionTurn.findFirst.mock.calls[0][0].where;
    expect(where).toMatchObject({ tenantId: TENANT, number: 5 });
    // 15:00Z del 3 = 09:00 en CDMX: el día del negocio es el 3.
    expect(where.businessDate.toISOString().slice(0, 10)).toBe("2026-09-03");
    expect(res).toHaveLength(1);
    expect(res[0]).toMatchObject({ customerId: "c-1", turnNumber: 5, age: 36 });
  });

  it("un turno inexistente hoy es 404; uno sin paciente es 422", async () => {
    await expect(service.search(USER, { mode: "turn", q: "9" })).rejects.toMatchObject({
      response: { message: "medical_clinic.turn_not_found" },
    });
    tx.receptionTurn.findFirst.mockResolvedValue({ id: "t-2", number: 9, customerId: null });
    await expect(service.search(USER, { mode: "turn", q: "9" })).rejects.toMatchObject({
      response: { message: "medical_clinic.turn_without_patient" },
    });
  });

  it("la edad se calcula contra el día del negocio", async () => {
    // 05:30Z del 4 = 23:30 del 3 en CDMX: todavía es 3 de septiembre.
    jest.setSystemTime(new Date("2026-09-04T05:30:00.000Z"));
    tx.receptionTurn.findFirst.mockResolvedValue({ id: "t-1", number: 5, customerId: "c-1" });
    tx.customer.findFirst.mockResolvedValue({ ...cliente, birthDate: new Date("1990-09-04") });
    const res = await service.search(USER, { mode: "turn", q: "5" });
    expect(res[0]?.age).toBe(35);
  });

  /**
   * F9-CLINIC-27 — la tarjeta del paciente tiene que saber si esa consulta se
   * continúa o si hay que abrir folio nuevo.
   */
  it("el último expediente dice si se puede continuar, está vencido o cerrado", async () => {
    const conFecha = (extra: Record<string, unknown>) => [
      {
        patientCustomerId: "c-1",
        id: "r-1",
        folio: "HCL-000001",
        consultationDate: new Date("2026-09-03"),
        status: "open",
        ...extra,
      },
    ];

    const buscar = async () => (await service.search(USER, { mode: "name", q: "ana" }))[0];

    tx.medicalClinicRecord.findMany.mockResolvedValue(conFecha({}));
    expect((await buscar())?.lastRecord).toMatchObject({ status: "open", lockReason: null });

    tx.medicalClinicRecord.findMany.mockResolvedValue(
      conFecha({ consultationDate: new Date("2026-09-02") }),
    );
    expect((await buscar())?.lastRecord).toMatchObject({ status: "open", lockReason: "expired" });

    tx.medicalClinicRecord.findMany.mockResolvedValue(conFecha({ status: "closed" }));
    expect((await buscar())?.lastRecord).toMatchObject({
      status: "closed",
      lockReason: "closed",
    });
  });
});
