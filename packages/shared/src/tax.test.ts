import { describe, expect, it } from "vitest";
import { MONEY_MAX } from "./money";
import {
  MAX_TAX_COMPONENTS,
  rateToScaled,
  splitLineTax,
  TAX_MODES,
  TAX_RATE_SCALE,
  taxModeSchema,
} from "./tax";

/**
 * F4-TAX-02 — la aritmética del impuesto vive UNA vez y en enteros.
 *
 * La usan el API (Decimal ⇄ centavos) y el carrito del web: si cada lado
 * dividiera por su cuenta, el cajero y el papel discutirían un centavo.
 * Los casos son los de los tres mercados: México incluido, Canadá con dos
 * componentes (y el 9.975 de Quebec, que exige cuatro decimales), y el
 * exento, que existe en todos.
 */
const GST = { code: "GST", name: "GST 5%", rate: "5" };
const PST = { code: "PST", name: "PST 7%", rate: "7" };
const QST = { code: "QST", name: "QST 9.975%", rate: "9.975" };
const IVA = { code: "IVA", name: "IVA 16%", rate: "16" };

describe("el contrato", () => {
  it("dos modos y nada más: el precio trae el impuesto, o se agrega", () => {
    expect(TAX_MODES).toEqual(["included", "excluded"]);
    expect(taxModeSchema.parse("included")).toBe("included");
    expect(() => taxModeSchema.parse("gross")).toThrow();
    expect(TAX_RATE_SCALE).toBe(4);
    expect(MAX_TAX_COMPONENTS).toBe(4);
  });

  it("la tasa se escala a diezmilésimas de por ciento: 16% → 160000, 9.975% → 99750", () => {
    expect(rateToScaled("16")).toBe(160000n);
    expect(rateToScaled("9.975")).toBe(99750n);
    expect(rateToScaled("0")).toBe(0n);
    expect(rateToScaled("16.0000")).toBe(160000n);
  });

  it("una tasa con más de cuatro decimales, negativa o mayor a 100 no es una tasa", () => {
    for (const mala of ["9.97501", "-1", "100.0001", "abc", ""]) {
      expect(() => rateToScaled(mala)).toThrow();
    }
  });
});

describe("splitLineTax — el precio YA incluye el impuesto (México)", () => {
  it("de $116.00 al 16%, $100.00 es base y $16.00 impuesto", () => {
    const r = splitLineTax({ amountCents: 11600, mode: "included", components: [IVA] });
    expect(r).toEqual({
      netCents: 10000,
      taxCents: 1600,
      byComponent: [{ code: "IVA", taxCents: 1600 }],
    });
  });

  it("con dos componentes la suma por componente es EXACTAMENTE el impuesto: el último absorbe el residuo", () => {
    // 10000 centavos con 5% + 7%: base = 10000 / 1.12 = 8928.57 → 8929; impuesto 1071.
    // Proporcional: GST 446.25 → 446, PST 624.75 → 625 = 1071. Y si no cuadrara, el último lo absorbe.
    const r = splitLineTax({ amountCents: 10000, mode: "included", components: [GST, PST] });
    expect(r.netCents + r.taxCents).toBe(10000);
    expect(r.byComponent.reduce((acc, c) => acc + c.taxCents, 0)).toBe(r.taxCents);
    expect(r.byComponent.map((c) => c.code)).toEqual(["GST", "PST"]);
  });

  it("un residuo de un centavo cae en el último componente, no se pierde", () => {
    // 1 centavo al 5% + 7%: base 1/1.12 = 0.89 → 1; impuesto 0. Y 3 centavos: base 2.68 → 3, impuesto 0.
    // 101 centavos: base 90.18 → 90; impuesto 11; GST 4.58 → 5, PST 6.42 → 6 = 11 ✓.
    // 1234 centavos: base 1101.79 → 1102; impuesto 132; GST 55 (55.08), PST 77 (77.12) = 132 ✓.
    // Se busca un caso donde el reparto proporcional NO cuadre solo: 121 centavos.
    // base 108.04 → 108; impuesto 13; GST 5.42 → 5; PST 7.58 → 8 = 13 ✓ (cuadra).
    // Se fija la PROPIEDAD sobre un barrido: en todo importe la suma por componente es el impuesto.
    for (let cents = 0; cents <= 3000; cents += 7) {
      const r = splitLineTax({ amountCents: cents, mode: "included", components: [GST, PST, QST] });
      expect(r.byComponent.reduce((acc, c) => acc + c.taxCents, 0)).toBe(r.taxCents);
      expect(r.netCents + r.taxCents).toBe(cents);
    }
  });
});

