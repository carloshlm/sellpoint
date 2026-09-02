import { formatQuantity, MOVEMENT_REASONS } from "@sellpoint/shared";
import { Link } from "@tanstack/react-router";
import { Download } from "lucide-react";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  DateRangeFilter,
  type RangoDeFechas,
  rangoUltimosDias,
} from "@/components/common/date-range-filter";
import { Button } from "@/components/ui/button";
import { Paginator } from "@/components/ui/paginator";
import { ScrollableTable } from "@/components/ui/scrollable-table";
import { resolveUiLocale } from "@/lib/accept-language";
import { downloadKardex } from "@/lib/inventory/kardex-api";
import { useKardex } from "@/lib/inventory/kardex-hooks";
import { WarehouseSelect } from "./warehouse-select";

interface KardexTabProps {
  productId: string;
  tracksLots: boolean;
  isComposite: boolean;
  /**
   * La unidad en la que se mide el producto. Decide cuántos decimales tienen
   * sentido: lo que se cuenta en piezas no puede tener medias piezas, así que
   * `262.0000` son cuatro dígitos que nunca van a significar nada.
   */
  baseUnit: string;
}

/**
 * F3-KARDEX-02 — el kardex de un producto.
 *
 * **La columna que justifica la pantalla es `balanceAfter`**: la lista de
 * movimientos la da cualquier consulta, pero el saldo que QUEDÓ después de
 * cada línea es lo que permite auditar sin recalcular a mano. Viene del
 * servidor, calculado sobre todo el histórico — la pantalla nunca lo suma.
 *
 * Las columnas de lote solo aparecen si el producto los maneja: en uno que no,
 * son tres columnas vacías que solo hacen scroll.
 */
/** Lo que se ve al abrir. Ver la nota del estado `rango`. */
const DIAS_INICIALES = 30;

