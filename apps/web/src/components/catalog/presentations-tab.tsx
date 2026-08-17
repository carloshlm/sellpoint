import { unitName } from "@sellpoint/shared";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { ConfirmDialog } from "@/components/common/confirm-dialog";
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
import { resolveUiLocale } from "@/lib/accept-language";
import type { ApiError } from "@/lib/api";
import type { Presentation } from "@/lib/products/api";
import {
  useCreatePresentation,
  useDeletePresentation,
  useUpdatePresentation,
} from "@/lib/products/hooks";
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
  const { t, i18n } = useTranslation();
  const [error, setError] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  // Edición EXPLÍCITA, no campos que guardan al salir del foco: acá hay
  // precios, y un typo que se guarda solo sin confirmar es una venta mal
  // cobrada.
  const [editingId, setEditingId] = useState<string | null>(null);
  const [pendingRemoval, setPendingRemoval] = useState<Presentation | null>(null);
  const updatePresentation = useUpdatePresentation(productId);
  const deletePresentation = useDeletePresentation(productId);

  // El nombre en PLURAL y en minúscula: las dos frases que lo usan hablan de
  // cantidades y lo insertan en medio de la oración ("Equivale en gramos"). La
  // minúscula la decide la frase, no la unidad — por eso `unitName` devuelve el
  // nombre capitalizado y se baja acá.
  const baseUnitLabel = unitName(baseUnit, resolveUiLocale(i18n), { plural: true }).toLowerCase();

  const onError = (apiError: ApiError) => setError(apiError.message);

  return (
    <div className="flex flex-col gap-3">
      <p className="text-xs text-muted-foreground">
        {t("products.presentations.baseUnitHint", { unit: baseUnitLabel })}
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
            <TableHead>{t("products.presentations.factor", { unit: baseUnitLabel })}</TableHead>
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
          {presentations.map((presentation) =>
            editingId === presentation.id ? (
              <EditPresentationRow
                key={presentation.id}
                productId={productId}
                presentation={presentation}
                onDone={() => setEditingId(null)}
                onError={onError}
              />
            ) : (
              <TableRow
                key={presentation.id}
                data-testid={`presentation-${presentation.id}`}
                className={presentation.isActive ? undefined : "opacity-50"}
              >
                <TableCell className="font-medium">{presentation.name}</TableCell>
                <TableCell>{presentation.factor}</TableCell>
                {/* Compra y venta se cambian acá mismo, como "solo enteros":
                    eran un ✓ muerto que obligaba a no-poder-hacer-nada. */}
                <TableCell>
                  <Checkbox
                    aria-label={t("products.presentations.purchasableFor", {
                      name: presentation.name,
                    })}
                    checked={presentation.isPurchasable}
                    disabled={!canManage}
                    onCheckedChange={(checked) => {
                      setError(null);
                      updatePresentation.mutate(
                        {
                          presentationId: presentation.id,
                          input: { isPurchasable: checked === true },
                        },
                        { onError },
                      );
                    }}
                  />
                </TableCell>
                <TableCell>
                  <Checkbox
                    aria-label={t("products.presentations.sellableFor", {
                      name: presentation.name,
                    })}
                    checked={presentation.isSellable}
                    disabled={!canManage}
                    onCheckedChange={(checked) => {
                      setError(null);
                      updatePresentation.mutate(
                        {
                          presentationId: presentation.id,
                          input: { isSellable: checked === true },
                        },
                        { onError },
                      );
                    }}
                  />
                </TableCell>
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
                  <TableCell className="text-right whitespace-nowrap">
                    {/* EDITAR queda disponible incluso en la predeterminada: es
                        lo que permite convertir la presentación base «×1» en
                        una de lote (renombrarla y cambiarle la equivalencia),
                        que es un caso real de negocios que solo venden por
                        caja. Bloquearlo no daría seguridad, quitaría capacidad. */}
                    <Button variant="ghost" size="sm" onClick={() => setEditingId(presentation.id)}>
                      {t("common.form.edit")}
                    </Button>
                    {/* Desactivar y eliminar la PREDETERMINADA los rechaza el
                        API con 409 —el producto quedaría sin presentación de
                        venta preseleccionada—. Se muestran deshabilitados con
                        el motivo: antes se veían iguales que en cualquier fila
                        y el límite se descubría a los golpes. */}
                    <Button
                      variant="ghost"
                      size="sm"
                      disabled={presentation.isDefaultSale}
                      title={
                        presentation.isDefaultSale
                          ? t("products.presentations.defaultLocked")
                          : undefined
                      }
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
                    <Button
                      variant="ghost"
                      size="sm"
                      disabled={presentation.isDefaultSale}
                      title={
                        presentation.isDefaultSale
                          ? t("products.presentations.defaultLocked")
                          : undefined
                      }
                      onClick={() => {
                        setError(null);
                        setPendingRemoval(presentation);
                      }}
                    >
                      {t("common.form.delete")}
                    </Button>
                  </TableCell>
                )}
              </TableRow>
            ),
          )}
        </TableBody>
      </Table>

      {/* La confirmación va SOLO acá: "Desactivar" se revierte de un clic, pero
          borrar se lleva el código de barras, el precio y no hay «deshacer». Y
          los dos botones están pegados en la misma fila. Pedir confirmación
          para todo entrenaría al usuario a aceptar sin leer. */}
      {pendingRemoval && (
        <ConfirmDialog
          data-testid="remove-presentation-dialog"
          title={t("products.presentations.removeDialog.title")}
          body={t("products.presentations.removeDialog.body", { name: pendingRemoval.name })}
          confirmLabel={t("products.presentations.removeDialog.confirm")}
          cancelLabel={t("common.form.cancel")}
          busy={deletePresentation.isPending}
          onCancel={() => setPendingRemoval(null)}
          onConfirm={() => {
            setError(null);
            deletePresentation.mutate(pendingRemoval.id, {
              onSuccess: () => setPendingRemoval(null),
              onError: (apiError) => {
                // El diálogo se cierra igual: el motivo del rechazo (es la
                // predeterminada, es la última) se muestra arriba y no se
                // arregla insistiendo con el mismo botón.
                setPendingRemoval(null);
                onError(apiError);
              },
            });
          }}
        />
      )}

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

