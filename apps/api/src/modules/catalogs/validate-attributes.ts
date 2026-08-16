/**
 * F2-CAT-04 — validación de `attributes` derivada de los campos del catálogo.
 *
 * Es una función PURA y sin dependencias: los `catalog_fields` SON el schema.
 * El diseño original de ARQUITECTURA § 3.3 pasaba por un JSON Schema draft-07
 * compilado con Ajv; se descartó al generalizar el motor porque era una
 * indirección sin dueño — había que mantener sincronizados los campos (filas)
 * con un documento que los describía. Con los campos como fuente única, esto
 * es un `for` sobre una lista.
 *
 * Devuelve TODOS los errores juntos: el form dinámico los pinta de una sola
 * vez, en vez de hacer que el usuario corrija, reintente y descubra el
 * siguiente.
 */

export interface FieldDefinition {
  key: string;
  fieldType: "text" | "number" | "lookup";
  required: boolean;
  isArchived: boolean;
  lookupCatalogId: string | null;
}

export interface FieldError {
  /** La `key` del campo, o `""` cuando el problema es del objeto entero. */
  key: string;
  /** Clave i18n — el backend la traduce con el Accept-Language del request. */
  message: string;
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function validateRecordAttributes(
  fields: readonly FieldDefinition[],
  attributes: unknown,
): FieldError[] {
  if (attributes === null || typeof attributes !== "object" || Array.isArray(attributes)) {
    return [{ key: "", message: "catalogs.attributes_must_be_object" }];
  }

  const values = attributes as Record<string, unknown>;
  const errors: FieldError[] = [];

  for (const field of fields) {
    // Un campo ARCHIVADO no se valida ni se exige: está oculto, no borrado, y
    // su valor tiene que poder guardarse tal cual estaba.
    if (field.isArchived) {
      continue;
    }

    const value = values[field.key];

    if (isEmpty(value)) {
      if (field.required) {
        errors.push({ key: field.key, message: "catalogs.field_required" });
      }
      // Un opcional vacío no se valida por tipo: no hay nada que mirar.
      continue;
    }

    const typeError = checkType(field, value);
    if (typeError) {
      errors.push({ key: field.key, message: typeError });
    }
  }

  // Claves que no corresponden a ningún campo (ni siquiera archivado): sin
  // esto, `attributes` se vuelve un basurero donde cualquiera escribe algo
  // que nadie lee nunca.
  const knownKeys = new Set(fields.map((field) => field.key));
  for (const key of Object.keys(values)) {
    if (!knownKeys.has(key)) {
      errors.push({ key, message: "catalogs.field_unknown" });
    }
  }

  return errors;
}

/** Ausente, nulo o cadena en blanco: para el usuario, el campo está vacío. */
function isEmpty(value: unknown): boolean {
  return value === undefined || value === null || (typeof value === "string" && !value.trim());
}

function checkType(field: FieldDefinition, value: unknown): string | null {
  switch (field.fieldType) {
    case "text":
      return typeof value === "string" ? null : "catalogs.field_must_be_text";

    case "number":
      // Finito y number de verdad: aceptar "500" abriría la puerta a
      // "aproximadamente 3" un día después, y ahí ya no hay vuelta atrás.
      return typeof value === "number" && Number.isFinite(value)
        ? null
        : "catalogs.field_must_be_number";

    case "lookup":
      // Guarda el ID del registro destino, no su código: el id es estable
      // ante renombres, el código es lo que se muestra. Que ese id EXISTA lo
      // verifica el service contra la DB — acá solo se mira la forma.
      return typeof value === "string" && UUID_PATTERN.test(value)
        ? null
        : "catalogs.field_must_be_reference";
  }
}