describe("splitLineTax — el impuesto se agrega al cobrar (Canadá, EE. UU.)", () => {
  it("$70.00 netos con GST 5% + PST 7% pagan $3.50 + $4.90", () => {
    const r = splitLineTax({ amountCents: 7000, mode: "excluded", components: [GST, PST] });
    expect(r).toEqual({
      netCents: 7000,
      taxCents: 840,
      byComponent: [
        { code: "GST", taxCents: 350 },
        { code: "PST", taxCents: 490 },
      ],
    });
  });

  it("Quebec: 9.975% de $100.00 son $9.98, medio centavo hacia arriba", () => {
    const r = splitLineTax({ amountCents: 10000, mode: "excluded", components: [GST, QST] });
    expect(r.byComponent).toEqual([
      { code: "GST", taxCents: 500 },
      { code: "QST", taxCents: 998 },
    ]);
    expect(r.taxCents).toBe(1498);
  });

  it("el medio centavo sube, no baja: $0.10 al 5% son $0.01 (0.005 → 1)", () => {
    const r = splitLineTax({ amountCents: 10, mode: "excluded", components: [GST] });
    expect(r.taxCents).toBe(1);
  });
});

describe("splitLineTax — los bordes", () => {
  it("exento (sin componentes) y tasa cero dan impuesto cero en los dos modos", () => {
    for (const mode of TAX_MODES) {
      expect(splitLineTax({ amountCents: 11600, mode, components: [] })).toEqual({
        netCents: 11600,
        taxCents: 0,
        byComponent: [],
      });
      const cero = splitLineTax({
        amountCents: 11600,
        mode,
        components: [{ code: "VAT0", name: "IVA 0%", rate: "0" }],
      });
      expect(cero.taxCents).toBe(0);
      expect(cero.byComponent).toEqual([{ code: "VAT0", taxCents: 0 }]);
    }
  });

  it("importe cero da todo cero", () => {
    const r = splitLineTax({ amountCents: 0, mode: "excluded", components: [GST, PST] });
    expect(r).toEqual({
      netCents: 0,
      taxCents: 0,
      byComponent: [
        { code: "GST", taxCents: 0 },
        { code: "PST", taxCents: 0 },
      ],
    });
  });

  it("el techo de la columna (MONEY_MAX en centavos) no pierde precisión: por eso bigint", () => {
    const tope = Math.round(MONEY_MAX * 100); // 99_999_999_999_999
    const r = splitLineTax({ amountCents: tope, mode: "excluded", components: [IVA] });
    // 16% exacto de 99 999 999 999 999 = 15 999 999 999 999.84 → 16 000 000 000 000
    expect(r.taxCents).toBe(16_000_000_000_000);
    expect(r.netCents).toBe(tope);
    expect(Number.isSafeInteger(r.taxCents)).toBe(true);
  });

  it("más de cuatro componentes o un importe negativo se rechazan", () => {
    expect(() =>
      splitLineTax({ amountCents: 100, mode: "excluded", components: [GST, PST, QST, IVA, IVA] }),
    ).toThrow();
    expect(() => splitLineTax({ amountCents: -1, mode: "excluded", components: [GST] })).toThrow();
    expect(() => splitLineTax({ amountCents: 1.5, mode: "excluded", components: [GST] })).toThrow();
  });
});
