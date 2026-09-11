import type { Purchase, PurchaseRow } from "@/lib/purchases/api";

/**
 * F9-PURCH — la compra de las pruebas del web: dos «Caja ×12» a $500 netos con
 * IVA 16 %, que suman $1,160 y cuadran con lo que dice el papel. Cada prueba
 * mueve SOLO lo que está probando (el descuadre, el estado, el lote).
 */
export function buildPurchaseRow(over: Partial<PurchaseRow> = {}): PurchaseRow {
  return {
    id: "p1",
    folio: "COM-000001",
    status: "confirmed",
    supplierId: "s1",
    supplierName: "Distribuidora Norte",
    warehouseId: "w1",
    warehouseName: "Central",
    purchaseDate: "2026-09-11",
    receivedDate: null,
    supplierInvoice: "A-4471",
    declaredTotal: "1160",
    subtotal: "1000",
    discount: "0",
    taxTotal: "160",
    total: "1160",
    extraChargesTotal: "0",
    taxMode: "excluded",
    notes: null,
    mismatch: false,
    difference: null,
    lineCount: 1,
    createdAt: "2026-09-11T18:00:00.000Z",
    confirmedAt: "2026-09-11T18:05:00.000Z",
    canceledAt: null,
    cancelReason: null,
    ...over,
  };
}

export function buildPurchase(over: Partial<Purchase> = {}): Purchase {
  return {
    ...buildPurchaseRow(),
    lines: [
      {
        id: "l1",
        lineNo: 1,
        productId: "prod-1",
        productSku: "SKU-1",
        presentationId: "pres-caja",
        presentationName: "Caja ×12",
        quantity: "2",
        unitCost: "500",
        unitCostNet: "500",
        discount: "0",
        taxGroupCode: "VAT16",
        taxAmount: "160",
        lineTotal: "1000",
        lotCode: null,
        expiresAt: null,
        description: "Guantes de nitrilo",
      },
    ],
    products: [
      {
        id: "prod-1",
        sku: "SKU-1",
        name: "Guantes de nitrilo",
        baseUnit: "pieza",
        tracksLots: false,
        presentations: [
          { id: "pres-caja", name: "Caja ×12", factor: "12", isPurchasable: true },
          { id: "pres-pieza", name: "Pieza", factor: "1", isPurchasable: true },
        ],
      },
    ],
    charges: [],
    taxes: [{ code: "VAT16", name: "IVA 16%", rate: "16", base: "1000", amount: "160" }],
    entry: null,
    ...over,
  };
}
