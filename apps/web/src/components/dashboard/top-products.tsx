import { formatMoney, getUnit, unitSymbol } from "@sellpoint/shared";
import { Link } from "@tanstack/react-router";
import { ChevronRight } from "lucide-react";
import { type ReactNode, useState } from "react";
import { useTranslation } from "react-i18next";
import { ItemKindIcon } from "@/components/reports/item-kind-icon";
import { ScrollableList } from "@/components/ui/scrollable-list";
import { useAdminTenantScope, useScopedCurrency } from "@/lib/admin/scope";
import { usePermissions } from "@/lib/auth/permissions";
import type { DashboardPeriod, DashboardProducts, SoldItemKind } from "@/lib/dashboard/api";
import { useDashboardProducts } from "@/lib/dashboard/hooks";
import { cn } from "@/lib/utils";
import { useAuthStore } from "@/stores/auth.store";

type FilaConFicha = Pick<
  NonNullable<DashboardProducts["uncosted"]>[number],
  "itemId" | "kind" | "name"
>;

/**
 * F10-KPI-02 — el nombre lleva a donde se corrige: el producto abre su ficha
 * y el servicio, su lista (los servicios no tienen ficha propia en la URL).
 * Sin el permiso de verlos, o desde el expediente del backoffice —donde el
 * producto es de OTRO negocio y el enlace abriría el catálogo propio—, el
 * nombre se lee sin enlazar.
 */
function NombreConFicha({ fila }: { fila: FilaConFicha }) {
  const { has } = usePermissions();
  const { tenantId } = useAdminTenantScope();
  const clase = "min-w-0 flex-1 truncate";

  if (tenantId === null && fila.kind === "product" && has("products:read")) {
    return (
      <Link
        to="/catalog/products"
        search={{ open: fila.itemId }}
        className={cn(clase, "underline-offset-2 hover:underline")}
      >
        {fila.name}
      </Link>
    );
  }
  if (tenantId === null && fila.kind === "service" && has("services:read")) {
    return (
      <Link to="/catalog/services" className={cn(clase, "underline-offset-2 hover:underline")}>
        {fila.name}
      </Link>
    );
  }
  return <span className={clase}>{fila.name}</span>;
}

/**
 * F10-RPT-01 — si el renglón es un producto, un servicio o un concepto, con
 * su nombre para quien no ve el ícono. El ícono es el MISMO de los reportes
 * (`ItemKindIcon`). Un API anterior no manda el tipo: el renglón queda como
 * estaba.
 */
function IconoDelTipo({ kind }: { kind: SoldItemKind | undefined }) {
  return kind === undefined ? null : <ItemKindIcon kind={kind} />;
}

/** Un aviso de una línea que se abre para enseñar su lista. */
function AvisoPlegable({
  titulo,
  tono,
  children,
}: {
  titulo: string;
  tono: "destructive" | "warning";
  children: ReactNode;
}) {
  const [abierto, setAbierto] = useState(false);
  return (
    <div className="flex flex-col gap-1">
      <button
        type="button"
        aria-expanded={abierto}
        onClick={() => setAbierto((antes) => !antes)}
        className={cn(
          "flex items-center gap-1 text-left text-xs",
          tono === "destructive" ? "text-destructive" : "text-warning",
        )}
      >
        <ChevronRight
          aria-hidden
          className={cn("size-3 shrink-0 transition-transform", abierto && "rotate-90")}
        />
        {titulo}
      </button>
      {abierto && children}
    </div>
  );
}

/**
 * Lo que se pesa o se mide dice su unidad («7.75 kg»); lo que se cuenta,
 * «unidades». Una unidad desconocida o ausente —un API anterior a este campo—
 * se cuenta: nunca se pinta un código que no se entiende.
 */
function seMide(unit: string | undefined): boolean {
  const definicion = unit ? getUnit(unit) : undefined;
  return definicion !== undefined && definicion.category !== "count";
}

/**
 * F5-DASH-12 — los dos tops lado a lado: qué se VENDE y qué DEJA. Dos listas
 * a propósito — vender mucho no es ganar mucho, y verlas juntas es donde el
 * dueño descubre a su producto estrella real.
 */
