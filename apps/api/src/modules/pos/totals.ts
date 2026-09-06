import { UnprocessableEntityException } from "@nestjs/common";
import { splitLineTax, type TaxMode } from "@sellpoint/shared";
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
 * La división vive en `splitLineTax` (shared): la misma que usa el carrito.
 * Los componentes se acumulan por código DESDE las líneas — nunca se
 * recalculan sobre el total — así `Σ tax_amount ≡ Σ sale_taxes.amount`.
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
  const componentes = new Map<string, ComponenteTotalizado>();
  let subtotal = new Prisma.Decimal(0);
  let discount = new Prisma.Decimal(0);
  let taxTotal = new Prisma.Decimal(0);
  let total = new Prisma.Decimal(0);

  const lines = lineas.map((linea, i) => {
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
    const componentesDeLinea = linea.grupo?.rates ?? [];
    const split = splitLineTax({
      amountCents: centavos(base),
      mode,
      components: componentesDeLinea,
    });
    const taxAmount = desdeCentavos(split.taxCents);
    const lineTotal = mode === "excluded" ? base.plus(taxAmount) : base;

    componentesDeLinea.forEach((rate, orden) => {
      const parte = split.byComponent[orden];
      const clave = rate.code;
      const acumulado = componentes.get(clave) ?? {
        code: rate.code,
        name: rate.name,
        rate: rate.rate,
        base: new Prisma.Decimal(0),
        amount: new Prisma.Decimal(0),
        sortOrder: componentes.size,
      };
      acumulado.base = acumulado.base.plus(desdeCentavos(split.netCents));
      acumulado.amount = acumulado.amount.plus(desdeCentavos(parte?.taxCents ?? 0));
      componentes.set(clave, acumulado);
    });

    subtotal = subtotal.plus(bruto);
    discount = discount.plus(linea.discount);
    taxTotal = taxTotal.plus(taxAmount);
    total = total.plus(lineTotal);
    return { lineTotal, taxAmount, taxGroupCode: linea.grupo?.code ?? null };
  });

  return { lines, subtotal, discount, taxTotal, total, byComponent: [...componentes.values()] };
}
