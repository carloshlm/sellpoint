import { ConflictException, UnprocessableEntityException } from "@nestjs/common";
import { Prisma } from "../../generated/prisma/client";
import { SuppliersService } from "./suppliers.service";

/**
 * F9-SUPPL-03 — el catálogo de proveedores.
 *
 * Lo que fija: la búsqueda mira nombre, registro fiscal, contacto, teléfono
 * y correo; el orden es alfabético con desempate por id; el registro fiscal
 * se normaliza y se valida con el PAÍS del negocio (sin país, todo vale);
 * borrar uno referenciado es 409; y todo audita en la misma tx.
 */
const TENANT = "11111111-1111-1111-1111-111111111111";
const USER = { userId: "u-1", tenantId: TENANT, permissions: [], locale: "es" as const };
const META = { ip: "127.0.0.1", userAgent: "jest" };

type Mock = jest.Mock;

const fila = (extra: Record<string, unknown> = {}) => ({
  id: "s-1",
  tenantId: TENANT,
  name: "Distribuidora Norte",
  taxId: null,
  contactName: null,
  phone: null,
  email: null,
  address: null,
  notes: null,
  isActive: true,
  createdBy: "u-1",
  updatedBy: "u-1",
  createdAt: new Date("2026-09-10T18:00:00.000Z"),
  updatedAt: new Date("2026-09-10T18:00:00.000Z"),
  ...extra,
});

const p2003 = () =>
  new Prisma.PrismaClientKnownRequestError("fk", { code: "P2003", clientVersion: "test" });

describe("SuppliersService (F9-SUPPL-03)", () => {
  let tx: {
    supplier: {
      count: Mock;
      findMany: Mock;
      findFirst: Mock;
      create: Mock;
      update: Mock;
      delete: Mock;
    };
    tenant: { findUniqueOrThrow: Mock };
  };
  let prisma: { withTenantContext: Mock };
  let audit: { record: Mock };
  let service: SuppliersService;

  beforeEach(() => {
    tx = {
      supplier: {
        count: jest.fn().mockResolvedValue(1),
        findMany: jest.fn().mockResolvedValue([fila()]),
        findFirst: jest.fn().mockResolvedValue(fila()),
        create: jest.fn().mockImplementation(({ data }) => Promise.resolve(fila(data))),
        update: jest.fn().mockImplementation(({ data }) => Promise.resolve(fila(data))),
        delete: jest.fn().mockResolvedValue(fila()),
      },
      tenant: { findUniqueOrThrow: jest.fn().mockResolvedValue({ country: "MX" }) },
    };
    prisma = {
      withTenantContext: jest.fn((_t: string, fn: (t: typeof tx) => unknown) => fn(tx)),
    };
    audit = { record: jest.fn() };
    // biome-ignore lint/suspicious/noExplicitAny: mocks parciales a propósito
    service = new SuppliersService(prisma as any, audit as any);
  });

  describe("listar", () => {
    it("va alfabético con desempate por id, y solo del tenant", async () => {
      await service.list(USER, { page: 2, pageSize: 20 });
      const args = tx.supplier.findMany.mock.calls[0][0];
      expect(args.orderBy).toEqual([{ name: "asc" }, { id: "asc" }]);
      expect(args.where.tenantId).toBe(TENANT);
      expect(args.skip).toBe(20);
    });

    it("la búsqueda mira nombre, registro fiscal, contacto, teléfono y correo", async () => {
      await service.list(USER, { query: "norte", page: 1, pageSize: 20 });
      const where = tx.supplier.findMany.mock.calls[0][0].where;
      const campos = where.OR.map((c: Record<string, unknown>) => Object.keys(c)[0]);
      expect(campos.sort()).toEqual(["contactName", "email", "name", "phone", "taxId"]);
      expect(where.OR[0].name.mode).toBe("insensitive");
    });

    it("`isActive` filtra; sin él salen activos e inactivos", async () => {
      await service.list(USER, { isActive: true, page: 1, pageSize: 20 });
      expect(tx.supplier.findMany.mock.calls[0][0].where.isActive).toBe(true);
      await service.list(USER, { page: 1, pageSize: 20 });
      expect(tx.supplier.findMany.mock.calls[1][0].where.isActive).toBeUndefined();
    });
  });

  describe("el registro fiscal", () => {
    it("en México se guarda normalizado y un RFC mal formado es 422", async () => {
      const creado = await service.create(USER, { name: "Norte", taxId: " dno900101ab1 " }, META);
      expect(creado.taxId).toBe("DNO900101AB1");
      await expect(service.create(USER, { name: "Norte", taxId: "NOPE" }, META)).rejects.toThrow(
        UnprocessableEntityException,
      );
      expect(tx.supplier.create).toHaveBeenCalledTimes(1);
    });

    it("sin país del negocio, todo vale (solo recorte y mayúsculas)", async () => {
      tx.tenant.findUniqueOrThrow.mockResolvedValue({ country: null });
      const creado = await service.create(USER, { name: "Norte", taxId: "abc-123" }, META);
      expect(creado.taxId).toBe("ABC-123");
    });

    it("vacío o null limpia el campo sin consultar el país", async () => {
      await service.update(USER, "s-1", { taxId: null }, META);
      expect(tx.supplier.update.mock.calls[0][0].data.taxId).toBeNull();
      expect(tx.tenant.findUniqueOrThrow).not.toHaveBeenCalled();
    });
  });

  describe("crear, editar, borrar", () => {
    it("crear audita en la misma tx con quién lo hizo", async () => {
      await service.create(USER, { name: "Norte" }, META);
      expect(tx.supplier.create.mock.calls[0][0].data.createdBy).toBe("u-1");
      expect(audit.record).toHaveBeenCalledWith(
        tx,
        expect.objectContaining({ action: "supplier.created", resourceType: "supplier" }),
      );
    });

    it("editar manda solo lo que vino, fija `updated_by`, y el audit no lleva la relación", async () => {
      await service.update(USER, "s-1", { contactName: "Rosa" }, META);
      const data = tx.supplier.update.mock.calls[0][0].data;
      expect(data.contactName).toBe("Rosa");
      expect(data.name).toBeUndefined();
      expect(data.updater).toEqual({ connect: { id: "u-1" } });
      const after = audit.record.mock.calls[0][1].after;
      expect(after).toEqual({ contactName: "Rosa" });
    });

    it("get/update/remove de otro tenant es 404: el tenantId va en el WHERE", async () => {
      tx.supplier.findFirst.mockResolvedValue(null);
      await expect(service.get(USER, "ajeno")).rejects.toMatchObject({ status: 404 });
      expect(tx.supplier.findFirst.mock.calls[0][0].where).toEqual({
        id: "ajeno",
        tenantId: TENANT,
      });
    });

    it("borrar uno referenciado por una compra o un gasto es 409, no un 500", async () => {
      tx.supplier.delete.mockRejectedValue(p2003());
      await expect(service.remove(USER, "s-1", META)).rejects.toThrow(ConflictException);
      expect(audit.record).not.toHaveBeenCalled();
    });

    it("cualquier otro error del borrado sale crudo", async () => {
      tx.supplier.delete.mockRejectedValue(new Error("boom"));
      await expect(service.remove(USER, "s-1", META)).rejects.toThrow("boom");
    });
  });
});
