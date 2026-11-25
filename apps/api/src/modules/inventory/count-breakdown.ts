import { UnprocessableEntityException } from "@nestjs/common";
import { QUANTITY_MAX, QUANTITY_SCALE } from "@sellpoint/shared";
import { type InventoryDocument, Prisma } from "../../generated/prisma/client";
import type { CountBreakdownInput } from "./dto/document.dto";

/**
 * F10-BULK-10/11 — «Contar por presentaciones».
 *
 * El inventario físico sigue en unidad base (decisión del 2026-08-31): lo que
 * se asienta es `counted`. El desglose es la cuenta que lo explica —«2 × Bolsa
 * 1 Kg + 1 × Bolsa 10 Kg + 600 g»— y se guarda con el renglón en
 * `count_breakdown`, para corregir una bolsa sin teclear todo otra vez y para
 * que el conteo confirmado diga cómo se contó.
 *
 * El API **calcula** `counted` desde el desglose (suma de cantidad × factor).
 * Si el cliente manda los dos, gana el desglose: un total que no sale de su
 * cuenta sería un desglose que miente.
 */

/**
 * Un renglón del desglose, como se guarda: `presentationId: null` son los
 * sueltos. Es `type` y no `interface` para que Prisma lo acepte como JSON.
 */
export type StoredCountBreakdownEntry = {
  presentationId: string | null;
  quantity: string;
};

/** Lo que la previa devuelve: el renglón guardado con el nombre de su presentación. */
export type CountBreakdownView = StoredCountBreakdownEntry & {
  presentationName: string | null;
};

const FIELD = "countBreakdown";

/**
 * Valida el desglose de UN renglón y calcula su contado.
 *
 * - Solo en un inventario físico: en una entrada o una salida no hay contado.
 * - Cada presentación es del producto del renglón y está activa.
 * - Una presentación de «Solo enteros» no admite medio empaque.
 * - La suma cabe en la columna: 4 decimales y `QUANTITY_MAX`.
 *
 * Que las cantidades sean de cero o más y que no pasen de `COUNT_BREAKDOWN_MAX_ROWS`
 * renglones lo revisa el DTO.
 */
export async function resolveCountBreakdown(
  tx: Prisma.TransactionClient,
  tenantId: string,
  document: InventoryDocument,
  productId: string,
  entries: CountBreakdownInput,
): Promise<{ countBreakdown: StoredCountBreakdownEntry[]; counted: Prisma.Decimal }> {
  if (document.type !== "physical_count") {
    throw new UnprocessableEntityException({
      message: "inventory.count_breakdown_not_count",
      args: { field: FIELD },
    });
  }

  const ids = [
    ...new Set(
      entries.flatMap((entry) => (entry.presentationId === null ? [] : [entry.presentationId])),
    ),
  ];
  const presentations =
    ids.length === 0
      ? []
      : await tx.productPresentation.findMany({
          where: { id: { in: ids }, productId, tenantId, isActive: true },
          select: { id: true, name: true, factor: true, allowFractionalInput: true },
        });
  const byId = new Map(presentations.map((presentation) => [presentation.id, presentation]));

  let counted = new Prisma.Decimal(0);
  const countBreakdown: StoredCountBreakdownEntry[] = [];
  for (const entry of entries) {
    const quantity = new Prisma.Decimal(entry.quantity);
    if (entry.presentationId === null) {
      counted = counted.plus(quantity);
      countBreakdown.push({ presentationId: null, quantity: quantity.toString() });
      continue;
    }
    const presentation = byId.get(entry.presentationId);
    if (presentation === undefined) {
      const product = await tx.product.findFirst({
        where: { id: productId, tenantId },
        select: { name: true },
      });
      throw new UnprocessableEntityException({
        message: "inventory.count_breakdown_presentation",
        args: { product: product?.name ?? "", field: FIELD },
      });
    }
    if (!presentation.allowFractionalInput && !quantity.isInteger()) {
      // El mismo mensaje que una entrada o una salida en esa presentación.
      throw new UnprocessableEntityException({
        message: "inventory.integer_only_presentation",
        args: { presentationName: presentation.name, field: FIELD },
      });
    }
    counted = counted.plus(quantity.times(presentation.factor));
    countBreakdown.push({ presentationId: presentation.id, quantity: quantity.toString() });
  }

  // 0.3333 × 1.5 da cinco decimales: la columna los redondearía en silencio.
  if (counted.decimalPlaces() > QUANTITY_SCALE) {
    throw new UnprocessableEntityException({
      message: "inventory.quantity_too_many_decimals",
      args: { field: FIELD },
    });
  }
  if (counted.greaterThan(QUANTITY_MAX)) {
    throw new UnprocessableEntityException({
      message: "inventory.quantity_too_large",
      args: { field: FIELD },
    });
  }
  return { countBreakdown, counted };
}

/**
 * Lo guardado en `count_breakdown`, leído con cuidado: es JSON, y lo que no
 * tenga la forma del desglose se trata como si no hubiera desglose.
 */
export function readCountBreakdown(
  value: Prisma.JsonValue | null,
): StoredCountBreakdownEntry[] | null {
  if (!Array.isArray(value)) {
    return null;
  }
  const entries: StoredCountBreakdownEntry[] = [];
  for (const item of value) {
    if (item === null || typeof item !== "object" || Array.isArray(item)) {
      return null;
    }
    const { presentationId, quantity } = item as Record<string, unknown>;
    if (
      (presentationId !== null && typeof presentationId !== "string") ||
      typeof quantity !== "string"
    ) {
      return null;
    }
    entries.push({ presentationId, quantity });
  }
  return entries;
}

/**
 * Los nombres de las presentaciones que nombran los desgloses de estas
 * líneas, en UNA consulta. Incluye las desactivadas: un conteo confirmado
 * con «Bolsa vieja» tiene que seguir diciendo «Bolsa vieja».
 */
export async function countBreakdownNames(
  tx: Prisma.TransactionClient,
  tenantId: string,
  lines: { countBreakdown: Prisma.JsonValue | null }[],
): Promise<Map<string, string>> {
  const ids = [
    ...new Set(
      lines.flatMap((line) =>
        (readCountBreakdown(line.countBreakdown) ?? []).flatMap((entry) =>
          entry.presentationId === null ? [] : [entry.presentationId],
        ),
      ),
    ),
  ];
  if (ids.length === 0) {
    return new Map();
  }
  const presentations = await tx.productPresentation.findMany({
    where: { id: { in: ids }, tenantId },
    select: { id: true, name: true },
  });
  return new Map(presentations.map((presentation) => [presentation.id, presentation.name]));
}

/** El desglose de la línea para la previa, con el nombre de cada presentación. */
export function describeCountBreakdown(
  value: Prisma.JsonValue | null,
  names: Map<string, string>,
): CountBreakdownView[] | null {
  const entries = readCountBreakdown(value);
  if (entries === null) {
    return null;
  }
  return entries.map((entry) => ({
    ...entry,
    presentationName:
      entry.presentationId === null ? null : (names.get(entry.presentationId) ?? null),
  }));
}
