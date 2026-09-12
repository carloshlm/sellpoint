import type { TaxMode } from "@sellpoint/shared";
import { type Currency, formatMoney } from "@sellpoint/shared";
import { forwardRef, useEffect, useImperativeHandle, useState } from "react";
import { useTranslation } from "react-i18next";
import { MoneyInput } from "@/components/form/money-input";
import { ProductSearch } from "@/components/purchases/product-search";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ScrollableTable } from "@/components/ui/scrollable-table";
import { formatCalendarDate } from "@/lib/inventory/format-date";
import { getProduct } from "@/lib/products/api";
import type {
  PurchaseOrder,
  PurchaseOrderLineInput,
  PurchaseOrderProduct,
} from "@/lib/purchase-orders/api";
import {
  useClosePurchaseOrderLineShort,
  useReplacePurchaseOrderLines,
} from "@/lib/purchase-orders/hooks";
import { getLastCost, type LastCost } from "@/lib/purchases/api";
import { useAuthStore } from "@/stores/auth.store";

interface LineaEditable {
  uid: string;
  productId: string;
  sku: string;
  description: string;
  presentationId: string;
  quantity: string;
  unitCost: string;
  discount: string;
  /** Lo que el API ya calculó (vacío mientras no se guarde). */
  lineTotal: string | null;
  /** Solo en una orden emitida: el progreso de lo recibido. */
  lineNo: number | null;
  quantityReceived: string;
  pending: string;
  closedShort: boolean;
  /** Carlos, 2026-09-12: lo último que se le pagó a ESTE proveedor por el producto. */
  lastCost: LastCost | null;
}

const nuevoUid = () =>
  typeof crypto?.randomUUID === "function" ? crypto.randomUUID() : `l-${Math.random()}`;

async function fichaDe(producto: {
  id: string;
  sku: string;
  name: string;
}): Promise<PurchaseOrderProduct> {
  const detalle = await getProduct(producto.id);
  return {
    id: producto.id,
    sku: producto.sku,
    name: producto.name,
    baseUnit: "",
    presentations: detalle.presentations.map((p) => ({
      id: p.id,
      name: p.name,
      factor: p.factor,
      isPurchasable: p.isPurchasable,
      cost: p.cost ?? null,
    })),
  };
}

function aEditable(orden: PurchaseOrder): LineaEditable[] {
  return orden.lines.map((l) => ({
    uid: l.id,
    productId: l.productId,
    sku: l.productSku,
    description: l.description,
    presentationId: l.presentationId ?? "",
    quantity: l.quantityOrdered,
    unitCost: l.unitCost ?? "",
    discount: Number(l.discount) > 0 ? l.discount : "",
    lineTotal: l.lineTotal,
    lineNo: l.lineNo,
    quantityReceived: l.quantityReceived,
    pending: l.pending,
    closedShort: l.closedShort,
    lastCost: null,
  }));
}

/**
 * F9-PO-12 — las líneas del pedido. En BORRADOR se capturan en bloque (como
 * la compra: cada guardado recompone los impuestos estimados). EMITIDA, la
 * tabla cambia de cara: cada línea muestra cuánto se pidió, cuánto llegó y
 * cuánto falta, y deja «cerrar corta» lo que el proveedor ya no surtirá.
 *
 * No lleva lote ni caducidad: eso es de la RECEPCIÓN (lo que llega), no del
 * pedido (lo que se pide). Por eso no es la tabla de la compra con un
 * interruptor: comparten el buscador (`ProductSearch`) y nada más.
 */
/** Lo que la pantalla padre necesita de la tabla: guardar antes de emitir (Carlos, 2026-09-11). */
export interface LineasHandle {
  /** Guarda las líneas SOLO si hay cambios sin guardar; resuelve cuando el servidor respondió. */
  guardarSiHayCambios: () => Promise<void>;
}

/**
 * El costo del CATÁLOGO como punto de partida de una línea nueva (Carlos,
 * 2026-09-11): el de la presentación elegida (`product_presentations.cost`,
 * el mismo que pisa la entrada al confirmarse). Sin presentación o sin costo
 * registrado, vacío: nunca se inventa un múltiplo.
 *
 * F9-COSTMODE-05: el catálogo guarda el costo en la base del NEGOCIO
 * (`tenants.cost_tax_mode`); si este documento está en la otra base, no se
 * sugiere nada — un costo en la base equivocada es peor que ninguno — y la
 * tabla lo dice con un hint.
 */
export function costoDeCatalogo(
  ficha: { presentations: { id: string; cost?: string | null }[] },
  presentationId: string,
  documentMode: TaxMode,
  tenantCostMode: TaxMode,
): string {
  if (documentMode !== tenantCostMode) return "";
  return ficha.presentations.find((p) => p.id === presentationId)?.cost ?? "";
}

