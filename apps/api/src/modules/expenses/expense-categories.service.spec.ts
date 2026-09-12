import { ConflictException } from "@nestjs/common";
import { Prisma } from "../../generated/prisma/client";
import { categoryCodeFromName } from "./dto/expense-category.dto";
import { ExpenseCategoriesService } from "./expense-categories.service";

/**
 * F9-EXP-03 — las categorías de gasto: orden `sort_order, name`; búsqueda por
 * código y nombre; el código se deriva del nombre si no viene y al final de
 * la lista; borrar una en uso es 409, un código repetido también.
 */
const TENANT = "11111111-1111-1111-1111-111111111111";
const USER = { userId: "u-1", tenantId: TENANT, permissions: [], locale: "es" as const };
const META = { ip: "127.0.0.1", userAgent: "jest" };
type Mock = jest.Mock;

const fila = (extra: Record<string, unknown> = {}) => ({
  id: "c-1",
  tenantId: TENANT,
  code: "rent",
  name: "Renta",
  isActive: true,
  sortOrder: 0,
  createdBy: "u-1",
  updatedBy: "u-1",
  createdAt: new Date("2026-09-10T18:00:00.000Z"),
  updatedAt: new Date("2026-09-10T18:00:00.000Z"),
  ...extra,
});
const prismaError = (code: string) =>
  new Prisma.PrismaClientKnownRequestError("x", { code, clientVersion: "test" });

describe("categoryCodeFromName", () => {
  it("quita acentos, pasa a snake_case y acota a 48", () => {
    expect(categoryCodeFromName("Servicios Profesionales")).toBe("servicios_profesionales");
    expect(categoryCodeFromName("  Papelería & útiles ")).toBe("papeleria_utiles");
    expect(categoryCodeFromName("!!!")).toBe("category");
    expect(categoryCodeFromName("a".repeat(60))).toHaveLength(48);
  });
});

describe("ExpenseCategoriesService (F9-EXP-03)", () => {
  let tx: {
    expenseCategory: {
      count: Mock;
      findMany: Mock;
      findFirst: Mock;
      create: Mock;
      update: Mock;
      delete: Mock;
      aggregate: Mock;
    };
  };
  let audit: { record: Mock };
  let service: ExpenseCategoriesService;

  beforeEach(() => {
    tx = {
      expenseCategory: {
        count: jest.fn().mockResolvedValue(1),
        findMany: jest.fn().mockResolvedValue([fila()]),
        findFirst: jest.fn().mockResolvedValue(fila()),
        create: jest.fn().mockImplementation(({ data }) => Promise.resolve(fila(data))),
        update: jest.fn().mockImplementation(({ data }) => Promise.resolve(fila(data))),
        delete: jest.fn().mockResolvedValue(fila()),
        aggregate: jest.fn().mockResolvedValue({ _max: { sortOrder: 170 } }),
      },
    };
    const prisma = {
      withTenantContext: jest.fn((_t: string, fn: (t: typeof tx) => unknown) => fn(tx)),
    };
    audit = { record: jest.fn() };
    // biome-ignore lint/suspicious/noExplicitAny: mocks parciales a propósito
    service = new ExpenseCategoriesService(prisma as any, audit as any);
  });

  it("lista por nombre, busca por código y nombre, y filtra activas", async () => {
    await service.list(USER, { query: "ren", isActive: true, page: 1, pageSize: 50 });
    const args = tx.expenseCategory.findMany.mock.calls[0][0];
    expect(args.orderBy).toEqual([{ name: "asc" }, { id: "asc" }]);
    expect(args.where.isActive).toBe(true);
    expect(args.where.OR.map((c: Record<string, unknown>) => Object.keys(c)[0]).sort()).toEqual([
      "code",
      "name",
    ]);
  });

  it("crear sin código lo deriva del nombre y lo manda al final de la lista", async () => {
    const creada = await service.create(USER, { name: "Servicios Profesionales" }, META);
    expect(creada.code).toBe("servicios_profesionales");
    expect(tx.expenseCategory.create.mock.calls[0][0].data.sortOrder).toBe(180);
    expect(audit.record).toHaveBeenCalledWith(
      tx,
      expect.objectContaining({ action: "expenses.category.create" }),
    );
  });

  it("un código repetido es 409", async () => {
    tx.expenseCategory.create.mockRejectedValue(prismaError("P2002"));
    await expect(service.create(USER, { code: "rent", name: "Renta 2" }, META)).rejects.toThrow(
      ConflictException,
    );
  });

  it("borrar una categoría con gastos es 409, no un 500", async () => {
    tx.expenseCategory.delete.mockRejectedValue(prismaError("P2003"));
    await expect(service.remove(USER, "c-1", META)).rejects.toThrow(ConflictException);
    expect(audit.record).not.toHaveBeenCalled();
  });

  it("desactivar manda solo isActive y fija updated_by", async () => {
    await service.update(USER, "c-1", { isActive: false }, META);
    const data = tx.expenseCategory.update.mock.calls[0][0].data;
    expect(data).toEqual({ isActive: false, updater: { connect: { id: "u-1" } } });
    expect(audit.record.mock.calls[0][1].after).toEqual({ isActive: false });
  });
});
