import { createSaleSchema } from "./dto/create-sale.dto";
import { createQuoteSchema } from "./dto/quote.dto";

/**
 * F4-CONCEPT-03 — la línea de cotización tiene TRES formas: producto,
 * servicio o concepto (descripción + precio). Nunca dos a la vez, y el
 * concepto es el único que trae precio porque no hay catálogo que lo diga.
 */
describe("DTOs del POS con línea de concepto (F4-CONCEPT-03)", () => {
  const cotizar = (line: Record<string, unknown>) => createQuoteSchema.safeParse({ lines: [line] });
  const uuid = "6b2a2d5e-1c1f-4a4e-9a7c-6a1c2f3d4e5f";

  it("acepta las tres formas de línea", () => {
    expect(cotizar({ productId: uuid, quantity: 2 }).success).toBe(true);
    expect(cotizar({ serviceId: uuid, quantity: 1 }).success).toBe(true);
    const concepto = cotizar({
      concept: { description: " Flete a domicilio ", unitPrice: 150 },
      quantity: 1,
    });
    expect(concepto.success).toBe(true);
    expect(JSON.stringify(concepto.data)).toContain('"description":"Flete a domicilio"');
  });

  it("producto y concepto juntos rebotan con su clave", () => {
    const res = cotizar({
      productId: uuid,
      concept: { description: "Flete", unitPrice: 1 },
      quantity: 1,
    });
    expect(res.success).toBe(false);
    expect(JSON.stringify(res.error?.issues)).toContain("pos.line_kind_invalid");
  });

  it("un concepto sin descripción o con precio negativo rebota", () => {
    expect(cotizar({ concept: { description: "  ", unitPrice: 1 }, quantity: 1 }).success).toBe(
      false,
    );
    expect(cotizar({ concept: { description: "Flete", unitPrice: -1 }, quantity: 1 }).success).toBe(
      false,
    );
  });

  it("una línea sin nada sigue rebotando", () => {
    const res = cotizar({ quantity: 1 });
    expect(res.success).toBe(false);
    expect(JSON.stringify(res.error?.issues)).toContain("pos.line_kind_invalid");
  });

  /**
   * F4-CONCEPT-06 — la venta identifica el concepto por `quoteLineId`, nunca
   * por descripción ni precio: eso se copia de la cotización en el servidor.
   */
  it("la línea de venta acepta quoteLineId como tercera forma, sola", () => {
    const linea = { quoteLineId: "5b3e7d6e-3c4a-4c9c-9d1a-2b3c4d5e6f70", quantity: 1 };
    expect(createSaleSchema.safeParse({ paymentMethod: "cash", lines: [linea] }).success).toBe(
      true,
    );
    // F4-CONCEPT-10: junto a un producto YA NO rebota — es el rastro de la
    // línea de la cotización de la que salió, y el precio lo sigue poniendo
    // el catálogo.
    expect(
      createSaleSchema.safeParse({
        paymentMethod: "cash",
        lines: [{ ...linea, productId: "5b3e7d6e-3c4a-4c9c-9d1a-2b3c4d5e6f71" }],
      }).success,
    ).toBe(true);
    expect(
      createSaleSchema.safeParse({
        paymentMethod: "cash",
        lines: [{ ...linea, serviceId: "5b3e7d6e-3c4a-4c9c-9d1a-2b3c4d5e6f72" }],
      }).success,
    ).toBe(true);
    // Producto Y servicio a la vez sigue sin tener forma.
    expect(
      createSaleSchema.safeParse({
        paymentMethod: "cash",
        lines: [
          {
            ...linea,
            productId: "5b3e7d6e-3c4a-4c9c-9d1a-2b3c4d5e6f71",
            serviceId: "5b3e7d6e-3c4a-4c9c-9d1a-2b3c4d5e6f72",
          },
        ],
      }).success,
    ).toBe(false);
    // El precio sigue sin poder viajar, también en esta forma.
    expect(
      createSaleSchema.safeParse({ paymentMethod: "cash", lines: [{ ...linea, unitPrice: 1 }] })
        .success,
    ).toBe(false);
  });

  it("la presentación sigue siendo cosa de productos", () => {
    const res = cotizar({
      concept: { description: "Flete", unitPrice: 1 },
      presentationId: uuid,
      quantity: 1,
    });
    expect(res.success).toBe(false);
  });
});
