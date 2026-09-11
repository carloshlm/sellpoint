import { normalizeLotCode } from "@sellpoint/shared";
import { useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";
import { DateField } from "@/components/form/date-field";
import { Input } from "@/components/ui/input";
import { useProductLots } from "@/lib/inventory/kardex-hooks";

/**
 * Lote y caducidad de una fila — SOLO si el producto se controla por lote.
 * Extraído de `purchase-lines-table.tsx` (F9-PO-13) para que la compra y la
 * recepción capturen el lote con las MISMAS reglas, sin copiarlas.
 *
 * Un producto sin control no las ofrece: un lote que la entrada RECHAZA no
 * es transporte, es carga que se descubre tarde (el API lo rebota con
 * `purchases.lot_not_tracked`).
 *
 * Mismas dos reglas que Entradas (`document-detail.tsx`): el código se
 * normaliza al teclear (`STM01` y `stm01` serían dos lotes en la base) y la
 * caducidad SIGUE al lote del REGISTRO (con o sin existencias) — si ya existe,
 * su fecha se pone siempre; si no, se limpia, porque es del lote y no de la
 * línea. El ref evita pisar la fecha que el usuario corrija a mano.
 */
export function LotCells({
  productId,
  controlaLote,
  lotCode,
  expiresAt,
  editable,
  onLotCode,
  onExpiresAt,
  lotLabel,
  expiresLabel,
}: {
  productId: string;
  controlaLote: boolean;
  lotCode: string;
  expiresAt: string;
  editable: boolean;
  onLotCode: (valor: string) => void;
  onExpiresAt: (valor: string) => void;
  lotLabel: string;
  expiresLabel: string;
}) {
  const { t } = useTranslation();
  const codigo = lotCode.trim();
  const { data: lotes } = useProductLots(controlaLote && codigo !== "" ? productId : undefined);
  const ultimoLoteProcesado = useRef(codigo);
  useEffect(() => {
    if (codigo === "" || lotes === undefined || ultimoLoteProcesado.current === codigo) return;
    ultimoLoteProcesado.current = codigo;
    const conocido = lotes.find((lot) => lot.lotCode === codigo);
    onExpiresAt(conocido?.expiresAt != null ? conocido.expiresAt.slice(0, 10) : "");
  }, [codigo, lotes, onExpiresAt]);

  if (!controlaLote) {
    return (
      <>
        <td className="p-2 text-muted-foreground">—</td>
        <td className="p-2 text-muted-foreground">—</td>
      </>
    );
  }
  return (
    <>
      <td className="p-2">
        <Input
          aria-label={lotLabel ?? t("inventory.document.lotCode")}
          className="w-28 uppercase"
          value={lotCode}
          disabled={!editable}
          onChange={(event) => onLotCode(normalizeLotCode(event.target.value))}
        />
      </td>
      <td className="p-2">
        <DateField
          label={expiresLabel}
          className="[&>label]:sr-only"
          value={expiresAt}
          disabled={!editable}
          onChange={(event) => onExpiresAt(event.target.value)}
        />
      </td>
    </>
  );
}
