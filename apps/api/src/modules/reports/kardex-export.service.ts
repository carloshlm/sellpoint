import { Injectable } from "@nestjs/common";
import { exportWithLimit } from "../../common/spreadsheet/export-guard";
import type { SpreadsheetFormat } from "../../common/spreadsheet/spreadsheet";
import type { UserScope } from "../../infrastructure/warehouse-scope/request-warehouse-scope";
import type { AuthUser } from "../auth/types/auth-user";
import { KardexService } from "../inventory/kardex.service";
import type { KardexExportFilters } from "./dto/kardex-export.dto";

/** El tope por página del propio kardex: pedir más lo recorta en silencio. */
const PAGE_SIZE = 200;

/**
 * F5-KDX-01 — el kardex en Excel.
 *
 * ── Por qué REUSA `kardex.service.list` y no consulta por su cuenta ──────
 *
 * Porque el `balanceAfter` es lo único que justifica que el kardex exista, y
 * lo calcula una window function sobre el orden total de los movimientos
 * (`created_at DESC, seq DESC`). Una segunda implementación daría los mismos
 * números hasta el día que no, y ese día nadie sabría a cuál creerle.
 *
 * Reusar el servicio trae de arriba, gratis, todo lo que ya sabe: el rango en
 * días del calendario del negocio, el alcance por almacén y el 404 del
 * producto ajeno.
 */
@Injectable()
export class KardexExportService {
  constructor(private readonly kardex: KardexService) {}

  async build(
    user: AuthUser,
    scope: UserScope,
    productId: string,
    query: KardexExportFilters,
    format: SpreadsheetFormat,
  ) {
    // La primera página se pide ANTES del tope: es la que dice cuántas filas
    // hay en total, y de paso valida el producto y el alcance —así el 404 y el
    // 403 llegan antes que cualquier archivo a medio armar—.
    const primera = await this.kardex.list(user, scope, productId, {
      ...query,
      page: 1,
      pageSize: PAGE_SIZE,
    });

    return exportWithLimit({
      count: async () => primera.total,
      rows: async () => {
        const filas = [...primera.rows];
        // Las páginas siguientes solo si hacen falta: la mayoría de los
        // productos cabe en una.
        for (let page = 2; filas.length < primera.total; page += 1) {
          const siguiente = await this.kardex.list(user, scope, productId, {
            ...query,
            page,
            pageSize: PAGE_SIZE,
          });
          if (siguiente.rows.length === 0) {
            break;
          }
          filas.push(...siguiente.rows);
        }

        return filas.map((fila) => [
          // Solo la fecha y la hora, sin zona: el Excel se lee, no se parsea.
          fila.createdAt.toISOString().slice(0, 16).replace("T", " "),
          fila.document.folio,
          fila.document.type,
          fila.direction === "entry" ? "Entrada" : "Salida",
          fila.reasonCode,
          // Lote y ubicación (decisión 5 de la revisión pre-F5): el papel no
          // puede contar menos que la pantalla, que ya los muestra.
          fila.lot?.lotCode ?? "",
          fila.location ?? "",
          fila.warehouse.name,
          // El signo va en la CANTIDAD y no en una columna aparte: así una
          // suma de la columna en Excel da el saldo, que es lo primero que
          // alguien intenta hacer con este archivo.
          fila.direction === "entry" ? fila.quantity : `-${fila.quantity}`,
          fila.balanceAfter,
          fila.unitCost ?? "",
          fila.createdBy.name,
        ]);
      },
      header: [
        "Fecha",
        "Folio",
        "Tipo",
        "Movimiento",
        "Motivo",
        "Lote",
        "Ubicación",
        "Almacén",
        "Cantidad",
        "Saldo",
        "Costo unitario",
        "Usuario",
      ],
      format,
      sheetName: "Kardex",
      filenameBase: "kardex",
    });
  }
}
