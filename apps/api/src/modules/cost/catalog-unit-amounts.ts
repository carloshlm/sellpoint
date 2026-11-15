import type { Prisma } from "../../generated/prisma/client";

export interface CatalogPresentation {
  id: string;
  productId: string;
  factor: Prisma.Decimal;
  isDefaultSale: boolean;
  price: Prisma.Decimal | null;
  cost: Prisma.Decimal | null;
  createdAt: Date;
}

export interface CatalogUnitAmounts {
  cost: Prisma.Decimal | null;
  price: Prisma.Decimal | null;
}

/**
 * El costo y el precio del CATÁLOGO por unidad base (Carlos, 2026-11-14: «el
 * costo y precio que tenemos en el catálogo de productos por unidad base»).
 *
 * Los dos viven en las presentaciones, cada una en SU unidad: la caja de 12
 * guarda lo que vale la caja. El stock se cuenta en unidad base, así que cada
 * monto se toma de UNA presentación y se divide entre su factor.
 *
 * ── Cuál presentación manda ─────────────────────────────────────────────
 *
 *  1. La BASE (factor 1): su monto ya es por unidad base, sin dividir nada.
 *     Gana aunque la predeterminada sea otra — vender la pieza a $15 y la caja
 *     de 12 a $150 es un descuento por volumen, no el precio de la pieza.
 *  2. La PREDETERMINADA de venta: es la que la ficha del producto edita.
 *  3. La más chica: la que menos se aleja de la unidad base.
 *
 * El costo y el precio se buscan POR SEPARADO: una pieza con costo y sin
 * precio no le quita su precio a la caja.
 *
 * ── Por qué `null` y no `0` ─────────────────────────────────────────────
 *
 * Como en `WeightedCostService`: «no está capturado» y «vale cero» son
 * afirmaciones distintas. Un producto sin presentaciones queda AUSENTE del
 * mapa.
 */
export function catalogUnitAmounts(
  presentations: readonly CatalogPresentation[],
): Map<string, CatalogUnitAmounts> {
  const porProducto = new Map<string, CatalogPresentation[]>();
  for (const presentacion of presentations) {
    const lista = porProducto.get(presentacion.productId) ?? [];
    lista.push(presentacion);
    porProducto.set(presentacion.productId, lista);
  }

  const montos = new Map<string, CatalogUnitAmounts>();
  for (const [productId, lista] of porProducto) {
    const ordenadas = [...lista].sort(porCercaniaALaBase);
    montos.set(productId, {
      cost: porUnidadBase(ordenadas, "cost"),
      price: porUnidadBase(ordenadas, "price"),
    });
  }
  return montos;
}

function porUnidadBase(
  ordenadas: readonly CatalogPresentation[],
  campo: "cost" | "price",
): Prisma.Decimal | null {
  const fuente = ordenadas.find((presentacion) => presentacion[campo] !== null);
  const monto = fuente?.[campo] ?? null;
  return fuente === undefined || monto === null ? null : monto.div(fuente.factor);
}

/** El desempate final —alta e id— es para que el resultado no dependa del plan de Postgres. */
function porCercaniaALaBase(a: CatalogPresentation, b: CatalogPresentation): number {
  return (
    Number(b.factor.equals(1)) - Number(a.factor.equals(1)) ||
    Number(b.isDefaultSale) - Number(a.isDefaultSale) ||
    a.factor.comparedTo(b.factor) ||
    a.createdAt.getTime() - b.createdAt.getTime() ||
    a.id.localeCompare(b.id)
  );
}