function TopProducts({ period }: { period: DashboardPeriod }) {
  const { t } = useTranslation();
  const { has } = usePermissions();
  const currency = useScopedCurrency();
  const locale = useAuthStore((s) => s.user?.locale ?? "es");
  const { forcePermission } = useAdminTenantScope();
  const puedeVer = forcePermission || has("reports:read");
  const { data } = useDashboardProducts(period, puedeVer);

  if (!puedeVer || data === undefined) {
    return null;
  }

  const dinero = (valor: string) => formatMoney(Number(valor), currency, locale);
  const vacio = <p className="text-muted-foreground text-sm">{t("dashboard.top.empty")}</p>;
  // F10-KPI-02: un API anterior no manda estos campos; sin ellos, el recuadro queda como antes.
  const perdidas = data.belowCost ?? [];
  const sinCosto = data.uncosted ?? [];
  const masPerdidas = (data.belowCostCount ?? perdidas.length) - perdidas.length;
  const masSinCosto = (data.uncostedCount ?? sinCosto.length) - sinCosto.length;

  return (
    <div className="grid gap-3 lg:grid-cols-2">
      <section className="flex min-w-0 flex-col gap-2 rounded-lg border bg-card p-4">
        <h2 className="font-medium text-sm">{t("dashboard.top.sold")}</h2>
        {data.topSold.length === 0 ? (
          vacio
        ) : (
          // El `min-w` es lo que crea el scroll: sin él, flexbox tritura el
          // nombre hasta que la fila "cabe" en un celular (revisión móvil,
          // Carlos 2026-08-31).
          <ScrollableList>
            <ol className="flex min-w-[26rem] flex-col gap-1 text-sm">
              {data.topSold.map((producto, i) => (
                <li key={producto.itemId} className="flex items-center gap-2">
                  <span className="w-5 text-muted-foreground tabular-nums">{i + 1}.</span>
                  <IconoDelTipo kind={producto.kind} />
                  <span className="min-w-0 flex-1 truncate">{producto.name}</span>
                  {producto.deltaPct !== null && producto.deltaPct !== 0 && (
                    <span
                      className={
                        producto.deltaPct > 0 ? "text-success text-xs" : "text-destructive text-xs"
                      }
                    >
                      {producto.deltaPct > 0 ? "▲" : "▼"} {Math.abs(producto.deltaPct)}%
                    </span>
                  )}
                  <span className="text-muted-foreground tabular-nums">
                    {Number(producto.units)}{" "}
                    {seMide(producto.unit)
                      ? unitSymbol(producto.unit)
                      : t("dashboard.top.units").toLowerCase()}
                  </span>
                  <span className="w-24 text-right tabular-nums">{dinero(producto.revenue)}</span>
                </li>
              ))}
            </ol>
          </ScrollableList>
        )}
      </section>
      <section className="flex min-w-0 flex-col gap-2 rounded-lg border bg-card p-4">
        <h2 className="font-medium text-sm">{t("dashboard.top.profit")}</h2>
        {data.topProfit.length === 0 ? (
          // El vacío de utilidad NO es el de ventas: puede haber ventas de
          // sobra y cero costos congelados (F5-DASH-01 nació después que
          // ellas). Decir «sin ventas» aquí sería mentir — se dice lo que
          // falta y cómo conseguirlo. Y si hubo costos pero todo perdió
          // (F10-KPI-02), culpar a los costos también mentiría.
          <p className="text-muted-foreground text-sm">
            {t(perdidas.length > 0 ? "dashboard.top.profitNone" : "dashboard.top.profitEmpty")}
          </p>
        ) : (
          <ScrollableList>
            <ol className="flex min-w-[24rem] flex-col gap-1 text-sm">
              {data.topProfit.map((producto, i) => (
                <li key={producto.itemId} className="flex items-center gap-2">
                  <span className="w-5 text-muted-foreground tabular-nums">{i + 1}.</span>
                  <IconoDelTipo kind={producto.kind} />
                  <span className="min-w-0 flex-1 truncate">{producto.name}</span>
                  <span className="text-muted-foreground text-xs tabular-nums">
                    {producto.marginPct}% {t("dashboard.top.margin").toLowerCase()}
                  </span>
                  <span className="w-24 text-right tabular-nums">{dinero(producto.profit)}</span>
                </li>
              ))}
            </ol>
          </ScrollableList>
        )}
        {(perdidas.length > 0 || sinCosto.length > 0) && (
          // El ancla `margin-check` es a donde llevan los avisos del panel (F10-KPI-17).
          <div id="margin-check" className="flex flex-col gap-2 border-t pt-2">
            {perdidas.length > 0 && (
              <AvisoPlegable
                tono="destructive"
                titulo={t("dashboard.top.belowCost", {
                  count: data.belowCostCount ?? perdidas.length,
                })}
              >
                <ScrollableList>
                  <ul className="flex min-w-[16rem] flex-col gap-1 text-sm">
                    {perdidas.map((fila) => (
                      <li key={fila.itemId} className="flex items-center gap-2">
                        <NombreConFicha fila={fila} />
                        <span className="text-muted-foreground text-xs tabular-nums">
                          {fila.marginPct === null
                            ? "—"
                            : `${fila.marginPct}% ${t("dashboard.top.margin").toLowerCase()}`}
                        </span>
                        <span className="w-24 text-right text-destructive tabular-nums">
                          {dinero(fila.profit)}
                        </span>
                      </li>
                    ))}
                  </ul>
                </ScrollableList>
                {masPerdidas > 0 && (
                  <p className="text-muted-foreground text-xs">
                    {t("dashboard.top.more", { count: masPerdidas })}
                  </p>
                )}
              </AvisoPlegable>
            )}
            {sinCosto.length > 0 && (
              <AvisoPlegable
                tono="warning"
                titulo={t("dashboard.top.uncosted", {
                  count: data.uncostedCount ?? sinCosto.length,
                })}
              >
                <ScrollableList>
                  <ul className="flex min-w-[16rem] flex-col gap-1 text-sm">
                    {sinCosto.map((fila) => (
                      <li key={fila.itemId} className="flex items-center gap-2">
                        <NombreConFicha fila={fila} />
                        <span className="w-24 text-right tabular-nums">{dinero(fila.revenue)}</span>
                      </li>
                    ))}
                  </ul>
                </ScrollableList>
                {masSinCosto > 0 && (
                  <p className="text-muted-foreground text-xs">
                    {t("dashboard.top.more", { count: masSinCosto })}
                  </p>
                )}
              </AvisoPlegable>
            )}
          </div>
        )}
      </section>
    </div>
  );
}

export { TopProducts };