/**
 * El punto de partida del costo de una línea nueva: el último pagado a ESTE
 * proveedor si es de la misma presentación y de la misma base que el
 * documento; si no, lo que diga el catálogo (o nada).
 */
export function costoInicial(
  ultimo: LastCost | null,
  presentationId: string,
  documentMode: TaxMode,
  delCatalogo: string,
): string {
  if (
    ultimo !== null &&
    ultimo.presentationId !== null &&
    ultimo.presentationId === presentationId &&
    ultimo.taxMode === documentMode
  ) {
    return ultimo.unitCost;
  }
  return delCatalogo;
}

export const PurchaseOrderLinesTable = forwardRef<LineasHandle, { order: PurchaseOrder }>(
  function PurchaseOrderLinesTable({ order }, ref) {
    const { t, i18n } = useTranslation();
    const locale = useAuthStore((s) => s.user?.locale ?? "es");
    const currency = (useAuthStore((s) => s.user?.tenant.currency) ?? "MXN") as Currency;
    const costTaxMode = useAuthStore((s) => s.user?.tenant.costTaxMode ?? "excluded");
    const editable = order.status === "draft";
    const viva = order.status === "open" || order.status === "partially_received";
    const mismaBase = order.taxMode === costTaxMode;

    const [lineas, setLineas] = useState<LineaEditable[]>(() => aEditable(order));
    const [catalogo, setCatalogo] = useState<PurchaseOrderProduct[]>(order.products);
    const [error, setError] = useState<string | null>(null);
    const guardar = useReplacePurchaseOrderLines();
    const cerrarCorta = useClosePurchaseOrderLineShort();

    // …y también al cambiar el ESTADO: emitida, una línea local sin guardar no puede quedar como fantasma.
    const firmaDeLineas = JSON.stringify([order.status, order.lines]);
    // Se resincroniza SOLO cuando las LÍNEAS del servidor cambian (por su
    // firma), no cada vez que llega el objeto entero: el autoguardado de la
    // cabecera devuelve el documento completo y, con `[documento]` como
    // dependencia, pisaba lo que el usuario estaba tecleando en la tabla antes
    // de guardar (lo cazó el navegador el 2026-09-11: 6 tecleados, 10 guardados).
    // biome-ignore lint/correctness/useExhaustiveDependencies: la dependencia real es la firma de las líneas
    useEffect(() => {
      setLineas(aEditable(order));
      setCatalogo((previo) => {
        const porId = new Map(previo.map((p) => [p.id, p]));
        for (const producto of order.products) porId.set(producto.id, producto);
        return [...porId.values()];
      });
    }, [firmaDeLineas]);

    const dinero = (valor: string) => formatMoney(Number(valor), currency, locale);
    const productoDe = (id: string) => catalogo.find((p) => p.id === id);
    const cambiar = (index: number, campo: keyof LineaEditable, valor: string) => {
      setLineas((previas) =>
        previas.map((linea, i) => (i === index ? { ...linea, [campo]: valor } : linea)),
      );
    };

    async function agregar(producto: { id: string; sku: string; name: string }) {
      const yaEstaba = productoDe(producto.id);
      const ficha = yaEstaba ?? (await fichaDe(producto));
      if (yaEstaba === undefined) setCatalogo((previo) => [...previo, ficha]);
      const presentacionInicial =
        (ficha.presentations.find((p) => p.isPurchasable) ?? ficha.presentations[0])?.id ?? "";
      // El último costo con ESTE proveedor gana al del catálogo como punto de
      // partida — si es de la misma presentación y de la misma base; si no,
      // solo se muestra (Carlos, 2026-09-12). Sin red, se sigue sin él.
      const ultimo = await getLastCost({ supplierId: order.supplierId, productId: producto.id })
        .then((r) => r)
        .catch(() => null);
      setLineas((previas) => [
        ...previas,
        {
          uid: nuevoUid(),
          productId: producto.id,
          sku: producto.sku,
          description: producto.name,
          presentationId: presentacionInicial,
          quantity: "",
          unitCost: costoInicial(
            ultimo,
            presentacionInicial,
            order.taxMode,
            costoDeCatalogo(ficha, presentacionInicial, order.taxMode, costTaxMode),
          ),
          lastCost: ultimo,
          discount: "",
          lineTotal: null,
          lineNo: null,
          quantityReceived: "0",
          pending: "",
          closedShort: false,
        },
      ]);
    }

    const armarPayload = (): PurchaseOrderLineInput[] =>
      lineas.map((linea) => ({
        productId: linea.productId,
        presentationId: linea.presentationId === "" ? null : linea.presentationId,
        quantity: Number(linea.quantity),
        unitCost: linea.unitCost.trim() === "" ? null : Number(linea.unitCost),
        discount: linea.discount.trim() === "" ? 0 : Number(linea.discount),
      }));
    // Hay cambios sin guardar si lo tecleado difiere de lo que el servidor tiene.
    const sucia = JSON.stringify(lineas) !== JSON.stringify(aEditable(order));
    useImperativeHandle(ref, () => ({
      guardarSiHayCambios: async () => {
        if (!editable || !sucia) return;
        await guardar.mutateAsync({ id: order.id, lines: armarPayload() });
      },
    }));

    const guardarLineas = () => {
      setError(null);
      const payload: PurchaseOrderLineInput[] = lineas.map((linea) => ({
        productId: linea.productId,
        presentationId: linea.presentationId === "" ? null : linea.presentationId,
        quantity: Number(linea.quantity),
        unitCost: linea.unitCost.trim() === "" ? null : Number(linea.unitCost),
        discount: linea.discount.trim() === "" ? 0 : Number(linea.discount),
      }));
      guardar.mutate(
        { id: order.id, lines: payload },
        { onError: (apiError) => setError(apiError.message) },
      );
    };

    return (
      <section className="flex flex-col gap-3" data-testid="purchase-order-lines">
        <h2 className="font-medium">{t("purchaseOrders.lines.title")}</h2>

        {editable && (
          <ProductSearch
            id="purchase-order-line-search"
            label={t("purchaseOrders.lines.search")}
            placeholder={t("purchaseOrders.lines.searchPlaceholder")}
            onPick={(producto) => {
              setError(null);
              agregar(producto).catch((e: { message?: string }) => setError(e.message ?? "error"));
            }}
          />
        )}
        {editable && !mismaBase && (
          <p className="text-muted-foreground text-xs">
            {t("purchaseOrders.lines.catalogCostOtherBase")}
          </p>
        )}

        {error !== null && (
          <p
            role="alert"
            className="rounded-md bg-destructive/10 px-3 py-2 text-destructive text-sm"
          >
            {error}
          </p>
        )}

        {lineas.length === 0 ? (
          <p className="text-muted-foreground text-sm">{t("purchaseOrders.lines.empty")}</p>
        ) : (
          <ScrollableTable>
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b bg-muted/40 text-left hover:bg-transparent">
                  <th className="p-2">{t("purchaseOrders.lines.product")}</th>
                  <th className="p-2">{t("purchaseOrders.lines.presentation")}</th>
                  <th className="p-2 text-right">{t("purchaseOrders.lines.quantity")}</th>
                  <th className="p-2 text-right">{t("purchaseOrders.lines.unitCost")}</th>
                  <th className="p-2 text-right">{t("purchaseOrders.lines.discount")}</th>
                  <th className="p-2 text-right">{t("purchaseOrders.lines.amount")}</th>
                  {!editable && <th className="p-2">{t("purchaseOrders.lines.received")}</th>}
                  {(editable || viva) && <th className="p-2" />}
                </tr>
              </thead>
              <tbody>
                {lineas.map((linea, index) => {
                  const producto = productoDe(linea.productId);
                  const presentacion = producto?.presentations.find(
                    (p) => p.id === linea.presentationId,
                  );
                  const porcentaje =
                    Number(linea.quantity) > 0
                      ? Math.min(
                          100,
                          Math.round(
                            (Number(linea.quantityReceived) / Number(linea.quantity)) * 100,
                          ),
                        )
                      : 0;
                  return (
                    <tr
                      key={linea.uid}
                      data-testid={`purchase-order-line-${index}`}
                      className="border-b last:border-0 hover:bg-muted/50 [&>td]:align-top"
                    >
                      <td className="p-2">
                        <span className="block font-medium">{linea.description}</span>
                        <span className="font-mono text-muted-foreground text-xs">{linea.sku}</span>
                      </td>
                      <td className="p-2">
                        {editable ? (
                          <select
                            aria-label={t("purchaseOrders.lines.presentation")}
                            className="h-9 rounded-md border border-input bg-background px-2 text-sm"
                            value={linea.presentationId}
                            onChange={(event) => {
                              cambiar(index, "presentationId", event.target.value);
                              if (linea.unitCost.trim() === "" && producto !== undefined) {
                                cambiar(
                                  index,
                                  "unitCost",
                                  costoDeCatalogo(
                                    producto,
                                    event.target.value,
                                    order.taxMode,
                                    costTaxMode,
                                  ),
                                );
                              }
                            }}
                          >
                            <option value="">{producto?.baseUnit || "—"}</option>
                            {(producto?.presentations ?? []).map((p) => (
                              <option key={p.id} value={p.id}>
                                {p.name}
                              </option>
                            ))}
                          </select>
                        ) : (
                          (presentacion?.name ?? producto?.baseUnit ?? "—")
                        )}
                        {editable && presentacion !== undefined && !presentacion.isPurchasable && (
                          <span className="block text-muted-foreground text-xs">
                            {t("purchaseOrders.lines.notPurchasable")}
                          </span>
                        )}
                      </td>
                      <td className="p-2 text-right tabular-nums">
                        {editable ? (
                          <Input
                            aria-label={t("purchaseOrders.lines.quantity")}
                            className="ml-auto w-24 text-right tabular-nums"
                            inputMode="decimal"
                            value={linea.quantity}
                            onChange={(event) => cambiar(index, "quantity", event.target.value)}
                          />
                        ) : (
                          linea.quantity
                        )}
                      </td>
                      <td className="p-2 text-right tabular-nums">
                        {editable ? (
                          <>
                            <MoneyInput
                              aria-label={t("purchaseOrders.lines.unitCost")}
                              value={linea.unitCost}
                              onChange={(valor) => cambiar(index, "unitCost", valor)}
                            />
                            {linea.lastCost !== null && (
                              <span
                                className="block text-muted-foreground text-xs"
                                data-testid={`last-cost-${index}`}
                              >
                                {t("purchaseOrders.lines.lastCost", {
                                  cost: dinero(linea.lastCost.unitCost),
                                  presentation: linea.lastCost.presentationName ?? "—",
                                  folio: linea.lastCost.folio,
                                  date: formatCalendarDate(
                                    linea.lastCost.purchaseDate,
                                    i18n.language,
                                  ),
                                })}
                              </span>
                            )}
                          </>
                        ) : linea.unitCost === "" ? (
                          "—"
                        ) : (
                          dinero(linea.unitCost)
                        )}
                      </td>
                      <td className="p-2 text-right tabular-nums">
                        {editable ? (
                          <MoneyInput
                            aria-label={t("purchaseOrders.lines.discount")}
                            value={linea.discount}
                            onChange={(valor) => cambiar(index, "discount", valor)}
                          />
                        ) : linea.discount === "" ? (
                          "—"
                        ) : (
                          `−${dinero(linea.discount)}`
                        )}
                      </td>
                      <td className="p-2 text-right tabular-nums">
                        {linea.lineTotal === null ? "—" : dinero(linea.lineTotal)}
                      </td>
                      {!editable && (
                        <td className="p-2">
                          <div className="flex min-w-36 flex-col gap-1">
                            <span className="tabular-nums text-xs">
                              {t("purchaseOrders.lines.progress", {
                                received: linea.quantityReceived,
                                ordered: linea.quantity,
                              })}
                              {linea.closedShort && (
                                <span className="ml-1 text-muted-foreground">
                                  · {t("purchaseOrders.lines.closedShort")}
                                </span>
                              )}
                            </span>
                            <div
                              role="progressbar"
                              aria-valuemin={0}
                              aria-valuemax={100}
                              aria-valuenow={porcentaje}
                              aria-label={t("purchaseOrders.lines.received")}
                              className="h-1.5 w-full overflow-hidden rounded-full bg-muted"
                            >
                              <div
                                className={`h-full ${linea.closedShort ? "bg-muted-foreground" : "bg-primary"}`}
                                style={{ width: `${porcentaje}%` }}
                              />
                            </div>
                          </div>
                        </td>
                      )}
                      {editable && (
                        <td className="p-2 text-right">
                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            onClick={() =>
                              setLineas((previas) => previas.filter((_, i) => i !== index))
                            }
                          >
                            {t("purchaseOrders.lines.remove")}
                          </Button>
                        </td>
                      )}
                      {viva && (
                        <td className="p-2 text-right">
                          {!linea.closedShort &&
                            Number(linea.pending) > 0 &&
                            linea.lineNo !== null && (
                              <Button
                                type="button"
                                variant="ghost"
                                size="sm"
                                disabled={cerrarCorta.isPending}
                                onClick={() => {
                                  setError(null);
                                  cerrarCorta.mutate(
                                    { id: order.id, lineNo: linea.lineNo as number },
                                    { onError: (apiError) => setError(apiError.message) },
                                  );
                                }}
                              >
                                {t("purchaseOrders.lines.closeShort")}
                              </Button>
                            )}
                        </td>
                      )}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </ScrollableTable>
        )}

        {editable && (
          <div>
            <Button type="button" onClick={guardarLineas} disabled={guardar.isPending}>
              {guardar.isPending ? t("common.form.submitting") : t("purchaseOrders.lines.save")}
            </Button>
          </div>
        )}
      </section>
    );
  },
);
