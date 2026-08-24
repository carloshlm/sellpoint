import { Injectable } from "@nestjs/common";
import { exportWithLimit } from "../../common/spreadsheet/export-guard";
import type { UserScope } from "../../infrastructure/warehouse-scope/request-warehouse-scope";
import type { AuthUser } from "../auth/types/auth-user";
import type { StockExportQueryDto } from "./dto/stock-report.dto";
import { StockReportService } from "./stock-report.service";

/** El tope alto de una sola página: el export no pagina, lo acota el límite. */
const SIN_PAGINAR = { page: 1, pageSize: 100 } as const;

/**
 * F5-STK-02 — el reporte de stock en Excel.
 *
 * Reusa `StockReportService`, así que el archivo y la pantalla salen de la
 * MISMA consulta: no hay una segunda implementación que algún día diga otra
 * cosa. Y pasa por `exportWithLimit`, que cuenta antes de traer: sobre el tope
 * responde 400 pidiendo acotar filtros en vez de bajar un Excel cortado, que
 * se lee como completo.
 */
@Injectable()
export class StockExportService {
  constructor(private readonly stock: StockReportService) {}

  async build(user: AuthUser, scope: UserScope, query: StockExportQueryDto) {
    const esDetalle = query.detail === "lots";

    return exportWithLimit({
      count: () => this.stock.count(user, scope, { ...query, ...SIN_PAGINAR }),
      rows: () =>
        esDetalle ? this.filasDeLotes(user, scope, query) : this.filas(user, scope, query),
      header: esDetalle
        ? ["Producto", "SKU", "Almacén", "Lote", "Caducidad", "Ubicación", "Cantidad", "Unidad"]
        : [
            "Producto",
            "SKU",
            "Almacén",
            "Cantidad",
            "Unidad",
            "Mínimo",
            "Bajo mínimo",
            "Costo promedio",
            "Valor",
          ],
      format: query.format,
      sheetName: esDetalle ? "Stock por lote" : "Stock",
      filenameBase: esDetalle ? "stock-por-lote" : "stock",
    });
  }

  /**
   * Trae TODO lo que los filtros dejen, de a páginas.
   *
   * Se pagina internamente porque `pageSize` está acotado en el DTO —el mismo
   * tope que protege a la pantalla— y el export puede llevarse hasta el
   * límite de filas. Que la consulta ya haya pasado por el contador del tope
   * es lo que hace seguro este bucle.
   */
  private async paginar<T>(
    traer: (page: number) => Promise<{ rows: T[]; total: number }>,
  ): Promise<T[]> {
    const acumulado: T[] = [];
    let page = 1;
    while (true) {
      const { rows, total } = await traer(page);
      acumulado.push(...rows);
      if (acumulado.length >= total || rows.length === 0) {
        return acumulado;
      }
      page += 1;
    }
  }

  private async filas(user: AuthUser, scope: UserScope, query: StockExportQueryDto) {
    const rows = await this.paginar((page) =>
      this.stock.list(user, scope, { ...query, ...SIN_PAGINAR, page }),
    );

    return rows.map((fila) => [
      fila.name,
      fila.sku,
      fila.warehouseName,
      fila.quantity,
      fila.baseUnit,
      fila.stockMin,
      fila.belowMin ? "Sí" : "",
      // La celda VACÍA y no un cero: sin historial no sabemos cuánto costó, y
      // un 0 en la columna de valor se sumaría al total del inventario.
      fila.avgCost ?? "",
      fila.totalValue ?? "",
    ]);
  }

  private async filasDeLotes(user: AuthUser, scope: UserScope, query: StockExportQueryDto) {
    const rows = await this.paginar((page) =>
      this.stock.listLots(user, scope, { ...query, ...SIN_PAGINAR, page }),
    );

    return rows.map((fila) => [
      fila.name,
      fila.sku,
      fila.warehouseName,
      fila.lotCode,
      fila.expiresAt ?? "",
      fila.location,
      fila.quantity,
      fila.baseUnit,
    ]);
  }
}
