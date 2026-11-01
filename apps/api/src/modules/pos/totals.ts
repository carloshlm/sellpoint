import { UnprocessableEntityException } from "@nestjs/common";
import { splitDocumentTax, type TaxMode } from "@sellpoint/shared";
import { Prisma } from "../../generated/prisma/client";

/**
 * F4-TAX-06 — el ÚNICO lugar donde se suma un documento.
 *
 * Antes la misma aritmética vivía tres veces (venta, cotización y la
 * cotización que emite la orden médica) y cada copia podía divergir un
 * centavo de las otras. Ahora las tres llaman acá.
 *
 * ── El redondeo va ANTES del descuento y del impuesto ─────────────────
 *
 * `unit_price × quantity` puede traer hasta seis decimales (la cantidad es
 * `Decimal(14,4)`), y `line_total` es `Decimal(14,2)`: antes se mandaba el
 * número crudo y Postgres lo redondeaba callado al guardar. Si el impuesto
 * se calculara sobre el crudo y la línea guardara el redondeado, habría un
 * centavo de descuadre garantizado en cantidades fraccionarias. Acá la línea
 * se redondea primero (medio centavo hacia arriba, lo que SAT y CRA aceptan
 * por línea), y todo lo demás se calcula sobre ESE número.
 *
 * ── Un descuento no deja una línea en negativo ─────────────────────────
 *
 * El 422 de «descuento mayor al subtotal» era del documento entero: una línea
 * podía quedar negativa si otra la compensaba. Con impuesto, esa base
 * negativa se compensaría con otra positiva en `sale_taxes` y SUBDECLARARÍA.
 * La guarda es por línea.
 *
 * ── Los dos modos ─────────────────────────────────────────────────────
 *
 * `included`: la línea ES lo que se paga; el impuesto va dentro y el total no
 * cambia por que exista. `excluded`: la línea es la base; el impuesto se suma.
 *
 * ── El impuesto sale por tasa, no renglón por renglón ─────────────────
 *
 * `splitDocumentTax` (shared, la misma que usa el carrito) calcula cada tasa
 * sobre la suma de sus líneas y reparte ese impuesto entre ellas en centavos
 * exactos (Carlos, 2026-11-01: el IVA de VTA-000109 era $15.18 sumando
 * renglones redondeados y $15.17 a mano). El reparto conserva
 * `Σ tax_amount ≡ Σ sale_taxes.amount`.
 */
export interface GrupoResuelto {
  id: string;
  code: string;
  name: string;
  rates: { code: string; name: string; rate: string }[];
}

export interface LineaFacturable {
  unitPrice: Prisma.Decimal;
  quantity: Prisma.Decimal;
  /** Monto fijo por línea; 0 en la cotización, que no descuenta. */
  discount: Prisma.Decimal;
  /** El impuesto de la línea; null = sin impuesto. */
  grupo: GrupoResuelto | null;
}

export interface LineaTotalizada {
  lineTotal: Prisma.Decimal;
  taxAmount: Prisma.Decimal;
  taxGroupCode: string | null;
}

export interface ComponenteTotalizado {
  code: string;
  name: string;
  rate: string;
  base: Prisma.Decimal;
  amount: Prisma.Decimal;
  sortOrder: number;
}

export interface TotalesDocumento {
  lines: LineaTotalizada[];
  /** Σ (unit_price × quantity) redondeado por línea: el precio de catálogo, en la unidad del modo. */
  subtotal: Prisma.Decimal;
  discount: Prisma.Decimal;
  taxTotal: Prisma.Decimal;
  /** Σ line_total: lo que se paga. En `included` es igual a `subtotal − discount`. */
  total: Prisma.Decimal;
  byComponent: ComponenteTotalizado[];
}

const DOS = 2;
const centavos = (d: Prisma.Decimal): number => d.times(100).toDecimalPlaces(0).toNumber();
const desdeCentavos = (n: number): Prisma.Decimal => new Prisma.Decimal(n).dividedBy(100);

export function armarTotales(
  lineas: LineaFacturable[],
  mode: TaxMode = "included",
): TotalesDocumento {
  let subtotal = new Prisma.Decimal(0);
  let discount = new Prisma.Decimal(0);
  let taxTotal = new Prisma.Decimal(0);
  let total = new Prisma.Decimal(0);

  const bases = lineas.map((linea, i) => {
    const bruto = linea.unitPrice
      .times(linea.quantity)
      .toDecimalPlaces(DOS, Prisma.Decimal.ROUND_HALF_UP);
    const base = bruto.minus(linea.discount);
    if (base.isNegative()) {
      throw new UnprocessableEntityException({
        message: "pos.line_discount_exceeds_line",
        args: { lineIndex: i },
      });
    }
    return { linea, bruto, base };
  });

  const reparto = splitDocumentTax({
    mode,
    lines: bases.map(({ linea, base }) => ({
      amountCents: centavos(base),
      components: linea.grupo?.rates ?? [],
    })),
  });

  const lines = bases.map(({ linea, bruto, base }, i) => {
    const taxAmount = desdeCentavos(reparto.lines[i]?.taxCents ?? 0);
    const lineTotal = mode === "excluded" ? base.plus(taxAmount) : base;
    subtotal = subtotal.plus(bruto);
    discount = discount.plus(linea.discount);
    taxTotal = taxTotal.plus(taxAmount);
    total = total.plus(lineTotal);
    return { lineTotal, taxAmount, taxGroupCode: linea.grupo?.code ?? null };
  });

  // Por componente Y tasa (Carlos, 2026-11-01): los grupos de IVA de México
  // (16, 8 y 0%) comparten el componente `VAT`; cada tasa es su renglón.
  const byComponent = reparto.byComponent.map((c, sortOrder) => ({
    code: c.code,
    name: c.name,
    rate: c.rate,
    base: desdeCentavos(c.netCents),
    amount: desdeCentavos(c.taxCents),
    sortOrder,
  }));

  return { lines, subtotal, discount, taxTotal, total, byComponent };
}
