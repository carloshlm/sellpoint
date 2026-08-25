import {
  type ColumnDef,
  coreFeatures,
  flexRender,
  type TableFeatures,
  useTable,
} from "@tanstack/react-table";
import { ArrowDown, ArrowUp, ArrowUpDown, Download } from "lucide-react";
import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { ScrollableTable } from "@/components/ui/scrollable-table";

/**
 * F5-HUB-03 — la tabla común de los reportes.
 *
 * ── Por qué server-side, y no ordenar en el cliente ─────────────────────
 *
 * Porque los datasets no caben en una página. Ordenar en el cliente ordena LA
 * PÁGINA, no el reporte: quien pide «los diez productos con más stock»
 * recibiría los diez mayores de las primeras veinte filas y no tendría forma
 * de notarlo — el resultado se ve perfectamente ordenado. Es la clase de
 * mentira que nadie reporta como bug.
 *
 * Por eso la tabla NO tiene modelo de orden ni de paginación propios: solo
 * `getCoreRowModel`, que pinta lo que le dan. Cada clic avisa hacia arriba y
 * quien la monta vuelve a preguntar al servidor, que es el único que ve el
 * conjunto completo.
 */
/** Una fila del reporte: columnas dinámicas, valores ya formateados por el API. */
type Fila = Record<string, unknown>;

export interface ReportColumn {
  key: string;
  header: string;
  /** Solo algunas: ordenar por una columna que el API no sabe ordenar mentiría. */
  sortable?: boolean;
  /** Los números se leen mejor a la derecha y con cifras de ancho fijo. */
  numeric?: boolean;
}

export interface ReportQuery {
  page: number;
  sortBy?: string;
  sortDir?: "asc" | "desc";
}

export interface ReportTableProps {
  columns: readonly ReportColumn[];
  rows: readonly Record<string, unknown>[];
  total: number;
  page: number;
  pageSize: number;
  isPending: boolean;
  sortBy?: string;
  sortDir?: "asc" | "desc";
  error?: string | null;
  onQueryChange: (query: ReportQuery) => void;
  /** Sin él no se pinta el botón: no todo reporte se baja. */
  onExport?: () => void;
}

export function ReportTable({
  columns,
  rows,
  total,
  page,
  pageSize,
  isPending,
  sortBy,
  sortDir,
  error = null,
  onQueryChange,
  onExport,
}: ReportTableProps) {
  const { t } = useTranslation();

  const definiciones = useMemo<ColumnDef<TableFeatures, Fila>[]>(
    () =>
      columns.map((columna) => ({
        id: columna.key,
        header: columna.header,
        accessorFn: (fila: Fila) => fila[columna.key],
        cell: (info: { getValue: () => unknown }) => {
          const valor = info.getValue();
          return valor === null || valor === undefined ? "" : String(valor);
        },
      })),
    [columns],
  );

  // SOLO `coreFeatures`: nada de `rowSortingFeature` ni `rowPaginationFeature`.
  // Esas features ordenan y paginan LO QUE RECIBEN, y lo que recibimos ya es
  // una página ordenada por el servidor — activarlas sería reordenar una
  // muestra y presentarla como el todo. Ver el docblock de arriba.
  const table = useTable({
    features: coreFeatures,
    data: rows as Fila[],
    columns: definiciones,
  });

  const paginas = Math.max(1, Math.ceil(total / pageSize));

  function ordenarPor(key: string) {
    // Al cambiar el orden se vuelve a la página 1: quedarse en la 7 con un
    // orden nuevo muestra filas que no tienen que ver con lo que se pidió, y
    // se lee como un error del sistema.
    const mismaColumna = sortBy === key;
    onQueryChange({
      page: 1,
      sortBy: key,
      sortDir: mismaColumna && sortDir === "asc" ? "desc" : "asc",
    });
  }

  return (
    <div className="flex flex-col gap-3">
      {onExport !== undefined && (
        <div className="flex justify-end">
          <Button variant="outline" size="sm" onClick={onExport} disabled={isPending}>
            <Download className="size-4" aria-hidden="true" />
            {t("reports.table.export")}
          </Button>
        </div>
      )}

      {error !== null ? (
        <p role="alert" className="text-destructive text-sm">
          {error}
        </p>
      ) : isPending ? (
        <p role="status">{t("common.form.loading")}</p>
      ) : rows.length === 0 ? (
        <p className="text-muted-foreground text-sm">{t("reports.table.empty")}</p>
      ) : (
        <ScrollableTable>
          <table className="w-full text-sm">
            <thead>
              {table.getHeaderGroups().map((grupo) => (
                <tr key={grupo.id} className="border-b text-left">
                  {grupo.headers.map((header) => {
                    const columna = columns.find((c) => c.key === header.column.id);
                    const activa = sortBy === header.column.id;
                    return (
                      <th
                        key={header.id}
                        className={`p-2 ${columna?.numeric === true ? "text-right" : ""}`}
                      >
                        {columna?.sortable === true ? (
                          // BOTÓN y no un `<th>` clicable: el orden es una
                          // acción, y con teclado se llega igual que con ratón.
                          <button
                            type="button"
                            className="inline-flex items-center gap-1 font-medium hover:text-foreground"
                            onClick={() => ordenarPor(header.column.id)}
                          >
                            {header.column.columnDef.header as string}
                            {activa ? (
                              sortDir === "desc" ? (
                                <ArrowDown className="size-3" aria-hidden="true" />
                              ) : (
                                <ArrowUp className="size-3" aria-hidden="true" />
                              )
                            ) : (
                              <ArrowUpDown
                                className="size-3 text-muted-foreground"
                                aria-hidden="true"
                              />
                            )}
                          </button>
                        ) : (
                          (header.column.columnDef.header as string)
                        )}
                      </th>
                    );
                  })}
                </tr>
              ))}
            </thead>
            <tbody>
              {table.getRowModel().rows.map((fila) => (
                <tr key={fila.id} className="border-b">
                  {fila.getAllCells().map((celda) => {
                    const columna = columns.find((c) => c.key === celda.column.id);
                    return (
                      <td
                        key={celda.id}
                        className={`p-2 ${columna?.numeric === true ? "text-right tabular-nums" : ""}`}
                      >
                        {flexRender(celda.column.columnDef.cell, celda.getContext())}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </ScrollableTable>
      )}

      {paginas > 1 && (
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            disabled={page <= 1}
            onClick={() => onQueryChange({ page: page - 1, sortBy, sortDir })}
          >
            {t("reports.table.previous")}
          </Button>
          <span className="text-muted-foreground text-sm">
            {t("reports.table.page", { page, pages: paginas })}
          </span>
          <Button
            variant="outline"
            size="sm"
            disabled={page >= paginas}
            onClick={() => onQueryChange({ page: page + 1, sortBy, sortDir })}
          >
            {t("reports.table.next")}
          </Button>
        </div>
      )}
    </div>
  );
}
