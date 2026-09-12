import { describe, expect, it } from "vitest";
import { ALL_FOLIO_PREFIXES, PURCHASE_FOLIO_PREFIXES } from "./inventory";
import {
  PURCHASE_ORDER_STATUSES,
  PURCHASE_ORDER_VIEW_STATUSES,
  PURCHASE_RECEIPT_STATUSES,
  pendingQuantity,
  purchaseOrderStatusFrom,
  purchaseOrderStatusSchema,
  purchaseOrderViewStatus,
  receivedPercent,
} from "./purchase-orders";

/**
 * F9-PO-01 — los contratos de Órdenes de compra y el estado DERIVADO.
 *
 * El estado de una orden abierta no se guarda «a mano»: se deriva de sus
 * líneas después de cada recepción con UNA función pura, que es la única
 * fuente de verdad. `closed` y `canceled` son decisiones de una persona y
 * no salen de acá.
 */
describe("contratos de Órdenes de compra (F9-PO-01)", () => {
  it("los seis estados de la orden y los tres de la recepción", () => {
    expect(PURCHASE_ORDER_STATUSES).toEqual([
      "draft",
      "open",
      "partially_received",
      "received",
      "closed",
      "canceled",
    ]);
    expect(PURCHASE_RECEIPT_STATUSES).toEqual(["draft", "confirmed", "canceled"]);
    expect(purchaseOrderStatusSchema.parse("partially_received")).toBe("partially_received");
    expect(() => purchaseOrderStatusSchema.parse("confirmed")).toThrow();
  });

  it("las series OCO (orden) y RCP (recepción) son de tres letras y no chocan con nadie", () => {
    expect(PURCHASE_FOLIO_PREFIXES.order).toBe("OCO");
    expect(PURCHASE_FOLIO_PREFIXES.receipt).toBe("RCP");
    expect(ALL_FOLIO_PREFIXES).toContain("OCO");
    expect(ALL_FOLIO_PREFIXES).toContain("RCP");
    expect(new Set(ALL_FOLIO_PREFIXES).size).toBe(ALL_FOLIO_PREFIXES.length);
  });

  describe("pendingQuantity", () => {
    it("resta en decimal, sin `Number`, y nunca baja de cero", () => {
      expect(pendingQuantity("100", "60")).toBe("40");
      expect(pendingQuantity("100.5", "60.25")).toBe("40.25");
      expect(pendingQuantity("0.3", "0.1")).toBe("0.2");
      expect(pendingQuantity("100", "100")).toBe("0");
      // Recibir de más no deja un pendiente negativo: el API lo rebota antes.
      expect(pendingQuantity("100", "110")).toBe("0");
    });
  });

  describe("purchaseOrderStatusFrom", () => {
    const linea = (ordered: string, received: string, closedShort = false) => ({
      ordered,
      received,
      closedShort,
    });

    it("sin nada recibido, la orden sigue abierta", () => {
      expect(purchaseOrderStatusFrom([linea("100", "0")])).toBe("open");
      expect(purchaseOrderStatusFrom([linea("100", "0"), linea("50", "0")])).toBe("open");
    });

    it("con algo recibido en alguna línea, parcialmente recibida", () => {
      expect(purchaseOrderStatusFrom([linea("100", "60")])).toBe("partially_received");
      // Una línea completa y otra intacta: todavía falta la otra.
      expect(purchaseOrderStatusFrom([linea("100", "100"), linea("50", "0")])).toBe(
        "partially_received",
      );
    });

    it("con todas las líneas completas, recibida", () => {
      expect(purchaseOrderStatusFrom([linea("100", "100")])).toBe("received");
      expect(purchaseOrderStatusFrom([linea("100", "100"), linea("50", "50")])).toBe("received");
      expect(purchaseOrderStatusFrom([linea("2.5", "2.5")])).toBe("received");
    });

    it("una línea cerrada corta cuenta como terminada: el proveedor ya no surtirá el resto", () => {
      expect(purchaseOrderStatusFrom([linea("100", "60", true)])).toBe("received");
      expect(purchaseOrderStatusFrom([linea("100", "60", true), linea("50", "50")])).toBe(
        "received",
      );
      // Cerrada corta sin recibir nada + otra intacta: algo ya se decidió.
      expect(purchaseOrderStatusFrom([linea("100", "0", true), linea("50", "0")])).toBe(
        "partially_received",
      );
    });

    it("sin líneas no hay nada que derivar: abierta", () => {
      expect(purchaseOrderStatusFrom([])).toBe("open");
    });
  });
});

/** Carlos, 2026-09-12: «¿ya fue asignada a una compra?» y «¿qué porcentaje llegó?». */
describe("purchaseOrderViewStatus — «facturada» se deriva de las recepciones", () => {
  it("recibida con todas sus recepciones confirmadas facturadas → invoiced; cerrada con faltante también", () => {
    expect(
      purchaseOrderViewStatus("received", [{ status: "confirmed", purchaseStatus: "confirmed" }]),
    ).toBe("invoiced");
    expect(
      purchaseOrderViewStatus("closed", [
        { status: "confirmed", purchaseStatus: "draft" },
        { status: "canceled", purchaseStatus: null },
      ]),
    ).toBe("invoiced");
  });

  it("una recepción confirmada sin compra, o con la compra anulada, la deja recibida", () => {
    expect(
      purchaseOrderViewStatus("received", [
        { status: "confirmed", purchaseStatus: "confirmed" },
        { status: "confirmed", purchaseStatus: null },
      ]),
    ).toBe("received");
    expect(
      purchaseOrderViewStatus("received", [{ status: "confirmed", purchaseStatus: "canceled" }]),
    ).toBe("received");
  });

  it("sin recepciones confirmadas, o antes de terminar de recibir, el estado no cambia", () => {
    expect(purchaseOrderViewStatus("received", [])).toBe("received");
    expect(
      purchaseOrderViewStatus("partially_received", [
        { status: "confirmed", purchaseStatus: "confirmed" },
      ]),
    ).toBe("partially_received");
    expect(PURCHASE_ORDER_VIEW_STATUSES).toContain("invoiced");
  });
});

describe("receivedPercent", () => {
  it("suma todas las líneas: 9 de 10 y 10 de 10 son 95 %", () => {
    expect(
      receivedPercent([
        { ordered: "10", received: "9", closedShort: false },
        { ordered: "10", received: "10", closedShort: false },
      ]),
    ).toBe(95);
  });

  it("decimales, sin líneas y de más: 0.5 de 2 son 25 %; nada pedido es 0; 12 de 10 no pasa de 100", () => {
    expect(receivedPercent([{ ordered: "2", received: "0.5", closedShort: false }])).toBe(25);
    expect(receivedPercent([])).toBe(0);
    expect(receivedPercent([{ ordered: "10", received: "12", closedShort: false }])).toBe(100);
  });
});
