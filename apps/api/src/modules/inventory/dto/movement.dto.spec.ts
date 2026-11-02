import { createEntrySchema, createExitSchema } from "./movement.dto";

/**
 * F3-CORE-02 — los DTOs aplican `REASON_RULES` con `superRefine`, así que la
 * MISMA tabla que hace reactivo al formulario valida en el servidor. Sin eso,
 * el front y el API discreparían y el usuario vería un 400 sobre un campo que
 * la pantalla nunca le pidió.
 *
 * Los errores salen **por ruta** (`lines.1.unitCost`, `reference`) porque el
 * formulario los pinta sobre la fila que falló (patrón `fieldErrorsOf`, F2).
 */
describe("DTOs de movimiento (F3-CORE-02)", () => {
  const UUID = "11111111-1111-4111-8111-111111111111";
  const linea = (extra: Record<string, unknown> = {}) => ({
    productId: UUID,
    quantity: 3,
    ...extra,
  });

  const entrada = (extra: Record<string, unknown> = {}) => ({
    warehouseId: UUID,
    reasonCode: "invoice",
    reference: "F-88213",
    lines: [linea({ unitCost: 10 }), linea({ unitCost: 5 })],
    ...extra,
  });

  const salida = (extra: Record<string, unknown> = {}) => ({
    warehouseId: UUID,
    reasonCode: "loss",
    reasonNote: "Se cayó una caja",
    lines: [linea()],
    ...extra,
  });

  const rutas = (result: { error?: { issues: { path: PropertyKey[] }[] } }) =>
    result.error?.issues.map((i) => i.path.join(".")) ?? [];

  describe("reglas por motivo", () => {
    it("una entrada por factura bien formada pasa", () => {
      expect(createEntrySchema.safeParse(entrada()).success).toBe(true);
    });

    it("`invoice` sin costo en la segunda línea marca ESA línea", () => {
      const result = createEntrySchema.safeParse(
        entrada({ lines: [linea({ unitCost: 10 }), linea()] }),
      );

      expect(result.success).toBe(false);
      expect(rutas(result)).toContain("lines.1.unitCost");
    });

    it("`invoice` sin referencia marca el campo, no la línea", () => {
      expect(rutas(createEntrySchema.safeParse(entrada({ reference: undefined })))).toContain(
        "reference",
      );
    });

    it("`consumption` exige el área o concepto en `reference`", () => {
      const result = createExitSchema.safeParse(
        salida({ reasonCode: "consumption", reasonNote: undefined }),
      );

      expect(rutas(result)).toContain("reference");
    });

    it("`adjustment` exige nota: ajustar sin explicar no se audita", () => {
      const result = createExitSchema.safeParse(
        salida({ reasonCode: "adjustment", reasonNote: undefined }),
      );

      expect(rutas(result)).toContain("reasonNote");
    });

    it("`transfer` exige el almacén destino", () => {
      const result = createExitSchema.safeParse(
        salida({ reasonCode: "transfer", reasonNote: undefined }),
      );

      expect(rutas(result)).toContain("linkedWarehouseId");
    });

    it("un motivo que el formulario no ofrece se rechaza en el enum", () => {
      expect(createExitSchema.safeParse(salida({ reasonCode: "sale" })).success).toBe(false);
      expect(createEntrySchema.safeParse(entrada({ reasonCode: "physical_count" })).success).toBe(
        false,
      );
    });
  });

  describe("cantidades", () => {
    it("rechaza cero y negativos: el signo lo pone la dirección", () => {
      expect(createExitSchema.safeParse(salida({ lines: [linea({ quantity: 0 })] })).success).toBe(
        false,
      );
      expect(createExitSchema.safeParse(salida({ lines: [linea({ quantity: -1 })] })).success).toBe(
        false,
      );
    });

    it("rechaza el quinto decimal, que la columna redondearía en silencio", () => {
      const result = createExitSchema.safeParse(salida({ lines: [linea({ quantity: 1.00005 })] }));

      expect(rutas(result)).toContain("lines.0.quantity");
    });

    it("acepta hasta cuatro decimales", () => {
      expect(
        createExitSchema.safeParse(salida({ lines: [linea({ quantity: 1.2345 })] })).success,
      ).toBe(true);
    });
  });

  describe("el cuerpo", () => {
    it("rechaza un movimiento sin líneas", () => {
      expect(createExitSchema.safeParse(salida({ lines: [] })).success).toBe(false);
    });

    it("rechaza más de 500 líneas: arriba de eso va por importación", () => {
      const muchas = Array.from({ length: 501 }, () => linea());

      expect(createExitSchema.safeParse(salida({ lines: muchas })).success).toBe(false);
    });

    it("rechaza un id que no es uuid", () => {
      expect(createExitSchema.safeParse(salida({ warehouseId: "abc" })).success).toBe(false);
    });
  });

  /**
   * La caducidad (Carlos, 2026-11-02): un lote se guardó con 0027-10-01. El
   * año va de 2000 a 2099 en cualquier movimiento, y una ENTRADA no trae
   * mercancía ya caducada; una salida sí puede nombrar un lote vencido.
   */
  describe("la caducidad", () => {
    const dia = (dias: number): string => {
      const d = new Date();
      d.setUTCHours(0, 0, 0, 0);
      d.setUTCDate(d.getUTCDate() + dias);
      return d.toISOString().slice(0, 10);
    };
    const conCaducidad = (expiresAt: string) => [
      linea({ unitCost: 10, lotCode: "M-1", expiresAt }),
    ];
    const mensajes = (result: { error?: { issues: { message: string }[] } }) =>
      result.error?.issues.map((i) => i.message) ?? [];

    it("el año 0027 se rechaza en la línea, también en una salida", () => {
      const entradaMala = createEntrySchema.safeParse(
        entrada({ lines: conCaducidad("0027-10-01") }),
      );
      const salidaMala = createExitSchema.safeParse(salida({ lines: conCaducidad("0027-10-01") }));

      expect(rutas(entradaMala)).toEqual(["lines.0.expiresAt"]);
      expect(mensajes(entradaMala)).toEqual(["inventory.expiry_year_out_of_range"]);
      expect(mensajes(salidaMala)).toEqual(["inventory.expiry_year_out_of_range"]);
    });

    it("una entrada con caducidad de ayer se rechaza; caducar hoy, no", () => {
      const ayer = createEntrySchema.safeParse(entrada({ lines: conCaducidad(dia(-1)) }));

      expect(rutas(ayer)).toEqual(["lines.0.expiresAt"]);
      expect(mensajes(ayer)).toEqual(["inventory.expiry_in_past"]);
      expect(createEntrySchema.safeParse(entrada({ lines: conCaducidad(dia(0)) })).success).toBe(
        true,
      );
    });

    it("una salida puede nombrar un lote que ya caducó", () => {
      expect(createExitSchema.safeParse(salida({ lines: conCaducidad(dia(-1)) })).success).toBe(
        true,
      );
    });
  });
});
