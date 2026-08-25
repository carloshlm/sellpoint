import { ChevronDown, ChevronUp } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { RowAction } from "@/components/ui/row-action";
import type { CatalogField, CatalogSummary } from "@/lib/catalogs/api";

/**
 * El MISMO orden que aplica el API (`position` y desempate por etiqueta):
 * exportado para que quien calcule un reordenamiento parta de lo que el
 * usuario está VIENDO, no de otra copia del criterio que un día diverge.
 */
export function ordenarCampos(fields: readonly CatalogField[]): CatalogField[] {
  return [...fields].sort((a, b) => a.position - b.position || a.label.localeCompare(b.label));
}

interface FieldListProps {
  fields: readonly CatalogField[];
  catalogs: readonly CatalogSummary[];
  canManage: boolean;
  /** Campos estándar del catálogo elegido: se muestran fijos, sin controles. */
  standardLabels: readonly string[];
  onEdit: (field: CatalogField) => void;
  /** Subir (-1) o bajar (+1) el campo un lugar. Ver `moverCampo` en la ruta. */
  onMove: (field: CatalogField, direction: -1 | 1) => void;
  /** Mientras un movimiento persiste, TODOS los botones de orden se apagan. */
  moving: boolean;
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
  onMove,
  moving,
  onRemove,
  onRestore,
}: FieldListProps) {
  const { t } = useTranslation();
  const catalogName = (id: string | null) =>
    catalogs.find((catalog) => catalog.id === id)?.name ?? t("catalogs.fields.unknownCatalog");

  const sorted = ordenarCampos(fields);

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
            {sorted.map((field, index) => (
              <li
                key={field.id}
                data-testid={`field-${field.key}`}
                // En pantalla angosta los botones bajan a su propia línea en vez
                // de empujar la fila fuera de la tarjeta: con dos acciones
                // ("Editar" y "Quitar") no queda ancho para el nombre del campo.
                className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2 rounded-md border border-border px-3 py-2"
              >
                <div className="flex min-w-0 flex-1 flex-col">
                  <span className="flex min-w-0 items-center gap-2 text-sm font-medium">
                    <span className="truncate">{field.label}</span>
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
                    {/* Botones y no arrastre: en un teléfono el drag pelea con
                        el scroll de la lista, y esto funciona igual con dedo,
                        ratón y teclado. El aria-label lleva el NOMBRE del
                        campo: cinco botones que digan solo «Subir» son
                        indistinguibles para un lector de pantalla. */}
                    <Button
                      variant="ghost"
                      size="icon"
                      aria-label={t("catalogs.fields.moveUp", { label: field.label })}
                      disabled={moving || index === 0}
                      onClick={() => onMove(field, -1)}
                    >
                      <ChevronUp />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      aria-label={t("catalogs.fields.moveDown", { label: field.label })}
                      disabled={moving || index === sorted.length - 1}
                      onClick={() => onMove(field, 1)}
                    >
                      <ChevronDown />
                    </Button>
                    {field.isArchived ? (
                      <RowAction intent="reactivate" onClick={() => onRestore(field)} />
                    ) : (
                      <>
                        <RowAction intent="edit" onClick={() => onEdit(field)} />
                        <RowAction intent="delete" onClick={() => onRemove(field)} />
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
