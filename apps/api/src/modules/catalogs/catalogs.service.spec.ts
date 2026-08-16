import { ConflictException, NotFoundException } from "@nestjs/common";
import { Prisma } from "../../generated/prisma/client";
import type { PrismaService } from "../../infrastructure/prisma/prisma.service";
import type { AuditService } from "../audit/audit.service";
import type { AuthUser } from "../auth/types/auth-user";
import { CatalogsService } from "./catalogs.service";

/**
 * F2-CAT-02. Unit con mocks manuales, mismo molde que `roles.service.spec.ts`.
 *
 * Lo que se prueba acá son DECISIONES del service, no que Prisma sepa
 * escribir: qué se rechaza y por qué. Lo que necesita DB real (el unique de
 * nombre, la RLS) vive en el e2e.
 */
const ACTOR: AuthUser = {
  id: "user-1",
  tenantId: "tenant-1",
  email: "ana@acme.mx",
  permissions: ["catalogs:manage", "catalogs:read"],
};

const META = { ip: "127.0.0.1", userAgent: "jest" };

function buildService(
  overrides: {
    findFirst?: jest.Mock;
    findMany?: jest.Mock;
    create?: jest.Mock;
    update?: jest.Mock;
  } = {},
) {
  const catalog = {
    findFirst: overrides.findFirst ?? jest.fn().mockResolvedValue(null),
    findMany: overrides.findMany ?? jest.fn().mockResolvedValue([]),
    create:
      overrides.create ??
      jest.fn().mockResolvedValue({
        id: "catalog-1",
        name: "Unidades de medida",
        systemKey: null,
        isSystem: false,
        isActive: true,
      }),
    update: overrides.update ?? jest.fn().mockResolvedValue({ id: "catalog-1" }),
  };

  const tx = { catalog };
  const prisma = {
    withTenantContext: jest.fn((_tenantId: string, fn: (tx: unknown) => unknown) => fn(tx)),
  } as unknown as PrismaService;

  const auditService = {
    record: jest.fn().mockResolvedValue(undefined),
  } as unknown as AuditService;

  return { service: new CatalogsService(prisma, auditService), tx, auditService };
}

describe("CatalogsService (F2-CAT-02)", () => {
  describe("create", () => {
    it("crea el subcatálogo dentro del contexto del tenant del ACTOR, no de uno recibido", async () => {
      const { service, tx } = buildService();

      await service.create(ACTOR, { name: "Unidades de medida" }, META);

      expect(tx.catalog.create).toHaveBeenCalledWith({
        data: { tenantId: "tenant-1", name: "Unidades de medida" },
      });
    });

    it("un subcatálogo NUNCA nace como del sistema, aunque alguien lo intente", async () => {
      const { service, tx } = buildService();

      await service.create(ACTOR, { name: "Proveedores" }, META);

      const payload = tx.catalog.create.mock.calls[0][0].data;
      expect(payload.systemKey).toBeUndefined();
      expect(payload.isSystem).toBeUndefined();
    });

    it("nombre repetido en el tenant → 409, no un error crudo de Postgres", async () => {
      // Instancia REAL de Prisma: el service discrimina con `instanceof`, así
      // que un objeto con `code: "P2002"` pegado a mano pasaría de largo y el
      // test sería verde con el mapeo roto (molde: roles.service.spec.ts).
      const { service } = buildService({
        create: jest.fn().mockRejectedValue(
          new Prisma.PrismaClientKnownRequestError("Unique constraint failed", {
            code: "P2002",
            clientVersion: "7.9.0",
          }),
        ),
      });

      await expect(service.create(ACTOR, { name: "Repetido" }, META)).rejects.toThrow(
        ConflictException,
      );
    });

    it("audita el alta dentro de la MISMA transacción", async () => {
      const { service, auditService, tx } = buildService();

      await service.create(ACTOR, { name: "Unidades" }, META);

      expect(auditService.record).toHaveBeenCalledWith(
        tx,
        expect.objectContaining({ action: "catalogs.create", resourceType: "catalog" }),
      );
    });
  });

  describe("update", () => {
    const systemCatalog = {
      id: "catalog-sys",
      name: "Catálogo de Productos",
      systemKey: "products",
      isSystem: true,
      isActive: true,
    };
    const subCatalog = {
      id: "catalog-1",
      name: "Unidades",
      systemKey: null,
      isSystem: false,
      isActive: true,
    };

    it("renombra un subcatálogo", async () => {
      const { service, tx } = buildService({
        findFirst: jest.fn().mockResolvedValue(subCatalog),
      });

      await service.update(ACTOR, "catalog-1", { name: "Unidades de medida" }, META);

      expect(tx.catalog.update).toHaveBeenCalledWith({
        where: { id: "catalog-1" },
        data: { name: "Unidades de medida" },
      });
    });

    it("el catálogo del SISTEMA no se renombra → 409", async () => {
      // Es la referencia estable que nombran los docs, el soporte y el equipo.
      const { service, tx } = buildService({
        findFirst: jest.fn().mockResolvedValue(systemCatalog),
      });

      await expect(
        service.update(ACTOR, "catalog-sys", { name: "Mis cosas" }, META),
      ).rejects.toThrow(ConflictException);
      expect(tx.catalog.update).not.toHaveBeenCalled();
    });

    it("el catálogo del SISTEMA no se archiva → 409", async () => {
      // Archivarlo dejaría al tenant sin dónde definir campos de producto: el
      // motor entero se apagaría sin un error que lo explicara.
      const { service, tx } = buildService({
        findFirst: jest.fn().mockResolvedValue(systemCatalog),
      });

      await expect(service.update(ACTOR, "catalog-sys", { isActive: false }, META)).rejects.toThrow(
        ConflictException,
      );
      expect(tx.catalog.update).not.toHaveBeenCalled();
    });

    it("un catálogo de otro tenant es 404, no 403: no se confirma que exista", async () => {
      const { service } = buildService({ findFirst: jest.fn().mockResolvedValue(null) });

      await expect(service.update(ACTOR, "ajeno", { name: "X" }, META)).rejects.toThrow(
        NotFoundException,
      );
    });

    it("la búsqueda filtra por tenantId además de la RLS (defensa en profundidad)", async () => {
      const findFirst = jest.fn().mockResolvedValue(subCatalog);
      const { service } = buildService({ findFirst });

      await service.update(ACTOR, "catalog-1", { name: "Otro" }, META);

      expect(findFirst).toHaveBeenCalledWith({
        where: { id: "catalog-1", tenantId: "tenant-1" },
      });
    });
  });

  describe("list", () => {
    it("lista los catálogos del tenant ordenados con el del sistema primero", async () => {
      const findMany = jest.fn().mockResolvedValue([]);
      const { service } = buildService({ findMany });

      await service.list(ACTOR);

      expect(findMany).toHaveBeenCalledWith({
        orderBy: [{ isSystem: "desc" }, { name: "asc" }],
      });
    });
  });
});
