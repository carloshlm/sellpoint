import { MOVEMENT_REASONS } from "@sellpoint/shared";
import { Link } from "@tanstack/react-router";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { resolveUiLocale } from "@/lib/accept-language";
import { useKardex } from "@/lib/inventory/kardex-hooks";
import { WarehouseSelect } from "./warehouse-select";

interface KardexTabProps {
  productId: string;
  tracksLots: boolean;
  isComposite: boolean;
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
export function KardexTab({ productId, tracksLots, isComposite }: KardexTabProps) {
  const { t, i18n } = useTranslation();
  const [warehouseId, setWarehouseId] = useState<string | null>(null);
  const [reasonCode, setReasonCode] = useState("");
  const [direction, setDirection] = useState("");

  const { data, isPending } = useKardex(isComposite ? undefined : productId, {
    ...(warehouseId !== null ? { warehouseId } : {}),
    ...(reasonCode !== "" ? { reasonCode } : {}),
    ...(direction !== "" ? { direction: direction as "entry" | "exit" } : {}),
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
      </div>

      {isPending ? (
        <p className="text-muted-foreground text-sm">{t("common.form.loading")}</p>
      ) : (data?.rows.length ?? 0) === 0 ? (
        <p className="text-muted-foreground text-sm">{t("inventory.kardex.empty")}</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b text-left text-muted-foreground">
                <th className="py-2 font-medium">{t("inventory.kardex.date")}</th>
                <th className="py-2 font-medium">{t("inventory.kardex.movement")}</th>
                <th className="py-2 font-medium">{t("inventory.kardex.quantity")}</th>
                {tracksLots && <th className="py-2 font-medium">{t("inventory.kardex.lot")}</th>}
                <th className="py-2 font-medium">{t("inventory.kardex.warehouse")}</th>
                <th className="py-2 font-medium">{t("inventory.kardex.reference")}</th>
                <th className="py-2 font-medium">{t("inventory.kardex.who")}</th>
                <th className="py-2 font-medium">{t("inventory.kardex.balance")}</th>
              </tr>
            </thead>
            <tbody>
              {(data?.rows ?? []).map((row) => (
                <tr key={row.id} className="border-b last:border-0">
                  <td className="py-2 whitespace-nowrap">{fecha(row.createdAt)}</td>
                  <td className="py-2">
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
                  <td className="py-2">
                    {/* El signo lo da la dirección: un kardex sin signo obliga
                        a leer dos columnas para saber si sumó o restó. */}
                    {row.direction === "entry" ? "+" : "−"}
                    {row.quantity}
                    {row.presentation !== null && (
                      <span className="ml-2 text-muted-foreground text-xs">
                        {row.presentation.quantityInPresentation} {row.presentation.name}
                      </span>
                    )}
                  </td>
                  {tracksLots && (
                    <td className="py-2">
                      {row.lot?.lotCode ?? "—"}
                      {row.location !== null && row.location !== "" && (
                        <span className="ml-2 text-muted-foreground text-xs">{row.location}</span>
                      )}
                    </td>
                  )}
                  <td className="py-2">{row.warehouse.name}</td>
                  <td className="py-2">
                    <Link
                      to="/movements/documents/$documentId"
                      params={{ documentId: row.document.id }}
                      className="font-mono underline"
                    >
                      {row.document.folio}
                    </Link>
                    {row.reference !== null && (
                      <span className="ml-2 text-muted-foreground text-xs">{row.reference}</span>
                    )}
                  </td>
                  <td className="py-2">{row.createdBy.name}</td>
                  <td data-testid="balance-after" className="py-2 font-medium">
                    {row.balanceAfter}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
