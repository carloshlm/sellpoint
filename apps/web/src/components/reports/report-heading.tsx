import { Link } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { useAdminTenantScope } from "@/lib/admin/scope";

/**
 * El título de un reporte con «Volver a Reportes» a su lado (Carlos,
 * 2026-11-02: «agrega un link para regresar a la pantalla donde están todos
 * los reportes»). Es el mismo patrón que «Volver a la lista» en Productos.
 *
 * Desde el expediente del backoffice el enlace no va: ahí estos componentes
 * viven en una pestaña y `/reports` sería la app propia del admin, no el hub
 * del negocio que mira.
 */
export function ReportHeading({ title }: { title: string }) {
  const { t } = useTranslation();
  const { tenantId: negocioAjeno } = useAdminTenantScope();

  return (
    <header className="flex flex-wrap items-center justify-between gap-3">
      <h1 className="font-semibold text-xl">{title}</h1>
      {negocioAjeno === null && (
        <Button asChild variant="outline">
          <Link to="/reports">{t("reports.hub.back")}</Link>
        </Button>
      )}
    </header>
  );
}
