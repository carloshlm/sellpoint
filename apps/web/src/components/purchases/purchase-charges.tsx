import { type Currency, formatMoney } from "@sellpoint/shared";
import { forwardRef, useEffect, useImperativeHandle, useState } from "react";
import { useTranslation } from "react-i18next";
import { MoneyInput } from "@/components/form/money-input";
import type { LineasHandle } from "@/components/purchase-orders/purchase-order-lines-table";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { Purchase, PurchaseChargeInput } from "@/lib/purchases/api";
import { useReplacePurchaseCharges } from "@/lib/purchases/hooks";
import { useAuthStore } from "@/stores/auth.store";

interface CargoEditable {
  description: string;
  amount: string;
  lineTotal: string | null;
}

/**
 * F9-PURCH-11 — los cargos de la factura: flete, maniobras, seguro.
 *
 * Suman al total y **no** cambian el costo de los productos: repartirlos
 * (landed cost) es una decisión contable que el negocio tiene que poder
 * elegir, no un efecto silencioso de capturar una factura. El texto lo dice
 * en la pantalla para que nadie lo descubra mirando un margen raro.
 */
export const PurchaseCharges = forwardRef<LineasHandle, { purchase: Purchase }>(
  function PurchaseCharges({ purchase }, ref) {
    const { t } = useTranslation();
    const locale = useAuthStore((s) => s.user?.locale ?? "es");
    const currency = (useAuthStore((s) => s.user?.tenant.currency) ?? "MXN") as Currency;
    const editable = purchase.status === "draft";
    const [cargos, setCargos] = useState<CargoEditable[]>(() =>
      purchase.charges.map((c) => ({
        description: c.description,
        amount: c.amount,
        lineTotal: c.lineTotal,
      })),
    );
    const [error, setError] = useState<string | null>(null);
    const guardar = useReplacePurchaseCharges();

    // Los cargos guardados mandan: la compra vuelve del API recompuesta.
    const firmaDeLineas = JSON.stringify([purchase.status, purchase.charges]);
    // Se resincroniza SOLO cuando las LÍNEAS del servidor cambian (por su
    // firma), no cada vez que llega el objeto entero: el autoguardado de la
    // cabecera devuelve el documento completo y, con `[documento]` como
    // dependencia, pisaba lo que el usuario estaba tecleando en la tabla antes
    // de guardar (lo cazó el navegador el 2026-09-11: 6 tecleados, 10 guardados).
    // biome-ignore lint/correctness/useExhaustiveDependencies: la dependencia real es la firma de las líneas
    useEffect(() => {
      setCargos(
        purchase.charges.map((c) => ({
          description: c.description,
          amount: c.amount,
          lineTotal: c.lineTotal,
        })),
      );
    }, [firmaDeLineas]);

    const armarPayload = (): PurchaseChargeInput[] =>
      cargos
        .filter((c) => c.description.trim() !== "")
        .map((c) => ({
          description: c.description.trim(),
          amount: c.amount.trim() === "" ? 0 : Number(c.amount),
        }));
    const guardados = purchase.charges.map((c) => ({
      description: c.description,
      amount: c.amount,
      lineTotal: c.lineTotal,
    }));
    const sucia = JSON.stringify(cargos) !== JSON.stringify(guardados);
    // Confirmar la compra guarda los cargos pendientes ANTES de preguntar.
    useImperativeHandle(ref, () => ({
      guardarSiHayCambios: async () => {
        if (!editable || !sucia) return;
        await guardar.mutateAsync({ id: purchase.id, charges: armarPayload() });
      },
    }));

    if (!editable && cargos.length === 0) {
      return null;
    }

    const dinero = (valor: string) => formatMoney(Number(valor), currency, locale);

    return (
      <section className="flex flex-col gap-3" data-testid="purchase-charges">
        <h2 className="font-medium">{t("purchases.charges.title")}</h2>
        <p className="text-muted-foreground text-sm">{t("purchases.charges.intro")}</p>

        {error !== null && (
          <p
            role="alert"
            className="rounded-md bg-destructive/10 px-3 py-2 text-destructive text-sm"
          >
            {error}
          </p>
        )}

        <ul className="flex flex-col gap-2">
          {cargos.map((cargo, index) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: la fila ES su posición
            <li key={index} className="flex flex-wrap items-end gap-2">
              <div className="flex flex-1 flex-col gap-1">
                <label
                  htmlFor={`charge-description-${index}`}
                  className="text-muted-foreground text-xs"
                >
                  {t("purchases.charges.description")}
                </label>
                <Input
                  id={`charge-description-${index}`}
                  value={cargo.description}
                  disabled={!editable}
                  onChange={(event) =>
                    setCargos((previos) =>
                      previos.map((c, i) =>
                        i === index ? { ...c, description: event.target.value } : c,
                      ),
                    )
                  }
                />
              </div>
              <div className="flex flex-col gap-1">
                <span className="text-muted-foreground text-xs">
                  {t("purchases.charges.amount")}
                </span>
                <MoneyInput
                  aria-label={`${t("purchases.charges.amount")} ${index + 1}`}
                  value={cargo.amount}
                  disabled={!editable}
                  onChange={(valor) =>
                    setCargos((previos) =>
                      previos.map((c, i) => (i === index ? { ...c, amount: valor } : c)),
                    )
                  }
                />
              </div>
              {cargo.lineTotal !== null && (
                <span className="pb-2 text-muted-foreground text-sm tabular-nums">
                  {dinero(cargo.lineTotal)}
                </span>
              )}
              {editable && (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => setCargos((previos) => previos.filter((_, i) => i !== index))}
                >
                  {t("purchases.charges.remove")}
                </Button>
              )}
            </li>
          ))}
        </ul>

        {editable && (
          <div className="flex gap-2">
            <Button
              type="button"
              variant="outline"
              onClick={() =>
                setCargos((previos) => [
                  ...previos,
                  { description: "", amount: "", lineTotal: null },
                ])
              }
            >
              {t("purchases.charges.add")}
            </Button>
            <Button
              type="button"
              disabled={guardar.isPending}
              onClick={() => {
                setError(null);
                guardar.mutate(
                  { id: purchase.id, charges: armarPayload() },
                  { onError: (apiError) => setError(apiError.message) },
                );
              }}
            >
              {guardar.isPending ? t("common.form.submitting") : t("purchases.charges.save")}
            </Button>
          </div>
        )}
      </section>
    );
  },
);
