import { UNIT_CODES } from "@sellpoint/shared";
import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { OnboardingGate } from "@/components/auth/onboarding-gate";
import { PermissionGate } from "@/components/auth/permission-gate";
import { ProtectedRoute } from "@/components/auth/protected-route";
import { CompositionTab } from "@/components/catalog/composition-tab";
import { DynamicForm } from "@/components/catalog/dynamic-form";
import { PresentationsTab } from "@/components/catalog/presentations-tab";
import { ProductImportDialog } from "@/components/catalog/product-import-dialog";
import { SelectField } from "@/components/form/select-field";
import { TextField } from "@/components/form/text-field";
import { AppLayout } from "@/components/layout/app-layout";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
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
import { usePermissions } from "@/lib/auth/permissions";
import { useCatalogFields, useCatalogs } from "@/lib/catalogs/hooks";
import type { ProductDetail } from "@/lib/products/api";
import {
  useAvailability,
  useCreateProduct,
  useDeleteProduct,
  useProduct,
  useProducts,
  useUpdateProduct,
} from "@/lib/products/hooks";

export const Route = createFileRoute("/catalog/products")({
  component: ProductsPage,
});

const PAGE_SIZE = 20;

/** F2-PROD-04..06 — lista, alta/edición y las pestañas del producto. */
function ProductsPage() {
  return (
    <ProtectedRoute>
      <OnboardingGate>
        <AppLayout>
          <PermissionGate need="products:read">
            <ProductsContent />
          </PermissionGate>
        </AppLayout>
      </OnboardingGate>
    </ProtectedRoute>
  );
}

