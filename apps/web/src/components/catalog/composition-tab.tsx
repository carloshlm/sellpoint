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
import type { ApiError } from "@/lib/api";
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
  const { t } = useTranslation();
  const { data: saved } = useComposition(productId);
  const { data: availability } = useAvailability(productId);
  const { data: cost } = useCostEstimate(productId);
  const replaceComposition = useReplaceComposition(productId);
  const [error, setError] = useState<string | null>(null);
  const [draft, setDraft] = useState<DraftLine[] | null>(null);

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
        onError: (apiError: ApiError) => setError(apiError.message),
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
                  <Input
                    type="number"
                    step="any"
                    aria-label={t("products.composition.quantityFor", { name: line.name })}
                    value={line.quantity}
                    disabled={!canManage}
                    onChange={(event) => {
                      const next = [...lines];
                      next[index] = { ...line, quantity: event.target.value };
                      setDraft(next);
                    }}
                  />
                </TableCell>
                {/* La unidad viene del COMPONENTE y no se edita: la cantidad
                    siempre está expresada en su unidad base. */}
                <TableCell>{line.baseUnit}</TableCell>
                <TableCell>
                  <Input
                    type="number"
                    step="any"
                    aria-label={t("products.composition.wasteFor", { name: line.name })}
                    value={line.wastePercentage}
                    disabled={!canManage}
                    onChange={(event) => {
                      const next = [...lines];
                      next[index] = { ...line, wastePercentage: event.target.value };
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
function ComponentPicker({
  excludeIds,
  onPick,
}: {
  excludeIds: readonly string[];
  onPick: (product: { id: string; sku: string; name: string; baseUnit: string }) => void;
}) {
  const { t } = useTranslation();
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
                {product.sku} — {product.name} ({product.baseUnit})
              </Button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export { CompositionTab };
