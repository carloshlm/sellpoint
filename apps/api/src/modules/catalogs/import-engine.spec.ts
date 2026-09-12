import { customHeaderLabels, resolveCustomColumns } from "./import-engine";
import type { FieldDefinition } from "./validate-attributes";

const campo = (key: string, label: string): FieldDefinition => ({
  key,
  label,
  fieldType: "text",
  required: false,
  isArchived: false,
  lookupCatalogId: null,
});

/**
 * Carlos (2026-09-12) renombró un campo y la plantilla siguió escribiendo el
 * nombre viejo: el encabezado salía con la `key`, que es inmutable por diseño
 * (es dónde vive el dato), en vez de con la etiqueta. La plantilla la lee una
 * persona, así que lleva la etiqueta — y para que los archivos ya descargados
 * sigan importando, el parser acepta las tres formas de nombrar la columna.
 */
describe("resolveCustomColumns — la columna propia se nombra como la persona la ve", () => {
  const proveedor = campo("proveedor", "Vendedores");

  it("la plantilla escribe la ETIQUETA de hoy, no la key de ayer", () => {
    expect(customHeaderLabels([proveedor, campo("sustancia_activa", "Sustancia activa")])).toEqual([
      "Vendedores",
      "Sustancia activa",
    ]);
  });

  it("un archivo con la etiqueta nueva se normaliza a la key", () => {
    const { header, nameOf } = resolveCustomColumns(["sku", "Vendedores"], [proveedor]);
    expect(header).toEqual(["sku", "proveedor"]);
    // Lo que se reporta es lo que ESA persona tiene escrito en SU planilla.
    expect(nameOf("proveedor")).toBe("Vendedores");
  });

  it("un archivo viejo con la key histórica sigue importando", () => {
    const { header, nameOf } = resolveCustomColumns(["sku", "proveedor"], [proveedor]);
    expect(header).toEqual(["sku", "proveedor"]);
    expect(nameOf("proveedor")).toBe("proveedor");
  });

  it("mayúsculas y acentos no rompen la columna: se compara por slug", () => {
    expect(resolveCustomColumns(["PROVEEDOR"], [proveedor]).header).toEqual(["proveedor"]);
    expect(
      resolveCustomColumns(["Sustancia Activa"], [campo("sustancia_activa", "Sustancia activa")])
        .header,
    ).toEqual(["sustancia_activa"]);
  });

  it("la columna que el archivo NO trae se nombra con la etiqueta actual", () => {
    expect(resolveCustomColumns(["sku"], [proveedor]).nameOf("proveedor")).toBe("Vendedores");
  });

  it("una columna que no es de ningún campo se deja como vino", () => {
    const { header } = resolveCustomColumns(["sku", "notas del vendedor"], [proveedor]);
    expect(header).toEqual(["sku", "notas del vendedor"]);
  });

  it("la key gana sobre la etiqueta de otro campo: es prueba exacta, no coincidencia de nombre", () => {
    const otro = campo("vendedores", "Otro");
    const { header } = resolveCustomColumns(["Vendedores"], [proveedor, otro]);
    expect(header).toEqual(["vendedores"]);
  });

  it("dos ETIQUETAS que reclaman el mismo nombre: no se adivina, la columna queda cruda", () => {
    const gemelo = campo("contacto", "Vendedores");
    const { header } = resolveCustomColumns(["Vendedores"], [proveedor, gemelo]);
    expect(header).toEqual(["Vendedores"]);
  });

  it("una celda sin nada usable no rompe el encabezado", () => {
    expect(resolveCustomColumns(["---", ""], [proveedor]).header).toEqual(["---", ""]);
  });
});
