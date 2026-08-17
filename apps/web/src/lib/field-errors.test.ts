import type { ApiError } from "@/lib/api";
import { fieldErrorsOf } from "./field-errors";

/**
 * El API devuelve `errors: [{ key, message, code }]` con la RUTA del campo
 * (`lines.0.wastePercentage`). Hasta ahora cada formulario lo casteaba a mano
 * y solo el de producto lo usaba; la pestaña de composición mostraba el
 * mensaje general arriba y el usuario tenía que adivinar qué fila corregir.
 */
const apiError = (extra: Record<string, unknown> = {}): ApiError =>
  ({
    statusCode: 400,
    message: "products.invalid_body",
    error: "Bad Request",
    ...extra,
  }) as ApiError;

describe("fieldErrorsOf", () => {
  it("indexa por la RUTA completa, que es lo que identifica la fila", () => {
    const errors = fieldErrorsOf(
      apiError({
        errors: [
          {
            key: "lines.0.wastePercentage",
            message: "Debe ser 100 o menos.",
            code: "validation.max",
          },
          {
            key: "lines.2.quantity",
            message: "Debe ser mayor que 0.",
            code: "validation.greater_than",
          },
        ],
      }),
    );

    expect(errors.get("lines.0.wastePercentage")).toBe("Debe ser 100 o menos.");
    expect(errors.get("lines.2.quantity")).toBe("Debe ser mayor que 0.");
    expect(errors.get("lines.1.quantity")).toBeUndefined();
  });

  it("un error sin `errors` devuelve un mapa vacío, no revienta", () => {
    // Los 409 de negocio (SKU repetido, es componente de otro) no traen campos:
    // esos se siguen mostrando como mensaje general.
    expect(fieldErrorsOf(apiError()).size).toBe(0);
  });

  it("ignora entradas mal formadas en vez de tumbar el formulario", () => {
    const errors = fieldErrorsOf(
      apiError({
        errors: [
          { key: "sku", message: "Ya existe." },
          { message: "sin key" },
          null,
          "no soy un objeto",
          { key: "vacio", message: "" },
        ],
      }),
    );

    expect(errors.get("sku")).toBe("Ya existe.");
    // Sin `key` o sin mensaje no hay dónde ni qué pintar.
    expect(errors.size).toBe(1);
  });

  it("`errors` que no es un arreglo se ignora", () => {
    // El reporte de importación viaja en `errors` con OTRA forma (row/field).
    expect(fieldErrorsOf(apiError({ errors: "no soy un arreglo" })).size).toBe(0);
  });
});
