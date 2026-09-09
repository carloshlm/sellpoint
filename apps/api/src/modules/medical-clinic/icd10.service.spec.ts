import { Icd10Service } from "./icd10.service";

/**
 * F9-CLINIC-HC-22 — código por prefijo (Prisma), texto por relevancia (SQL
 * sobre `search`), y solo vigentes. La base la prueba el integration spec y
 * el e2e; aquí, qué consulta se arma con qué.
 */
describe("Icd10Service", () => {
  const findMany = jest.fn().mockResolvedValue([]);
  const queryRaw = jest.fn().mockResolvedValue([]);
  const service = new Icd10Service({
    medicalClinicIcd10Code: { findMany },
    $queryRaw: queryRaw,
    // biome-ignore lint/suspicious/noExplicitAny: mock parcial a propósito
  } as any);

  beforeEach(() => {
    findMany.mockClear();
    queryRaw.mockClear();
  });

  it("un código tecleado busca por prefijo con punto, solo vigentes, ordenado por código", async () => {
    await service.search({ q: "j069", limit: 20 });
    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { isValid: true, code: { startsWith: "J06.9" } },
        orderBy: { code: "asc" },
        take: 20,
      }),
    );
    expect(queryRaw).not.toHaveBeenCalled();
  });

  it("un texto busca en `search` sin acentos ni mayúsculas, con los comodines de LIKE escapados", async () => {
    await service.search({ q: "  Infección 100%_x ", limit: 5 });
    expect(findMany).not.toHaveBeenCalled();
    const sql = queryRaw.mock.calls[0]?.[0] as { values: unknown[]; sql: string };
    expect(sql.values).toEqual(["%infeccion 100\\%\\_x%", "infeccion 100%_x", 5]);
    expect(sql.sql).toMatch(/ORDER BY position\(/);
    expect(sql.sql).toMatch(/"is_valid"/);
  });
});
