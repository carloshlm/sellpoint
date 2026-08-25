import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";

/**
 * El paginador de los listados, en UN solo lugar.
 *
 * ── Por qué existe (Carlos, 2026-08-25) ─────────────────────────────────
 *
 * El server siempre paginó a 20, pero tres pantallas —documentos de
 * inventario, cotizaciones y traspasos— no mandaban `page` ni pintaban
 * botones: a partir del registro 21, los viejos desaparecían del listado sin
 * ningún aviso. Peor que no paginar, porque se perdían EN SILENCIO.
 *
 * Ya había dos copias del mismo markup (historial de ventas y reportes) y
 * este cambio iba a sumar tres más: cinco copias de la misma decisión es
 * cuatro de más. Las claves i18n viven en `common.table.*` porque el
 * paginador no es de ningún módulo.
 *
 * ── El contrato ─────────────────────────────────────────────────────────
 *
 * Con una sola página NO se pinta: un paginador de «1 de 1» es decorado que
 * resta atención. Y quien lo monta debe VOLVER a la página 1 al cambiar
 * cualquier filtro — quedarse en la página 3 de un filtro que ahora tiene
 * una sola página muestra una tabla vacía que parece un bug.
 */
export function Paginator({
  page,
  pageSize,
  total,
  onPageChange,
}: {
  page: number;
  pageSize: number;
  total: number;
  onPageChange: (page: number) => void;
}) {
  const { t } = useTranslation();
  const pages = Math.max(1, Math.ceil(total / pageSize));

  if (pages <= 1) {
    return null;
  }

  return (
    <div className="flex items-center gap-2">
      <Button
        variant="outline"
        size="sm"
        disabled={page <= 1}
        onClick={() => onPageChange(page - 1)}
      >
        {t("common.table.previous")}
      </Button>
      <span className="text-muted-foreground text-sm">
        {t("common.table.page", { page, pages })}
      </span>
      <Button
        variant="outline"
        size="sm"
        disabled={page >= pages}
        onClick={() => onPageChange(page + 1)}
      >
        {t("common.table.next")}
      </Button>
    </div>
  );
}
