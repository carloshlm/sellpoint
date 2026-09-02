import { nextSequenceValue } from "../inventory/folio";
import { TurnsService } from "./turns.service";

jest.mock("../inventory/folio", () => ({ nextSequenceValue: jest.fn() }));

/**
 * F9-RECEP-07 — el número de turno que reinicia cada día.
 *
 * El «reinicio» no es un reset: cada DÍA DEL NEGOCIO es una serie nueva en
 * `tenant_sequences` (`reception_turn:YYYYMMDD`), con UN solo instante para
 * la serie y para `business_date`. Los tests fijan que el día es el del
 * calendario del negocio y no el de UTC: a las 22:30 de CDMX el 2 de
 * septiembre, UTC ya está en el 3.
 */
const TENANT = "11111111-1111-1111-1111-111111111111";
const USER = { userId: "u-1", tenantId: TENANT, permissions: [], locale: "es" as const };
const META = { ip: "127.0.0.1", userAgent: "jest" };
const secuencia = nextSequenceValue as jest.Mock;

type Mock = jest.Mock;

const turno = (extra: Record<string, unknown> = {}) => ({
  id: "t-1",
  tenantId: TENANT,
  businessDate: new Date("2026-09-02"),
  number: 5,
  customerId: null,
  customerName: null,
  status: "waiting",
  attendedAt: null,
  attendedBy: null,
  createdAt: new Date("2026-09-03T04:30:00.000Z"),
  updatedAt: new Date("2026-09-03T04:30:00.000Z"),
  ...extra,
});

describe("TurnsService (F9-RECEP-07)", () => {
  let tx: {
    receptionTurn: { create: Mock; findMany: Mock; findFirst: Mock; update: Mock };
    customer: { findFirst: Mock };
  };
  let prisma: { withTenantContext: Mock; tenant: { findUnique: Mock } };
  let audit: { record: Mock };
  let service: TurnsService;

  beforeEach(() => {
    jest.useFakeTimers().setSystemTime(new Date("2026-09-03T04:30:00.000Z")); // 2-sep 22:30 CDMX
    secuencia.mockReset().mockResolvedValue(5n);
    tx = {
      receptionTurn: {
        create: jest.fn().mockImplementation(({ data }) => Promise.resolve(turno(data))),
        findMany: jest.fn().mockResolvedValue([turno()]),
        findFirst: jest.fn().mockResolvedValue(turno()),
        update: jest.fn().mockImplementation(({ data }) => Promise.resolve(turno(data))),
      },
      customer: {
        findFirst: jest.fn().mockResolvedValue({
          id: "c-1",
          firstName: "Ana",
          lastNamePaternal: "Pérez",
          lastNameMaternal: "López",
        }),
      },
    };
    prisma = {
      withTenantContext: jest.fn((_t: string, fn: (t: typeof tx) => unknown) => fn(tx)),
      tenant: { findUnique: jest.fn().mockResolvedValue({ timezone: "America/Mexico_City" }) },
    };
    audit = { record: jest.fn() };
    // biome-ignore lint/suspicious/noExplicitAny: mocks parciales a propósito
    service = new TurnsService(prisma as any, audit as any);
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  describe("generar", () => {
    it("la serie y el día son los del calendario del NEGOCIO, no los de UTC", async () => {
      const creado = await service.create(USER, {}, META);
      expect(secuencia).toHaveBeenCalledWith(tx, TENANT, "reception_turn:20260902");
      const data = tx.receptionTurn.create.mock.calls[0][0].data;
      expect(data.businessDate).toEqual(new Date("2026-09-02"));
      expect(data.number).toBe(5);
      expect(creado.number).toBe(5);
      expect(creado.businessDate).toBe("2026-09-02");
    });

    it("otro negocio en Madrid, al mismo instante, ya está en el 3", async () => {
      prisma.tenant.findUnique.mockResolvedValue({ timezone: "Europe/Madrid" });
      await service.create(USER, {}, META);
      expect(secuencia).toHaveBeenCalledWith(tx, TENANT, "reception_turn:20260903");
      expect(tx.receptionTurn.create.mock.calls[0][0].data.businessDate).toEqual(
        new Date("2026-09-03"),
      );
    });

    it("con cliente, guarda su id y el snapshot del nombre completo", async () => {
      await service.create(USER, { customerId: "c-1" }, META);
      const data = tx.receptionTurn.create.mock.calls[0][0].data;
      expect(data.customerId).toBe("c-1");
      expect(data.customerName).toBe("Ana Pérez López");
    });

    it("un cliente que no es del negocio → 404 reception.customer_not_found", async () => {
      tx.customer.findFirst.mockResolvedValue(null);
      await expect(service.create(USER, { customerId: "c-9" }, META)).rejects.toMatchObject({
        status: 404,
        response: { message: "reception.customer_not_found" },
      });
      expect(tx.receptionTurn.create).not.toHaveBeenCalled();
    });

    it("audita en la misma transacción", async () => {
      await service.create(USER, {}, META);
      expect(audit.record).toHaveBeenCalledWith(
        tx,
        expect.objectContaining({ action: "reception.turn.create", userId: "u-1" }),
      );
    });
  });

  describe("listar", () => {
    it("sin fecha, lista el día del negocio de HOY, del número mayor al menor", async () => {
      await service.list(USER, {});
      const args = tx.receptionTurn.findMany.mock.calls[0][0];
      expect(args.where).toEqual({ tenantId: TENANT, businessDate: new Date("2026-09-02") });
      expect(args.orderBy).toEqual([{ number: "desc" }]);
      expect(args.take).toBe(500);
    });

    it("con fecha, lista ese día", async () => {
      await service.list(USER, { date: "2026-08-31" });
      expect(tx.receptionTurn.findMany.mock.calls[0][0].where.businessDate).toEqual(
        new Date("2026-08-31"),
      );
    });
  });

  describe("atender y volver a espera", () => {
    it("atender marca la hora y quién atendió", async () => {
      const atendido = await service.attend(USER, "t-1", META);
      const data = tx.receptionTurn.update.mock.calls[0][0].data;
      expect(data.status).toBe("attended");
      expect(data.attendedAt).toBeInstanceOf(Date);
      expect(data.attendedBy).toBe("u-1");
      expect(atendido.status).toBe("attended");
    });

    it("atender dos veces es idempotente: devuelve el mismo turno sin tocarlo", async () => {
      tx.receptionTurn.findFirst.mockResolvedValue(
        turno({ status: "attended", attendedAt: new Date("2026-09-03T04:00:00.000Z") }),
      );
      const otra = await service.attend(USER, "t-1", META);
      expect(tx.receptionTurn.update).not.toHaveBeenCalled();
      expect(otra.attendedAt).toBe("2026-09-03T04:00:00.000Z");
    });

    it("volver a espera limpia la hora de atención", async () => {
      tx.receptionTurn.findFirst.mockResolvedValue(
        turno({ status: "attended", attendedAt: new Date("2026-09-03T04:00:00.000Z") }),
      );
      await service.wait(USER, "t-1", META);
      const data = tx.receptionTurn.update.mock.calls[0][0].data;
      expect(data).toEqual({ status: "waiting", attendedAt: null, attendedBy: null });
    });

    it("un turno ajeno → 404 reception.turn_not_found", async () => {
      tx.receptionTurn.findFirst.mockResolvedValue(null);
      await expect(service.attend(USER, "t-9", META)).rejects.toMatchObject({
        status: 404,
        response: { message: "reception.turn_not_found" },
      });
    });
  });
});
