import { Prisma } from "../../generated/prisma/client";
import type { ContextoFiscal } from "../pos/tax-resolver";
import { armarCompra, costoNetoPorUnidad } from "./purchase-totals";

/**
 * F9-PURCH-04 — la aritmética de la compra.
 *
 * Lo que fija: los dos modos fiscales dan el MISMO costo neto (que es el que
 * pisa el catálogo); el descuento de línea lo baja; y un flete suma al total
 * **sin tocar ningún costo unitario** — el landed cost está pospuesto a
 * propósito y este test es su candado.
 */
const d = (n: string | number) => new Prisma.Decimal(n);

const IVA16 = {
  id: "g-iva",
  code: "VAT16",
  name: "IVA 16%",
  rates: [{ code: "IVA", name: "IVA", rate: "16" }],
};

const fiscal = (mode: "included" | "excluded"): ContextoFiscal => ({
  mode,
  porDefecto: IVA16,
  grupos: new Map([[IVA16.id, IVA16]]),
});

const linea = (unitCost: string, quantity: string, discount = "0") => ({
  unitCost: d(unitCost),
  quantity: d(quantity),
  discount: d(discount),
});

describe("armarCompra (F9-PURCH-04)", () => {
  it("`excluded`: 10 × $100 con IVA 16 → subtotal 1000, impuesto 160, total 1160", () => {
    const totales = armarCompra({
      lines: [linea("100", "10")],
      charges: [],
      fiscal: fiscal("excluded"),
    });

    expect(totales.subtotal.toString()).toBe("1000");
    expect(totales.taxTotal.toString()).toBe("160");
    expect(totales.total.toString()).toBe("1160");
    expect(totales.extraChargesTotal.toString()).toBe("0");
    const cuenta = totales.lines[0] as { lineTotal: Prisma.Decimal; taxAmount: Prisma.Decimal };
    expect(costoNetoPorUnidad(cuenta.lineTotal, cuenta.taxAmount, d("10"))?.toString()).toBe("100");
  });

  it("`included`: 10 × $116 con IVA adentro → el MISMO total y el MISMO costo neto", () => {
    const totales = armarCompra({
      lines: [linea("116", "10")],
      charges: [],
      fiscal: fiscal("included"),
    });

    expect(totales.total.toString()).toBe("1160");
    expect(totales.taxTotal.toString()).toBe("160");
    const cuenta = totales.lines[0] as { lineTotal: Prisma.Decimal; taxAmount: Prisma.Decimal };
    // La misma mercancía al mismo precio: el catálogo no puede quedar con dos
    // costos distintos según cómo el proveedor imprimió su factura.
    expect(costoNetoPorUnidad(cuenta.lineTotal, cuenta.taxAmount, d("10"))?.toString()).toBe("100");
  });

  it("un descuento de línea baja el costo neto: se pagó menos por la misma mercancía", () => {
    const totales = armarCompra({
      lines: [linea("100", "10", "100")],
      charges: [],
      fiscal: fiscal("excluded"),
    });

    expect(totales.discount.toString()).toBe("100");
    expect(totales.taxTotal.toString()).toBe("144");
    expect(totales.total.toString()).toBe("1044");
    const cuenta = totales.lines[0] as { lineTotal: Prisma.Decimal; taxAmount: Prisma.Decimal };
    expect(costoNetoPorUnidad(cuenta.lineTotal, cuenta.taxAmount, d("10"))?.toString()).toBe("90");
  });

  /** ⚠ El candado del landed cost: el flete suma a la factura, no al costo. */
  it("un flete de $200 con IVA suma 32 al impuesto y 232 al total, sin tocar ningún costo unitario", () => {
    const sinFlete = armarCompra({
      lines: [linea("100", "10")],
      charges: [],
      fiscal: fiscal("excluded"),
    });
    const conFlete = armarCompra({
      lines: [linea("100", "10")],
      charges: [{ amount: d("200") }],
      fiscal: fiscal("excluded"),
    });

    expect(conFlete.extraChargesTotal.toString()).toBe("232");
    expect(conFlete.taxTotal.toString()).toBe("192");
    expect(conFlete.total.toString()).toBe("1392");
    // El subtotal sigue siendo el de la MERCANCÍA: el cargo no es mercancía.
    expect(conFlete.subtotal.toString()).toBe("1000");

    const costo = (t: typeof sinFlete) => {
      const cuenta = t.lines[0] as { lineTotal: Prisma.Decimal; taxAmount: Prisma.Decimal };
      return costoNetoPorUnidad(cuenta.lineTotal, cuenta.taxAmount, d("10"))?.toString();
    };
    expect(costo(conFlete)).toBe(costo(sinFlete));
    expect(costo(conFlete)).toBe("100");
  });

  it("los componentes se acumulan en UNA lista: líneas y cargos suman al mismo IVA", () => {
    const totales = armarCompra({
      lines: [linea("100", "10")],
      charges: [{ amount: d("200") }],
      fiscal: fiscal("excluded"),
    });

    expect(totales.byComponent).toHaveLength(1);
    const iva = totales.byComponent[0] as { code: string; amount: Prisma.Decimal };
    expect(iva.code).toBe("IVA");
    // Σ del desglose ≡ impuesto total: el PDF y el total no pueden discrepar.
    expect(iva.amount.toString()).toBe(totales.taxTotal.toString());
  });

  it("una línea sin impuesto no inventa componentes y suma limpio", () => {
    const sinIva: ContextoFiscal = { mode: "excluded", porDefecto: null, grupos: new Map() };
    const totales = armarCompra({ lines: [linea("100", "3")], charges: [], fiscal: sinIva });

    expect(totales.taxTotal.toString()).toBe("0");
    expect(totales.total.toString()).toBe("300");
    expect(totales.byComponent).toHaveLength(0);
  });
});

describe("costoNetoPorUnidad (F9-PURCH-04)", () => {
  it("sin cantidad no hay costo unitario: null, jamás cero", () => {
    expect(costoNetoPorUnidad(d("1160"), d("160"), null)).toBeNull();
    expect(costoNetoPorUnidad(d("1160"), d("160"), d("0"))).toBeNull();
  });

  it("redondea a dos decimales HALF_UP, como todo el dinero del sistema", () => {
    // 100 / 3 = 33.333… → 33.33
    expect(costoNetoPorUnidad(d("100"), d("0"), d("3"))?.toString()).toBe("33.33");
    // 101 / 3 = 33.666… → 33.67
    expect(costoNetoPorUnidad(d("101"), d("0"), d("3"))?.toString()).toBe("33.67");
  });
});
