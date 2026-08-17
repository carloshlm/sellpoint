import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
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
import type { Presentation } from "@/lib/products/api";
import { useCreatePresentation, useUpdatePresentation } from "@/lib/products/hooks";
import { MONEY_STEP, moneyScaleError } from "@/lib/products/money";

interface PresentationsTabProps {
  productId: string;
  baseUnit: string;
  presentations: readonly Presentation[];
  canManage: boolean;
}

/**
 * F2-PRESENT-02/03/04 — tabla inline, sin wizards ni drag-and-drop
 * (ARQUITECTURA § 3.5: "el TenantAdmin no debería necesitar entrenamiento").
 *
 * El toggle de "solo enteros" nace del estado que devuelve el SERVER, que lo
 * deriva de la categoría de la unidad base. La UI no lo calcula: si lo hiciera,
 * dos lugares tendrían que ponerse de acuerdo sobre la misma regla.
 */
function PresentationsTab({
  productId,
  baseUnit,
  presentations,
  canManage,
}: PresentationsTabProps) {
  const { t } = useTranslation();
  const [error, setError] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const updatePresentation = useUpdatePresentation(productId);

  const onError = (apiError: ApiError) => setError(apiError.message);

  return (
    <div className="flex flex-col gap-3">
      <p className="text-xs text-muted-foreground">
        {t("products.presentations.baseUnitHint", { unit: baseUnit })}
      </p>

      {error && (
        <p
          role="alert"
          data-testid="presentations-error"
          className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive"
        >
          {error}
        </p>
      )}

      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>{t("products.presentations.name")}</TableHead>
            <TableHead>{t("products.presentations.factor", { unit: baseUnit })}</TableHead>
            <TableHead>{t("products.presentations.purchasable")}</TableHead>
            <TableHead>{t("products.presentations.sellable")}</TableHead>
            <TableHead>{t("products.presentations.default")}</TableHead>
            <TableHead>{t("products.presentations.wholeOnly")}</TableHead>
            <TableHead>{t("products.presentations.barcode")}</TableHead>
            <TableHead>{t("products.presentations.price")}</TableHead>
            {canManage && <TableHead />}
          </TableRow>
        </TableHeader>
        <TableBody>
          {presentations.map((presentation) => (
            <TableRow
              key={presentation.id}
              data-testid={`presentation-${presentation.id}`}
              className={presentation.isActive ? undefined : "opacity-50"}
            >
              <TableCell className="font-medium">{presentation.name}</TableCell>
              <TableCell>{presentation.factor}</TableCell>
              <TableCell>{presentation.isPurchasable ? "✓" : "—"}</TableCell>
              <TableCell>{presentation.isSellable ? "✓" : "—"}</TableCell>
              <TableCell>
                <input
                  type="radio"
                  name="default-presentation"
                  aria-label={t("products.presentations.setDefault", {
                    name: presentation.name,
                  })}
                  checked={presentation.isDefaultSale}
                  disabled={!canManage}
                  onChange={() => {
                    setError(null);
                    updatePresentation.mutate(
                      { presentationId: presentation.id, input: { isDefaultSale: true } },
                      { onError },
                    );
                  }}
                />
              </TableCell>
              <TableCell>
                <Checkbox
                  aria-label={t("products.presentations.wholeOnlyFor", {
                    name: presentation.name,
                  })}
                  // Estado derivado del SERVER: `false` significa que admite
                  // decimales, así que "solo enteros" es su negación.
                  checked={!presentation.allowFractionalInput}
                  disabled={!canManage}
                  onCheckedChange={(checked) => {
                    setError(null);
                    updatePresentation.mutate(
                      {
                        presentationId: presentation.id,
                        input: { allowFractionalInput: checked !== true },
                      },
                      { onError },
                    );
                  }}
                />
              </TableCell>
              <TableCell>{presentation.barcode ?? "—"}</TableCell>
              <TableCell>{presentation.price ?? "—"}</TableCell>
              {canManage && (
                <TableCell className="text-right">
                  {/* No se BORRA: F4 va a referenciarlas desde las ventas. */}
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => {
                      setError(null);
                      updatePresentation.mutate(
                        {
                          presentationId: presentation.id,
                          input: { isActive: !presentation.isActive },
                        },
                        { onError },
                      );
                    }}
                  >
                    {presentation.isActive
                      ? t("products.presentations.deactivate")
                      : t("products.presentations.reactivate")}
                  </Button>
                </TableCell>
              )}
            </TableRow>
          ))}
        </TableBody>
      </Table>

      {canManage &&
        (adding ? (
          <NewPresentationRow
            productId={productId}
            onDone={() => setAdding(false)}
            onError={onError}
          />
        ) : (
          <div>
            <Button variant="outline" size="sm" onClick={() => setAdding(true)}>
              {t("products.presentations.add")}
            </Button>
          </div>
        ))}
    </div>
  );
}

