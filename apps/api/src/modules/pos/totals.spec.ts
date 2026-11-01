import { UnprocessableEntityException } from "@nestjs/common";
import { Prisma } from "../../generated/prisma/client";
import { armarTotales, type GrupoResuelto, type LineaFacturable } from "./totals";

/**
 * F4-TAX-06/07 — el motor de totales. Primero la propiedad que hace segura la
 * migración de México: sin impuesto (o en modo incluido) los números son los
 * de siempre. Después, el impuesto en los dos modos y la igualdad de sumas
 * que sostiene el ticket.
 */
const D = (v: string | number) => new Prisma.Decimal(v);
const linea = (
  unitPrice: string,
  quantity: string,
  discount = "0",
  grupo: GrupoResuelto | null = null,
): LineaFacturable => ({
  unitPrice: D(unitPrice),
  quantity: D(quantity),
  discount: D(discount),
  grupo,
});
const IVA16: GrupoResuelto = {
  id: "g1",
  code: "VAT16",
  name: "IVA 16%",
  rates: [{ code: "VAT", name: "IVA 16%", rate: "16" }],
};
const GST_PST: GrupoResuelto = {
  id: "g2",
  code: "GST_PST",
  name: "GST 5% + PST 7%",
  rates: [
    { code: "GST", name: "GST 5%", rate: "5" },
    { code: "PST", name: "PST 7%", rate: "7" },
  ],
};
const EXENTO: GrupoResuelto = { id: "g3", code: "EXEMPT", name: "Exento", rates: [] };
const IVA0: GrupoResuelto = {
  id: "g4",
  code: "VAT0",
  name: "IVA 0%",
  rates: [{ code: "VAT", name: "IVA 0%", rate: "0" }],
};

/**
 * Carlos (2026-11-01), el ticket VTA-000033 de la farmacia: una venta con
 * productos al 0% (A) y al 16% (B) decía «IVA 0% $17.24». Los tres grupos de
 * IVA de México comparten el componente `VAT`, y el motor juntaba por código:
 * un solo renglón, con el nombre y la tasa del PRIMERO y la suma de todos.
 * Cada tasa es su propio renglón, con su base y su impuesto.
 */
describe("tasas distintas del mismo componente: un renglón por tasa", () => {
  it("IVA 0% y 16% en la misma venta: dos renglones, cada uno con su base", () => {
    const totales = armarTotales(
      [linea("150", "1", "0", IVA0), linea("100", "1", "0", IVA16), linea("23", "1", "0", IVA0)],
      "included",
    );

    expect(
      totales.byComponent.map((c) => [
        c.code,
        c.name,
        c.rate,
        c.base.toFixed(2),
        c.amount.toFixed(2),
      ]),
    ).toEqual([
      ["VAT", "IVA 0%", "0", "173.00", "0.00"],
      ["VAT", "IVA 16%", "16", "86.21", "13.79"],
    ]);
    expect(totales.taxTotal.toFixed(2)).toBe("13.79");
  });

  /**
   * Carlos (2026-11-01), VTA-000109: redondeado renglón por renglón, el IVA de
   * Agua ($70) y Jarritos ($40) era $9.66 + $5.52 = $15.18; la cuenta a mano,
   * 110 − 110/1.16, da $15.17. El IVA sale de la suma de cada tasa y se
   * reparte después entre los renglones.
   */
  it("VTA-000109: $110 al 16% llevan $15.17 de IVA y el subtotal sin IVA es $212.83", () => {
    const t = armarTotales(
      [
        linea("23", "2", "0", IVA0),
        linea("14", "5", "0", IVA16),
        linea("24", "3", "0", IVA0),
        linea("20", "2", "0", IVA16),
      ],
      "included",
    );
    expect(t.total.toFixed(2)).toBe("228.00");
    expect(t.taxTotal.toFixed(2)).toBe("15.17");
    expect(t.total.minus(t.taxTotal).toFixed(2)).toBe("212.83");
    expect(t.lines.map((l) => l.taxAmount.toFixed(2))).toEqual(["0.00", "9.65", "0.00", "5.52"]);
    expect(
      t.byComponent.map((c) => [c.name, c.base.toFixed(2), c.amount.toFixed(2), c.sortOrder]),
    ).toEqual([
      ["IVA 0%", "118.00", "0.00", 0],
      ["IVA 16%", "94.83", "15.17", 1],
    ]);
  });

  it("la misma tasa en dos líneas sigue siendo UN renglón", () => {
    const totales = armarTotales([linea("116", "1", "0", IVA16), linea("58", "1", "0", IVA16)]);

    expect(totales.byComponent.map((c) => [c.name, c.amount.toFixed(2)])).toEqual([
      ["IVA 16%", "24.00"],
    ]);
  });
});

