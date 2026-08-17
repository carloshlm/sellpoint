import { unitName } from "@sellpoint/shared";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { resolveUiLocale } from "@/lib/accept-language";
import type { ApiError } from "@/lib/api";
import { fieldErrorsOf } from "@/lib/field-errors";
import {
  useAvailability,
  useComposition,
  useCostEstimate,
  useProducts,
  useReplaceComposition,
} from "@/lib/products/hooks";

interface CompositionTabProps {
  productId: string;
  canManage: boolean;
}

interface DraftLine {
  componentId: string;
  sku: string;
  name: string;
  baseUnit: string;
  quantity: string;
  wastePercentage: string;
}

/**
 * F2-BOM-03/04 — el "apartado de relaciones entre productos" de Carlos.
 *
 * Tabla + picker, sin wizards. Se carga cuánto lleva UNA unidad del compuesto;
 * el "alcanza para N" lo calcula el server contra el stock y se muestra en
 * vivo — nunca se guarda, porque un número fijo mentiría apenas cambiara el
 * inventario.
 */
function CompositionTab({ productId, canManage }: CompositionTabProps) {
  const { t, i18n } = useTranslation();
  const uiLocale = resolveUiLocale(i18n);
  const { data: saved } = useComposition(productId);
  const { data: availability } = useAvailability(productId);
  const { data: cost } = useCostEstimate(productId);
  const replaceComposition = useReplaceComposition(productId);
  const [error, setError] = useState<string | null>(null);
  const [draft, setDraft] = useState<DraftLine[] | null>(null);
  // Errores POR CAMPO indexados por su ruta (`lines.1.wastePercentage`). El API
  // ya dice cuál falló; antes se mostraba solo el mensaje general arriba y con
  // cinco componentes había que adivinar en qué fila estaba el número malo.
  const [fieldErrors, setFieldErrors] = useState<Map<string, string>>(new Map());

  /** Limpia el error de un campo apenas se lo toca: ya no describe lo que hay. */
  function clearFieldError(path: string) {
    setFieldErrors((current) => {
      if (!current.has(path)) {
        return current;
      }
      const next = new Map(current);
      next.delete(path);
      return next;
    });
  }

  const lines: DraftLine[] =
    draft ??
    (saved ?? []).map((line) => ({
      componentId: line.component.id,
      sku: line.component.sku,
      name: line.component.name,
      baseUnit: line.component.baseUnit,
      quantity: line.quantity,
      wastePercentage: line.wastePercentage,
    }));

  function save(next: DraftLine[]) {
    setError(null);
    setFieldErrors(new Map());
    replaceComposition.mutate(
      {
        lines: next.map((line) => ({
          componentId: line.componentId,
          quantity: Number(line.quantity),
          wastePercentage: Number(line.wastePercentage) || 0,
        })),
      },
      {
        onSuccess: () => setDraft(null),
        onError: (apiError: ApiError) => {
          const byField = fieldErrorsOf(apiError);
          setFieldErrors(byField);
          // El mensaje general solo cuando NO hay campos señalados: repetir
          // arriba lo que ya está pintado en la fila es ruido, y un 409 de
          // negocio (el ciclo de composición) no señala ninguna.
          setError(byField.size > 0 ? null : apiError.message);
        },
      },
    );
  }

  return (
    <div className="flex flex-col gap-4">
      {error && (
        <p
          role="alert"
          data-testid="composition-error"
          className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive"
        >
          {error}
        </p>
      )}

      {canManage && (
        <ComponentPicker
          excludeIds={[productId, ...lines.map((line) => line.componentId)]}
          onPick={(product) =>
            setDraft([
              ...lines,
              {
                componentId: product.id,
                sku: product.sku,
                name: product.name,
                baseUnit: product.baseUnit,
                quantity: "1",
                wastePercentage: "0",
              },
            ])
          }
        />
      )}

      {lines.length === 0 ? (
        <p className="text-sm text-muted-foreground" data-testid="composition-empty">
          {t("products.composition.empty")}
        </p>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t("products.composition.component")}</TableHead>
              <TableHead>{t("products.composition.quantity")}</TableHead>
              <TableHead>{t("products.composition.unit")}</TableHead>
              <TableHead>{t("products.composition.waste")}</TableHead>
              {canManage && <TableHead />}
            </TableRow>
          </TableHeader>
          <TableBody>
            {lines.map((line, index) => (
              <TableRow key={line.componentId} data-testid={`composition-${line.sku}`}>
                <TableCell className="font-medium">{line.name}</TableCell>
                <TableCell>
                  <LineField
                    label={t("products.composition.quantityFor", { name: line.name })}
                    value={line.quantity}
                    // La ruta es la MISMA que arma el pipe de Zod en el API:
                    // por eso el error cae en el input correcto sin traducir
                    // nada entre las dos puntas.
                    error={fieldErrors.get(`lines.${index}.quantity`)}
                    disabled={!canManage}
                    onChange={(value) => {
                      clearFieldError(`lines.${index}.quantity`);
                      const next = [...lines];
                      next[index] = { ...line, quantity: value };
                      setDraft(next);
                    }}
                  />
                </TableCell>
                {/* La unidad viene del COMPONENTE y no se edita: la cantidad
                    siempre está expresada en su unidad base. */}
                <TableCell>{unitName(line.baseUnit, uiLocale)}</TableCell>
                <TableCell>
                  <LineField
                    label={t("products.composition.wasteFor", { name: line.name })}
                    value={line.wastePercentage}
                    error={fieldErrors.get(`lines.${index}.wastePercentage`)}
                    disabled={!canManage}
                    onChange={(value) => {
                      clearFieldError(`lines.${index}.wastePercentage`);
                      const next = [...lines];
                      next[index] = { ...line, wastePercentage: value };
                      setDraft(next);
                    }}
                  />
                </TableCell>
                {canManage && (
                  <TableCell className="text-right">
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => setDraft(lines.filter((_, i) => i !== index))}
                    >
                      {t("common.form.remove")}
                    </Button>
                  </TableCell>
                )}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}

      {canManage && draft && (
        <div className="flex gap-2">
          <Button size="sm" disabled={replaceComposition.isPending} onClick={() => save(lines)}>
            {t("products.composition.save")}
          </Button>
          <Button size="sm" variant="outline" onClick={() => setDraft(null)}>
            {t("common.form.cancel")}
          </Button>
        </div>
      )}

      <section
        aria-label={t("products.composition.summary")}
        data-testid="composition-summary"
        className="flex flex-col gap-1 rounded-md border border-border bg-muted/30 p-3 text-sm"
      >
        <p>
          {t("products.composition.costEstimate")}: <strong>{cost?.total ?? "—"}</strong>
        </p>
        {/* El "alcanza para N" de Carlos, calculado contra el stock real. */}
        <p data-testid="composition-availability">
          {t("products.composition.availability", { count: availability?.units ?? 0 })}
        </p>
        {availability?.limitedBy && (
          <p className="text-muted-foreground">
            {t("products.composition.limitedBy", { name: availability.limitedBy.name })}
          </p>
        )}
      </section>
    </div>
  );
}

/** Autocompletado server-side: reusa la búsqueda de productos de F2-PROD-02. */
/**
 * Un número de la fila, con su error debajo.
 *
 * El mensaje va DENTRO de la celda y no arriba de la tabla: con cinco
 * componentes, "Debe ser 100 o menos" en el encabezado obliga a revisar las
 * cinco filas a ojo. Se usa `aria-invalid` + `role="alert"` para que un lector
 * de pantalla anuncie el problema en el campo donde está.
 */
function LineField({
  label,
  value,
  error,
  disabled,
  onChange,
}: {
  label: string;
  value: string;
  error?: string;
  disabled: boolean;
  onChange: (value: string) => void;
}) {
  return (
    <div className="flex flex-col gap-1">
      <Input
        type="number"
        step="any"
        aria-label={label}
        aria-invalid={error ? true : undefined}
        value={value}
        disabled={disabled}
        onChange={(event) => onChange(event.target.value)}
      />
      {error && (
        <p role="alert" className="text-xs text-destructive">
          {error}
        </p>
      )}
    </div>
  );
}

function ComponentPicker({
  excludeIds,
  onPick,
}: {
  excludeIds: readonly string[];
  onPick: (product: { id: string; sku: string; name: string; baseUnit: string }) => void;
}) {
  const { t, i18n } = useTranslation();
  const uiLocale = resolveUiLocale(i18n);
  const [query, setQuery] = useState("");
  const { data } = useProducts({ query: query.trim() || undefined, pageSize: 10 });

  const candidates = (data?.items ?? []).filter((item) => !excludeIds.includes(item.id));

  return (
    <div className="flex flex-col gap-2">
      <Label htmlFor="component-search">{t("products.composition.search")}</Label>
      <Input
        id="component-search"
        value={query}
        onChange={(event) => setQuery(event.target.value)}
      />
      {query.trim() && (
        <ul className="flex flex-wrap gap-2">
          {candidates.map((product) => (
            <li key={product.id}>
              <Button variant="outline" size="sm" onClick={() => onPick(product)}>
                {product.sku} — {product.name} ({unitName(product.baseUnit, uiLocale)})
              </Button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export { CompositionTab };
