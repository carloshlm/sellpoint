import { INVALID_ID } from "../../../common/http/id-field";
import {
  expiringExportQuerySchema,
  expiringQuerySchema,
  productLotsQuerySchema,
} from "./lots-query.dto";

const UUID = "3f1c9a52-7d0b-4e8a-9c61-2b5d8e4f7a90";

/**
 * F10-MANFIX-20 — los lotes y los próximos a vencer recibían cada parámetro
 * suelto (`@Query("warehouseId")`). Su DTO hace lo mismo que el handler hacía
 * a mano; solo el id mal formado deja de llegar crudo a la base.
 */
describe("productLotsQuerySchema", () => {
  it("`withStock` se enciende solo con `true`", () => {
    expect(productLotsQuerySchema.parse({ withStock: "true" }).withStock).toBe(true);
    expect(productLotsQuerySchema.parse({ withStock: "1" }).withStock).toBe(false);
    expect(productLotsQuerySchema.parse({}).withStock).toBe(false);
  });

  it("el almacén: vacío es «sin filtro»; mal formado, 400 `common.invalid_id`", () => {
    expect(productLotsQuerySchema.parse({ warehouseId: "" }).warehouseId).toBeUndefined();
    expect(productLotsQuerySchema.parse({ warehouseId: UUID }).warehouseId).toBe(UUID);
    expect(productLotsQuerySchema.safeParse({ warehouseId: "abc" }).error?.issues[0]?.message).toBe(
      INVALID_ID,
    );
  });
});

describe("expiringQuerySchema", () => {
  /**
   * 30 días es el default del tablero, y un `days` basura cae ahí y no en un
   * 500: pedir «próximos a vencer» sin decir cuántos días es razonable.
   */
  it.each([
    [undefined, 30],
    ["abc", 30],
    ["-1", 30],
    ["Infinity", 30],
    ["7.9", 7],
    ["90", 90],
    // `Number("")` es 0: el `?days=` vacío pedía «lo que vence hoy», y lo sigue pidiendo.
    ["", 0],
  ])("`days=%s` → %s", (days, expected) => {
    expect(expiringQuerySchema.parse({ days }).days).toBe(expected);
  });

  it("`onlyExpired` se enciende con `true` o `1`", () => {
    expect(expiringQuerySchema.parse({ onlyExpired: "true" }).onlyExpired).toBe(true);
    expect(expiringQuerySchema.parse({ onlyExpired: "1" }).onlyExpired).toBe(true);
    expect(expiringQuerySchema.parse({ onlyExpired: "yes" }).onlyExpired).toBe(false);
  });

  it("el almacén: vacío es «sin filtro»; mal formado, 400 `common.invalid_id`", () => {
    expect(expiringQuerySchema.parse({ warehouseId: "" }).warehouseId).toBeUndefined();
    expect(expiringQuerySchema.safeParse({ warehouseId: "abc" }).error?.issues[0]?.message).toBe(
      INVALID_ID,
    );
  });

  it("el export baja CSV solo si se pide; cualquier otra cosa es Excel", () => {
    expect(expiringExportQuerySchema.parse({ format: "csv" }).format).toBe("csv");
    expect(expiringExportQuerySchema.parse({ format: "ods" }).format).toBe("xlsx");
    expect(expiringExportQuerySchema.parse({}).format).toBe("xlsx");
  });
});
