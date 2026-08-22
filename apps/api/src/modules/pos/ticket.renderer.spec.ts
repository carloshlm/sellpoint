import { buildTicketDefinition, type TicketInput, type TicketRow } from "./ticket.renderer";

/**
 * F4-TICKET-01 — el papel que el cliente se lleva.
 *
 * Se testea el `docDefinition`, no el binario: lo que importa es QUÉ dice el
 * papel, y comparar bytes de un PDF no lo responde. Mismo molde que
 * `document-pdf.renderer.spec.ts`.
 */
describe("buildTicketDefinition (F4-TICKET-01)", () => {
  const t = (key: string) => key;

  const fila: TicketRow = {
    description: "Paracetamol 500mg — Caja ×12",
    quantity: "2",
    baseUnit: "unit",
    unitPrice: "15.00",
    lineTotal: "30.00",
    lotCode: null,
  };

  const base: TicketInput = {
    tenant: {
      name: "Mi Negocio",
      legalName: "DISTRIBUIDORA DEL NORTE S.A. DE C.V.",
      taxId: "DNO010203AB4",
      address: "Av. Siempre Viva 742",
    },
    kind: "sale",
    folio: "VTA-000042",
    createdAt: new Date("2026-08-21T19:42:00Z"),
    sellerName: "Ana Ruiz",
    warehouseName: "Central",
    rows: [fila],
    subtotal: "30.00",
    discount: "0.00",
    total: "30.00",
    paymentMethod: "cash",
    received: "50.00",
    change: "20.00",
    note: null,
    currency: "MXN",
    locale: "es",
    width: "58mm",
  };

  const textos = (def: unknown): string => JSON.stringify(def);

  describe("el papel", () => {
    it("sale del ancho pedido y con alto AUTOMÁTICO", () => {
      const angosto = buildTicketDefinition(base, t) as { pageSize: { width: number } };
      const ancho = buildTicketDefinition({ ...base, width: "80mm" }, t) as {
        pageSize: { width: number; height: string };
      };

      expect(ancho.pageSize.width).toBeGreaterThan(angosto.pageSize.width);
      // Un ticket de tres líneas no puede salir con treinta centímetros de
      // papel en blanco abajo, que es lo que da un alto fijo.
      expect(ancho.pageSize.height).toBe("auto");
    });

    it("encabeza con la razón social y el RFC", () => {
      const json = textos(buildTicketDefinition(base, t));

      expect(json).toContain("DISTRIBUIDORA DEL NORTE");
      expect(json).toContain("DNO010203AB4");
    });

    it("el folio va siempre: es lo que la persona busca", () => {
      expect(textos(buildTicketDefinition(base, t))).toContain("VTA-000042");
    });
  });

  describe("las líneas", () => {
    /**
     * ⚠ Lecciones del 2026-08-20. La unidad se NOMBRA y la cantidad se formatea
     * según su categoría: nadie lee «unit» y nadie cuenta «2.0000» piezas.
     */
    it("nombra la unidad y no imprime su código", () => {
      const json = textos(buildTicketDefinition(base, t));

      expect(json).toContain("2 piezas");
      expect(json).not.toContain("2 unit");
    });

    it("una cantidad por peso lleva sus tres decimales", () => {
      const json = textos(
        buildTicketDefinition({ ...base, rows: [{ ...fila, baseUnit: "kg", quantity: "0.5" }] }, t),
      );

      expect(json).toContain("0.500 kilogramos");
    });

    /**
     * Un servicio no sale del anaquel: no tiene unidad base, y ponerle
     * «piezas» sería inventar una medida que nadie definió.
     */
    it("un servicio no lleva unidad", () => {
      const json = textos(
        buildTicketDefinition(
          { ...base, rows: [{ ...fila, description: "Consulta", baseUnit: null, quantity: "1" }] },
          t,
        ),
      );

      expect(json).not.toContain("1 piezas");
      expect(json).toContain("Consulta");
    });

    it("el lote sale impreso cuando FEFO eligió uno", () => {
      const json = textos(
        buildTicketDefinition({ ...base, rows: [{ ...fila, lotCode: "L-8823" }] }, t),
      );

      expect(json).toContain("L-8823");
    });

    it("sin lote no se imprime una etiqueta vacía", () => {
      expect(textos(buildTicketDefinition(base, t))).not.toContain("ticket.lot");
    });
  });

  describe("los totales", () => {
    it("muestra el total", () => {
      expect(textos(buildTicketDefinition(base, t))).toContain("$30.00");
    });

    it("sin descuento NO imprime la línea de subtotal: sería ruido", () => {
      const json = textos(buildTicketDefinition(base, t));

      expect(json).not.toContain("ticket.discount");
      expect(json).not.toContain("ticket.subtotal");
    });

    it("con descuento imprime subtotal y descuento", () => {
      const json = textos(buildTicketDefinition({ ...base, discount: "5.00", total: "25.00" }, t));

      expect(json).toContain("ticket.subtotal");
      expect(json).toContain("-$5.00");
    });

    it("con efectivo imprime el recibido y el vuelto", () => {
      const json = textos(buildTicketDefinition(base, t));

      expect(json).toContain("ticket.received");
      expect(json).toContain("$20.00");
    });
  });

  describe("la cotización se ve DISTINTA de un ticket", () => {
    const cotizacion: TicketInput = {
      ...base,
      kind: "quote",
      folio: "COT-000007",
      paymentMethod: null,
      received: null,
      change: null,
    };

    /**
     * ⚠ Decisión de Carlos. Sin la marca, el cliente vuelve con un papel que
     * parece un comprobante de pago por algo que nunca pagó.
     */
    it("lleva la marca COTIZACIÓN", () => {
      expect(textos(buildTicketDefinition(cotizacion, t))).toContain("ticket.quoteMark");
    });

    /**
     * ⚠ La leyenda es una decisión de NEGOCIO, no cortesía: los precios no se
     * congelan (F4-QUOTE-02), así que el papel tiene que decir que el final se
     * calcula en caja. Sin eso, el cliente vuelve en un mes reclamando un
     * número que el sistema ya no reconoce.
     */
    it("lleva la leyenda de que el precio final se calcula en caja", () => {
      const json = textos(buildTicketDefinition(cotizacion, t));

      expect(json).toContain("ticket.quoteDisclaimer");
      expect(json).not.toContain("ticket.thanks");
    });

    it("NO imprime método de pago, recibido ni vuelto: no se cobró nada", () => {
      const json = textos(buildTicketDefinition(cotizacion, t));

      expect(json).not.toContain("ticket.payment");
      expect(json).not.toContain("ticket.received");
      expect(json).not.toContain("ticket.change");
    });

    it("una venta NO lleva la marca ni la leyenda", () => {
      const json = textos(buildTicketDefinition(base, t));

      expect(json).not.toContain("ticket.quoteMark");
      expect(json).not.toContain("ticket.quoteDisclaimer");
    });
  });

  describe("el dinero y el idioma", () => {
    /**
     * Gotcha del 2026-07-16: ICU de Node 22 renderiza USD en locale `es` como
     * `USD 1,234.56` (código ISO + NBSP), no como `US$`. El expected se fija
     * empíricamente en vez de asumir el símbolo.
     */
    it("una moneda extranjera se renderiza como la da ICU, sin inventar el símbolo", () => {
      const json = textos(buildTicketDefinition({ ...base, currency: "USD" }, t));

      expect(json).toContain("USD");
      expect(json).not.toContain("US$");
    });

    it("en inglés la unidad se nombra en inglés", () => {
      const json = textos(buildTicketDefinition({ ...base, locale: "en" }, t));

      expect(json).toContain("2 pieces");
    });
  });
});
