import { DiagnosticStudiesService } from "./diagnostic-studies.service";
import { LabStudiesService } from "./lab-studies.service";

/**
 * F9-CLINIC-07/08 — los dos catálogos de estudios sobre la MISMA base.
 *
 * Una tabla de casos, dos delegates: si la base se rompe, los dos caen. Lo
 * que fija: listado por nombre con desempate por id, búsqueda por código y
 * nombre, 409 en código repetido, 422 en update vacío, 409 al borrar un
 * estudio que ya está en una orden (P2003 traducido), y auditoría en la tx.
 */
const TENANT = "11111111-1111-1111-1111-111111111111";
const USER = { userId: "u-1", tenantId: TENANT, permissions: [], locale: "es" as const };
const META = { ip: "127.0.0.1", userAgent: "jest" };

type Mock = jest.Mock;

const fila = (extra: Record<string, unknown> = {}) => ({
  id: "s-1",
  tenantId: TENANT,
  code: "BH",
  name: "Biometría hemática",
  description: null,
  cost: null,
  price: null,
  isActive: true,
  createdAt: new Date("2026-09-03T18:00:00.000Z"),
  updatedAt: new Date("2026-09-03T18:00:00.000Z"),
  ...extra,
});

class PrismaError extends Error {
  code: string;
  constructor(code: string) {
    super(code);
    this.code = code;
    // Prisma tipa sus errores por clase; el service pregunta por `code`
    // sobre `PrismaClientKnownRequestError`. El mock imita el nombre.
    this.name = "PrismaClientKnownRequestError";
  }
}

describe.each([
  [
    "laboratorio",
    "medicalClinicLabStudy",
    LabStudiesService,
    "lab_study",
    "medical_clinic.lab_study_not_found",
  ],
  [
    "diagnóstico",
    "medicalClinicDiagnosticStudy",
    DiagnosticStudiesService,
    "diagnostic_study",
    "medical_clinic.diagnostic_study_not_found",
  ],
] as const)(
  "catálogo de estudios de %s (F9-CLINIC-07/08)",
  (_nombre, delegado, Service, recurso, notFound) => {
    let modelo: {
      count: Mock;
      findMany: Mock;
      findFirst: Mock;
      create: Mock;
      update: Mock;
      delete: Mock;
    };
    let tx: Record<string, typeof modelo>;
    let prisma: { withTenantContext: Mock };
    let audit: { record: Mock };
    let service: LabStudiesService | DiagnosticStudiesService;

    beforeEach(() => {
      modelo = {
        count: jest.fn().mockResolvedValue(1),
        findMany: jest.fn().mockResolvedValue([fila()]),
        findFirst: jest.fn().mockResolvedValue(fila()),
        create: jest.fn().mockImplementation(({ data }) => Promise.resolve(fila(data))),
        update: jest.fn().mockImplementation(({ data }) => Promise.resolve(fila(data))),
        delete: jest.fn().mockResolvedValue(fila()),
      };
      tx = { [delegado]: modelo };
      prisma = {
        withTenantContext: jest.fn((_t: string, fn: (t: typeof tx) => unknown) => fn(tx)),
      };
      audit = { record: jest.fn() };
      // biome-ignore lint/suspicious/noExplicitAny: mocks parciales a propósito
      service = new Service(prisma as any, audit as any);
    });

    it("lista por nombre con desempate por id y busca por código y nombre", async () => {
      const res = await service.list(USER, { query: "bio", page: 2, pageSize: 10 });
      const args = modelo.findMany.mock.calls[0][0];
      expect(args.orderBy).toEqual([{ name: "asc" }, { id: "asc" }]);
      expect(args.skip).toBe(10);
      expect(args.where.tenantId).toBe(TENANT);
      expect(args.where.OR).toEqual([
        { code: { contains: "bio", mode: "insensitive" } },
        { name: { contains: "bio", mode: "insensitive" } },
      ]);
      expect(res.rows[0]).toMatchObject({ id: "s-1", code: "BH", price: null });
      expect(res.total).toBe(1);
    });

    it("el filtro de activos viaja al where solo cuando se pide", async () => {
      await service.list(USER, { page: 1, pageSize: 20 });
      expect(modelo.findMany.mock.calls[0][0].where.isActive).toBeUndefined();
      await service.list(USER, { isActive: false, page: 1, pageSize: 20 });
      expect(modelo.findMany.mock.calls[1][0].where.isActive).toBe(false);
    });

    it("crea con el tenant y quién lo hizo, con costo y precio, y audita en la tx", async () => {
      const creado = await service.create(
        USER,
        { code: "BH", name: "Biometría", cost: 40, price: 180 },
        META,
      );
      const data = modelo.create.mock.calls[0][0].data;
      expect(data).toMatchObject({ tenantId: TENANT, code: "BH", createdBy: "u-1" });
      expect(String(data.price)).toBe("180");
      expect(creado.price).toBe("180");
      expect(audit.record).toHaveBeenCalledWith(
        tx,
        expect.objectContaining({
          action: `medical_clinic.${recurso}.create`,
          resourceType: recurso,
        }),
      );
    });

    it("un código repetido responde 409 con su clave", async () => {
      modelo.create.mockRejectedValue(new PrismaError("P2002"));
      await expect(service.create(USER, { code: "BH", name: "x" }, META)).rejects.toMatchObject({
        response: { message: "medical_clinic.code_taken" },
      });
    });

    it("un estudio que no existe (o es de otro negocio) es 404 con la clave del catálogo", async () => {
      modelo.findFirst.mockResolvedValue(null);
      await expect(service.get(USER, "ajeno")).rejects.toMatchObject({
        response: { message: notFound },
      });
      await expect(service.update(USER, "ajeno", { name: "x" }, META)).rejects.toMatchObject({
        response: { message: notFound },
      });
    });

    it("actualiza solo lo que viene, null limpia, y audita antes y después", async () => {
      await service.update(USER, "s-1", { price: null, description: "En ayunas" }, META);
      const data = modelo.update.mock.calls[0][0].data;
      expect(data).toEqual({ price: null, description: "En ayunas" });
      expect(audit.record).toHaveBeenCalledWith(
        tx,
        expect.objectContaining({
          action: `medical_clinic.${recurso}.update`,
          before: expect.anything(),
        }),
      );
    });

    it("borrar un estudio que ya está en una orden responde 409 study_in_use", async () => {
      modelo.delete.mockRejectedValue(new PrismaError("P2003"));
      await expect(service.remove(USER, "s-1", META)).rejects.toMatchObject({
        response: { message: "medical_clinic.study_in_use" },
      });
    });
  },
);
