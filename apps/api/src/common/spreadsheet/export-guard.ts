import { BadRequestException } from "@nestjs/common";
import {
  type SpreadsheetFormat,
  type SpreadsheetOptions,
  serializeSpreadsheet,
} from "./spreadsheet";

/**
 * F5-CORE-02 — el tope de filas de TODO export de reportes.
 *
 * ── Por qué un tope y no una cola ───────────────────────────────────────
 *
 * La cola Redis + worker + S3 que prometía el viejo FLUJOS §8 quedó DIFERIDA
 * con el criterio de F4-PRINT-BT: sin un tenant real cuyos reportes desborden
 * con filtros razonables, montar esa infraestructura sería código de fe. El
 * tope es la promesa que sí se puede cumplir hoy, y el día que un cliente lo
 * golpee de verdad, ese golpe será el caso que justifique la cola.
 *
 * ── Por qué 400 y no un archivo truncado ────────────────────────────────
 *
 * Un Excel cortado **se lee como completo**: quien lo abre no tiene forma de
 * saber que faltan filas, y decide sobre un pedazo del inventario creyendo que
 * es todo. Preferimos el rechazo ruidoso que pide acotar filtros.
 *
 * ── Por qué `count` y `rows` son DOS funciones ──────────────────────────
 *
 * Para que las filas no se materialicen cuando el dataset desborda. Si el
 * helper recibiera las filas ya armadas, el tope las rechazaría DESPUÉS de que
 * la base las trajo y el proceso las sostuvo en memoria — que es exactamente
 * el problema del que el tope viene a proteger. El `COUNT` va primero y el
 * `SELECT` solo ocurre si el resultado cabe.
 */
export const MAX_EXPORT_ROWS = 10_000;

export interface ExportWithLimitInput extends SpreadsheetOptions {
  /** El `COUNT` con los filtros ya aplicados. Corre SIEMPRE, y primero. */
  count: () => Promise<number>;
  /** El `SELECT` sin paginar. Solo corre si el dataset cabe bajo el tope. */
  rows: () => Promise<readonly (readonly string[])[]>;
  /** Los encabezados. Los pone el helper para que ningún reporte los olvide. */
  header: readonly string[];
  format: SpreadsheetFormat;
}

export async function exportWithLimit(
  input: ExportWithLimitInput,
): Promise<{ body: Buffer; contentType: string; filename: string }> {
  const { count, rows, header, format, ...options } = input;

  const total = await count();
  if (total > MAX_EXPORT_ROWS) {
    // Los números van en `args` y no incrustados en la clave: el mensaje se
    // traduce y «acota los filtros» sin cifras deja a la persona adivinando
    // si sobran diez filas o cien mil.
    throw new BadRequestException({
      message: "reports.export_too_large",
      args: { max: MAX_EXPORT_ROWS, total },
    });
  }

  // Cero resultados NO es un error: es la respuesta legítima de un filtro, y
  // la planilla con solo encabezados dice «acá no hay nada», que es la verdad.
  const data = await rows();
  return serializeSpreadsheet([header, ...data], format, options);
}
