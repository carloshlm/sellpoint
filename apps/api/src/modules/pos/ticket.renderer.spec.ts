import { DEFAULT_TICKET_SETTINGS, TICKET_LOGO_SVG } from "@sellpoint/shared";
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
    },
    // Ya colapsado por el service (2026-08-26): almacén con fallback al tenant.
    header: { address: "Av. Siempre Viva 742", phone: "+525512345678" },
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
    settings: DEFAULT_TICKET_SETTINGS,
    logo: null,
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

    /**
     * El contacto del encabezado (2026-08-26) llega YA colapsado en `header`
     * (almacén con fallback al negocio — la regla vive en ticketHeaderContact
     * y se prueba allá). Acá solo se fija que el renderer lo pinta.
     */
    it("pinta la dirección y el teléfono del header", () => {
      const json = textos(buildTicketDefinition(base, t));

      expect(json).toContain("Av. Siempre Viva 742");
      expect(json).toContain("ticket.phone: +525512345678");
    });

    it("sin contacto no pinta líneas vacías (null y cadena en blanco)", () => {
      const sinContacto = textos(
        buildTicketDefinition({ ...base, header: { address: null, phone: null } }, t),
      );
      expect(sinContacto).not.toContain("ticket.phone");

      const enBlanco = textos(
        buildTicketDefinition({ ...base, header: { address: "   ", phone: "" } }, t),
      );
      expect(enBlanco).not.toContain("ticket.phone");
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
  /**
   * F4-TICKETCFG-05 — el papel obedece la configuración del negocio: cada
   * línea del encabezado sale solo con su toggle, el pie es el mensaje propio
   * si lo hay, y el logotipo va arriba de todo. La leyenda de la cotización no
   * se apaga con nada.
   */
  describe("la configuración del ticket (F4-TICKETCFG-05)", () => {
    const apagado = {
      ...DEFAULT_TICKET_SETTINGS,
      showBusinessName: false,
      showTaxId: false,
      showAddress: false,
      showPhone: false,
      showWarehouse: false,
    };

    it("con todo apagado el encabezado no dice negocio, RFC, dirección ni teléfono, y la fecha va sin almacén", () => {
      const json = textos(buildTicketDefinition({ ...base, settings: apagado }, t));
      expect(json).not.toContain("DISTRIBUIDORA DEL NORTE");
      expect(json).not.toContain("DNO010203AB4");
      expect(json).not.toContain("Av. Siempre Viva 742");
      expect(json).not.toContain("+525512345678");
      expect(json).not.toContain("Central");
      // Lo que no es del encabezado sigue: folio y vendedor.
      expect(json).toContain("VTA-000042");
      expect(json).toContain("Ana Ruiz");
    });

    it("con todo prendido (defaults) el encabezado sigue completo", () => {
      const json = textos(buildTicketDefinition(base, t));
      expect(json).toContain("DISTRIBUIDORA DEL NORTE");
      expect(json).toContain("DNO010203AB4");
      expect(json).toContain("Central");
    });

    it("el pie es el mensaje propio si lo hay; si no, el de fábrica", () => {
      const propio = textos(
        buildTicketDefinition(
          { ...base, settings: { ...DEFAULT_TICKET_SETTINGS, footerMessage: "Vuelva pronto" } },
          t,
        ),
      );
      expect(propio).toContain("Vuelva pronto");
      expect(propio).not.toContain("ticket.thanks");
      expect(textos(buildTicketDefinition(base, t))).toContain("ticket.thanks");
    });

    it("en la cotización la leyenda del precio sigue aunque haya mensaje propio", () => {
      const json = textos(
        buildTicketDefinition(
          {
            ...base,
            kind: "quote",
            settings: { ...DEFAULT_TICKET_SETTINGS, footerMessage: "Vuelva pronto" },
          },
          t,
        ),
      );
      expect(json).toContain("ticket.quoteDisclaimer");
      expect(json).toContain("Vuelva pronto");
    });

    it("el logotipo va ARRIBA: un preset como nodo svg, una imagen propia como nodo image, y sin logotipo nada", () => {
      const conSvg = buildTicketDefinition({ ...base, logo: { svg: TICKET_LOGO_SVG.pharmacy } }, t);
      const primero = (conSvg.content as Record<string, unknown>[])[0];
      expect(primero).toMatchObject({ svg: TICKET_LOGO_SVG.pharmacy, alignment: "center" });
      expect(typeof primero?.width).toBe("number");

      const conPng = buildTicketDefinition(
        { ...base, logo: { dataUrl: "data:image/png;base64,AAAA" } },
        t,
      );
      const primeroPng = (conPng.content as Record<string, unknown>[])[0];
      expect(primeroPng).toMatchObject({
        image: "data:image/png;base64,AAAA",
        alignment: "center",
      });

      // Sin logotipo el papel EMPIEZA por el encabezado; el código de barras
      // del pie también es un nodo svg, así que se mira el primer nodo.
      const sinLogo = (buildTicketDefinition(base, t).content as Record<string, unknown>[])[0];
      expect(sinLogo).toHaveProperty("text");
      expect(sinLogo).not.toHaveProperty("svg");
      expect(sinLogo).not.toHaveProperty("image");
    });

    it("el logotipo escala con el papel: más ancho en 80 mm que en 58 mm", () => {
      const ancho = (w: "58mm" | "80mm") =>
        (
          buildTicketDefinition({ ...base, width: w, logo: { svg: TICKET_LOGO_SVG.cafe } }, t)
            .content as { width: number }[]
        )[0]?.width ?? 0;
      expect(ancho("80mm")).toBeGreaterThan(ancho("58mm"));
    });
  });
});

