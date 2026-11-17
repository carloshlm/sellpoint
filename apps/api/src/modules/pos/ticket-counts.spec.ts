import type { TicketRow } from "./ticket.renderer";
import { contarTicket } from "./ticket-counts";

/**
 * Filas, unidades y servicios al pie del ticket (Carlos, 2026-11-16).
 *
 * Un cliente pidió el número de filas y de piezas. Lo que se decidió:
 * - **Filas**: los renglones del ticket, de cualquier tipo.
 * - **Unidades**: lo que el cliente se lleva en la bolsa, contado como se
 *   vendió. Cada pieza o caja cuenta 1; lo de a granel, 1 por renglón.
 * - **Servicios**: servicios y conceptos, por su cantidad. No van en la bolsa.
 */
describe("contarTicket", () => {
  const producto = (quantity: string, baseUnit: string, factor?: string): TicketRow => ({
    kind: "product",
    description: "Producto",
    quantity,
    baseUnit,
    presentation: factor === undefined ? null : { name: "Paquete", factor },
    unitPrice: "1.00",
    lineTotal: "1.00",
    lotCode: null,
    taxGroupCode: null,
  });
  const servicio = (quantity: string): TicketRow => ({
    ...producto(quantity, "unit"),
    kind: "service",
    baseUnit: null,
  });
  const concepto = (quantity: string): TicketRow => ({
    ...servicio(quantity),
    kind: "concept",
  });

  it("la captura de Carlos: 4 Agua, 2 Advil y 1 consulta → 3 filas, 6 unidades, 1 servicio", () => {
    expect(contarTicket([producto("4", "unit"), producto("2", "unit"), servicio("1")])).toEqual({
      lines: 3,
      units: "6",
      services: "1",
    });
  });

  it("la venta mezclada: 4 Agua, 2 Advil, 2 Caja ×12, 0.750 kg jitomate, 1 consulta → 5, 9, 1", () => {
    expect(
      contarTicket([
        producto("4", "unit"),
        producto("2", "unit"),
        producto("2", "unit", "12"),
        producto("0.75", "kg"),
        servicio("1"),
      ]),
    ).toEqual({ lines: 5, units: "9", services: "1" });
  });

  it("una caja con 12 cuenta por cajas, no por piezas sueltas", () => {
    expect(contarTicket([producto("2", "unit", "12")]).units).toBe("2");
  });

  it("lo de a granel cuenta 1 por renglón, aunque sean 2 kg justos", () => {
    expect(
      contarTicket([producto("0.75", "kg"), producto("2", "kg"), producto("1.5", "m")]).units,
    ).toBe("3");
  });

  it("un paquete de algo que se pesa (2 Bolsa 10Kg) cuenta por bolsas", () => {
    expect(contarTicket([producto("2", "kg", "10")]).units).toBe("2");
  });

  it("una caja vendida en fracción cuenta 1", () => {
    expect(contarTicket([producto("1.5", "unit", "12")]).units).toBe("1");
  });

  it("una presentación de factor 1 es la pieza de siempre", () => {
    expect(contarTicket([producto("3", "unit", "1")]).units).toBe("3");
  });

  it("los conceptos cuentan como servicios, por su cantidad", () => {
    expect(contarTicket([servicio("2"), concepto("1")])).toEqual({
      lines: 2,
      units: "0",
      services: "3",
    });
  });

  it("sin renglones, todo en cero", () => {
    expect(contarTicket([])).toEqual({ lines: 0, units: "0", services: "0" });
  });
});
