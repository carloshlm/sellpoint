import { describe, expect, it } from "vitest";
import { catalogDisplayName } from "./display-name";

/**
 * El nombre de un catálogo del sistema es COPY nuestro, no dato del negocio:
 * el API lo rechaza si alguien intenta renombrarlo
 * (`catalogs.system_cannot_be_renamed`). Por eso se traduce. El nombre de un
 * subcatálogo lo escribió el usuario y JAMÁS se toca.
 */
const traducir = (key: string) => `[${key}]`;

describe("catalogDisplayName", () => {
  it("traduce los tres catálogos del sistema por su systemKey", () => {
    expect(
      catalogDisplayName({ name: "Catálogo de Productos", systemKey: "products" }, traducir),
    ).toBe("[catalogs.system.products]");
    expect(
      catalogDisplayName({ name: "Catálogo de Almacenes", systemKey: "warehouses" }, traducir),
    ).toBe("[catalogs.system.warehouses]");
    expect(
      catalogDisplayName({ name: "Catálogo de Servicios", systemKey: "services" }, traducir),
    ).toBe("[catalogs.system.services]");
  });

  it("un subcatálogo conserva el nombre que escribió el usuario", () => {
    expect(catalogDisplayName({ name: "Unidad de Medida", systemKey: null }, traducir)).toBe(
      "Unidad de Medida",
    );
  });

  it("un systemKey desconocido cae al nombre de la base, nunca a la clave cruda", () => {
    // Si mañana nace un cuarto catálogo del sistema y alguien olvida la clave,
    // el usuario ve un nombre legible y no «catalogs.system.labs».
    expect(
      catalogDisplayName({ name: "Catálogo de Laboratorio", systemKey: "labs" }, traducir),
    ).toBe("Catálogo de Laboratorio");
  });
});
