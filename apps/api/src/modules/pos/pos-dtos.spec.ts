import { MONEY_MAX } from "@sellpoint/shared";
import { createSaleSchema } from "./dto/create-sale.dto";
import { openSessionSchema } from "./dto/open-session.dto";
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

/** F4-DISC — el descuento del ticket: monto positivo con escala de dinero y PIN de 4 a 8 dígitos. */
describe("createSaleSchema con descuento del ticket (F4-DISC)", () => {
  const linea = { productId: "11111111-1111-4111-8111-111111111111", quantity: 1 };

  it("acepta monto, código y motivo opcional", () => {
    const r = createSaleSchema.safeParse({
      paymentMethod: "cash",
      lines: [linea],
      discount: { amount: 25.5, code: "1234", reason: "Cliente frecuente" },
    });
    expect(r.success).toBe(true);
  });

  it("rechaza monto en cero o con tres decimales, código corto o con letras, y claves inventadas", () => {
    const base = { paymentMethod: "cash", lines: [linea] };
    expect(
      createSaleSchema.safeParse({ ...base, discount: { amount: 0, code: "1234" } }).success,
    ).toBe(false);
    expect(
      createSaleSchema.safeParse({ ...base, discount: { amount: 1.005, code: "1234" } }).success,
    ).toBe(false);
    expect(
      createSaleSchema.safeParse({ ...base, discount: { amount: 10, code: "123" } }).success,
    ).toBe(false);
    expect(
      createSaleSchema.safeParse({ ...base, discount: { amount: 10, code: "12a4" } }).success,
    ).toBe(false);
    expect(
      createSaleSchema.safeParse({ ...base, discount: { amount: 10, code: "1234", percent: 5 } })
        .success,
    ).toBe(false);
  });
});

/**
 * F10-MANFIX-10 — el fondo inicial del turno: opcional (sin él, $0), un
 * importe como los demás (dos decimales, el tope de la columna) y nunca
 * negativo: un cajón no empieza debiendo.
 */
describe("openSessionSchema con fondo inicial (F10-MANFIX-10)", () => {
  const abrir = (body: Record<string, unknown>) => openSessionSchema.safeParse(body);

  it("el fondo es opcional: sin él, el turno abre como siempre", () => {
    const r = abrir({});
    expect(r.success).toBe(true);
    expect(r.data).toEqual({});
  });

  it("acepta cero, pesos con centavos y el tope de la columna", () => {
    expect(abrir({ openingCash: 0 }).data).toEqual({ openingCash: 0 });
    expect(abrir({ openingCash: 500.5 }).data).toEqual({ openingCash: 500.5 });
    expect(abrir({ openingCash: MONEY_MAX }).success).toBe(true);
  });

  it("rechaza negativos, tres decimales, más que el tope y texto, con su clave", () => {
    for (const openingCash of [-1, 1.005, MONEY_MAX + 1, "500"]) {
      const r = abrir({ openingCash });
      expect(r.success).toBe(false);
      expect(JSON.stringify(r.error?.issues)).toContain("pos.opening_cash_invalid");
    }
  });
});

/**
 * F10-MANFIX-15 — con cuánto pagó el cliente. Solo existe en el EFECTIVO:
 * tarjeta y transferencia se cobran por el monto exacto fuera del sistema, y
 * un «recibido» ahí sería un dato inventado. Es opcional (una venta sin él se
 * cobra igual) y es un importe como los demás.
 */
describe("createSaleSchema con lo recibido (F10-MANFIX-15)", () => {
  const linea = { productId: "11111111-1111-4111-8111-111111111111", quantity: 1 };
  const cobrar = (body: Record<string, unknown>) =>
    createSaleSchema.safeParse({ lines: [linea], ...body });

  it("en efectivo acepta lo recibido, y también su ausencia", () => {
    expect(cobrar({ paymentMethod: "cash", cashReceived: 300 }).data).toMatchObject({
      cashReceived: 300,
    });
    expect(cobrar({ paymentMethod: "cash", cashReceived: 243.5 }).success).toBe(true);
    expect(cobrar({ paymentMethod: "cash" }).success).toBe(true);
  });

  it("con tarjeta o transferencia rebota: ahí no se recibe nada que contar", () => {
    for (const paymentMethod of ["card", "transfer"]) {
      const r = cobrar({ paymentMethod, cashReceived: 100 });
      expect(r.success).toBe(false);
      expect(JSON.stringify(r.error?.issues)).toContain("pos.cash_received_only_cash");
    }
  });

  it("rechaza negativos, tres decimales, más que el tope y texto, con su clave", () => {
    for (const cashReceived of [-1, 50.005, MONEY_MAX + 1, "300"]) {
      const r = cobrar({ paymentMethod: "cash", cashReceived });
      expect(r.success).toBe(false);
      expect(JSON.stringify(r.error?.issues)).toContain("pos.cash_received_invalid");
    }
  });
});