/**
 * La fila en modo edición. Se cambian los datos que describen la presentación
 * —nombre, equivalencia, código de barras, precio—; los interruptores (compra,
 * venta, predeterminada, solo enteros) NO están acá porque se operan de un
 * clic en la fila normal y meterlos duplicaría el mismo control en dos lugares.
 */
function EditPresentationRow({
  productId,
  presentation,
  onDone,
  onError,
}: {
  productId: string;
  presentation: Presentation;
  onDone: () => void;
  onError: (error: ApiError) => void;
}) {
  const { t } = useTranslation();
  const [name, setName] = useState(presentation.name);
  const [factor, setFactor] = useState(presentation.factor);
  const [barcode, setBarcode] = useState(presentation.barcode ?? "");
  const [price, setPrice] = useState(presentation.price ?? "");
  const updatePresentation = useUpdatePresentation(productId);

  const factorValue = Number(factor);
  const priceError = moneyScaleError(price);
  const canSubmit = name.trim().length > 0 && factorValue > 0 && !priceError;

  function save() {
    updatePresentation.mutate(
      {
        presentationId: presentation.id,
        input: {
          name: name.trim(),
          factor: factorValue,
          // Vaciar el campo BORRA el código de barras (`null`), no lo deja como
          // estaba: si no, no habría forma de quitarlo.
          barcode: barcode.trim() || null,
          price: price === "" ? null : Number(price),
        },
      },
      { onSuccess: onDone, onError },
    );
  }

  return (
    <TableRow data-testid={`presentation-${presentation.id}-editing`}>
      <TableCell>
        <Input
          aria-label={t("products.presentations.name")}
          value={name}
          onChange={(event) => setName(event.target.value)}
        />
      </TableCell>
      <TableCell>
        <Input
          aria-label={t("products.presentations.factorShort")}
          type="number"
          step="any"
          value={factor}
          onChange={(event) => setFactor(event.target.value)}
        />
      </TableCell>
      {/* Los interruptores siguen siendo los de la fila normal: no se editan
          acá para no tener el mismo control dos veces. */}
      <TableCell colSpan={4} />
      <TableCell>
        <Input
          aria-label={t("products.presentations.barcode")}
          value={barcode}
          onChange={(event) => setBarcode(event.target.value)}
        />
      </TableCell>
      <TableCell>
        <Input
          aria-label={t("products.presentations.price")}
          type="number"
          step={MONEY_STEP}
          aria-invalid={priceError ? true : undefined}
          value={price}
          onChange={(event) => setPrice(event.target.value)}
        />
      </TableCell>
      <TableCell className="text-right whitespace-nowrap">
        <Button size="sm" disabled={!canSubmit || updatePresentation.isPending} onClick={save}>
          {t("common.form.save")}
        </Button>
        <Button variant="ghost" size="sm" onClick={onDone}>
          {t("common.form.cancel")}
        </Button>
      </TableCell>
    </TableRow>
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
            {t(priceError)}
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
