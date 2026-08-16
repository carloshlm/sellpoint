import { useTranslation } from "react-i18next";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import type { CatalogField, CatalogSummary } from "@/lib/catalogs/api";

interface FieldListProps {
  fields: readonly CatalogField[];
  catalogs: readonly CatalogSummary[];
  canManage: boolean;
  /** Campos estándar del catálogo elegido: se muestran fijos, sin controles. */
  standardLabels: readonly string[];
  onEdit: (field: CatalogField) => void;
  onRemove: (field: CatalogField) => void;
  onRestore: (field: CatalogField) => void;
}

/**
 * F2-SCHEMA-02/03. Los campos ESTÁNDAR se pintan arriba y sin botones: no hay
 * forma de llegar a editarlos desde acá, que es más honesto que mostrarlos
 * deshabilitados y hacer que el usuario descubra a los golpes qué puede tocar.
 */
function FieldList({
  fields,
  catalogs,
  canManage,
  standardLabels,
  onEdit,
  onRemove,
  onRestore,
}: FieldListProps) {
  const { t } = useTranslation();
  const catalogName = (id: string | null) =>
    catalogs.find((catalog) => catalog.id === id)?.name ?? t("catalogs.fields.unknownCatalog");

  const sorted = [...fields].sort((a, b) => a.position - b.position);

  return (
    <div className="flex flex-col gap-4">
      <section aria-labelledby="standard-fields" className="flex flex-col gap-2">
        <h3 id="standard-fields" className="text-xs font-semibold text-muted-foreground uppercase">
          {t("catalogs.fields.standardTitle")}
        </h3>
        <ul className="flex flex-wrap gap-2">
          {standardLabels.map((label) => (
            <li key={label}>
              <Badge variant="default">{label}</Badge>
            </li>
          ))}
        </ul>
        <p className="text-xs text-muted-foreground">{t("catalogs.fields.standardHint")}</p>
      </section>

      <section aria-labelledby="custom-fields" className="flex flex-col gap-2">
        <h3 id="custom-fields" className="text-xs font-semibold text-muted-foreground uppercase">
          {t("catalogs.fields.customTitle")}
        </h3>

        {sorted.length === 0 ? (
          <p className="text-sm text-muted-foreground" data-testid="fields-empty">
            {t("catalogs.fields.empty")}
          </p>
        ) : (
          <ul className="flex flex-col gap-2">
            {sorted.map((field) => (
              <li
                key={field.id}
                data-testid={`field-${field.key}`}
                className="flex items-center justify-between gap-3 rounded-md border border-border px-3 py-2"
              >
                <div className="flex min-w-0 flex-col">
                  <span className="flex items-center gap-2 truncate text-sm font-medium">
                    {field.label}
                    {field.isArchived && (
                      <Badge variant="warning" data-testid={`field-${field.key}-archived`}>
                        {t("catalogs.fields.archivedBadge")}
                      </Badge>
                    )}
                  </span>
                  <span className="truncate text-xs text-muted-foreground">
                    {t(`catalogs.fields.types.${field.fieldType}`)}
                    {field.fieldType === "lookup" && ` → ${catalogName(field.lookupCatalogId)}`}
                    {field.required && ` · ${t("catalogs.fields.requiredBadge")}`}
                  </span>
                </div>

                {canManage && (
                  <div className="flex shrink-0 gap-1">
                    {field.isArchived ? (
                      <Button variant="ghost" size="sm" onClick={() => onRestore(field)}>
                        {t("catalogs.fields.restore")}
                      </Button>
                    ) : (
                      <>
                        <Button variant="ghost" size="sm" onClick={() => onEdit(field)}>
                          {t("common.form.edit")}
                        </Button>
                        <Button variant="ghost" size="sm" onClick={() => onRemove(field)}>
                          {t("catalogs.fields.remove")}
                        </Button>
                      </>
                    )}
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

export { FieldList };
