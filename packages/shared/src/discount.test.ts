import { describe, expect, it } from "vitest";
import { discountCapCents, isDiscountCode, prorateDiscountCents } from "./discount";

/** F4-DISC — el prorrateo exacto en centavos y la forma del PIN. */
describe("prorateDiscountCents", () => {
  it("reparte en proporción y coloca los centavos sobrantes en las fracciones más grandes", () => {
    // 10.00 entre 30.00 y 60.00 → 3.33 y 6.67 (la fracción .666 se lleva el centavo).
    expect(prorateDiscountCents(1000, [3000, 6000])).toEqual([333, 667]);
    // 1.00 entre tres iguales: 0.34, 0.33, 0.33 (empate → la primera).
    expect(prorateDiscountCents(100, [1000, 1000, 1000])).toEqual([34, 33, 33]);
  });

  it("la suma es exacta y ninguna línea recibe más que su importe", () => {
    const partes = prorateDiscountCents(9999, [5, 12345, 1, 700]);
    expect(partes.reduce((a, b) => a + b, 0)).toBe(9999);
    expect(partes[0]).toBeLessThanOrEqual(5);
    expect(partes[2]).toBeLessThanOrEqual(1);
    expect(prorateDiscountCents(13051, [13051])).toEqual([13051]);
  });

  it("sin descuento, sin importes o con importes en cero reparte ceros", () => {
    expect(prorateDiscountCents(0, [100, 200])).toEqual([0, 0]);
    expect(prorateDiscountCents(500, [])).toEqual([]);
    expect(prorateDiscountCents(500, [0, 0])).toEqual([0, 0]);
    expect(prorateDiscountCents(50, [0, 100])).toEqual([0, 50]);
  });
});

describe("isDiscountCode y discountCapCents", () => {
  it("el PIN es de 4 a 8 dígitos", () => {
    expect(isDiscountCode("1234")).toBe(true);
    expect(isDiscountCode("12345678")).toBe(true);
    expect(isDiscountCode("123")).toBe(false);
    expect(isDiscountCode("123456789")).toBe(false);
    expect(isDiscountCode("12a4")).toBe(false);
  });

  it("el tope es el porcentaje del subtotal redondeado al centavo; sin tope, null", () => {
    expect(discountCapCents(25300, 20)).toBe(5060);
    expect(discountCapCents(999, 12.5)).toBe(125);
    expect(discountCapCents(25300, null)).toBeNull();
  });
});
