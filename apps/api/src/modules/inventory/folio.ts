import {
  FOLIO_SERIES,
  type FolioLanguage,
  type FolioSeries,
  folioLanguageForCountry,
  folioPrefix,
  isFolioLanguage,
} from "@sellpoint/shared";
import type { Prisma } from "../../generated/prisma/client";

/** Dígitos mínimos del número. Crece más allá sin romper: `ENT-1000000`. */
const FOLIO_DIGITS = 6;

/**
 * Toma el siguiente folio de una serie de un tenant y lo devuelve formateado
 * (`ENT-000042`).
 *
 * ── Por qué UNA sola sentencia ───────────────────────────────────────────
 *
 * `INSERT … ON CONFLICT DO UPDATE … RETURNING` lee, incrementa y devuelve en
 * un solo paso atómico. La alternativa obvia —leer el valor y después
 * actualizarlo— entrega el MISMO número a dos transacciones simultáneas, que
 * es exactamente el escenario normal de un almacén con dos turnos dando de
 * alta entradas al mismo tiempo.
 *
 * ── El gotcha del lock, y qué hacer con él ───────────────────────────────
 *
 * Esa sentencia toma el lock de la fila `(tenant, key)` y **no lo suelta hasta
 * el COMMIT**. O sea: mientras la transacción que pidió el folio siga abierta,
 * cualquier otra operación de la misma serie del mismo tenant espera.
 *
 * Por eso el folio se toma al **crear el borrador**, en una transacción corta
 * propia, y NO dentro de la transacción del ledger: así el lock dura
 * milisegundos en vez de sostenerse durante todo el posteo de movimientos.
 * **F4 hereda el patrón**: el POS puede tomar su folio al abrir el carrito, no
 * al cobrar.
 *
 * ── La serie no tiene huecos ─────────────────────────────────────────────
 *
 * Consecuencia de guardar el contador en una tabla y no en un `SEQUENCE`: si
 * la transacción falla, el incremento se deshace con ella y el número vuelve.
 * Un borrador que se abandona tampoco deja hueco — queda anulado CON su folio,
 * así que todo número emitido se puede explicar.
 *
 * ── El prefijo es del negocio ────────────────────────────────────────────
 *
 * Lo que se ve en el papel (`ENT`, `VTA`, `TUR`… o `ENT`, `SLS`, `SHF`…) sale
 * del juego de prefijos del negocio (`FOLIO_PREFIX_SETS`), que se fija con
 * su primer folio (ver `folioLanguageOf`). El llamador solo dice la serie.
 *
 * @param tx Transacción del llamador. Esta función NUNCA abre una: quien la
 *   llama decide el alcance, igual que `AuditService.record`.
 * @param series La serie, que es también su llave en `tenant_sequences`
 *   (`entry`, `sale`, `cashbox_session`…).
 */
export async function nextFolio(
  tx: Prisma.TransactionClient,
  tenantId: string,
  series: FolioSeries,
): Promise<string> {
  // El idioma ANTES que el contador: si hay que fijarlo, el lock de la fila
  // del negocio no se toma mientras se sostiene el de la serie.
  const language = await folioLanguageOf(tx, tenantId);
  const value = await nextSequenceValue(tx, tenantId, series);

  return `${folioPrefix(language, series)}-${String(value).padStart(FOLIO_DIGITS, "0")}`;
}

/**
 * El juego de prefijos del negocio, y lo FIJA si todavía no lo tiene.
 *
 * Carlos, 2026-11-16: «el folío no lo define el idioma del usuario sino el
 * idioma principal de un país». El país se elige después de registrarse y se
 * puede editar, así que el juego no se fija al crear el negocio sino con su
 * PRIMER folio, desde el país que tenga en ese momento. Después ya no cambia:
 * una serie no mezcla `TUR-000019` con `SHF-000020`. Un negocio que ya tiene
 * folios sin idioma fijo (el API viejo los emitió durante el deploy) se queda
 * en español.
 *
 * Dos primeros folios simultáneos no se contradicen: el `UPDATE … WHERE
 * folio_language IS NULL` del segundo espera al primero, ya no encuentra la
 * fila sin fijar y relee el idioma que quedó.
 */
export async function folioLanguageOf(
  tx: Prisma.TransactionClient,
  tenantId: string,
): Promise<FolioLanguage> {
  const tenant = await tx.tenant.findUnique({
    where: { id: tenantId },
    select: { folioLanguage: true, country: true },
  });

  if (tenant === null) {
    throw new Error(`No existe el negocio ${tenantId} para tomar su folio`);
  }
  if (isFolioLanguage(tenant.folioLanguage)) return tenant.folioLanguage;

  // Si ya emitió folios sin idioma fijo, los emitió en español: el API viejo
  // durante la ventana del deploy (la migración corre antes). Se queda en
  // español, la misma regla del relleno de la migración, para que su serie no
  // mezcle prefijos. El código de barras diario (`sale_barcode:…`) no cuenta.
  const yaEmitio = await tx.tenantSequence.findFirst({
    where: { tenantId, key: { in: [...FOLIO_SERIES] } },
    select: { key: true },
  });
  const language = yaEmitio ? "es" : folioLanguageForCountry(tenant.country);
  const { count } = await tx.tenant.updateMany({
    where: { id: tenantId, folioLanguage: null },
    data: { folioLanguage: language },
  });
  if (count === 1) return language;

  // Otro primer folio lo fijó mientras tanto: vale el suyo.
  const fijado = await tx.tenant.findUniqueOrThrow({
    where: { id: tenantId },
    select: { folioLanguage: true },
  });
  return isFolioLanguage(fijado.folioLanguage) ? fijado.folioLanguage : language;
}

/**
 * El contador PELADO de una serie: el BigInt crudo, sin prefijo ni padding.
 *
 * Es la mitad de `nextFolio` sin el formato, extraída el 2026-08-24 para el
 * código de barras diario del ticket (`sale_barcode:YYYYMMDD` → consecutivo
 * 0001-9999 que "reinicia" cada día porque cada fecha es una serie NUEVA, no
 * un reset). El formato es del llamador; la atomicidad y la ausencia de
 * huecos —todo lo del docblock de arriba— viven acá.
 */
export async function nextSequenceValue(
  tx: Prisma.TransactionClient,
  tenantId: string,
  key: string,
): Promise<bigint> {
  const [row] = await tx.$queryRaw<{ next_value: bigint }[]>`
    INSERT INTO tenant_sequences (tenant_id, key, next_value)
    VALUES (${tenantId}::uuid, ${key}, 1)
    ON CONFLICT (tenant_id, key)
    DO UPDATE SET next_value = tenant_sequences.next_value + 1, updated_at = now()
    RETURNING next_value`;

  if (row === undefined) {
    // Inalcanzable con la sentencia de arriba (siempre inserta o actualiza),
    // pero el tipo lo admite y un contador vacío sería peor que un error claro.
    throw new Error(`No se pudo obtener el folio de la serie "${key}"`);
  }

  return row.next_value;
}
