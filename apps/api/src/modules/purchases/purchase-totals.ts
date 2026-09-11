import { Prisma } from "../../generated/prisma/client";
import type { ContextoFiscal } from "../pos/tax-resolver";
import { grupoDe } from "../pos/tax-resolver";
// ⚠ Deuda con nombre: `totals.ts` y `tax-resolver.ts` viven en `pos/` porque
// nacieron con la venta, pero ya los usan la cotización, la orden médica, los
// gastos y ahora las compras — no son del punto de venta, son del NEGOCIO.
// Moverlos a `modules/tax/` es un refactor de cuatro módulos que no cabe en
// esta tarea; importarlos desde acá no agrega acoplamiento nuevo (son
// funciones puras sobre decimales).
import { armarTotales, type LineaTotalizada } from "../pos/totals";

/** Una línea de la factura, como la captura el usuario. */
export interface LineaDeCompra {
  unitCost: Prisma.Decimal;
  quantity: Prisma.Decimal;
  discount: Prisma.Decimal;
  /** El grupo de impuesto elegido; `null`/ausente = el default del negocio. */
  taxGroupId?: string | null;
}

/** Un cargo de la factura: flete, maniobras, seguro. */
export interface CargoDeCompra {
  amount: Prisma.Decimal;
  taxGroupId?: string | null;
}

export interface TotalesDeCompra {
  lines: LineaTotalizada[];
  charges: LineaTotalizada[];
  /** Σ (costo × cantidad) de las LÍNEAS, sin cargos. */
  subtotal: Prisma.Decimal;
  discount: Prisma.Decimal;
  taxTotal: Prisma.Decimal;
  /** Lo que se paga por la factura entera: líneas + cargos, con su impuesto. */
  total: Prisma.Decimal;
  /** Σ de los cargos CON su impuesto. */
  extraChargesTotal: Prisma.Decimal;
  byComponent: ReturnType<typeof armarTotales>["byComponent"];
}

const CERO = new Prisma.Decimal(0);

/**
 * F9-PURCH-04 — la aritmética de una compra, en UNA sola llamada al sumador
 * del negocio.
 *
 * Líneas y cargos entran JUNTOS a `armarTotales` (el cargo es una línea de
 * `quantity: 1`) y no en dos llamadas: los componentes de impuesto se acumulan
 * por código desde todas las partidas, así que `Σ tax_amount ≡ Σ
 * purchase_taxes.amount` — con dos llamadas habría que sumar dos mapas y el
 * desglose del PDF podría discrepar del total por un centavo de redondeo.
 *
 * **Los cargos suman al total y NO se prorratean al costo de las líneas.**
 * Repartir un flete entre veinte productos (landed cost) es una decisión
 * contable que el negocio tiene que poder elegir, no un efecto silencioso de
 * capturar una factura: queda pospuesto con nombre y fijado por test.
 */
export function armarCompra(input: {
  lines: LineaDeCompra[];
  charges: CargoDeCompra[];
  fiscal: ContextoFiscal;
}): TotalesDeCompra {
  const { lines, charges, fiscal } = input;
  const totales = armarTotales(
    [
      ...lines.map((linea) => ({
        unitPrice: linea.unitCost,
        quantity: linea.quantity,
        discount: linea.discount,
        grupo: grupoDe(fiscal, linea.taxGroupId),
      })),
      // Un cargo es una línea de una unidad: mismo sumador, mismo redondeo.
      ...charges.map((cargo) => ({
        unitPrice: cargo.amount,
        quantity: new Prisma.Decimal(1),
        discount: CERO,
        grupo: grupoDe(fiscal, cargo.taxGroupId),
      })),
    ],
    fiscal.mode,
  );

  const totalizadasDeLinea = totales.lines.slice(0, lines.length);
  const totalizadasDeCargo = totales.lines.slice(lines.length);
  const brutoDeCargos = charges.reduce((suma, cargo) => suma.plus(cargo.amount), CERO);

  return {
    lines: totalizadasDeLinea,
    charges: totalizadasDeCargo,
    // `armarTotales` suma el bruto de TODO; el subtotal de la compra es el de
    // las líneas, que es lo que el papel lista como mercancía.
    subtotal: totales.subtotal.minus(brutoDeCargos),
    discount: totales.discount,
    taxTotal: totales.taxTotal,
    total: totales.total,
    extraChargesTotal: totalizadasDeCargo.reduce((suma, cargo) => suma.plus(cargo.lineTotal), CERO),
    byComponent: totales.byComponent,
  };
}

/**
 * F9-PURCH-04 — el costo SIN impuesto por unidad de la presentación: lo ÚNICO
 * que cruza el puente a la entrada de inventario.
 *
 * Es el número que va a pisar `product_presentations.cost` y a alimentar el
 * costo promedio. La factura viene en neto + IVA, así que mandar el bruto
 * inflaría el margen un 16 % **para siempre** — y nadie lo notaría hasta ver
 * una utilidad que no cierra. Por eso se descuenta el impuesto de la línea y
 * se reparte entre las unidades compradas, y por eso el descuento de línea SÍ
 * baja el costo (se pagó menos por la misma mercancía).
 *
 * Sin cantidad no hay costo unitario: `null`, jamás cero — un cero diría «me
 * salió gratis» y el promedio ponderado se lo creería.
 */
export function costoNetoPorUnidad(
  lineTotal: Prisma.Decimal,
  taxAmount: Prisma.Decimal,
  quantity: Prisma.Decimal | null,
): Prisma.Decimal | null {
  if (quantity === null || quantity.lessThanOrEqualTo(0)) {
    return null;
  }
  return lineTotal
    .minus(taxAmount)
    .dividedBy(quantity)
    .toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP);
}
