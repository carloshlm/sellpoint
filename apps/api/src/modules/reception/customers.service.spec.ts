import { ageFromBirthDate, localCalendarDate } from "@sellpoint/shared";
import { CustomersService } from "./customers.service";

/**
 * F9-RECEP-06 — el registro de clientes.
 *
 * Lo que fija: el listado va del más reciente al más viejo con desempate por
 * id; la búsqueda mira los tres nombres, el teléfono y el correo; la edad
 * sale CALCULADA con el día del negocio; y todo audita en la misma tx.
 */
const TENANT = "11111111-1111-1111-1111-111111111111";
const USER = { userId: "u-1", tenantId: TENANT, permissions: [], locale: "es" as const };
const META = { ip: "127.0.0.1", userAgent: "jest" };
const CDMX = "America/Mexico_City";

type Mock = jest.Mock;

const fila = (extra: Record<string, unknown> = {}) => ({
  id: "c-1",
  tenantId: TENANT,
  firstName: "Ana",
  lastNamePaternal: "Pérez",
  lastNameMaternal: null,
  birthDate: null,
  phone: null,
  email: null,
  notes: null,
  isActive: true,
  createdAt: new Date("2026-09-01T18:00:00.000Z"),
  updatedAt: new Date("2026-09-01T18:00:00.000Z"),
  ...extra,
});

