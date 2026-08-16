import { deriveFieldKey } from "./field-key";

/**
 * F2-CAT-03. La `key` es el identificador ESTABLE con el que el valor de un
 * campo vive dentro del JSONB `attributes`. El usuario nunca la escribe: la
 * derivamos de su etiqueta y después ya no cambia — renombrar "Sustancia
 * Activa" a "Principio activo" cambia lo que se lee en pantalla, no dónde
 * están guardados los datos.
 */
describe("deriveFieldKey (F2-CAT-03)", () => {
  it("pasa una etiqueta común a snake_case", () => {
    expect(deriveFieldKey("Sustancia Activa")).toBe("sustancia_activa");
    expect(deriveFieldKey("Origen del Grano")).toBe("origen_del_grano");
  });

  it("quita acentos y eñes: la key es ASCII para que sirva de clave JSON sin sorpresas", () => {
    // Sin normalizar, "Código" y "Codigo" darían keys distintas y el usuario
    // vería dos campos que para él son el mismo.
    expect(deriveFieldKey("Código Interno")).toBe("codigo_interno");
    expect(deriveFieldKey("Año de cosecha")).toBe("ano_de_cosecha");
    expect(deriveFieldKey("Tamaño")).toBe("tamano");
  });

  it("colapsa separadores y signos en un solo guion bajo", () => {
    expect(deriveFieldKey("Nivel  de   Cafeína")).toBe("nivel_de_cafeina");
    expect(deriveFieldKey("Peso (neto)")).toBe("peso_neto");
    expect(deriveFieldKey("Precio / Costo")).toBe("precio_costo");
    expect(deriveFieldKey("  Con espacios  ")).toBe("con_espacios");
  });

  it("dos etiquetas que un humano lee igual dan la MISMA key", () => {
    // Es lo que hace que el 409 de duplicado tenga sentido: "Color", "COLOR"
    // y "color " son el mismo campo para quien lo usa.
    expect(deriveFieldKey("COLOR")).toBe(deriveFieldKey("color"));
    expect(deriveFieldKey("Tipo de Tueste")).toBe(deriveFieldKey("tipo de tueste"));
  });

  it("una key nunca empieza con dígito: no sería un identificador usable", () => {
    expect(deriveFieldKey("2da presentación")).toBe("f_2da_presentacion");
  });

  it("una etiqueta sin nada aprovechable LANZA en vez de dar una key vacía", () => {
    // Una key vacía convertiría el JSONB en un basurero silencioso.
    expect(() => deriveFieldKey("   ")).toThrow();
    expect(() => deriveFieldKey("!!!")).toThrow();
  });

  it("recorta a un largo razonable sin cortar a la mitad de un guion bajo", () => {
    const key = deriveFieldKey("Una etiqueta absurdamente larga ".repeat(10));

    expect(key.length).toBeLessThanOrEqual(63);
    expect(key.endsWith("_")).toBe(false);
  });
});
