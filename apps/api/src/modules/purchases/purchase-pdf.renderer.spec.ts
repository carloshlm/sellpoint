import { buildPurchaseDefinition, type PdfPurchaseInput } from "./purchase-pdf.renderer";

/**
 * F9-PURCH-09 — el papel de la compra, sobre el `docDefinition` (el mismo
 * molde que `document-pdf.renderer.spec.ts`): se afirma lo que el papel DICE,
 * sin generar el binario.
 *
 * Lo que fija: el descuadre contra el total declarado se imprime con su
 * diferencia y desaparece cuando cuadra; los cargos salen en su propio
 * bloque; una compra anulada lleva marca de agua; y los importes van sin
 * símbolo, con la moneda dicha al pie.
 */
const t = (key: string) => key;

const base: PdfPurchaseInput = {
  tenant: {
    name: "Mi Negocio",
    legalName: "DISTRIBUIDORA DEL NORTE S.A. DE C.V.",
    address: "Av. Siempre Viva 742",
    phone: "+525512345678",
    timezone: "America/Mexico_City",
    showBusinessName: true,
    showAddress: true,
    showPhone: true,
    country: "MX",
    currency: "MXN",
  },
  purchase: {
    folio: "COM-000042",
    status: "confirmed",
    supplierName: "Distribuidora Norte",
    supplierTaxId: "DNO900101AB1",
    warehouseName: "Central",
    purchaseDate: "2026-09-11",
    receivedDate: null,
    supplierInvoice: "A-4471",
    taxMode: "excluded",
    subtotal: "1000",
    discount: "0",
    taxTotal: "160",
    extraChargesTotal: "0",
    total: "1160",
    declaredTotal: null,
    notes: null,
    entryFolio: null,
  },
  lines: [
    {
      lineNo: 1,
      sku: "PAR-500",
      description: "Paracetamol 500 mg",
      presentationName: "Caja ×12",
      quantity: "10",
      unitCost: "100",
      discount: "0",
      taxAmount: "160",
      lineTotal: "1160",
      lotCode: null,
      expiresAt: null,
    },
  ],
  charges: [],
  taxes: [{ code: "IVA", name: "IVA 16%", rate: "16", base: "1000", amount: "160" }],
  locale: "es",
};

/** Todo el texto del documento, aplanado: lo que una persona leería. */
function textos(nodo: unknown): string[] {
  if (nodo === null || nodo === undefined) return [];
  if (typeof nodo === "string") return [nodo];
  if (Array.isArray(nodo)) return nodo.flatMap(textos);
  if (typeof nodo === "object") {
    return Object.entries(nodo as Record<string, unknown>).flatMap(([clave, valor]) =>
      clave === "style" || clave === "layout" ? [] : textos(valor),
    );
  }
  return [];
}
const papel = (input: PdfPurchaseInput) => textos(buildPurchaseDefinition(input, t)).join(" | ");

describe("buildPurchaseDefinition (F9-PURCH-09)", () => {
  it("imprime el folio, el proveedor con su registro fiscal y la factura del papel", () => {
    const texto = papel(base);

    expect(texto).toContain("COM-000042");
    expect(texto).toContain("Distribuidora Norte");
    expect(texto).toContain("DNO900101AB1");
    expect(texto).toContain("A-4471");
    // Los importes van sin símbolo y la moneda se dice una vez, al pie.
    expect(texto).toContain("pdf.currency");
    expect(texto).toContain("MXN");
    expect(texto).not.toContain("$1,160");
  });

  it("con un total declarado DISTINTO aparece la leyenda con la diferencia", () => {
    const texto = papel({
      ...base,
      purchase: { ...base.purchase, declaredTotal: "1200" },
    });

    expect(texto).toContain("pdf.purchase.declaredTotal");
    // La leyenda lleva la diferencia real: 1200 − 1160 = 40.
    expect(texto).toContain("pdf.purchase.mismatch 40.00");
  });

  it("cuando el papel CUADRA, no hay leyenda de descuadre", () => {
    const texto = papel({
      ...base,
      purchase: { ...base.purchase, declaredTotal: "1160" },
    });

    expect(texto).toContain("pdf.purchase.declaredTotal");
    expect(texto).not.toContain("pdf.purchase.mismatch");
  });

  it("«1160.00» y «1160» son el mismo importe: no inventa un descuadre", () => {
    const texto = papel({
      ...base,
      purchase: { ...base.purchase, declaredTotal: "1160.00", total: "1160" },
    });

    expect(texto).not.toContain("pdf.purchase.mismatch");
  });

  it("los cargos van en su propio bloque y suman aparte de la mercancía", () => {
    const texto = papel({
      ...base,
      purchase: { ...base.purchase, extraChargesTotal: "232", total: "1392", taxTotal: "192" },
      charges: [{ description: "Flete", amount: "200", taxAmount: "32", lineTotal: "232" }],
      taxes: [{ code: "IVA", name: "IVA 16%", rate: "16", base: "1200", amount: "192" }],
    });

    expect(texto).toContain("pdf.purchase.chargesTitle");
    expect(texto).toContain("Flete");
    expect(texto).toContain("pdf.purchase.charges");
    // El subtotal sigue siendo la MERCANCÍA: el cargo no es mercancía.
    expect(texto).toContain("1,000.00");
  });

  it("una compra ANULADA lleva marca de agua, y una confirmada no", () => {
    const anulada = buildPurchaseDefinition(
      { ...base, purchase: { ...base.purchase, status: "canceled" } },
      t,
    ) as { watermark?: unknown };
    expect(anulada.watermark).toMatchObject({ text: "pdf.purchase.canceled" });

    const confirmada = buildPurchaseDefinition(base, t) as { watermark?: unknown };
    expect(confirmada.watermark).toBeUndefined();
  });

  it("con lotes la tabla gana sus dos columnas; sin lotes, no las pinta", () => {
    const conLote = papel({
      ...base,
      lines: [
        {
          ...(base.lines[0] as PdfPurchaseInput["lines"][number]),
          lotCode: "L-2026",
          expiresAt: "2027-01-31",
        },
      ],
    });
    expect(conLote).toContain("pdf.lot");
    expect(conLote).toContain("L-2026");
    expect(conLote).toContain("2027-01-31");

    expect(papel(base)).not.toContain("pdf.lot");
  });

  it("dice el folio de la entrada de inventario cuando la compra ya la generó", () => {
    const texto = papel({
      ...base,
      purchase: { ...base.purchase, entryFolio: "ENT-000012" },
    });

    expect(texto).toContain("pdf.purchase.entry");
    expect(texto).toContain("ENT-000012");
  });
});
