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

  it("los componentes se acumulan DESDE las líneas: Σ tax_amount es Σ por componente, línea por línea", () => {
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
