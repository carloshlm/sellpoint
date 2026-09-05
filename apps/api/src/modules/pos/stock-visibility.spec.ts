import type { LookupItem } from "./lookup.strategies";
import { hideStock, hideStockFromItem } from "./stock-visibility";

/**
 * F4-POSVIS — con «Mostrar existencias en el punto de venta» apagado, el API
 * NO manda la existencia: `available` y `expired` viajan en `null`. Solo en
 * los productos; servicios, cotizaciones y conceptos no tienen anaquel.
 */
describe("hideStock (F4-POSVIS)", () => {
  const producto: LookupItem = {
    type: "product",
    matchedBy: "name",
    id: "p1",
    sku: "SKU-1",
    name: "Agua",
    baseUnit: "unit",
    allowFractionalInput: false,
    available: "22",
    expired: "3",
    presentations: [],
  } as unknown as LookupItem;
  const servicio: LookupItem = {
    type: "service",
    matchedBy: "name",
    id: "s1",
    code: "CORTE",
    name: "Corte",
    price: "150",
  } as unknown as LookupItem;

  it("a un producto le quita available y expired, y conserva todo lo demás", () => {
    expect(hideStockFromItem(producto)).toEqual({
      ...producto,
      available: null,
      expired: null,
    });
  });

  it("un servicio pasa intacto", () => {
    expect(hideStockFromItem(servicio)).toBe(servicio);
  });

  it("hideStock recorre la lista sin cambiar el orden", () => {
    expect(hideStock([producto, servicio]).map((i) => i.id)).toEqual(["p1", "s1"]);
    expect(hideStock([producto, servicio])[0]).toMatchObject({ available: null });
  });
});
