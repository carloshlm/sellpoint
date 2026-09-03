import { describe, expect, it } from "vitest";
import { conceptLineSchema, POS_LINE_KINDS, posLineKindSchema } from "./pos-lines";

/**
 * F4-CONCEPT-01 — los tipos de línea de cotización y venta son CÓDIGO, como
 * `MODULE_KEYS`: la base los espeja con un CHECK, pero la lista canónica vive
 * acá para que el API, el web y el ticket hablen de lo mismo.
 */
describe("tipos de línea del POS (F4-CONCEPT-01)", () => {
  it("son exactamente producto, servicio y concepto", () => {
    expect(POS_LINE_KINDS).toEqual(["product", "service", "concept"]);
  });

  it("posLineKindSchema rechaza lo que no está en la lista", () => {
    expect(posLineKindSchema.parse("concept")).toBe("concept");
    expect(() => posLineKindSchema.parse("medicine")).toThrow();
    expect(() => posLineKindSchema.parse("")).toThrow();
  });

  it("un concepto es descripción + precio: sin descripción o con precio negativo rebota", () => {
    expect(conceptLineSchema.parse({ description: " Flete a domicilio ", unitPrice: 150 })).toEqual(
      {
        description: "Flete a domicilio",
        unitPrice: 150,
      },
    );
    expect(conceptLineSchema.safeParse({ description: "   ", unitPrice: 10 }).success).toBe(false);
    expect(conceptLineSchema.safeParse({ description: "Flete", unitPrice: -1 }).success).toBe(
      false,
    );
    expect(
      conceptLineSchema.safeParse({ description: "x".repeat(201), unitPrice: 1 }).success,
    ).toBe(false);
    expect(conceptLineSchema.parse({ description: "Anticipo", unitPrice: 0 }).unitPrice).toBe(0);
  });
});