describe("CustomersService (F9-RECEP-06)", () => {
  let tx: {
    customer: {
      count: Mock;
      findMany: Mock;
      findFirst: Mock;
      create: Mock;
      update: Mock;
      delete: Mock;
    };
  };
  let prisma: { withTenantContext: Mock; tenant: { findUnique: Mock } };
  let audit: { record: Mock };
  let service: CustomersService;

  beforeEach(() => {
    tx = {
      customer: {
        count: jest.fn().mockResolvedValue(1),
        findMany: jest.fn().mockResolvedValue([fila()]),
        findFirst: jest.fn().mockResolvedValue(fila()),
        create: jest.fn().mockImplementation(({ data }) => Promise.resolve(fila(data))),
        update: jest.fn().mockImplementation(({ data }) => Promise.resolve(fila(data))),
        delete: jest.fn().mockResolvedValue(fila()),
      },
    };
    prisma = {
      withTenantContext: jest.fn((_t: string, fn: (t: typeof tx) => unknown) => fn(tx)),
      tenant: { findUnique: jest.fn().mockResolvedValue({ timezone: CDMX }) },
    };
    audit = { record: jest.fn() };
    // biome-ignore lint/suspicious/noExplicitAny: mocks parciales a propósito
    service = new CustomersService(prisma as any, audit as any);
  });

  describe("listar", () => {
    it("va del más reciente al más viejo, con desempate por id", async () => {
      await service.list(USER, { page: 1, pageSize: 20 });
      const args = tx.customer.findMany.mock.calls[0][0];
      expect(args.orderBy).toEqual([{ createdAt: "desc" }, { id: "desc" }]);
      expect(args.skip).toBe(0);
      expect(args.take).toBe(20);
    });

    it("la búsqueda mira los tres nombres, el teléfono y el correo", async () => {
      await service.list(USER, { query: "lópez", page: 1, pageSize: 20 });
      const where = tx.customer.findMany.mock.calls[0][0].where;
      const campos = where.OR.map((c: Record<string, unknown>) => Object.keys(c)[0]);
      expect(campos.sort()).toEqual([
        "email",
        "firstName",
        "lastNameMaternal",
        "lastNamePaternal",
        "phone",
      ]);
    });

    it("la edad sale calculada con el día del negocio; sin fecha, null", async () => {
      tx.customer.findMany.mockResolvedValue([
        fila({ id: "c-1", birthDate: new Date("1990-09-02") }),
        fila({ id: "c-2", birthDate: null }),
      ]);
      const { rows } = await service.list(USER, { page: 1, pageSize: 20 });
      const esperada = ageFromBirthDate("1990-09-02", localCalendarDate(CDMX, new Date()));
      expect(rows[0]?.age).toBe(esperada);
      expect(rows[0]?.birthDate).toBe("1990-09-02");
      expect(rows[1]?.age).toBeNull();
      expect(rows[1]?.birthDate).toBeNull();
    });
  });

  describe("filtro por fecha de alta (F9-RECEP-20)", () => {
    it("acota created_at por el DÍA del negocio, en su zona: inicio inclusivo, fin abierto", async () => {
      // 2026-09-04 en CDMX (UTC-6) va de las 06:00Z del 4 a las 06:00Z del 5.
      await service.list(USER, { from: "2026-09-04", to: "2026-09-04", page: 1, pageSize: 20 });
      const where = tx.customer.findMany.mock.calls[0][0].where;
      expect(where.createdAt).toEqual({
        gte: new Date("2026-09-04T06:00:00.000Z"),
        lt: new Date("2026-09-05T06:00:00.000Z"),
      });
      // El conteo usa el MISMO where.
      expect(tx.customer.count.mock.calls[0][0].where).toEqual(where);
    });

    it("solo «desde» o solo «hasta» acotan por un lado; sin fechas no acotan", async () => {
      await service.list(USER, { from: "2026-09-01", page: 1, pageSize: 20 });
      expect(tx.customer.findMany.mock.calls[0][0].where.createdAt).toEqual({
        gte: new Date("2026-09-01T06:00:00.000Z"),
      });
      await service.list(USER, { page: 1, pageSize: 20 });
      expect(tx.customer.findMany.mock.calls[1][0].where.createdAt).toBeUndefined();
    });
  });

  describe("alta, edición y baja", () => {
    it("crear guarda la fecha como DATE y audita en la misma tx", async () => {
      const creado = await service.create(
        USER,
        {
          firstName: "Ana",
          lastNamePaternal: "Pérez",
          birthDate: "1990-09-02",
          phone: "+525512345678",
        },
        META,
      );
      const data = tx.customer.create.mock.calls[0][0].data;
      expect(data.tenantId).toBe(TENANT);
      expect(data.birthDate).toEqual(new Date("1990-09-02"));
      expect(data.createdBy).toBe("u-1");
      expect(audit.record).toHaveBeenCalledWith(
        tx,
        expect.objectContaining({
          action: "reception.customer.create",
          userId: "u-1",
          ip: "127.0.0.1",
        }),
      );
      expect(creado.birthDate).toBe("1990-09-02");
    });

    it("consultar a uno del negocio devuelve la ficha; a uno ajeno, 404", async () => {
      await expect(service.get(USER, "c-1")).resolves.toMatchObject({
        id: "c-1",
        firstName: "Ana",
      });
      tx.customer.findFirst.mockResolvedValue(null);
      await expect(service.get(USER, "c-9")).rejects.toMatchObject({ status: 404 });
    });

    it("editar a alguien que no es del negocio responde 404 con su clave", async () => {
      tx.customer.findFirst.mockResolvedValue(null);
      await expect(service.update(USER, "c-9", { notes: "x" }, META)).rejects.toMatchObject({
        status: 404,
        response: { message: "reception.customer_not_found" },
      });
      expect(tx.customer.update).not.toHaveBeenCalled();
    });

    it("editar manda solo lo que cambió y limpia con null", async () => {
      await service.update(USER, "c-1", { birthDate: null, notes: "VIP" }, META);
      const data = tx.customer.update.mock.calls[0][0].data;
      expect(data).toEqual({ birthDate: null, notes: "VIP" });
      expect(audit.record).toHaveBeenCalledWith(
        tx,
        expect.objectContaining({ action: "reception.customer.update" }),
      );
    });

    it("eliminar borra de verdad y audita con lo que había", async () => {
      await service.remove(USER, "c-1", META);
      expect(tx.customer.delete).toHaveBeenCalledWith({ where: { id: "c-1" } });
      expect(audit.record).toHaveBeenCalledWith(
        tx,
        expect.objectContaining({
          action: "reception.customer.delete",
          before: expect.objectContaining({ firstName: "Ana" }),
        }),
      );
    });

    it("eliminar a alguien ajeno responde 404, no 500", async () => {
      tx.customer.findFirst.mockResolvedValue(null);
      await expect(service.remove(USER, "c-9", META)).rejects.toMatchObject({ status: 404 });
      expect(tx.customer.delete).not.toHaveBeenCalled();
    });
  });
});
