import { canonicalHeader, headerLabel, localizeHeaders } from "./import-headers";

/**
 * Las plantillas hablan el idioma de quien las descarga; los parsers entienden
 * los dos. La clave interna nunca cambia.
 */
describe("encabezados de importación por idioma", () => {
  it("en español la etiqueta ES la clave; en inglés, su traducción", () => {
    expect(headerLabel("codigo_de_barras", "es")).toBe("codigo_de_barras");
    expect(headerLabel("codigo_de_barras", "en")).toBe("barcode");
    expect(localizeHeaders(["sku", "nombre", "precio"], "en")).toEqual(["sku", "name", "price"]);
  });

  it("una columna personalizada no se traduce: su nombre lo puso el negocio", () => {
    expect(headerLabel("laboratorio", "en")).toBe("laboratorio");
  });

  it("el parser vuelve a la clave desde el inglés, sin distinguir mayúsculas ni espacios", () => {
    expect(canonicalHeader(" Name ")).toBe("nombre");
    expect(canonicalHeader("TRACKS_LOTS")).toBe("controla_lotes");
    expect(canonicalHeader("unit_cost")).toBe("costo_unitario");
  });

  it("el español y lo personalizado pasan intactos (solo recortados)", () => {
    expect(canonicalHeader(" nombre ")).toBe("nombre");
    expect(canonicalHeader("laboratorio")).toBe("laboratorio");
    expect(canonicalHeader("Laboratorio")).toBe("Laboratorio");
  });

  it("ida y vuelta: toda clave conocida regresa a sí misma desde su etiqueta en inglés", () => {
    for (const key of ["sku", "nombre", "unidad_base", "caducidad", "contado", "presentacion"]) {
      expect(canonicalHeader(headerLabel(key, "en"))).toBe(key);
    }
  });
});
