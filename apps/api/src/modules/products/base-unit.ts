import { ConflictException } from "@nestjs/common";
import { getUnit, type Locale, SUPPORTED_LOCALES, unitName } from "@sellpoint/shared";
import type { Prisma } from "../../generated/prisma/client";

/**
 * La unidad base de un producto y la presentación que nace con ella. Lo usan
 * el formulario (`products.service.ts`) y la importación de Excel
 * (`import.service.ts`): una sola regla para los dos caminos que escriben
 * `products.base_unit`.
 */

/**
 * Nombre de la presentación base que se crea con cada producto. Es la que
 * lleva el precio y el costo que el usuario carga en el form del catálogo
 * (decisión de Carlos, 2026-08-16): el precio vive en `product_presentations`,
 * una sola fuente de verdad, pero se edita desde la misma pantalla.
 *
 * Se llama como la UNIDAD BASE, no "Unidad" a secas (corrección de Carlos,
 * 2026-08-17): un producto en gramos mostraba una presentación llamada
 * "Unidad" que en realidad valía 1 gramo, y eso confunde justo donde no
 * conviene. Va en el idioma de quien crea el producto porque es un dato del
 * tenant —editable, como cualquier otro nombre de presentación—, no una
 * etiqueta que se traduzca al vuelo.
 */
export function basePresentationName(baseUnit: string, locale: Locale): string {
  return unitName(baseUnit, locale);
}

/**
 * `count` (cosas que se cuentan de a una) no admite decimales; el resto sí.
 * El Admin puede sobrescribirlo por presentación (F2-PRESENT).
 */
export function derivesFractionalInput(baseUnit: string): boolean {
  return getUnit(baseUnit)?.category !== "count";
}

export type BaseUnitLockMessage =
  | "products.base_unit_locked_by_movements"
  | "products.base_unit_locked_by_stock"
  | "products.base_unit_locked_by_composition";

/**
 * Por qué NO se puede cambiar la unidad base de cada producto, o nada si se
 * puede. Cambiarla es ambiguo si ya hay existencias (¿los 500 que hay eran
 * gramos o kilos?) o si el producto es componente de otro (su composición
 * está expresada en la unidad vieja) — ARQUITECTURA § 3.5, validación #2.
 *
 * Con historia la unidad queda fija AUNQUE el saldo esté en cero: los
 * movimientos se escribieron EN esa unidad, y reinterpretarlos cambiaría
 * números ya registrados sin tocar una fila. Por eso el historial se reporta
 * primero, después el saldo y al final la composición.
 *
 * Va por lote de productos (F10-BULK-15): la importación revisa todas sus
 * filas con tres consultas, no con tres por fila.
 */
export async function baseUnitLocks(
  tx: Prisma.TransactionClient,
  productIds: readonly string[],
): Promise<Map<string, BaseUnitLockMessage>> {
  const ids = [...new Set(productIds)];
  if (ids.length === 0) {
    return new Map();
  }

  const [conMovimientos, conSaldo, comoComponente] = await Promise.all([
    tx.stockMovement.groupBy({ by: ["productId"], where: { productId: { in: ids } } }),
    tx.stockByWarehouse.groupBy({
      by: ["productId"],
      where: { productId: { in: ids }, quantity: { gt: 0 } },
    }),
    tx.productComposition.groupBy({
      by: ["componentProductId"],
      where: { componentProductId: { in: ids } },
    }),
  ]);

  const movimientos = new Set(conMovimientos.map((row) => row.productId));
  const saldo = new Set(conSaldo.map((row) => row.productId));
  const componente = new Set(comoComponente.map((row) => row.componentProductId));

  const candados = new Map<string, BaseUnitLockMessage>();
  for (const id of ids) {
    if (movimientos.has(id)) {
      candados.set(id, "products.base_unit_locked_by_movements");
    } else if (saldo.has(id)) {
      candados.set(id, "products.base_unit_locked_by_stock");
    } else if (componente.has(id)) {
      candados.set(id, "products.base_unit_locked_by_composition");
    }
  }
  return candados;
}

/** El 409 del formulario: la misma regla que `baseUnitLocks`, para un producto. */
export async function assertBaseUnitChangeable(
  tx: Prisma.TransactionClient,
  productId: string,
): Promise<void> {
  const candado = (await baseUnitLocks(tx, [productId])).get(productId);
  if (candado !== undefined) {
    throw new ConflictException({ message: candado });
  }
}

/**
 * F10-BULK-14 — cuando la unidad base SÍ cambia (sin historial), la
 * presentación base la acompaña. Antes conservaba el nombre y el «Solo
 * enteros» de la unidad anterior: un producto pasado de pieza a kilogramo
 * seguía llamando «Pieza» a su kilo y rechazaba 0.250.
 *
 * La presentación base es la de factor 1 que nació con el producto (la más
 * antigua, con el mismo desempate que el detalle del producto). No tiene por
 * qué ser la predeterminada de venta: esa marca se puede pasar a un empaque.
 *
 * - El nombre cambia SOLO si todavía es el nombre por omisión de la unidad
 *   anterior, en cualquiera de los idiomas: uno que el negocio escribió no se
 *   pisa. El nombre nuevo va en el idioma de quien hace el cambio, igual que
 *   al crear el producto. Si otra presentación del producto ya se llama así,
 *   el nombre se queda: dos presentaciones no pueden llamarse igual.
 * - `allowFractionalInput` se recalcula siempre con `derivesFractionalInput`.
 */
export async function followBaseUnitChange(
  tx: Prisma.TransactionClient,
  productId: string,
  change: { from: string; to: string; locale: Locale },
): Promise<void> {
  const base = await tx.productPresentation.findFirst({
    where: { productId, factor: 1 },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    select: { id: true, name: true },
  });
  if (!base) {
    return;
  }

  const nombresPorOmision = SUPPORTED_LOCALES.map((locale) =>
    basePresentationName(change.from, locale),
  );
  const nombreNuevo = basePresentationName(change.to, change.locale);
  const renombrar =
    nombresPorOmision.includes(base.name) &&
    base.name !== nombreNuevo &&
    (await tx.productPresentation.count({
      where: { productId, name: nombreNuevo, NOT: { id: base.id } },
    })) === 0;

  await tx.productPresentation.update({
    where: { id: base.id },
    data: {
      allowFractionalInput: derivesFractionalInput(change.to),
      ...(renombrar ? { name: nombreNuevo } : {}),
    },
  });
}
