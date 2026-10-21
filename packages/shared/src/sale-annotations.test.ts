import { describe, expect, it } from "vitest";
import {
  SALE_ANNOTATIONS_MAX,
  saleAnnotationSchema,
  saleAnnotationsSchema,
} from "./sale-annotations";

/**
 * F9-RECEP-21 — lo único que un módulo le devuelve a la venta. El POS lo
 * valida antes de guardarlo: un módulo con un bug no puede escribir basura en
 * `sales.annotations` ni romper el ticket de nadie.
 */
const valida = {
  sourceModule: "reception",
  labelKey: "reception.saleAnnotation.turn",
  value: "7",
  emphasis: true,
} as const;

describe("saleAnnotationSchema", () => {
  it("una anotación bien formada pasa", () => {
    expect(saleAnnotationSchema.parse(valida)).toEqual(valida);
  });

  it("la etiqueta es una CLAVE de i18n, no un texto", () => {
    expect(saleAnnotationSchema.safeParse({ ...valida, labelKey: "Turno 7" }).success).toBe(false);
    expect(saleAnnotationSchema.safeParse({ ...valida, labelKey: "Reception.turn" }).success).toBe(
      false,
    );
    expect(saleAnnotationSchema.safeParse({ ...valida, labelKey: "" }).success).toBe(false);
  });

  it("el valor no puede ir vacío ni pasar de 40", () => {
    expect(saleAnnotationSchema.safeParse({ ...valida, value: "" }).success).toBe(false);
    expect(saleAnnotationSchema.safeParse({ ...valida, value: "x".repeat(41) }).success).toBe(
      false,
    );
    expect(saleAnnotationSchema.safeParse({ ...valida, value: "x".repeat(40) }).success).toBe(true);
  });

  it("solo un módulo del catálogo puede anotar", () => {
    expect(saleAnnotationSchema.safeParse({ ...valida, sourceModule: "pos" }).success).toBe(false);
  });

  it("no acepta campos de más", () => {
    expect(saleAnnotationSchema.safeParse({ ...valida, color: "red" }).success).toBe(false);
  });
});

describe("saleAnnotationsSchema", () => {
  it("acepta hasta el tope y rechaza uno más", () => {
    const tope = Array.from({ length: SALE_ANNOTATIONS_MAX }, () => valida);
    expect(saleAnnotationsSchema.safeParse(tope).success).toBe(true);
    expect(saleAnnotationsSchema.safeParse([...tope, valida]).success).toBe(false);
  });

  it("el tope es 10", () => {
    expect(SALE_ANNOTATIONS_MAX).toBe(10);
  });
});
