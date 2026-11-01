import { Prisma } from "../../generated/prisma/client";
import { pdfRowsFor } from "./document-pdf.service";

/**
 * Carlos (2026-09-02): el PDF de un inventario físico CONFIRMADO salía con
 * teórico y contado vacíos y el doble de filas. Un confirmado se armaba con
 * sus movimientos —lo correcto para entradas y salidas, donde FEFO puede
 * partir una línea en varios lotes—, pero un conteo asienta DOS movimientos
 * por línea (salida del teórico, entrada de lo contado) y ninguno sabe qué
 * se contó. El papel de un conteo son sus líneas, siempre.
 */
describe("pdfRowsFor", () => {
  const producto = { sku: "A-1", name: "Jabón", baseUnit: "unit" };
  const linea = {
    lineNo: 1,
    productId: "p1",
    quantity: new Prisma.Decimal("200"),
    theoretical: null,
    counted: new Prisma.Decimal("185"),
    unitCost: null,
    lotCode: "ST1",
    expiresAt: new Date("2026-09-30"),
    location: "O-01-02",
    product: producto,
    presentation: null,
  };
  const movimiento = (
    direction: "entry" | "exit",
    quantity: string,
    presentation: { name: string; factor: Prisma.Decimal } | null = null,
  ) => ({
    productId: "p1",
    quantity: new Prisma.Decimal(quantity),
    direction,
    unitCost: null,
    location: "O-01-02",
    product: producto,
    presentation,
    lot: { lotCode: "ST1", expiresAt: new Date("2026-09-30") },
  });

  it("un conteo confirmado usa sus líneas: el teórico capturado y lo contado", () => {
    const rows = pdfRowsFor({
      type: "physical_count",
      status: "confirmed",
      lines: [linea],
      movements: [movimiento("exit", "200"), movimiento("entry", "185")],
    });

    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ theoretical: "200", counted: "185", lotCode: "ST1" });
  });

  /**
   * Carlos (2026-11-01), el Queso Oaxaca: la fila de los 33 kg sin lote se
   * subió vacía y su lote (ST2) se puso en pantalla, así que el teórico
   * capturado era el TOTAL del producto (448.8). El papel decía −415.8; la
   * aprobación hizo +33. El teórico de un confirmado es el que se aplicó.
   */
  it("un conteo confirmado imprime el teórico que se APLICÓ, no el capturado", () => {
    const rows = pdfRowsFor({
      type: "physical_count",
      status: "confirmed",
      lines: [
        {
          ...linea,
          lineNo: 1,
          lotCode: "ST2",
          quantity: new Prisma.Decimal("448.8"),
          counted: new Prisma.Decimal("33"),
        },
        {
          ...linea,
          lineNo: 2,
          lotCode: "ST1",
          quantity: new Prisma.Decimal("448.8"),
          counted: new Prisma.Decimal("448.8"),
        },
      ],
      movements: [{ ...movimiento("entry", "33"), lot: { lotCode: "ST2", expiresAt: null } }],
    });

    expect(rows.map((r) => [r.lotCode, r.theoretical, r.counted])).toEqual([
      ["ST2", "0", "33"],
      ["ST1", "448.8", "448.8"],
    ]);
  });

  it("un conteo anulado no movió nada: conserva el teórico que se vio al capturar", () => {
    const rows = pdfRowsFor({
      type: "physical_count",
      status: "canceled",
      lines: [linea],
      movements: [],
    });

    expect(rows[0]).toMatchObject({ theoretical: "200", counted: "185" });
  });

  it("una entrada confirmada sí sale de sus movimientos, uno por lote", () => {
    const rows = pdfRowsFor({
      type: "entry",
      status: "confirmed",
      lines: [linea],
      movements: [movimiento("entry", "120"), movimiento("entry", "80")],
    });

    expect(rows.map((r) => r.quantityBase)).toEqual(["120", "80"]);
  });

  /**
   * Carlos (2026-09-02, revisado): el movimiento se guarda en unidad base,
   * pero quien lee el papel capturó cajas. Con el factor se reconstruye lo
   * tecleado, igual que en el kardex.
   */
  it("un movimiento con presentación reconstruye lo tecleado con el factor", () => {
    const rows = pdfRowsFor({
      type: "entry",
      status: "confirmed",
      lines: [linea],
      movements: [movimiento("entry", "36", { name: "Caja ×12", factor: new Prisma.Decimal(12) })],
    });

    expect(rows[0]).toMatchObject({
      quantityInput: "3",
      quantityBase: "36",
      presentationName: "Caja ×12",
    });
  });
});
