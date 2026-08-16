import type { FieldDefinition } from "./validate-attributes";
import { validateRecordAttributes } from "./validate-attributes";

/**
 * F2-CAT-04. Función PURA: sin DB, sin Nest, sin Ajv. Los campos del catálogo
 * SON el schema — no hay un JSON Schema intermedio que compilar
 * (ARQUITECTURA § 3.3).
 *
 * Los errores salen como claves i18n por campo, que es lo que el form dinámico
 * necesita para pintar el mensaje debajo del input correcto.
 */
function field(overrides: Partial<FieldDefinition> = {}): FieldDefinition {
  return {
    key: "campo",
    fieldType: "text",
    required: false,
    isArchived: false,
    lookupCatalogId: null,
    ...overrides,
  };
}

describe("validateRecordAttributes (F2-CAT-04)", () => {
  it("un registro que cumple no produce errores", () => {
    const fields = [
      field({ key: "sustancia", fieldType: "text", required: true }),
      field({ key: "dosis", fieldType: "number" }),
    ];

    expect(validateRecordAttributes(fields, { sustancia: "Paracetamol", dosis: 500 })).toEqual([]);
  });

  describe("required", () => {
    it("un requerido ausente, vacío o nulo falla", () => {
      const fields = [field({ key: "sustancia", required: true })];

      expect(validateRecordAttributes(fields, {})).toEqual([
        { key: "sustancia", message: "catalogs.field_required" },
      ]);
      expect(validateRecordAttributes(fields, { sustancia: null })).toHaveLength(1);
      // Cadena de solo espacios: para el usuario el campo está vacío.
      expect(validateRecordAttributes(fields, { sustancia: "   " })).toHaveLength(1);
    });

    it("un opcional ausente o nulo es válido: no todo campo se llena siempre", () => {
      const fields = [field({ key: "notas", required: false })];

      expect(validateRecordAttributes(fields, {})).toEqual([]);
      expect(validateRecordAttributes(fields, { notas: null })).toEqual([]);
    });
  });

  describe("tipos", () => {
    it("text exige string", () => {
      const fields = [field({ key: "nombre", fieldType: "text" })];

      expect(validateRecordAttributes(fields, { nombre: 42 })).toEqual([
        { key: "nombre", message: "catalogs.field_must_be_text" },
      ]);
    });

    it("number exige un número FINITO, no un string que parece número", () => {
      // Aceptar "500" abriría la puerta a "aproximadamente 3" un día después.
      const fields = [field({ key: "dosis", fieldType: "number" })];

      expect(validateRecordAttributes(fields, { dosis: 500 })).toEqual([]);
      expect(validateRecordAttributes(fields, { dosis: 12.5 })).toEqual([]);
      expect(validateRecordAttributes(fields, { dosis: "500" })).toHaveLength(1);
      expect(validateRecordAttributes(fields, { dosis: Number.NaN })).toHaveLength(1);
    });

    it("lookup exige un UUID: guarda el id del registro destino, no su código", () => {
      // El id es estable ante renombres del código; el código es lo que se
      // muestra (ARQUITECTURA § 3.3).
      const fields = [field({ key: "unidad", fieldType: "lookup", lookupCatalogId: "cat-1" })];

      expect(
        validateRecordAttributes(fields, { unidad: "0f14d0ab-9605-4a62-a9e4-5ed26688389b" }),
      ).toEqual([]);
      expect(validateRecordAttributes(fields, { unidad: "kg" })).toEqual([
        { key: "unidad", message: "catalogs.field_must_be_reference" },
      ]);
    });
  });

  describe("campos archivados", () => {
    it("no se validan ni se exigen, aunque estén marcados como requeridos", () => {
      // Su valor sigue en `attributes` y debe poder guardarse tal cual: el
      // campo está oculto, no borrado.
      const fields = [field({ key: "viejo", required: true, isArchived: true })];

      expect(validateRecordAttributes(fields, {})).toEqual([]);
      expect(validateRecordAttributes(fields, { viejo: 12345 })).toEqual([]);
    });
  });

  describe("claves desconocidas", () => {
    it("una clave que no corresponde a ningún campo se rechaza", () => {
      // Sin esto, `attributes` se convierte en un basurero donde cualquier
      // cliente puede escribir lo que quiera y nadie lo lee nunca.
      const fields = [field({ key: "conocido" })];

      expect(validateRecordAttributes(fields, { conocido: "ok", intruso: "x" })).toEqual([
        { key: "intruso", message: "catalogs.field_unknown" },
      ]);
    });

    it("la clave de un campo ARCHIVADO no se considera desconocida", () => {
      const fields = [field({ key: "viejo", isArchived: true })];

      expect(validateRecordAttributes(fields, { viejo: "valor previo" })).toEqual([]);
    });
  });

  it("reporta TODOS los errores juntos, no solo el primero", () => {
    // El form pinta los mensajes de una sola vez; devolver de a uno haría que
    // el usuario corrija, reintente y descubra el siguiente.
    const fields = [field({ key: "a", required: true }), field({ key: "b", fieldType: "number" })];

    expect(validateRecordAttributes(fields, { b: "no numero", c: 1 })).toHaveLength(3);
  });

  it("attributes que no es un objeto se rechaza entero", () => {
    expect(validateRecordAttributes([], null)).toEqual([
      { key: "", message: "catalogs.attributes_must_be_object" },
    ]);
    expect(validateRecordAttributes([], ["a"])).toHaveLength(1);
  });
});