export function KardexTab({ productId, tracksLots, isComposite, baseUnit }: KardexTabProps) {
  const { t, i18n } = useTranslation();
  const [warehouseId, setWarehouseId] = useState<string | null>(null);
  const [reasonCode, setReasonCode] = useState("");
  const [direction, setDirection] = useState("");

  /**
   * Arranca acotado a los últimos 30 días (Carlos, 2026-08-23). Un kardex de
   * un producto con dos años de historia abre con cientos de renglones y el
   * usuario no encuentra el de ayer. El histórico completo sigue a un clic:
   * se limpian las fechas y vuelve todo.
   *
   * El estado inicial se calcula UNA vez —función perezosa de `useState`— y no
   * en cada render: si no, un turno abierto a medianoche vería el rango
   * moverse solo bajo los pies.
   */
  const [rango, setRango] = useState<RangoDeFechas>(() => rangoUltimosDias(DIAS_INICIALES));

  /**
   * Los filtros, separados de todo lo demás: el export los reusa TAL CUAL.
   * Si el archivo se armara con otra lista, bajaría un universo distinto del
   * que la pantalla muestra y nadie lo notaría hasta abrirlo.
   */
  const filtrosDelExport = {
    ...(warehouseId !== null ? { warehouseId } : {}),
    ...(reasonCode !== "" ? { reasonCode } : {}),
    ...(direction !== "" ? { direction: direction as "entry" | "exit" } : {}),
    ...(rango.from !== "" ? { from: rango.from } : {}),
    ...(rango.to !== "" ? { to: rango.to } : {}),
  };
  const [exportando, setExportando] = useState(false);
  const [pagina, setPagina] = useState(1);

  // Cualquier filtro vuelve a la página 1 (ver el docblock del Paginator).
  // biome-ignore lint/correctness/useExhaustiveDependencies: las deps SON los filtros
  useEffect(() => {
    setPagina(1);
  }, [warehouseId, reasonCode, direction, rango.from, rango.to]);

  const { data, isPending } = useKardex(isComposite ? undefined : productId, {
    ...filtrosDelExport,
    page: pagina,
  });

  // Un compuesto no tiene movimientos propios: se arma al consumirlo. Una
  // tabla vacía haría pensar que nunca se movió, que es otra cosa.
  if (isComposite) {
    return <p className="text-muted-foreground text-sm">{t("inventory.kardex.compositeHint")}</p>;
  }

  const fecha = (iso: string) =>
    new Intl.DateTimeFormat(resolveUiLocale(i18n), {
      dateStyle: "short",
      timeStyle: "short",
    }).format(new Date(iso));

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-end gap-3">
        {/* El orden lo pidió Carlos (2026-08-24): primero DÓNDE y QUÉ tipo de
            movimiento —lo que acota de verdad— y las fechas cierran. Abrir
            por el rango es empezar por el filtro más fino sobre el conjunto
            más grande. */}
        <div className="flex min-w-48 flex-col gap-1">
          <label htmlFor="kardex-warehouse" className="font-medium text-sm">
            {t("inventory.kardex.warehouse")}
          </label>
          <WarehouseSelect
            id="kardex-warehouse"
            value={warehouseId}
            onChange={setWarehouseId}
            scoped
          />
        </div>

        <div className="flex min-w-48 flex-col gap-1">
          <label htmlFor="kardex-reason" className="font-medium text-sm">
            {t("inventory.document.reason")}
          </label>
          <select
            id="kardex-reason"
            value={reasonCode}
            onChange={(event) => setReasonCode(event.target.value)}
            className="rounded-md border border-input bg-background px-3 py-2 text-sm"
          >
            <option value="">{t("inventory.kardex.allReasons")}</option>
            {MOVEMENT_REASONS.map((reason) => (
              <option key={reason} value={reason}>
                {t(`inventory.reason.${reason}`)}
              </option>
            ))}
          </select>
        </div>

        <div className="flex min-w-40 flex-col gap-1">
          <label htmlFor="kardex-direction" className="font-medium text-sm">
            {t("inventory.kardex.movement")}
          </label>
          <select
            id="kardex-direction"
            value={direction}
            onChange={(event) => setDirection(event.target.value)}
            className="rounded-md border border-input bg-background px-3 py-2 text-sm"
          >
            <option value="">{t("inventory.kardex.allDirections")}</option>
            <option value="entry">{t("inventory.direction.entry")}</option>
            <option value="exit">{t("inventory.direction.exit")}</option>
          </select>
        </div>

        <DateRangeFilter id="kardex" from={rango.from} to={rango.to} onChange={setRango} />

        {/* El export baja lo MISMO que la pantalla muestra: los filtros
            vigentes viajan con él.

            SIN guarda de `isComposite`: el componente ya retornó arriba si lo
            es —un compuesto no tiene kardex propio, se arma al consumirlo—.
            Una contraprueba lo demostró: agregar `!isComposite &&` acá no
            ponía rojo ningún test, porque el caso del que protegería no puede
            llegar hasta esta línea. */}
        {
          <Button
            variant="outline"
            size="sm"
            className="mb-0.5"
            disabled={exportando}
            onClick={() => {
              setExportando(true);
              void downloadKardex(productId, filtrosDelExport).finally(() => setExportando(false));
            }}
          >
            <Download className="size-4" aria-hidden="true" />
            {t("reports.table.export")}
          </Button>
        }
      </div>

      {isPending ? (
        <p className="text-muted-foreground text-sm">{t("common.form.loading")}</p>
      ) : (data?.rows.length ?? 0) === 0 ? (
        <p className="text-muted-foreground text-sm">{t("inventory.kardex.empty")}</p>
      ) : (
        <ScrollableTable>
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b text-left text-muted-foreground">
                <th className="px-2 py-2 font-medium">{t("inventory.kardex.date")}</th>
                <th className="px-2 py-2 font-medium">{t("inventory.kardex.movement")}</th>
                <th className="px-2 py-2 font-medium">{t("inventory.kardex.quantity")}</th>
                {tracksLots && (
                  <th className="px-2 py-2 font-medium">{t("inventory.kardex.lot")}</th>
                )}
                <th className="px-2 py-2 font-medium">{t("inventory.kardex.warehouse")}</th>
                <th className="px-2 py-2 font-medium">{t("inventory.kardex.reference")}</th>
                <th className="px-2 py-2 font-medium">{t("inventory.kardex.who")}</th>
                <th className="px-2 py-2 font-medium">{t("inventory.kardex.balance")}</th>
              </tr>
            </thead>
            <tbody>
              {(data?.rows ?? []).map((row) => (
                <tr key={row.id} className="border-b last:border-0">
                  <td className="px-2 py-2 whitespace-nowrap">{fecha(row.createdAt)}</td>
                  <td className="px-2 py-2">
                    <span
                      className={`rounded-full px-2 py-0.5 text-xs ${
                        row.direction === "entry"
                          ? "bg-success-soft text-success"
                          : "bg-destructive/10 text-destructive"
                      }`}
                    >
                      {t(`inventory.direction.${row.direction}`)}
                    </span>
                    <span className="ml-2 text-muted-foreground">
                      {t(`inventory.reason.${row.reasonCode}`)}
                    </span>
                  </td>
                  <td className="px-2 py-2">
                    {/* El signo lo da la dirección: un kardex sin signo obliga
                        a leer dos columnas para saber si sumó o restó. */}
                    {row.direction === "entry" ? "+" : "−"}
                    {/* Sin etiqueta de unidad (Carlos, 2026-09-02, revisado), y lo
                        tecleado en presentación solo cuando el factor no es 1:
                        «50 Pieza» junto a «+50» es decir lo mismo dos veces;
                        «3 Caja ×12» junto a «+36» sí cuenta algo. */}
                    {formatQuantity(row.quantity, baseUnit)}
                    {row.presentation !== null && Number(row.presentation.factor) !== 1 && (
                      <span className="ml-2 text-muted-foreground text-xs">
                        {row.presentation.quantityInPresentation} {row.presentation.name}
                      </span>
                    )}
                  </td>
                  {tracksLots && (
                    <td className="px-2 py-2">
                      {row.lot?.lotCode ?? "—"}
                      {row.location !== null && row.location !== "" && (
                        <span className="ml-2 text-muted-foreground text-xs">{row.location}</span>
                      )}
                    </td>
                  )}
                  <td className="px-2 py-2">{row.warehouse.name}</td>
                  <td className="px-2 py-2">
                    <Link
                      to="/movements/documents/$documentId"
                      params={{ documentId: row.document.id }}
                      className="font-mono underline"
                    >
                      {row.document.folio}
                    </Link>
                    {/* La referencia solo si DICE algo distinto: en una venta
                        el API la llena con el folio mismo, y repetir lo que el
                        enlace ya dice es ruido (Carlos, 2026-08-24). Cuando
                        trae una factura o una remisión, sí aporta. */}
                    {row.reference !== null && row.reference !== row.document.folio && (
                      <span className="ml-2 text-muted-foreground text-xs">{row.reference}</span>
                    )}
                  </td>
                  <td className="px-2 py-2">{row.createdBy.name}</td>
                  <td data-testid="balance-after" className="py-2 font-medium">
                    {formatQuantity(row.balanceAfter, baseUnit)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </ScrollableTable>
      )}
      <Paginator
        page={pagina}
        pageSize={data?.pageSize ?? 50}
        total={data?.total ?? 0}
        onPageChange={setPagina}
      />
    </div>
  );
}
