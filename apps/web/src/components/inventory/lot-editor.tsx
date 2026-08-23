import { normalizeLotCode } from "@sellpoint/shared";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { ConfirmDialog } from "@/components/common/confirm-dialog";
import type { ApiError } from "@/lib/api";
import type { StockLotRow } from "@/lib/inventory/kardex-api";
import { updateLot } from "@/lib/inventory/kardex-api";
import { STOCK_QUERY_KEY } from "@/lib/inventory/kardex-hooks";

/**
 * F3-LOTS-04 — corregir un lote mal cargado.
 *
 * **Cambiar la caducidad NO es lo mismo que corregir un typo en el código**,
 * aunque el formulario sea el mismo: la fecha decide qué partida sale primero
 * (FEFO), así que corregirla reordena de dónde va a salir la próxima venta.
 *
 * Por eso el diálogo aparece SOLO cuando cambia la fecha. Pedir confirmación
 * para todo entrena a aceptar sin leer, y el día que importa ya nadie lee.
 */
export function LotEditor({
  productId,
  lot,
  onClose,
}: {
  productId: string;
  lot: StockLotRow;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const [lotCode, setLotCode] = useState(lot.lotCode);
  const [expiresAt, setExpiresAt] = useState(lot.expiresAt?.slice(0, 10) ?? "");
  const [confirmando, setConfirmando] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fechaOriginal = lot.expiresAt?.slice(0, 10) ?? "";
  const cambiaFecha = expiresAt !== fechaOriginal;
  const cambiaCodigo = lotCode !== lot.lotCode;

  const guardar = useMutation({
    mutationFn: () =>
      updateLot(productId, lot.lotId, {
        ...(cambiaCodigo ? { lotCode } : {}),
        ...(cambiaFecha ? { expiresAt: expiresAt === "" ? null : expiresAt } : {}),
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: STOCK_QUERY_KEY });
      onClose();
    },
    onError: (apiError: ApiError) => {
      setConfirmando(false);
      // El 409 tiene su propio mensaje traducido por el filtro del API: se
      // muestra tal cual en vez de inventar uno genérico.
      setError(apiError.message || t("inventory.kardex.saveFailed"));
    },
  });

  return (
    <div className="flex flex-col gap-3 rounded-md border border-input p-3">
      <div className="flex flex-wrap gap-3">
        <div className="flex flex-col gap-1">
          <label htmlFor="lot-code" className="font-medium text-sm">
            {t("inventory.kardex.lotCode")}
          </label>
          <input
            id="lot-code"
            type="text"
            value={lotCode}
            onChange={(event) =>
              // Se normaliza AL TECLEAR y no solo al guardar: el API también lo
              // hace —esa es la garantía de los datos— pero si la pantalla no,
              // el cajero escribe `stm01`, guarda, y al recargar ve `STM01`.
              setLotCode(normalizeLotCode(event.target.value))
            }
            className="rounded-md border border-input bg-background px-3 py-2 text-sm"
          />
        </div>
        <div className="flex flex-col gap-1">
          <label htmlFor="lot-expires" className="font-medium text-sm">
            {t("inventory.kardex.expiresAt")}
          </label>
          <input
            id="lot-expires"
            type="date"
            value={expiresAt}
            onChange={(event) => setExpiresAt(event.target.value)}
            className="rounded-md border border-input bg-background px-3 py-2 text-sm"
          />
        </div>
      </div>

      {error !== null && (
        <p role="alert" className="text-destructive text-sm">
          {error}
        </p>
      )}

      <div className="flex gap-2">
        <button
          type="button"
          disabled={guardar.isPending || (!cambiaCodigo && !cambiaFecha)}
          onClick={() => {
            setError(null);
            // La fecha reordena FEFO: eso se pregunta. Un código no.
            if (cambiaFecha) {
              setConfirmando(true);
              return;
            }
            guardar.mutate();
          }}
          className="rounded-md bg-primary px-3 py-2 text-primary-foreground text-sm disabled:opacity-50"
        >
          {t("inventory.kardex.save")}
        </button>
        <button
          type="button"
          onClick={onClose}
          className="rounded-md border border-input px-3 py-2 text-sm"
        >
          {t("common.form.cancel")}
        </button>
      </div>

      {confirmando && (
        <ConfirmDialog
          title={t("inventory.kardex.expiryWarningTitle", { lotCode: lot.lotCode })}
          body={t("inventory.kardex.expiryWarning")}
          confirmLabel={t("inventory.kardex.expiryConfirm")}
          cancelLabel={t("common.form.cancel")}
          busy={guardar.isPending}
          onCancel={() => setConfirmando(false)}
          onConfirm={() => guardar.mutate()}
        />
      )}
    </div>
  );
}
