import { Link } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { usePermissions } from "@/lib/auth/permissions";
import type { Supplier } from "@/lib/suppliers/api";
import { useSuppliers } from "@/lib/suppliers/hooks";

/**
 * Coincidencia EXACTA de registro fiscal (ya normalizado): el API busca por
 * `contains` para el buscador, pero «DNO900101AB1» no es «DNO900101AB12».
 * En edición, el propio registro no cuenta como repetido.
 */
export function matchingSuppliers(rows: Supplier[], taxId: string, excludeId?: string): Supplier[] {
  return rows.filter((row) => row.id !== excludeId && row.taxId === taxId);
}

/**
 * F9-SUPPL-07 — un registro fiscal que ya existe AVISA y ofrece editar, pero
 * NO bloquea (mismo criterio que el contacto de clientes): la base no tiene
 * UNIQUE y esta tarjeta tampoco lo inventa. Sin permiso de lectura no consulta.
 */
export function DuplicateSupplierCard({
  taxId,
  excludeId,
}: {
  /** El registro fiscal COMPROBADO (al salir del campo), normalizado; null sin dato. */
  taxId: string | null;
  excludeId?: string;
}) {
  const { t } = useTranslation();
  const { has } = usePermissions();
  const puedeBuscar = has("suppliers:read");
  const consulta = useSuppliers(
    { query: taxId ?? undefined },
    { enabled: puedeBuscar && taxId !== null },
  );
  const repetidos =
    taxId === null ? [] : matchingSuppliers(consulta.data?.rows ?? [], taxId, excludeId);
  if (repetidos.length === 0) return null;

  return (
    <section
      data-testid="duplicate-supplier"
      role="status"
      className="flex flex-col gap-2 rounded-lg border border-warning bg-warning-soft px-4 py-3 text-sm"
    >
      <p className="font-medium">
        {t("suppliers.form.duplicates.title", { count: repetidos.length })}
      </p>
      <p className="text-muted-foreground">{t("suppliers.form.duplicates.hint")}</p>
      <ul className="flex flex-col divide-y divide-warning/40">
        {repetidos.map((row) => (
          <li key={row.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2">
            <span className="font-medium">{row.name}</span>
            {row.contactName && <span className="text-muted-foreground">{row.contactName}</span>}
            {has("suppliers:manage") && (
              <Link
                to="/suppliers/$supplierId"
                params={{ supplierId: row.id }}
                className="ml-auto font-medium text-primary hover:underline"
              >
                {t("common.actions.edit")}
              </Link>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}
