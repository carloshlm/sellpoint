import { useState } from "react";
import { useTranslation } from "react-i18next";
import { WarehouseSelect } from "@/components/inventory/warehouse-select";
import { Button } from "@/components/ui/button";
import { useOpenSession, usePosWarehouses } from "@/lib/pos/hooks";

/**
 * Abrir turno.
 *
 * Acá sí se MUEVE stock: solo las sucursales activas dentro del alcance del
 * usuario. Salen de la lista de la CAJA (`GET /pos/warehouses`, con
 * `pos:sell`) y no de la de inventario, que exige `warehouses:read`: el rol de
 * fábrica Seller no lo tiene, y la primera pantalla del día del cajero decía
 * «No hay sucursales disponibles» (F10-MANFIX-08). `WarehouseSelect`
 * preselecciona la asignada (o la única), y el API rellena con la ASIGNADA si
 * no se manda ninguna — así que el cajero de siempre abre con un clic y el que
 * rota elige.
 */
export function OpenSession() {
  const { t } = useTranslation();
  const [warehouseId, setWarehouseId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const abrir = useOpenSession();
  const sucursales = usePosWarehouses();

  return (
    <section className="flex max-w-md flex-col gap-4" data-testid="open-session">
      <div>
        <h1 className="font-semibold text-xl">{t("pos.session.openTitle")}</h1>
        <p className="text-muted-foreground text-sm">{t("pos.session.openHint")}</p>
      </div>

      <div className="flex flex-col gap-1">
        <label htmlFor="session-warehouse" className="font-medium text-sm">
          {t("pos.session.warehouse")}
        </label>
        <WarehouseSelect
          id="session-warehouse"
          value={warehouseId}
          onChange={setWarehouseId}
          source={sucursales}
          emptyMessage={t("pos.session.warehouseEmpty")}
        />
      </div>

      {error !== null && (
        <p role="alert" className="rounded-md bg-destructive/10 px-3 py-2 text-destructive text-sm">
          {error}
        </p>
      )}

      <Button
        disabled={abrir.isPending}
        onClick={() => {
          setError(null);
          abrir.mutate(warehouseId ?? undefined, {
            // El error del server NUNCA se traga — lección del confirm mudo de
            // F3. Un turno ya abierto o un almacén fuera de alcance tienen que
            // decirse, no dejar el botón muerto.
            onError: (e) => setError(e.message || t("pos.session.openFailed")),
          });
        }}
      >
        {abrir.isPending ? t("common.form.submitting") : t("pos.session.open")}
      </Button>
    </section>
  );
}
