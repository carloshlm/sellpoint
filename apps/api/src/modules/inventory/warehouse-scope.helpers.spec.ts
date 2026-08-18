import { ForbiddenException } from "@nestjs/common";
import type { UserScope } from "../../infrastructure/warehouse-scope/request-warehouse-scope";
import { assertWarehouseInScope, warehouseScopeWhere } from "./warehouse-scope.helpers";

/**
 * F3-CORE-03 — el alcance por almacén, primer consumidor real de
 * `@CurrentUserScope()` (existía desde F1-SCOPE sin que nadie lo usara).
 *
 * Tres estados posibles del scope, y los tres importan:
 *  · `"all"`      — sin restricción (el default permisivo de F2-SCOPE-01: un
 *                   tenant chico que nunca asignó alcances ve todo);
 *  · `[a, b]`     — solo esos almacenes;
 *  · `[]`         — ninguno. Es el fail-closed del interceptor, no un "todos".
 */
describe("alcance por almacén (F3-CORE-03)", () => {
  const A = "11111111-1111-4111-8111-111111111111";
  const B = "22222222-2222-4222-8222-222222222222";

  describe("assertWarehouseInScope", () => {
    it("con `all` deja pasar cualquier almacén", () => {
      expect(() => assertWarehouseInScope({ warehouseIds: "all" }, A)).not.toThrow();
    });

    it("con una lista deja pasar los suyos y frena los ajenos", () => {
      const scope: UserScope = { warehouseIds: [A] };

      expect(() => assertWarehouseInScope(scope, A)).not.toThrow();
      expect(() => assertWarehouseInScope(scope, B)).toThrow(ForbiddenException);
    });

    /**
     * El caso que más importa: lista VACÍA no significa "todos". Es el
     * fail-closed del interceptor cuando no pudo resolver el scope, y
     * confundirlo con `all` abriría el inventario entero.
     */
    it("con la lista vacía frena TODO: `[]` no es `all`", () => {
      expect(() => assertWarehouseInScope({ warehouseIds: [] }, A)).toThrow(ForbiddenException);
    });

    it("el 403 dice qué pasó, con clave traducible", () => {
      try {
        assertWarehouseInScope({ warehouseIds: [] }, A);
        throw new Error("debería haber lanzado");
      } catch (error) {
        expect((error as ForbiddenException).getResponse()).toMatchObject({
          message: "inventory.warehouse_out_of_scope",
        });
      }
    });
  });

  describe("warehouseScopeWhere", () => {
    it("con `all` no filtra nada: un `where` vacío", () => {
      expect(warehouseScopeWhere({ warehouseIds: "all" })).toEqual({});
    });

    it("con una lista filtra por ids", () => {
      expect(warehouseScopeWhere({ warehouseIds: [A, B] })).toEqual({ id: { in: [A, B] } });
    });

    it("con la lista vacía devuelve un filtro que no matchea nada", () => {
      expect(warehouseScopeWhere({ warehouseIds: [] })).toEqual({ id: { in: [] } });
    });
  });
});
