import type { PurchaseOrder, PurchaseOrderRow, PurchaseReceipt } from "@/lib/purchase-orders/api";

/**
 * F9-PO — la orden de las pruebas del web: 100 «Caja ×12» a $120 acordados
 * con IVA 16 % (total esperado $13,920), emitida y sin recibir. Cada prueba
 * mueve SOLO lo que está probando.
 */
export function buildPurchaseOrderRow(over: Partial<PurchaseOrderRow> = {}): PurchaseOrderRow {
  return {
    id: "po1",
    folio: "OCO-000001",
    status: "open",
    supplierId: "s1",
    supplierName: "Distribuidora Norte",
    warehouseId: "w1",
    warehouseName: "Central",
    orderDate: "2026-09-10",
    expectedDate: "2026-09-25",
    supplierReference: null,
    paymentTerms: null,
    taxMode: "excluded",
    subtotal: "12000",
    discount: "0",
    taxTotal: "1920",
    total: "13920",
    notes: null,
    lineCount: 1,
    createdAt: "2026-09-10T18:00:00.000Z",
    issuedAt: "2026-09-10T18:05:00.000Z",
    closedAt: null,
    canceledAt: null,
    cancelReason: null,
    ...over,
  };
}

export function buildPurchaseOrder(over: Partial<PurchaseOrder> = {}): PurchaseOrder {
  return {
    ...buildPurchaseOrderRow(),
    lines: [
      {
        id: "pol1",
        lineNo: 1,
        productId: "prod-1",
        productSku: "SKU-1",
        presentationId: "pres-caja",
        presentationName: "Caja ×12",
        quantityOrdered: "100",
        quantityReceived: "0",
        pending: "100",
        closedShort: false,
        unitCost: "120",
        discount: "0",
        taxGroupCode: "VAT16",
        taxAmount: "1920",
        lineTotal: "13920",
        description: "Guantes de nitrilo",
      },
    ],
    products: [
      {
        id: "prod-1",
        sku: "SKU-1",
        name: "Guantes de nitrilo",
        baseUnit: "pieza",
        presentations: [
          { id: "pres-caja", name: "Caja ×12", factor: "12", isPurchasable: true },
          { id: "pres-pieza", name: "Pieza", factor: "1", isPurchasable: true },
        ],
      },
    ],
    taxes: [{ code: "VAT16", name: "IVA 16%", rate: "16", base: "12000", amount: "1920" }],
    receipts: [],
    purchases: [],
    ...over,
  };
}

export function buildPurchaseReceipt(over: Partial<PurchaseReceipt> = {}): PurchaseReceipt {
  return {
    id: "rcp1",
    folio: "RCP-000001",
    status: "draft",
    purchaseOrderId: "po1",
    orderFolio: "OCO-000001",
    orderStatus: "open",
    receivedDate: "2026-09-11",
    packingSlip: null,
    notes: null,
    purchase: null,
    lines: [
      {
        id: "rl1",
        lineNo: 1,
        purchaseOrderLineId: "pol1",
        orderLineNo: 1,
        productId: "prod-1",
        productSku: "SKU-1",
        description: "Guantes de nitrilo",
        presentationName: "Caja ×12",
        tracksLots: true,
        quantityOrdered: "100",
        quantityReceived: "0",
        pending: "100",
        quantity: "100",
        lotCode: null,
        expiresAt: null,
        notes: null,
      },
    ],
    createdAt: "2026-09-11T18:00:00.000Z",
    confirmedAt: null,
    canceledAt: null,
    cancelReason: null,
    ...over,
  };
}