function NewPresentationRow({
  productId,
  onDone,
  onError,
}: {
  productId: string;
  onDone: () => void;
  onError: (error: ApiError) => void;
}) {
  const { t } = useTranslation();
  const [name, setName] = useState("");
  const [factor, setFactor] = useState("");
  const [barcode, setBarcode] = useState("");
  const [price, setPrice] = useState("");
  const createPresentation = useCreatePresentation(productId);

  const factorValue = Number(factor);
  // El precio de una presentación va a la MISMA columna `DECIMAL(14,2)` que el
  // del producto: misma regla, misma barrera antes de mandar.
  const priceError = moneyScaleError(price);
  const canSubmit = name.trim().length > 0 && factorValue > 0 && !priceError;

  return (
    <form
      className="flex flex-wrap items-end gap-2 rounded-md border border-border p-3"
      onSubmit={(event) => {
        event.preventDefault();
        createPresentation.mutate(
          {
            name,
            factor: factorValue,
            ...(barcode ? { barcode } : {}),
            ...(price ? { price: Number(price) } : {}),
          },
          { onSuccess: onDone, onError },
        );
      }}
    >
      <div className="flex flex-col gap-1 text-xs">
        <Label htmlFor="new-presentation-name">{t("products.presentations.name")}</Label>
        <Input
          id="new-presentation-name"
          value={name}
          onChange={(event) => setName(event.target.value)}
        />
      </div>
      <div className="flex flex-col gap-1 text-xs">
        <Label htmlFor="new-presentation-factor">{t("products.presentations.factorShort")}</Label>
        <Input
          id="new-presentation-factor"
          type="number"
          step="any"
          value={factor}
          onChange={(event) => setFactor(event.target.value)}
        />
      </div>
      <div className="flex flex-col gap-1 text-xs">
        <Label htmlFor="new-presentation-barcode">{t("products.presentations.barcode")}</Label>
        <Input
          id="new-presentation-barcode"
          value={barcode}
          onChange={(event) => setBarcode(event.target.value)}
        />
      </div>
      <div className="flex flex-col gap-1 text-xs">
        <Label htmlFor="new-presentation-price">{t("products.presentations.price")}</Label>
        <Input
          id="new-presentation-price"
          type="number"
          step={MONEY_STEP}
          aria-invalid={priceError ? true : undefined}
          value={price}
          onChange={(event) => setPrice(event.target.value)}
        />
        {priceError && (
          <p role="alert" className="text-destructive">
            {t("products.too_many_decimals")}
          </p>
        )}
      </div>
      <Button type="submit" size="sm" disabled={!canSubmit || createPresentation.isPending}>
        {t("common.form.add")}
      </Button>
      <Button type="button" size="sm" variant="outline" onClick={onDone}>
        {t("common.form.cancel")}
      </Button>
    </form>
  );
}

export { PresentationsTab };
