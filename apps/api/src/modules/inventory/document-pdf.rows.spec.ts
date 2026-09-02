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
  const movimiento = (direction: "entry" | "exit", quantity: string) => ({
    quantity: new Prisma.Decimal(quantity),
    direction,
    unitCost: null,
    location: "O-01-02",
    product: producto,
    presentation: null,
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

  it("una entrada confirmada sí sale de sus movimientos, uno por lote", () => {
    const rows = pdfRowsFor({
      type: "entry",
      status: "confirmed",
      lines: [linea],
      movements: [movimiento("entry", "120"), movimiento("entry", "80")],
    });

    expect(rows.map((r) => r.quantityBase)).toEqual(["120", "80"]);
  });
});
