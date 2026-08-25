import { Link } from "@tanstack/react-router";
import {
  Boxes,
  ClipboardList,
  FileSpreadsheet,
  Package,
  ScrollText,
  Timer,
  Truck,
  Users,
} from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { usePermissions } from "@/lib/auth/permissions";
import {
  downloadCatalogReport,
  downloadSalesReport,
  downloadStockReport,
  downloadUsersReport,
  downloadWarehousesReport,
} from "@/lib/reports/api";

/**
 * F5-HUB-02 — el hub de Reportes.
 *
 * Ocho tarjetas con TRES comportamientos, y la diferencia no es cosmética:
 *
 *  · **Pantalla propia** (stock, ventas): consultas con filtros que no existen
 *    en ningún otro lado.
 *  · **Export directo** (catálogo, usuarios, almacenes): descargan sin
 *    navegar. Una pantalla intermedia sería una copia del listado que la
 *    persona ya tiene en Sistema o en Catálogo.
 *  · **Herencia de F3** (kardex, vencimientos, tránsito): enlazan a su
 *    pantalla, que ya existe y ya sabe filtrar. Construir una nueva acá sería
 *    mantener dos que dicen lo mismo.
 */
interface TarjetaDeReporte {
  key: string;
  icon: typeof Package;
  /** Adónde lleva. Ausente en las que descargan sin moverse. */
  to?: string;
  /** Qué baja. Ausente en las que navegan. */
  descargar?: () => Promise<void>;
  /**
   * El permiso que hace falta. Vencimientos y tránsito piden `inventory:read`
   * y no `reports:read`: exportar la pantalla que ya estás viendo no puede
   * exigir un permiso nuevo (mismo criterio que «reimprimir es leer»).
   */
  permiso: string;
}

const TARJETAS: readonly TarjetaDeReporte[] = [
  // Stock y ventas DESCARGAN, no navegan: sus endpoints ya existen pero sus
  // pantallas llegan en F5-STK-04 y F5-SALES-03. Enlazar a una ruta que no
  // existe daría un «Not Found» al primer clic, y un enlace muerto es peor
  // que un archivo. Cuando las pantallas existan, `descargar` se cambia por
  // `to` y el botón vuelve a ser enlace.
  { key: "stock", icon: Package, descargar: downloadStockReport, permiso: "reports:read" },
  {
    key: "sales",
    icon: FileSpreadsheet,
    descargar: downloadSalesReport,
    permiso: "reports:read",
  },
  { key: "kardex", icon: ScrollText, to: "/catalog/products", permiso: "reports:read" },
  {
    key: "products",
    icon: ClipboardList,
    descargar: downloadCatalogReport,
    permiso: "reports:read",
  },
  { key: "users", icon: Users, descargar: downloadUsersReport, permiso: "reports:read" },
  { key: "warehouses", icon: Boxes, descargar: downloadWarehousesReport, permiso: "reports:read" },
  { key: "expiring", icon: Timer, to: "/movements/expiring", permiso: "inventory:read" },
  { key: "inTransit", icon: Truck, to: "/movements/transfers", permiso: "inventory:read" },
];

export function ReportsHub() {
  const { t } = useTranslation();
  const { has } = usePermissions();
  const [bajando, setBajando] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const visibles = TARJETAS.filter((tarjeta) => has(tarjeta.permiso));

  async function descargar(tarjeta: TarjetaDeReporte) {
    if (tarjeta.descargar === undefined) {
      return;
    }
    setError(null);
    setBajando(tarjeta.key);
    try {
      await tarjeta.descargar();
    } catch {
      // El fallo se DICE. Una descarga que no ocurre y no avisa deja a la
      // persona esperando un archivo que nunca va a llegar.
      setError(t("reports.hub.downloadFailed"));
    } finally {
      setBajando(null);
    }
  }

  const CLASES =
    "flex h-full w-full items-start gap-3 rounded-lg border bg-card p-4 text-left transition-colors hover:bg-accent focus-visible:outline-2 focus-visible:outline-ring";

  return (
    <section className="flex flex-col gap-4" data-testid="reports-hub">
      <h1 className="font-semibold text-xl">{t("reports.hub.title")}</h1>

      {error !== null && (
        <p role="alert" className="text-destructive text-sm">
          {error}
        </p>
      )}

      <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {visibles.map((tarjeta) => {
          const Icono = tarjeta.icon;
          const titulo = t(`reports.hub.${tarjeta.key}.title`);
          const detalle = t(`reports.hub.${tarjeta.key}.detail`);
          const contenido = (
            <>
              <Icono className="mt-0.5 size-5 shrink-0 text-muted-foreground" aria-hidden="true" />
              <span className="flex flex-col gap-1">
                <span className="font-medium text-sm">{titulo}</span>
                <span className="text-muted-foreground text-xs">{detalle}</span>
              </span>
            </>
          );

          return (
            <li key={tarjeta.key}>
              {tarjeta.to === undefined ? (
                // BOTÓN y no enlace: no navega a ningún lado, descarga. Un
                // `<a>` que no lleva a una URL miente al lector de pantalla y
                // rompe el «abrir en pestaña nueva».
                <button
                  type="button"
                  aria-label={titulo}
                  className={CLASES}
                  disabled={bajando !== null}
                  onClick={() => void descargar(tarjeta)}
                >
                  {contenido}
                  {bajando === tarjeta.key && (
                    <span className="ml-auto text-muted-foreground text-xs">
                      {t("common.form.loading")}
                    </span>
                  )}
                </button>
              ) : (
                <Link to={tarjeta.to} aria-label={titulo} className={CLASES}>
                  {contenido}
                </Link>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