describe("sin impuesto: la aritmética de siempre (refactor puro, F4-TAX-06)", () => {
  it("tres líneas con descuento dan el mismo subtotal, descuento y total que antes", () => {
    const t = armarTotales([linea("10", "2", "1"), linea("5.5", "3"), linea("100", "1", "20")]);
    expect(t.subtotal.toString()).toBe("136.5");
    expect(t.discount.toString()).toBe("21");
    expect(t.total.toString()).toBe("115.5");
    expect(t.taxTotal.toString()).toBe("0");
    expect(t.lines.map((l) => l.lineTotal.toString())).toEqual(["19", "16.5", "80"]);
    expect(t.lines.every((l) => l.taxAmount.isZero() && l.taxGroupCode === null)).toBe(true);
    expect(t.byComponent).toEqual([]);
  });

  it("una cantidad fraccionaria se redondea a centavos ANTES: 0.333 × 15.50 es 5.16, no 5.1615", () => {
    const t = armarTotales([linea("15.50", "0.333")]);
    expect(t.lines[0]?.lineTotal.toString()).toBe("5.16");
    expect(t.subtotal.toString()).toBe("5.16");
  });

  it("el medio centavo sube: 0.5 × 0.01 es 0.01", () => {
    expect(armarTotales([linea("0.01", "0.5")]).total.toString()).toBe("0.01");
  });

  it("un descuento mayor que SU línea es 422 con el índice, aunque otra línea lo compense", () => {
    expect(() => armarTotales([linea("15", "1", "20"), linea("100", "1")])).toThrow(
      UnprocessableEntityException,
    );
    try {
      armarTotales([linea("100", "1"), linea("15", "1", "20")]);
    } catch (e) {
      expect((e as UnprocessableEntityException).getResponse()).toEqual({
        message: "pos.line_discount_exceeds_line",
        args: { lineIndex: 1 },
      });
    }
  });

  it("un descuento igual a la línea la deja en cero, sin reclamar", () => {
    expect(armarTotales([linea("15", "1", "15")]).total.toString()).toBe("0");
  });
});

describe("modo incluido (México): el dinero NO cambia, solo aparece el desglose", () => {
  it("$116.00 al 16% sigue costando $116.00 y desglosa $16.00 de IVA", () => {
    const t = armarTotales([linea("116", "1", "0", IVA16)], "included");
    expect(t.total.toString()).toBe("116");
    expect(t.subtotal.toString()).toBe("116");
    expect(t.taxTotal.toString()).toBe("16");
    expect(t.lines[0]).toMatchObject({ taxGroupCode: "VAT16" });
    expect(t.lines[0]?.taxAmount.toString()).toBe("16");
    expect(t.byComponent.map((c) => [c.code, c.base.toString(), c.amount.toString()])).toEqual([
      ["VAT", "100", "16"],
    ]);
  });

  it("con descuento: el impuesto sale del precio ya descontado", () => {
    const t = armarTotales([linea("116", "1", "16", IVA16)], "included");
    expect(t.total.toString()).toBe("100");
    expect(t.taxTotal.toString()).toBe("13.79");
    expect(t.byComponent[0]?.base.toString()).toBe("86.21");
  });

  it("una línea exenta y otra gravada: el total es la suma y solo una paga", () => {
    const t = armarTotales(
      [linea("116", "1", "0", IVA16), linea("50", "2", "0", EXENTO)],
      "included",
    );
    expect(t.total.toString()).toBe("216");
    expect(t.taxTotal.toString()).toBe("16");
    expect(t.lines[1]).toMatchObject({ taxGroupCode: "EXEMPT" });
    expect(t.lines[1]?.taxAmount.toString()).toBe("0");
  });
});

describe("modo excluido (Canadá, EE. UU.): el impuesto se suma", () => {
  it("$80 netos con descuento de $10 pagan $70 + GST 3.50 + PST 4.90 = $78.40, en dos componentes", () => {
    const t = armarTotales([linea("80", "1", "10", GST_PST)], "excluded");
    expect(t.subtotal.toString()).toBe("80");
    expect(t.discount.toString()).toBe("10");
    expect(t.taxTotal.toString()).toBe("8.4");
    expect(t.total.toString()).toBe("78.4");
    expect(t.lines[0]?.lineTotal.toString()).toBe("78.4");
    expect(t.byComponent.map((c) => [c.code, c.base.toString(), c.amount.toString()])).toEqual([
      ["GST", "70", "3.5"],
      ["PST", "70", "4.9"],
    ]);
  });

  it("el reparto cuadra: Σ tax_amount de las líneas es Σ por componente", () => {
    const lineas = Array.from({ length: 7 }, (_, i) =>
      linea((i * 3.37 + 0.01).toFixed(2), "1", "0", GST_PST),
    );
    const t = armarTotales(lineas, "excluded");
    const sumaLineas = t.lines.reduce((acc, l) => acc.plus(l.taxAmount), D(0));
    const sumaComponentes = t.byComponent.reduce((acc, c) => acc.plus(c.amount), D(0));
    expect(sumaLineas.toString()).toBe(sumaComponentes.toString());
    expect(t.total.toString()).toBe(
      t.lines.reduce((acc, l) => acc.plus(l.lineTotal), D(0)).toString(),
    );
    expect(t.total.minus(t.taxTotal).toString()).toBe(t.subtotal.minus(t.discount).toString());
  });

  it("sin grupo o exento, la línea no suma impuesto ni componente", () => {
    const t = armarTotales(
      [linea("50", "1", "0", null), linea("50", "1", "0", EXENTO)],
      "excluded",
    );
    expect(t.total.toString()).toBe("100");
    expect(t.byComponent).toEqual([]);
  });
});
