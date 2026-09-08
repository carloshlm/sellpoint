import { formatMoney } from "@sellpoint/shared";

import { useScopedCurrency } from "@/lib/admin/scope";
import { useAuthStore } from "@/stores/auth.store";

/**
 * Un importe leído en una celda o un resumen: «$150.00», en la moneda del
 * negocio y el formato del idioma. `null` es «—», porque un costo sin
 * capturar no es cero.
 *
 * Existe para que las tablas de los catálogos no pinten el texto crudo que
 * devuelve el API («150», «0.02»): si el campo de captura dice «150.00», el
 * listado tiene que decir lo mismo.
 */
export function Money({ value }: { value: string | number | null | undefined }) {
  const currency = useScopedCurrency();
  const locale = useAuthStore((s) => s.user?.locale ?? "es");
  if (value === null || value === undefined || value === "") {
    return <>—</>;
  }
  return <>{formatMoney(Number(value), currency, locale)}</>;
}