/**
 * ── EL CÓDIGO DE BARRAS DEL FOLIO (2026-08-24, pedido de Carlos) ──────────
 *
 * Al pie del ticket, en Code-128 con el folio COMPLETO — alfanumérico, así
 * que no hay tope de dígitos ni reinicio de numeración que inventar. Va en
 * AMBOS papeles a propósito: escanear una cotización en el carrito ya carga
 * la cotización a la venta (quoteLookup), y escanear una venta la encuentra
 * en el historial por el buscador de folio.
 */
describe("el código de barras del folio", () => {
  const t = (key: string) => key;
  const fila: TicketRow = {
    description: "Paracetamol 500mg",
    quantity: "1",
    baseUnit: "unit",
    unitPrice: "15.00",
    lineTotal: "15.00",
    lotCode: null,
  };
  const base: TicketInput = {
    tenant: { name: "Mi Negocio", legalName: null, taxId: null },
    header: { address: null, phone: null },
    kind: "sale",
    folio: "VTA-000042",
    createdAt: new Date("2026-08-21T19:42:00Z"),
    sellerName: "Ana",
    warehouseName: "Central",
    rows: [fila],
    subtotal: "15.00",
    discount: "0.00",
    total: "15.00",
    paymentMethod: "cash",
    received: null,
    change: null,
    note: null,
    currency: "MXN",
    locale: "es",
    width: "58mm",
    settings: DEFAULT_TICKET_SETTINGS,
    logo: null,
  };

  /**
   * ── EL CÓDIGO DIARIO DE 12 DÍGITOS (2026-08-24, diseño de Carlos) ────
   *
   * La venta nueva trae `barcode` (202608240045): las barras codifican ESO y
   * el número se pinta VISIBLE debajo — como nodo de texto de pdfmake y no
   * `includetext` de bwip, para que el papel tenga una sola tipografía. La
   * venta vieja (barcode null) y la cotización caen a las barras del folio.
   */
  it("una venta CON código diario pinta sus barras y el número visible", () => {
    const def = JSON.stringify(buildTicketDefinition({ ...base, barcode: "202608240045" }, t));

    expect(def).toContain("<svg");
    expect(def).toContain("202608240045");
  });

  it("una venta VIEJA (sin código) cae a las barras del folio", () => {
    const def = JSON.stringify(buildTicketDefinition({ ...base, barcode: null }, t));

    expect(def).toContain("<svg");
    // El número diario no existe: no puede aparecer ni inventarse.
    expect(def).not.toContain("202608240045");
  });

  it("la VENTA lleva el código al pie", () => {
    const def = JSON.stringify(buildTicketDefinition(base, t));

    expect(def).toContain('"svg"');
    expect(def).toContain("<svg");
  });

  it("la COTIZACIÓN también: escanearla carga la cotización a la venta", () => {
    const def = JSON.stringify(
      buildTicketDefinition({ ...base, kind: "quote", folio: "COT-000003" }, t),
    );

    expect(def).toContain("<svg");
  });

  it("el ancho se deriva del papel, nunca es fijo", () => {
    // Regla del archivo: todo elemento de ancho fijo revienta el margen de
    // 58 mm. El nodo svg declara su width calculado desde el ancho útil.
    const def = buildTicketDefinition(base, t) as {
      content: ({ svg?: string; width?: number } | unknown)[];
    };
    const nodo = def.content.find(
      (item): item is { svg: string; width: number } =>
        typeof item === "object" && item !== null && "svg" in item,
    );

    expect(nodo).toBeDefined();
    expect(nodo?.width).toBeGreaterThan(0);
    // 58mm ≈ 164pt de página menos márgenes: el código no puede excederlo.
    expect(nodo?.width).toBeLessThanOrEqual(58 * 2.83 - 2 * 5 * 2.83);
  });
});
