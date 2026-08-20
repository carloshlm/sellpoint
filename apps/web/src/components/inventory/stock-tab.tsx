import { unitName } from "@sellpoint/shared";
import { Link } from "@tanstack/react-router";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Badge } from "@/components/ui/badge";
import { ScrollableTable } from "@/components/ui/scrollable-table";
import { resolveUiLocale } from "@/lib/accept-language";
import { usePermissions } from "@/lib/auth/permissions";
import { formatCalendarDate } from "@/lib/inventory/format-date";
import { useInTransit, useStock } from "@/lib/inventory/kardex-hooks";
import { LotEditor } from "./lot-editor";

/**
 * F3-KARDEX-05 — dónde está el stock de un producto.
 *
 * **Los almacenes en CERO se muestran.** "Nunca llegó a esta bodega" y "se
 * agotó en esta bodega" piden decisiones distintas, y sin la fila no se
 * distinguen. Por eso el servidor devuelve una fila por almacén del alcance y
 * `updatedAt: null` cuando nunca se movió nada.
 *
 * En productos con lote, el PRIMERO de la lista se marca: es el que el sistema
 * va a descontar (FEFO). Decirlo evita la sorpresa de ver salir una partida
 * distinta de la que uno tenía en mente.
 */
export function StockTab({ productId }: { productId: string }) {
  const { t, i18n } = useTranslation();
  const { has } = usePermissions();
  const { data, isPending } = useStock(productId);
  const { data: transito } = useInTransit(productId);
  const [editando, setEditando] = useState<string | null>(null);
  const puedeEditar = has("inventory:movement");

  if (isPending || data === undefined) {
    return <p className="text-muted-foreground text-sm">{t("common.form.loading")}</p>;
  }

  const unidad = unitName(data.baseUnit, resolveUiLocale(i18n), { plural: true }).toLowerCase();

  // Un compuesto no tiene saldo propio: se arma al consumirlo. Lo que importa
  // es cuántas unidades salen con lo que hay, y qué componente lo limita.
  if (data.isComposite) {
    return (
      <div className="flex flex-col gap-2">
        <p className="text-sm">
          {t("inventory.kardex.assemblable", { units: data.availability?.units ?? 0 })}
        </p>
        {data.availability?.limitingComponent != null && (
          <p className="text-muted-foreground text-sm">
            {t("inventory.kardex.limitedBy", {
              sku: data.availability.limitingComponent.sku,
              name: data.availability.limitingComponent.name,
            })}
          </p>
        )}
      </div>
    );
  }

  const enTransito = transito?.rows.find((row) => row.productId === productId);

  return (
    <div className="flex flex-col gap-4">
      <ScrollableTable>
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b text-left text-muted-foreground">
              <th className="px-2 py-2 font-medium">{t("inventory.kardex.warehouse")}</th>
              <th className="px-2 py-2 font-medium">{t("inventory.kardex.quantity")}</th>
              <th className="px-2 py-2 font-medium">{t("inventory.kardex.stockUpdated")}</th>
            </tr>
          </thead>
          <tbody>
            {data.rows.map((row) => (
              <>
                <tr key={row.warehouseId} className="border-b last:border-0">
                  <td className="px-2 py-2">{row.name}</td>
                  <td className="px-2 py-2">
                    {row.quantity} {unidad}
                  </td>
                  <td className="px-2 py-2 text-muted-foreground">
                    {/* `null` no es una fecha vieja: nunca se movió nada acá. */}
                    {row.updatedAt === null
                      ? t("inventory.kardex.stockNever")
                      : new Intl.DateTimeFormat(resolveUiLocale(i18n), {
                          dateStyle: "short",
                        }).format(new Date(row.updatedAt))}
                  </td>
                </tr>
                {(row.lots ?? []).map((lot, index) => (
                  <tr key={lot.lotId} className="border-b border-dashed last:border-0 text-xs">
                    <td className="py-1 pl-6">
                      {lot.lotCode}
                      {lot.location !== "" && (
                        <span className="ml-2 text-muted-foreground">{lot.location}</span>
                      )}
                      {/* El primero FEFO es el que el sistema va a descontar. */}
                      {index === 0 && (
                        <Badge data-testid="fefo-first" variant="default" className="ml-2">
                          {t("inventory.kardex.fefoFirst")}
                        </Badge>
                      )}
                      {lot.expiringSoon && (
                        <Badge data-testid="expiring-soon" variant="warning" className="ml-2">
                          {t("inventory.kardex.expiringSoon")}
                        </Badge>
                      )}
                    </td>
                    <td className="py-1">{lot.quantity}</td>
                    <td className="py-1 text-muted-foreground">
                      {lot.expiresAt === null
                        ? "—"
                        : formatCalendarDate(lot.expiresAt, resolveUiLocale(i18n))}
                      {puedeEditar && (
                        <button
                          type="button"
                          onClick={() => setEditando(editando === lot.lotId ? null : lot.lotId)}
                          className="ml-2 underline"
                        >
                          {t("inventory.kardex.editLot")}
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
                {(row.lots ?? [])
                  .filter((lot) => lot.lotId === editando)
                  .map((lot) => (
                    <tr key={`${lot.lotId}-editor`}>
                      <td colSpan={3} className="py-2">
                        <LotEditor
                          productId={productId}
                          lot={lot}
                          onClose={() => setEditando(null)}
                        />
                      </td>
                    </tr>
                  ))}
              </>
            ))}
          </tbody>
          <tfoot>
            <tr className="border-t font-medium">
              <td className="px-2 py-2">{t("inventory.kardex.stockTotal")}</td>
              <td className="px-2 py-2">
                {data.total} {unidad}
                {data.belowMin && (
                  <Badge
                    data-testid="below-min"
                    variant="destructive"
                    className="ml-2"
                    title={t("inventory.kardex.belowMinTitle", { min: data.stockMin })}
                  >
                    {t("inventory.kardex.belowMin")}
                  </Badge>
                )}
              </td>
              <td />
            </tr>
            {enTransito !== undefined && (
              <tr data-testid="in-transit" className="text-muted-foreground">
                <td className="px-2 py-2" title={t("inventory.kardex.inTransitHint")}>
                  {t("inventory.kardex.inTransit")}
                </td>
                <td className="px-2 py-2">
                  {enTransito.quantity} {unidad}
                </td>
                <td />
              </tr>
            )}
          </tfoot>
        </table>
      </ScrollableTable>
      {has("inventory:movement") && (
        <div className="flex gap-2">
          <Link
            to="/movements/entries"
            className="rounded-md border border-input px-3 py-2 text-sm"
          >
            {t("inventory.kardex.registerEntry")}
          </Link>
          <Link to="/movements/exits" className="rounded-md border border-input px-3 py-2 text-sm">
            {t("inventory.kardex.registerExit")}
          </Link>
        </div>
      )}
    </div>
  );
}
