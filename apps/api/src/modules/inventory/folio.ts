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
 * @param tx Transacción del llamador. Esta función NUNCA abre una: quien la
 *   llama decide el alcance, igual que `AuditService.record`.
 * @param key La serie. Coincide con el tipo de documento (`entry`, `exit`,
 *   `physical_count`).
 * @param prefix Lo que se ve en el papel (`ENT`, `SAL`, `INV`). Lo elige el
 *   llamador desde `FOLIO_PREFIXES` (F3-DOC-03) para que esta función no
 *   dependa del catálogo de tipos.
 */
export async function nextFolio(
  tx: Prisma.TransactionClient,
  tenantId: string,
  key: string,
  prefix: string,
): Promise<string> {
  const value = await nextSequenceValue(tx, tenantId, key);

  return `${prefix}-${String(value).padStart(FOLIO_DIGITS, "0")}`;
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
