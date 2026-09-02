import { describe, expect, it } from "vitest";
import { MODULE_KEYS, moduleKeySchema } from "./modules";

/**
 * F9-MOD-01 — el catálogo de módulos es CÓDIGO, no datos: un módulo sin
 * código que lo implemente no existe. Esta lista es la única fuente de verdad
 * para el API (guard), el backoffice (toggles) y el menú del cliente.
 */
describe("catálogo de módulos por tenant (F9-MOD-01)", () => {
  it("Recepción es el primer módulo", () => {
    expect(MODULE_KEYS).toEqual(["reception"]);
  });

  it("moduleKeySchema acepta solo claves del catálogo", () => {
    expect(moduleKeySchema.parse("reception")).toBe("reception");
    expect(() => moduleKeySchema.parse("foo")).toThrow();
    expect(() => moduleKeySchema.parse("")).toThrow();
  });
});
