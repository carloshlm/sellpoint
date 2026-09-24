import { parseMoneyInput } from "@sellpoint/shared";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { MoneyField } from "@/components/form/money-field";
import { WarehouseSelect } from "@/components/inventory/warehouse-select";
import { Button } from "@/components/ui/button";
import { moneyInputError } from "@/lib/money";
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
 *
 * F10-MANFIX-10 — el FONDO INICIAL: el efectivo con que el cajón arranca para
 * dar cambio. Se escribe aquí, al abrir (decisión de Carlos, 2026-09-24), con
 * el mismo campo de importe que el resto de la app. Es opcional: vacío es $0
 * y no viaja, así que quien no usa fondo abre con el mismo clic de siempre. Un
 * importe mal escrito («50,5») se marca y NO deja abrir: abrir con un fondo
 * distinto del que se quiso daría un arqueo equivocado todo el día.
 */
export function OpenSession() {
  const { t } = useTranslation();
  const [warehouseId, setWarehouseId] = useState<string | null>(null);
  const [fondo, setFondo] = useState("");
  const [error, setError] = useState<string | null>(null);
  const abrir = useOpenSession();
  const sucursales = usePosWarehouses();
  const errorFondo = moneyInputError(fondo);

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

      <MoneyField
        label={t("pos.session.openingCashLabel")}
        value={fondo}
        onChange={setFondo}
        hint={t("pos.session.openingCashHint")}
        error={errorFondo === null ? undefined : t(errorFondo)}
      />

      {error !== null && (
        <p role="alert" className="rounded-md bg-destructive/10 px-3 py-2 text-destructive text-sm">
          {error}
        </p>
      )}

      <Button
        disabled={abrir.isPending || errorFondo !== null}
        onClick={() => {
          setError(null);
          const openingCash = parseMoneyInput(fondo);
          abrir.mutate(
            {
              ...(warehouseId !== null && { warehouseId }),
              ...(openingCash !== null && { openingCash }),
            },
            {
              // El error del server NUNCA se traga — lección del confirm mudo
              // de F3. Un turno ya abierto o un almacén fuera de alcance
              // tienen que decirse, no dejar el botón muerto.
              onError: (e) => setError(e.message || t("pos.session.openFailed")),
            },
          );
        }}
      >
        {abrir.isPending ? t("common.form.submitting") : t("pos.session.open")}
      </Button>
    </section>
  );
}