function ProductsContent() {
  const { t } = useTranslation();
  const { has } = usePermissions();
  const canManage = has("products:manage");

  const [query, setQuery] = useState("");
  const [onlyComposite, setOnlyComposite] = useState(false);
  const [page, setPage] = useState(1);
  const [openId, setOpenId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [importing, setImporting] = useState(false);

  const { data, isPending } = useProducts({
    query: query.trim() || undefined,
    ...(onlyComposite ? { composite: true } : {}),
    page,
    pageSize: PAGE_SIZE,
  });

  const totalPages = Math.max(1, Math.ceil((data?.total ?? 0) / PAGE_SIZE));

  if (openId) {
    return (
      <ProductDetailPanel productId={openId} canManage={canManage} onBack={() => setOpenId(null)} />
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold">{t("products.page.title")}</h1>
        {canManage && (
          <div className="flex gap-2">
            <Button variant="outline" onClick={() => setImporting(true)}>
              {t("products.import.open")}
            </Button>
            <Button onClick={() => setCreating(true)}>{t("products.add")}</Button>
          </div>
        )}
      </header>

      {importing && <ProductImportDialog onClose={() => setImporting(false)} />}

      {creating && (
        <Card>
          <CardHeader>
            <CardTitle>{t("products.add")}</CardTitle>
          </CardHeader>
          <CardContent>
            <ProductForm onDone={() => setCreating(false)} />
          </CardContent>
        </Card>
      )}

      <div className="flex flex-wrap items-end gap-4">
        <div className="flex flex-col gap-1 text-sm">
          <Label htmlFor="product-search">{t("common.form.search")}</Label>
          <Input
            id="product-search"
            value={query}
            placeholder={t("products.searchPlaceholder")}
            onChange={(event) => {
              setQuery(event.target.value);
              setPage(1);
            }}
          />
        </div>
        <div className="flex items-center gap-2">
          <Checkbox
            id="only-composite"
            checked={onlyComposite}
            onCheckedChange={(checked) => {
              setOnlyComposite(checked === true);
              setPage(1);
            }}
          />
          <Label htmlFor="only-composite">{t("products.onlyComposite")}</Label>
        </div>
      </div>

      {isPending ? (
        <p role="status">{t("common.form.loading")}</p>
      ) : (data?.items ?? []).length === 0 ? (
        <p className="text-sm text-muted-foreground" data-testid="products-empty">
          {t("products.empty")}
        </p>
      ) : (
        <>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t("products.form.sku")}</TableHead>
                <TableHead>{t("products.form.name")}</TableHead>
                <TableHead>{t("products.form.price")}</TableHead>
                {/* La columna de armables solo tiene sentido con el filtro de
                    compuestos puesto: para un producto simple no significa nada. */}
                {onlyComposite && <TableHead>{t("products.availableUnits")}</TableHead>}
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {(data?.items ?? []).map((product) => (
                <TableRow key={product.id} data-testid={`product-${product.sku}`}>
                  <TableCell className="font-medium">{product.sku}</TableCell>
                  <TableCell>
                    {product.name}
                    {product.isComposite && (
                      <Badge variant="default" className="ml-2">
                        {t("products.compositeBadge")}
                      </Badge>
                    )}
                  </TableCell>
                  <TableCell>{product.price ?? "—"}</TableCell>
                  {onlyComposite && <AvailabilityCell productId={product.id} />}
                  <TableCell className="text-right">
                    <Button variant="ghost" size="sm" onClick={() => setOpenId(product.id)}>
                      {t("products.open")}
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>

          <div className="flex items-center justify-between text-sm">
            <span data-testid="products-total">
              {t("products.pagination", { total: data?.total ?? 0 })}
            </span>
            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                disabled={page <= 1}
                onClick={() => setPage((current) => current - 1)}
              >
                {t("products.previous")}
              </Button>
              <span>{`${page} / ${totalPages}`}</span>
              <Button
                variant="outline"
                size="sm"
                disabled={page >= totalPages}
                onClick={() => setPage((current) => current + 1)}
              >
                {t("products.next")}
              </Button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

/** F2-BOM-05: unidades armables en la lista, solo para compuestos. */
function AvailabilityCell({ productId }: { productId: string }) {
  const { data } = useAvailability(productId);
  return <TableCell data-testid={`availability-${productId}`}>{data?.units ?? "…"}</TableCell>;
}

function ProductDetailPanel({
  productId,
  canManage,
  onBack,
}: {
  productId: string;
  canManage: boolean;
  onBack: () => void;
}) {
  const { t } = useTranslation();
  const { data: product, isPending } = useProduct(productId);
  const [tab, setTab] = useState<"info" | "presentations" | "composition">("info");

  if (isPending || !product) {
    return <p role="status">{t("common.form.loading")}</p>;
  }

  const tabs = [
    { id: "info" as const, label: t("products.tabs.info") },
    { id: "presentations" as const, label: t("products.tabs.presentations") },
    // La pestaña de composición aparece SOLO si el producto es compuesto:
    // para uno simple no hay nada que armar.
    ...(product.isComposite
      ? [{ id: "composition" as const, label: t("products.tabs.composition") }]
      : []),
  ];

  return (
    <div className="flex flex-col gap-6">
      <header className="flex items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">{product.name}</h1>
          <p className="text-sm text-muted-foreground">{product.sku}</p>
        </div>
        <Button variant="outline" onClick={onBack}>
          {t("products.back")}
        </Button>
      </header>

      <nav aria-label={t("products.tabs.label")} className="flex gap-2 border-b border-border">
        {tabs.map((item) => (
          <button
            key={item.id}
            type="button"
            aria-current={tab === item.id ? "page" : undefined}
            className={
              tab === item.id
                ? "border-b-2 border-primary px-3 py-2 text-sm font-medium"
                : "px-3 py-2 text-sm text-muted-foreground"
            }
            onClick={() => setTab(item.id)}
          >
            {item.label}
          </button>
        ))}
      </nav>

      {tab === "info" && <ProductForm product={product} onDone={onBack} />}
      {tab === "presentations" && (
        <PresentationsTab
          productId={product.id}
          baseUnit={product.baseUnit}
          presentations={product.presentations}
          canManage={canManage}
        />
      )}
      {tab === "composition" && <CompositionTab productId={product.id} canManage={canManage} />}
    </div>
  );
}

function ProductForm({ product, onDone }: { product?: ProductDetail; onDone: () => void }) {
  const { t } = useTranslation();
  const { has } = usePermissions();
  const canManage = has("products:manage");
  const { data: catalogs } = useCatalogs();
  const productsCatalog = catalogs?.find((catalog) => catalog.isSystem);
  const { data: fields } = useCatalogFields(productsCatalog?.id);

  const basePresentation = product?.presentations.find(
    (presentation) => presentation.isDefaultSale,
  );

  const [sku, setSku] = useState(product?.sku ?? "");
  const [name, setName] = useState(product?.name ?? "");
  const [baseUnit, setBaseUnit] = useState(product?.baseUnit ?? "unit");
  const [stockMin, setStockMin] = useState(product?.stockMin ?? "0");
  const [isComposite, setIsComposite] = useState(product?.isComposite ?? false);
  const [price, setPrice] = useState(basePresentation?.price ?? "");
  const [cost, setCost] = useState(basePresentation?.cost ?? "");
  const [attributes, setAttributes] = useState<Record<string, unknown>>(product?.attributes ?? {});
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  const createProduct = useCreateProduct();
  const updateProduct = useUpdateProduct();
  const deleteProduct = useDeleteProduct();
  const isSubmitting = createProduct.isPending || updateProduct.isPending;

  // Anticipa la guarda del server: con stock o siendo componente de otro, la
  // unidad base no se puede mover (ARQUITECTURA § 3.5).
  const { data: availability } = useAvailability(product?.id, Boolean(product?.isComposite));
  void availability;

  function handleError(apiError: ApiError) {
    const errors = (apiError as unknown as { errors?: { key: string; message: string }[] }).errors;
    if (errors?.length) {
      setFieldErrors(Object.fromEntries(errors.map((item) => [item.key, t(item.message)])));
      return;
    }
    setError(apiError.message);
  }

  return (
    <form
      className="flex max-w-2xl flex-col gap-4"
      onSubmit={(event) => {
        event.preventDefault();
        setError(null);
        setFieldErrors({});
        const payload = {
          sku,
          name,
          baseUnit,
          stockMin: Number(stockMin) || 0,
          isComposite,
          attributes,
          ...(price !== "" ? { price: Number(price) } : {}),
          ...(cost !== "" ? { cost: Number(cost) } : {}),
        };

        if (product) {
          updateProduct.mutate(
            { id: product.id, input: payload },
            { onSuccess: onDone, onError: handleError },
          );
          return;
        }
        createProduct.mutate(payload, { onSuccess: onDone, onError: handleError });
      }}
    >
      {error && (
        <p
          role="alert"
          data-testid="product-form-error"
          className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive"
        >
          {error}
        </p>
      )}

      <TextField
        label={t("products.form.sku")}
        value={sku}
        disabled={!canManage}
        onChange={(event) => setSku(event.target.value)}
      />
      <TextField
        label={t("products.form.name")}
        value={name}
        disabled={!canManage}
        onChange={(event) => setName(event.target.value)}
      />
      <SelectField
        label={t("products.form.baseUnit")}
        value={baseUnit}
        disabled={!canManage}
        options={UNIT_CODES.map((code) => ({ value: code, label: code }))}
        onChange={(event) => setBaseUnit(event.target.value)}
      />
      <TextField
        label={t("products.form.stockMin")}
        type="number"
        step="any"
        value={stockMin}
        disabled={!canManage}
        onChange={(event) => setStockMin(event.target.value)}
      />

      {/* Precio y costo editan la presentación base: el usuario los ve como
          "el precio del producto" y los carga acá mismo. */}
      <TextField
        label={t("products.form.price")}
        type="number"
        step="any"
        hint={t("products.form.priceHint")}
        value={price}
        disabled={!canManage}
        onChange={(event) => setPrice(event.target.value)}
      />
      <TextField
        label={t("products.form.cost")}
        type="number"
        step="any"
        value={cost}
        disabled={!canManage}
        onChange={(event) => setCost(event.target.value)}
      />

      <div className="flex items-center gap-2">
        <Checkbox
          id="is-composite"
          checked={isComposite}
          disabled={!canManage}
          onCheckedChange={(checked) => setIsComposite(checked === true)}
        />
        <Label htmlFor="is-composite">{t("products.form.isComposite")}</Label>
      </div>

      <DynamicForm
        fields={fields ?? []}
        values={attributes}
        errors={fieldErrors}
        disabled={!canManage}
        onChange={(key, value) => setAttributes((previous) => ({ ...previous, [key]: value }))}
      />

      {canManage && (
        <div className="flex gap-2">
          <Button type="submit" disabled={isSubmitting || !sku.trim() || !name.trim()}>
            {isSubmitting ? t("common.form.submitting") : t("common.form.save")}
          </Button>
          <Button type="button" variant="outline" onClick={onDone}>
            {t("common.form.cancel")}
          </Button>
          {product && (
            <Button
              type="button"
              variant="destructive"
              onClick={() => {
                setError(null);
                deleteProduct.mutate(product.id, {
                  onSuccess: onDone,
                  // 409 si es componente de otro: el mensaje nombra a quiénes.
                  onError: handleError,
                });
              }}
            >
              {t("common.form.remove")}
            </Button>
          )}
        </div>
      )}
    </form>
  );
}
