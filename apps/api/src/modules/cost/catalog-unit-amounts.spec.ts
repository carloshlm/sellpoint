import { Prisma } from "../../generated/prisma/client";
import { type CatalogPresentation, catalogUnitAmounts } from "./catalog-unit-amounts";

const presentacion = (parcial: Partial<CatalogPresentation>): CatalogPresentation => ({
  id: "a",
  productId: "p1",
  factor: new Prisma.Decimal(1),
  isDefaultSale: false,
  price: null,
  cost: null,
  createdAt: new Date("2026-01-01T00:00:00.000Z"),
  ...parcial,
});
const dinero = (valor: string) => new Prisma.Decimal(valor);

/**
 * Carlos (2026-11-14): el reporte de stock muestra el costo y el precio «que
 * tenemos en el catálogo de productos por unidad base».
 */
describe("el costo y el precio del catálogo por unidad base", () => {
  it("salen de la presentación base (factor 1), aunque la predeterminada sea la caja", () => {
    const montos = catalogUnitAmounts([
      presentacion({ id: "pieza", price: dinero("15.00"), cost: dinero("9.50") }),
      presentacion({
        id: "caja",
        factor: new Prisma.Decimal(12),
        isDefaultSale: true,
        price: dinero("150.00"),
        cost: dinero("100.00"),
      }),
    ]);

    expect(montos.get("p1")?.price?.toFixed(2)).toBe("15.00");
    expect(montos.get("p1")?.cost?.toFixed(2)).toBe("9.50");
  });

  it("si la base no los tiene, se reparten los de la predeterminada entre su factor", () => {
    const montos = catalogUnitAmounts([
      presentacion({ id: "pieza" }),
      presentacion({
        id: "tarima",
        factor: new Prisma.Decimal(144),
        price: dinero("1300.00"),
        cost: dinero("1000.00"),
      }),
      presentacion({
        id: "caja",
        factor: new Prisma.Decimal(12),
        isDefaultSale: true,
        price: dinero("120.00"),
        cost: dinero("90.00"),
      }),
    ]);

    expect(montos.get("p1")?.price?.toFixed(2)).toBe("10.00");
    expect(montos.get("p1")?.cost?.toFixed(2)).toBe("7.50");
  });

  it("el costo y el precio se buscan por separado: cada uno donde esté capturado", () => {
    const montos = catalogUnitAmounts([
      presentacion({ id: "pieza", cost: dinero("4.00") }),
      presentacion({ id: "caja", factor: new Prisma.Decimal(10), price: dinero("80.00") }),
    ]);

    expect(montos.get("p1")?.cost?.toFixed(2)).toBe("4.00");
    expect(montos.get("p1")?.price?.toFixed(2)).toBe("8.00");
  });

  it("sin predeterminada ni base, manda la presentación más chica", () => {
    const montos = catalogUnitAmounts([
      presentacion({ id: "tarima", factor: new Prisma.Decimal(100), price: dinero("900.00") }),
      presentacion({ id: "caja", factor: new Prisma.Decimal(10), price: dinero("100.00") }),
    ]);

    expect(montos.get("p1")?.price?.toFixed(2)).toBe("10.00");
  });

  it("lo que no está capturado queda en null, no en cero, y cada producto va aparte", () => {
    const montos = catalogUnitAmounts([
      presentacion({ id: "a", productId: "p1" }),
      presentacion({ id: "b", productId: "p2", price: dinero("0.00") }),
    ]);

    expect(montos.get("p1")).toEqual({ cost: null, price: null });
    // Cero SÍ es un dato: «lo regalo» no es «no sé cuánto vale».
    expect(montos.get("p2")?.price?.toFixed(2)).toBe("0.00");
    expect(montos.get("p2")?.cost).toBeNull();
    expect(montos.has("p3")).toBe(false);
  });
});
