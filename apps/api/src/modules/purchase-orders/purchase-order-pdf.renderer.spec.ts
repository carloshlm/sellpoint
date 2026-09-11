import {
  buildPurchaseOrderDefinition,
  type PdfPurchaseOrderInput,
} from "./purchase-order-pdf.renderer";

/**
 * F9-PO-06 — el papel de la orden, sobre el `docDefinition` (molde
 * `purchase-pdf.renderer.spec.ts`): se afirma lo que el papel DICE.
 *
 * Lo que fija: el pie trae el número de orden (la práctica «no PO, no pay»);
 * los impuestos van marcados como estimados; cerrada y anulada llevan marca
 * de agua y una emitida no; la fecha esperada y las condiciones salen cuando
 * existen; los importes van sin símbolo y con la moneda al pie.
 */
const t = (key: string) =>
  key === "pdf.purchaseOrder.footer"
    ? "Indique el número de orden {folio} en su factura y en su remisión."
    : key;

const base: PdfPurchaseOrderInput = {
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
  order: {
    folio: "OCO-000042",
    status: "open",
    supplierName: "Distribuidora Norte",
    supplierTaxId: "DNO900101AB1",
    warehouseName: "Central",
    orderDate: "2026-09-11",
    expectedDate: "2026-09-25",
    supplierReference: "COT-77",
    paymentTerms: "30 días",
    taxMode: "excluded",
    subtotal: "1000",
    discount: "0",
    taxTotal: "160",
    total: "1160",
    notes: null,
  },
  lines: [
    {
      lineNo: 1,
      sku: "PAR-500",
      description: "Paracetamol 500 mg",
      presentationName: "Caja ×12",
      quantityOrdered: "10",
      unitCost: "100",
      discount: "0",
      taxAmount: "160",
      lineTotal: "1160",
    },
  ],
  taxes: [{ code: "IVA", name: "IVA 16%", rate: "16", base: "1000", amount: "160" }],
  locale: "es",
};

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
const papel = (input: PdfPurchaseOrderInput) =>
  textos(buildPurchaseOrderDefinition(input, t)).join(" | ");

describe("el papel de la orden de compra (F9-PO-06)", () => {
  it("el pie pide el número de orden en la factura y la remisión, con el folio puesto", () => {
    expect(papel(base)).toContain(
      "Indique el número de orden OCO-000042 en su factura y en su remisión.",
    );
    expect(papel(base)).not.toContain("{folio}");
  });

  it("los impuestos van marcados como estimados y el total es el esperado", () => {
    const texto = papel(base);
    expect(texto).toContain("IVA 16% (16%) · pdf.purchaseOrder.estimated");
    // Entre etiqueta y valor se cuela el `alignment` al aplanar: se afirman por separado.
    expect(texto).toContain("pdf.purchaseOrder.total");
    expect(texto).toContain("1,160.00");
  });

  it("la fecha esperada, la referencia y las condiciones salen cuando existen, y no cuando no", () => {
    expect(papel(base)).toContain("pdf.purchaseOrder.expectedDate: 2026-09-25");
    expect(papel(base)).toContain("pdf.purchaseOrder.reference: COT-77");
    expect(papel(base)).toContain("pdf.purchaseOrder.terms: 30 días");
    const escueta = papel({
      ...base,
      order: { ...base.order, expectedDate: null, supplierReference: null, paymentTerms: null },
    });
    expect(escueta).not.toContain("pdf.purchaseOrder.expectedDate");
    expect(escueta).not.toContain("pdf.purchaseOrder.reference");
    expect(escueta).not.toContain("pdf.purchaseOrder.terms");
  });

  it("cerrada y anulada llevan marca de agua; emitida no", () => {
    const definicion = (status: string) =>
      buildPurchaseOrderDefinition({ ...base, order: { ...base.order, status } }, t) as {
        watermark?: { text: string };
      };
    expect(definicion("open").watermark).toBeUndefined();
    expect(definicion("partially_received").watermark).toBeUndefined();
    expect(definicion("closed").watermark?.text).toBe("pdf.purchaseOrder.closed");
    expect(definicion("canceled").watermark?.text).toBe("pdf.purchaseOrder.canceled");
  });

  it("los importes van sin símbolo y la moneda se dice al pie", () => {
    const texto = papel(base);
    expect(texto).not.toContain("$");
    expect(texto).toContain("pdf.currency: ");
    expect(texto).toContain("(MXN)");
  });
});
