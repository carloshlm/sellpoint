import { UNIT_CODES, unitName } from "@sellpoint/shared";
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
import { ConfirmDialog } from "@/components/common/confirm-dialog";
import { SelectField } from "@/components/form/select-field";
import { TextField } from "@/components/form/text-field";
import { KardexTab } from "@/components/inventory/kardex-tab";
import { StockTab } from "@/components/inventory/stock-tab";
import { AppLayout } from "@/components/layout/app-layout";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { RowAction } from "@/components/ui/row-action";
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
import { usePermissions } from "@/lib/auth/permissions";
import { usePlan } from "@/lib/billing/use-plan";
import { useCatalogFields, useCatalogs } from "@/lib/catalogs/hooks";
import { fieldErrorsOf } from "@/lib/field-errors";
import type { ProductDetail } from "@/lib/products/api";
import {
  useAvailability,
  useCreateProduct,
  useDeleteProduct,
  useProduct,
  useProducts,
  useUpdateProduct,
} from "@/lib/products/hooks";
import { MONEY_STEP, moneyScaleError } from "@/lib/products/money";
import { useScrollIntoView } from "@/lib/use-scroll-into-view";
import { useAuthStore } from "@/stores/auth.store";

/** Las pestañas del detalle, como valores: la URL las tiene que validar. */
const PRODUCT_TABS = ["info", "presentations", "composition", "stock", "kardex"] as const;
type ProductTab = (typeof PRODUCT_TABS)[number];

export interface ProductsSearch {
  /** El producto abierto. Sin esto, el listado. */
  open?: string;
  /** La pestaña dentro del detalle. */
  tab?: ProductTab;
}

/**
 * **Qué producto estás mirando es parte de DÓNDE estás, no de cómo se ve la
 * pantalla.** Antes vivía en un `useState`, y por eso el detalle abierto y el
 * listado compartían la misma URL — `/catalog/products` en los dos casos.
 *
 * Eso rompía el menú de una forma que parecía un capricho del navegador:
 * estando en el Kardex de un producto, hacer clic en "Productos" navegaba a la
 * URL en la que YA estabas, así que el router no tenía nada que hacer y la
 * pantalla no se movía. No era que el clic se perdiera: era que no había a
 * dónde ir.
 *
 * Con el producto en la URL, el arreglo no es un parche sino una consecuencia,
 * y vienen tres cosas más de regalo: la flecha ATRÁS del navegador funciona,
 * F5 te deja donde estabas, y se puede pasar un enlace al kardex de un
 * producto concreto.
 *
 * `validateSearch` es la aduana: lo que venga en la URL es texto que escribió
 * cualquiera. Una pestaña inventada se descarta en vez de romper el render.
 */
