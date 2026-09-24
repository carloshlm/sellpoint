import type * as React from "react";
import { useTranslation } from "react-i18next";
import { formatBusinessTime } from "@/lib/inventory/format-date";
import type { CashboxSession } from "@/lib/pos/api";
import { useAuthStore } from "@/stores/auth.store";

/**
 * Un dato de la barra, con su separador DELANTE.
 *
 * F10-MANFIX-16: con los «·» sueltos entre los datos, al partirse la línea en
 * el celular uno quedaba colgando al final del renglón, junto a la sucursal.
 * Pegado al dato que sigue, un separador nunca termina un renglón; y el que
 * EMPIEZA uno cae en la franja que la barra recorre a la izquierda (`-ml-7`)
 * y esconde (`overflow-hidden`). El `w-7` es lo que medían los dos huecos y el
 * punto de antes, así que en una pantalla ancha la barra se ve igual.
 */
function Dato({ className, ...props }: React.ComponentProps<"span">) {
  return (
    <span className="flex items-center">
      <span aria-hidden className="w-7 text-center">
        ·
      </span>
      <span className={className} {...props} />
    </span>
  );
}

/**
 * La barra del POS: **desde qué almacén se está vendiendo**.
 *
 * Cierra la deuda de F3-HOME-05 sobre VISTAS §9.1. No es decoración: el
 * vendedor tiene que saber de dónde está descontando. Un cajero que rota entre
 * sucursales y no ve cuál abrió puede vender media mañana contra el inventario
 * equivocado, y el error solo aparece al cuadrar.
 */
export function SessionBar({ session }: { session: CashboxSession }) {
  const { t, i18n } = useTranslation();
  const timeZone = useAuthStore((s) => s.user?.tenant?.timezone);
  // F10-MANFIX-16: el formato de hora de la app, el mismo del panel del
  // vendedor y del reporte de cierres de turno.
  const desde = formatBusinessTime(session.openedAt, i18n.language, timeZone);

  return (
    <div data-testid="session-bar" className="rounded-md border border-input px-3 py-2 text-sm">
      {/* El recorte va en su propia caja, sin padding: en la de afuera, la
          franja escondida caería en parte sobre el padding, que sí se ve. */}
      <div className="overflow-hidden">
        <div className="-ml-7 flex flex-wrap items-center gap-y-1">
          <Dato className="font-medium">🛒 {t("pos.title")}</Dato>
          <Dato data-testid="session-warehouse" className="font-medium">
            {session.warehouse.name}
          </Dato>
          <Dato className="text-muted-foreground">
            {t("pos.session.openSince", { time: desde })}
          </Dato>
        </div>
      </div>
    </div>
  );
}
