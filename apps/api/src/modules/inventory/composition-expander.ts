import { ConflictException } from "@nestjs/common";
import { Prisma } from "../../generated/prisma/client";
import type { ResolvedLine } from "./line-resolver";

/** Una línea expandida sabe de qué compuesto salió: el kardex lo explica. */
export interface ExpandedLine extends ResolvedLine {
  parentProductId?: string;
}

/** Profundidad máxima del recorrido. Ver la nota sobre ciclos, abajo. */
const MAX_DEPTH = 20;

/**
 * F3-CORE-06 — un producto compuesto no tiene existencias propias, así que
 * sacarlo del almacén significa sacar sus COMPONENTES.
 *
 * La fórmula es `cantidad × qty_componente × (1 + merma/100)`, **la misma** que
 * usa `availability` para decir "alcanza para N unidades" (F2-BOM-02). Que
 * coincidan no es cosmético: si difirieran, la pantalla prometería 50 cafés y
 * el ledger dejaría de servir al 47, sin que nadie pudiera explicar por qué.
 *
 * Recorre en RECURSIÓN porque un compuesto puede llevar otro compuesto: el
 * combo lleva 2 cafés y cada café 22 gr de azúcar. Nadie captura "44 gr" — se
 * deduce, y detenerse en el primer nivel dejaría el saldo del azúcar intacto.
 *
 * Todo en `Prisma.Decimal`: la merma introduce decimales y con floats la
 * diferencia se acumularía movimiento a movimiento.
 */
export async function expandComposition(
  tx: Prisma.TransactionClient,
  tenantId: string,
  lines: ResolvedLine[],
): Promise<ExpandedLine[]> {
  const aExpandir = lines.filter((l) => l.expand);
  if (aExpandir.length === 0) {
    return lines;
  }

  // El grafo del tenant, en UNA query: recorrer en recursión pidiendo a la
  // base en cada nivel sería N+1 sobre una estructura que cabe en memoria.
  const compositions = await tx.productComposition.findMany({
    where: { tenantId },
    select: {
      parentProductId: true,
      componentProductId: true,
      quantity: true,
      wastePercentage: true,
    },
  });
  const porPadre = new Map<string, typeof compositions>();
  for (const row of compositions) {
    const actual = porPadre.get(row.parentProductId) ?? [];
    actual.push(row);
    porPadre.set(row.parentProductId, actual);
  }

  const compuestos = new Set(
    (
      await tx.product.findMany({
        where: { tenantId, isComposite: true },
        select: { id: true },
      })
    ).map((p) => p.id),
  );

  const resultado: ExpandedLine[] = lines.filter((l) => !l.expand);

  for (const line of aExpandir) {
    // Agregado POR COMPONENTE: dos líneas del mismo compuesto tienen que
    // terminar en un solo descuento de azúcar, no en dos que el ledger
    // bloquearía por separado.
    const acumulado = new Map<string, Prisma.Decimal>();

    const walk = (productId: string, factor: Prisma.Decimal, depth: number): void => {
      // Corte por profundidad: F2-BOM-01 impide crear ciclos, pero un dato
      // heredado o una migración a mano podrían dejar uno, y colgar el proceso
      // sería peor que descontar de menos.
      if (depth > MAX_DEPTH) {
        return;
      }
      const componentes = porPadre.get(productId);
      if (componentes === undefined || componentes.length === 0) {
        throw new ConflictException({
          message: "inventory.composite_without_composition",
          args: { productId },
        });
      }

      for (const componente of componentes) {
        const merma = new Prisma.Decimal(componente.wastePercentage.toString()).div(100).plus(1);
        const necesario = factor.mul(new Prisma.Decimal(componente.quantity.toString())).mul(merma);

        if (compuestos.has(componente.componentProductId)) {
          walk(componente.componentProductId, necesario, depth + 1);
          continue;
        }
        const previo = acumulado.get(componente.componentProductId) ?? new Prisma.Decimal(0);
        acumulado.set(componente.componentProductId, previo.plus(necesario));
      }
    };

    walk(line.productId, line.quantityBase, 0);

    for (const [componentProductId, quantityBase] of acumulado) {
      const existente = resultado.find(
        (l) => l.productId === componentProductId && l.parentProductId === line.productId,
      );
      if (existente !== undefined) {
        existente.quantityBase = existente.quantityBase.plus(quantityBase);
        continue;
      }
      resultado.push({
        ...line,
        productId: componentProductId,
        // La presentación era del compuesto; el componente ya viene en su
        // propia unidad base.
        presentationId: null,
        quantityBase,
        quantityInput: quantityBase,
        expand: false,
        parentProductId: line.productId,
      });
    }
  }

  return resultado;
}