export const Route = createFileRoute("/catalog/products")({
  validateSearch: (search: Record<string, unknown>): ProductsSearch => ({
    ...(typeof search.open === "string" && search.open !== "" ? { open: search.open } : {}),
    ...(PRODUCT_TABS.includes(search.tab as ProductTab) ? { tab: search.tab as ProductTab } : {}),
  }),
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
  const { canWrite } = usePlan();
  const canManage = has("products:manage") && canWrite;

  const [query, setQuery] = useState("");
  const [onlyComposite, setOnlyComposite] = useState(false);
  const [page, setPage] = useState(1);
  // El producto abierto sale de la URL, no del estado: ver el docblock de
  // `Route`. `creating` sí es estado — un formulario a medio llenar no es un
  // lugar al que se pueda volver con un enlace.
  const { open: openId, tab } = Route.useSearch();
  const navigate = Route.useNavigate();
  const [creating, setCreating] = useState(false);
  // Desactivar/Reactivar directo desde la fila (Carlos, 2026-08-25): apagar
  // un producto no debería exigir abrir la ficha.
  const toggleActive = useUpdateProduct();
  // Desactivar puede REBOTAR: un producto con existencias no se apaga (sería
  // inventario fantasma — el conteo excluye los inactivos). Sin este aviso el
  // clic no haría nada visible y el usuario creería que la app se colgó.
  const [errorAcción, setErrorAcción] = useState<string | null>(null);
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
      <ProductDetailPanel
        productId={openId}
        canManage={canManage}
        tab={tab ?? "info"}
        onTab={(next) => navigate({ search: { open: openId, tab: next } })}
        onBack={() => navigate({ search: {} })}
      />
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

      {/* El rechazo de desactivar, arriba de la tabla: la fila donde se hizo
          clic puede quedar fuera de la vista al scrollear, el aviso no. */}
      {errorAcción ? (
        <p
          data-testid="product-action-error"
          className="rounded-md bg-destructive/10 px-3 py-2 text-destructive text-sm"
        >
          {errorAcción}
        </p>
      ) : null}

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
                      // warning y no default (Carlos, 2026-08-25): "Compuesto"
                      // no es un estado apagado, es una señal de atención —
                      // vender uno descuenta componentes.
                      <Badge variant="warning" className="ml-2">
                        {t("products.compositeBadge")}
                      </Badge>
                    )}
                    {/* Un producto apagado sin señal parece un bug de stock. */}
                    {!product.isActive && (
                      <Badge variant="default" className="ml-2">
                        {t("products.inactiveBadge")}
                      </Badge>
                    )}
                  </TableCell>
                  <TableCell>{product.price ?? "—"}</TableCell>
                  {onlyComposite && <AvailabilityCell productId={product.id} />}
                  <TableCell className="text-right">
                    {/* «Ver» y no «Editar» (Carlos, 2026-08-31): el enlace abre
                        la ficha, y desde ahí se edita SI se tiene permiso. A
                        quien solo puede leer, «Editar» le prometía algo que la
                        pantalla no le iba a dar. */}
                    <RowAction
                      intent="view"
                      onClick={() => navigate({ search: { open: product.id } })}
                    />
                    {canManage && (
                      <RowAction
                        intent={product.isActive ? "deactivate" : "reactivate"}
                        disabled={toggleActive.isPending}
                        onClick={() => {
                          setErrorAcción(null);
                          toggleActive.mutate(
                            { id: product.id, input: { isActive: !product.isActive } },
                            {
                              onError: (apiError) => {
                                // El mensaje dice CUÁNTOS almacenes; el detalle
                                // dice cuáles y con cuánto, que es lo que el
                                // usuario necesita para poder sacarlo.
                                const almacenes = (
                                  apiError as { warehouses?: { name: string; quantity: string }[] }
                                ).warehouses;
                                setErrorAcción(
                                  almacenes?.length
                                    ? `${apiError.message} (${almacenes
                                        .map((a) => `${a.name}: ${a.quantity}`)
                                        .join(" · ")})`
                                    : apiError.message,
                                );
                              },
                            },
                          );
                        }}
                      />
                    )}
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
  tab,
  onTab,
  onBack,
}: {
  productId: string;
  canManage: boolean;
  tab: ProductTab;
  onTab: (tab: ProductTab) => void;
  onBack: () => void;
}) {
  const { t } = useTranslation();
  const { has } = usePermissions();
  const { data: product, isPending } = useProduct(productId);
  // `inventory:read` y no `products:read`: ver el catálogo no implica ver
  // cuánto hay ni cómo se movió.
  const canReadInventory = has("inventory:read");

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
    // Kardex y stock son de INVENTARIO, no de catálogo: quien administra
    // productos no necesariamente puede ver cuánto hay.
    ...(canReadInventory
      ? [
          { id: "stock" as const, label: t("products.tabs.stock") },
          { id: "kardex" as const, label: t("products.tabs.kardex") },
        ]
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
            onClick={() => onTab(item.id)}
          >
            {item.label}
          </button>
        ))}
      </nav>

      {/* La MISMA tarjeta que el alta (Carlos, 2026-08-24): el formulario es
          uno solo y tiene que verse como uno solo — pelado sobre el gris de la
          página parecía otra pantalla. Sin CardHeader: el nombre del producto
          ya preside arriba y repetirlo sería eco. */}
      {tab === "info" && (
        <Card>
          <CardContent>
            <ProductForm product={product} onDone={onBack} />
          </CardContent>
        </Card>
      )}
      {tab === "presentations" && (
        <PresentationsTab
          productId={product.id}
          baseUnit={product.baseUnit}
          presentations={product.presentations}
          canManage={canManage}
        />
      )}
      {tab === "composition" && <CompositionTab productId={product.id} canManage={canManage} />}
      {tab === "stock" && <StockTab productId={product.id} />}
      {tab === "kardex" && (
        <KardexTab
          productId={product.id}
          tracksLots={product.tracksLots ?? false}
          isComposite={product.isComposite}
          baseUnit={product.baseUnit}
        />
      )}
    </div>
  );
}

function ProductForm({ product, onDone }: { product?: ProductDetail; onDone: () => void }) {
  const { t, i18n } = useTranslation();
  // La respuesta visible al clic que montó el form: entra a la vista con el
  // cursor en el primer campo (ver el docblock del hook).
  const formRef = useScrollIntoView<HTMLFormElement>({ focusFirstField: true, block: "start" });
  const uiLocale = resolveUiLocale(i18n);
  const { has } = usePermissions();
  const { canWrite } = usePlan();
  const canManage = has("products:manage") && canWrite;
  const { data: catalogs } = useCatalogs();
  // Por systemKey, NUNCA `find(isSystem)`: hay TRES catálogos del sistema y
  // el de Almacenes ordena primero — bindearía los campos equivocados.
  const productsCatalog = catalogs?.find((catalog) => catalog.systemKey === "products");
  const { data: fields } = useCatalogFields(productsCatalog?.id);

  const basePresentation = product?.presentations.find(
    (presentation) => presentation.isDefaultSale,
  );

  const [sku, setSku] = useState(product?.sku ?? "");
  const [name, setName] = useState(product?.name ?? "");
  const [baseUnit, setBaseUnit] = useState(product?.baseUnit ?? "unit");
  const [stockMin, setStockMin] = useState(product?.stockMin ?? "0");
  const [location, setLocation] = useState(product?.location ?? "");
  const usaUbicaciones = useAuthStore((state) => state.user?.tenant?.usesLocations === true);
  const [isComposite, setIsComposite] = useState(product?.isComposite ?? false);
  const [tracksLots, setTracksLots] = useState(product?.tracksLots ?? false);
  const [price, setPrice] = useState(basePresentation?.price ?? "");
  const [cost, setCost] = useState(basePresentation?.cost ?? "");
  // Sale de la presentación base, igual que el precio: `barcode` no es columna
  // de `products` —la caja de 12 y la pieza suelta llevan códigos distintos—
  // pero el usuario lo ve como «el código del producto» y lo carga acá mismo,
  // en UN solo paso (Carlos, 2026-08-24).
  const [barcode, setBarcode] = useState(basePresentation?.barcode ?? "");
  const [attributes, setAttributes] = useState<Record<string, unknown>>(product?.attributes ?? {});
  const lotesBloqueados = Boolean(product?.hasLotStock) && (product?.tracksLots ?? false);
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [confirmingDelete, setConfirmingDelete] = useState(false);

  const createProduct = useCreateProduct();
  const updateProduct = useUpdateProduct();
  const deleteProduct = useDeleteProduct();
  const isSubmitting = createProduct.isPending || updateProduct.isPending;

  // Anticipa la guarda del server: con stock o siendo componente de otro, la
  // unidad base no se puede mover (ARQUITECTURA § 3.5).
  const { data: availability } = useAvailability(product?.id, Boolean(product?.isComposite));
  void availability;

  // Los importes tienen dos decimales (`DECIMAL(14,2)`): se avisa MIENTRAS se
  // escribe y se bloquea el submit. El API lo rechaza igual —esta validación no
  // reemplaza a la de allá, la adelanta— pero enterarse al guardar, después de
  // llenar todo el formulario, es la peor forma de enterarse.
  // La clave la elige el helper: hay dos motivos distintos por los que un
  // importe no entra y el texto tiene que decir cuál.
  const priceErrorKey = moneyScaleError(price);
  const costErrorKey = moneyScaleError(cost);
  const priceError = priceErrorKey ? t(priceErrorKey) : undefined;
  const costError = costErrorKey ? t(costErrorKey) : undefined;

  function handleError(apiError: ApiError) {
    // Mismo helper que la pestaña de composición: el casteo del `errors` del
    // API vivía duplicado y con su propio criterio en cada formulario.
    const byField = fieldErrorsOf(apiError);
    if (byField.size > 0) {
      // `t()` es una red por si alguna clave llega sin traducir del backend;
      // con texto ya traducido i18next devuelve el mismo string.
      setFieldErrors(Object.fromEntries([...byField].map(([key, message]) => [key, t(message)])));
      return;
    }
    setError(apiError.message);
  }

  return (
    <form
      ref={formRef}
      className="flex max-w-2xl flex-col gap-4"
      onSubmit={(event) => {
        event.preventDefault();
        setError(null);
        setFieldErrors({});
        // La regla de los DOS códigos (Carlos, 2026-08-24): se exige al menos
        // uno. Sin interno, se adopta el de barras — es lo que hace medio
        // comercio con los códigos mundiales, y el interno es obligatorio.
        // La copia INVERSA no existe a propósito: el código de barras
        // describe lo IMPRESO en el empaque, y rellenarlo con el interno
        // inventaría códigos que ningún escáner va a leer.
        const codigoInterno = sku.trim() !== "" ? sku : barcode.trim();
        const payload = {
          sku: codigoInterno,
          name,
          baseUnit,
          stockMin: Number(stockMin) || 0,
          // Vacío es "sin ubicación", no la cadena vacía: la hoja del conteo
          // los manda al final por NULL.
          location: location.trim() === "" ? null : location.trim(),
          isComposite,
          tracksLots,
          attributes,
          ...(price !== "" ? { price: Number(price) } : {}),
          ...(cost !== "" ? { cost: Number(cost) } : {}),
          ...(barcode !== "" ? { barcode } : {}),
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

      {/* ── El ORDEN sigue el flujo del alta (Carlos, 2026-08-24) ────────
          Primero lo que viene IMPRESO en la caja que el usuario tiene en la
          mano, después lo que decide el negocio. Y el costo antes que el
          precio, porque el precio se decide MIRANDO el costo, no al revés.
          Lo fija `catalog-products-barcode.test.tsx`: un reordenamiento
          accidental no rompe nada visible, solo deja de acompañar. */}

      {/* Va PRIMERO y es el campo estándar del catálogo: es lo que lee el
          escáner. Puede coincidir con el código interno —y está bien— cuando
          el producto trae un código mundial (EAN/UPC) que el negocio adopta
          como propio: son campos distintos que a veces valen lo mismo. */}
      <TextField
        label={t("products.form.barcode")}
        hint={t("products.form.barcodeHint")}
        value={barcode}
        disabled={!canManage}
        onChange={(event) => setBarcode(event.target.value)}
      />
      <TextField
        label={t("products.form.sku")}
        hint={t("products.form.skuHint")}
        value={sku}
        // El placeholder MUESTRA lo que se va a usar: con el interno vacío y
        // un código de barras puesto, el interno adopta ese valor al guardar.
        // Decirlo con el valor real vale más que explicarlo en abstracto.
        placeholder={barcode.trim() !== "" && sku.trim() === "" ? barcode : undefined}
        disabled={!canManage}
        onChange={(event) => setSku(event.target.value)}
      />
      {/* El porqué del botón muerto. Un Guardar deshabilitado sin explicación
          se lee como pantalla rota — lección repetida de este proyecto. */}
      {sku.trim() === "" && barcode.trim() === "" && (
        <p className="text-muted-foreground text-sm" role="status">
          {t("products.form.codesRequired")}
        </p>
      )}
      <TextField
        label={t("products.form.name")}
        value={name}
        disabled={!canManage}
        onChange={(event) => setName(event.target.value)}
      />
      {/* Se elige por NOMBRE ("Kilogramo") y se guarda el CÓDIGO (`kg`): nadie
          que no sea del oficio reconoce `oz` en un desplegable, pero el código
          es lo que viaja a la DB y a la planilla de importación. */}
      <SelectField
        label={t("products.form.baseUnit")}
        value={baseUnit}
        disabled={!canManage}
        options={UNIT_CODES.map((code) => ({ value: code, label: unitName(code, uiLocale) }))}
        onChange={(event) => setBaseUnit(event.target.value)}
      />

      {/* Costo y precio editan la presentación base: el usuario los ve como
          "el costo y el precio del producto" y los carga acá mismo. */}
      <TextField
        label={t("products.form.cost")}
        type="number"
        step={MONEY_STEP}
        hint={t("products.form.costHint")}
        error={costError}
        value={cost}
        disabled={!canManage}
        onChange={(event) => setCost(event.target.value)}
      />
      <TextField
        label={t("products.form.price")}
        type="number"
        step={MONEY_STEP}
        hint={t("products.form.priceHint")}
        error={priceError}
        value={price}
        disabled={!canManage}
        onChange={(event) => setPrice(event.target.value)}
      />
      <TextField
        label={t("products.form.stockMin")}
        type="number"
        step="any"
        hint={t("products.form.stockMinHint")}
        value={stockMin}
        disabled={!canManage}
        onChange={(event) => setStockMin(event.target.value)}
      />
      {/*
        Solo si el negocio usa ubicaciones: a quien no las lleva, un campo
        más en cada alta es ruido que hay que ignorar cada vez.
      */}
      {usaUbicaciones && (
        <TextField
          label={t("products.form.location")}
          hint={t("products.form.locationHint")}
          value={location}
          disabled={!canManage}
          onChange={(event) => setLocation(event.target.value)}
        />
      )}

      <DynamicForm
        fields={fields ?? []}
        values={attributes}
        errors={fieldErrors}
        disabled={!canManage}
        onChange={(key, value) => setAttributes((previous) => ({ ...previous, [key]: value }))}
      />

      {/* ── Los dos interruptores, al FINAL (Carlos, 2026-08-24) ─────────
          Todo lo de arriba son DATOS del producto —lo que dice la caja, lo
          que cobra el negocio—. Estos dos son decisiones de COMPORTAMIENTO:
          cambian cómo se maneja el producto en TODO el sistema. Mezclados
          entre la descripción y el proveedor eran fáciles de pasar por alto,
          justo los dos que más consecuencias tienen. Primero el de lotes,
          que es el que condiciona entradas, salidas y FEFO. */}

      <div className="flex items-center gap-2">
        <Checkbox
          id="tracks-lots"
          checked={tracksLots}
          // Solo se bloquea para APAGARLO con saldo asignado a lotes: eso
          // dejaría las filas de `stock_lots` huérfanas. Encenderlo siempre se
          // puede — el saldo previo queda "sin lote" y se asigna después por
          // inventario físico.
          disabled={!canManage || lotesBloqueados}
          // El `title` no es decoración: es el ÚNICO lugar donde el usuario se
          // entera de por qué no puede. Un checkbox gris sin explicación se lee
          // como un bug de la pantalla.
          title={lotesBloqueados ? t("products.form.tracksLotsLocked") : undefined}
          onCheckedChange={(checked) => setTracksLots(checked === true)}
        />
        <Label htmlFor="tracks-lots">{t("products.form.tracksLots")}</Label>
      </div>

      <div className="flex items-center gap-2">
        <Checkbox
          id="is-composite"
          checked={isComposite}
          disabled={!canManage}
          onCheckedChange={(checked) => setIsComposite(checked === true)}
        />
        <Label htmlFor="is-composite">{t("products.form.isComposite")}</Label>
      </div>

      {canManage && (
        <div className="flex gap-2">
          <Button
            type="submit"
            disabled={
              isSubmitting ||
              (!sku.trim() && !barcode.trim()) ||
              !name.trim() ||
              Boolean(priceError) ||
              Boolean(costError)
            }
          >
            {isSubmitting ? t("common.form.submitting") : t("common.form.save")}
          </Button>
          <Button type="button" variant="outline" onClick={onDone}>
            {t("common.form.cancel")}
          </Button>
          {/* Desactivar SIEMPRE existió en el contrato (isActive del PATCH)
              pero ninguna pantalla lo ofrecía — y el aviso de «tiene
              movimientos, desactívalo» mandaba a un botón que no estaba
              (Carlos, 2026-08-25). Colores por token, como RowAction. */}
          {product && (
            <Button
              type="button"
              variant="outline"
              className={
                product.isActive
                  ? "text-warning hover:text-warning"
                  : "text-success hover:text-success"
              }
              disabled={updateProduct.isPending}
              onClick={() => {
                setError(null);
                updateProduct.mutate(
                  { id: product.id, input: { isActive: !product.isActive } },
                  { onError: handleError },
                );
              }}
            >
              {t(product.isActive ? "common.actions.deactivate" : "common.actions.reactivate")}
            </Button>
          )}
          {product && (
            <Button type="button" variant="destructive" onClick={() => setConfirmingDelete(true)}>
              {t("common.actions.delete")}
            </Button>
          )}
        </div>
      )}

      {/* Borrar un producto se lleva sus presentaciones, sus códigos de barras
          y su composición. Es lo más caro que se puede hacer desde esta
          pantalla y era lo ÚNICO que no preguntaba. */}
      {confirmingDelete && product && (
        <ConfirmDialog
          data-testid="remove-product-dialog"
          title={t("products.removeDialog.title")}
          body={t("products.removeDialog.body", { name: product.name })}
          confirmLabel={t("products.removeDialog.confirm")}
          cancelLabel={t("common.form.cancel")}
          busy={deleteProduct.isPending}
          onCancel={() => setConfirmingDelete(false)}
          onConfirm={() => {
            setError(null);
            deleteProduct.mutate(product.id, {
              onSuccess: onDone,
              // 409 si es componente de otro: el mensaje nombra a quiénes. El
              // diálogo se cierra porque insistir con el mismo botón no lo
              // arregla — hay que deshacer la composición primero.
              onError: (apiError) => {
                setConfirmingDelete(false);
                handleError(apiError);
              },
            });
          }}
        />
      )}
    </form>
  );
}
