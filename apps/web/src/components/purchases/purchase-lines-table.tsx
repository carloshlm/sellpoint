import { type Currency, formatMoney } from "@sellpoint/shared";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { DateField } from "@/components/form/date-field";
import { MoneyInput } from "@/components/form/money-input";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ScrollableTable } from "@/components/ui/scrollable-table";
import { listPresentations } from "@/lib/products/api";
import { useProducts } from "@/lib/products/hooks";
import type { Purchase, PurchaseLineInput, PurchaseProduct } from "@/lib/purchases/api";
import { useReplacePurchaseLines } from "@/lib/purchases/hooks";
import { useDebouncedValue } from "@/lib/use-debounced-value";
import { useAuthStore } from "@/stores/auth.store";

/** La línea EN EDICIÓN: todo texto, porque es lo que el usuario teclea. */
interface LineaEditable {
  productId: string;
  sku: string;
  /**
   * Identidad LOCAL de la fila, no del API: una línea nueva no tiene id hasta
   * guardarse, y con el índice como `key` quitar una del medio dejaba el input
   * de la de abajo con lo que se estaba tecleando.
   */
  uid: string;
  description: string;
  presentationId: string;
  quantity: string;
  unitCost: string;
  discount: string;
  lotCode: string;
  expiresAt: string;
  /** Lo ya calculado por el API para esta línea (vacío mientras no se guarde). */
  taxAmount: string | null;
  lineTotal: string | null;
  unitCostNet: string | null;
}

const MIN_QUERY = 2;

const nuevoUid = () =>
  typeof crypto?.randomUUID === "function" ? crypto.randomUUID() : `l-${Math.random()}`;

function aEditable(compra: Purchase): LineaEditable[] {
  return compra.lines.map((linea) => ({
    uid: linea.id,
    productId: linea.productId,
    sku: linea.productSku,
    description: linea.description,
    presentationId: linea.presentationId ?? "",
    quantity: linea.quantity ?? "",
    unitCost: linea.unitCost ?? "",
    discount: Number(linea.discount) > 0 ? linea.discount : "",
    lotCode: linea.lotCode ?? "",
    expiresAt: linea.expiresAt ?? "",
    taxAmount: linea.taxAmount,
    lineTotal: linea.lineTotal,
    unitCostNet: linea.unitCostNet,
  }));
}

/**
 * F9-PURCH-11 — la captura de las líneas de la factura.
 *
 * Las líneas van en BLOQUE («Guardar líneas») y no con autoguardado por celda:
 * cada guardado recompone los impuestos de la compra entera, así que guardar
 * a mitad de una fila dejaría totales de un estado que el papel nunca tuvo.
 * La cabecera sí se autoguarda — ahí cada campo es independiente.
 *
 * El lote y la caducidad se capturan aunque el inventario los pida después:
 * la compra TRANSPORTA lo que dice el papel. Si el producto lleva lotes, se
 * avisa; no se bloquea.
 */
export function PurchaseLinesTable({ purchase }: { purchase: Purchase }) {
  const { t } = useTranslation();
  const locale = useAuthStore((s) => s.user?.locale ?? "es");
  const currency = (useAuthStore((s) => s.user?.tenant.currency) ?? "MXN") as Currency;
  const editable = purchase.status === "draft";

  const [lineas, setLineas] = useState<LineaEditable[]>(() => aEditable(purchase));
  const [catalogo, setCatalogo] = useState<PurchaseProduct[]>(purchase.products);
  const [termino, setTermino] = useState("");
  const [error, setError] = useState<string | null>(null);
  const buscado = useDebouncedValue(termino.trim());
  const buscar = buscado.length >= MIN_QUERY;
  const { data: encontrados } = useProducts({ query: buscado, pageSize: 10 }, { enabled: buscar });
  const guardar = useReplacePurchaseLines();

  // La compra vuelve del API con sus totales ya hechos: la tabla se rehace
  // desde ella, que es la única fuente de verdad de lo guardado.
  useEffect(() => {
    setLineas(aEditable(purchase));
    setCatalogo((previo) => {
      const porId = new Map(previo.map((p) => [p.id, p]));
      for (const producto of purchase.products) porId.set(producto.id, producto);
      return [...porId.values()];
    });
  }, [purchase]);

  const dinero = (valor: string) => formatMoney(Number(valor), currency, locale);
  const productoDe = (id: string) => catalogo.find((p) => p.id === id);

  const cambiar = (index: number, campo: keyof LineaEditable, valor: string) => {
    setLineas((previas) =>
      previas.map((linea, i) => (i === index ? { ...linea, [campo]: valor } : linea)),
    );
  };

  async function agregar(producto: { id: string; sku: string; name: string }) {
    setTermino("");
    const yaEstaba = productoDe(producto.id);
    // Las presentaciones se resuelven ANTES de armar la línea, en una variable
    // local: leerlas de `catalogo` después del `setCatalogo` devolvía el estado
    // VIEJO (React no lo actualiza a mitad de la función) y la presentación
    // nacía vacía — con la fila pidiendo «—» en vez de la comprable.
    const presentaciones =
      yaEstaba?.presentations ??
      (await listPresentations(producto.id)).map((p) => ({
        id: p.id,
        name: p.name,
        factor: p.factor,
        isPurchasable: p.isPurchasable,
      }));
    if (yaEstaba === undefined) {
      setCatalogo((previo) => [
        ...previo,
        {
          id: producto.id,
          sku: producto.sku,
          name: producto.name,
          baseUnit: "",
          tracksLots: false,
          presentations: presentaciones,
        },
      ]);
    }
    setLineas((previas) => [
      ...previas,
      {
        uid: nuevoUid(),
        productId: producto.id,
        sku: producto.sku,
        description: producto.name,
        // La comprable es la que se usa al comprar; si no hay ninguna marcada,
        // la primera (el API cae a la unidad base si llega vacía).
        presentationId:
          (presentaciones.find((p) => p.isPurchasable) ?? presentaciones[0])?.id ?? "",
        quantity: "",
        unitCost: "",
        discount: "",
        lotCode: "",
        expiresAt: "",
        taxAmount: null,
        lineTotal: null,
        unitCostNet: null,
      },
    ]);
  }

  const guardarLineas = () => {
    setError(null);
    const payload: PurchaseLineInput[] = lineas.map((linea) => ({
      productId: linea.productId,
      presentationId: linea.presentationId === "" ? null : linea.presentationId,
      quantity: linea.quantity.trim() === "" ? null : Number(linea.quantity),
      unitCost: linea.unitCost.trim() === "" ? null : Number(linea.unitCost),
      discount: linea.discount.trim() === "" ? 0 : Number(linea.discount),
      lotCode: linea.lotCode.trim() === "" ? null : linea.lotCode.trim(),
      expiresAt: linea.expiresAt === "" ? null : linea.expiresAt,
    }));
    guardar.mutate(
      { id: purchase.id, lines: payload },
      { onError: (apiError) => setError(apiError.message) },
    );
  };

  return (
    <section className="flex flex-col gap-3" data-testid="purchase-lines">
      <h2 className="font-medium">{t("purchases.lines.title")}</h2>

      {editable && (
        <div className="flex flex-col gap-1">
          <label htmlFor="purchase-line-search" className="font-medium text-sm">
            {t("purchases.lines.search")}
          </label>
          <Input
            id="purchase-line-search"
            type="search"
            value={termino}
            placeholder={t("purchases.lines.searchPlaceholder")}
            onChange={(event) => setTermino(event.target.value)}
            className="max-w-sm"
          />
          {buscar && (encontrados?.items ?? []).length > 0 && (
            <ul className="flex max-h-48 max-w-sm flex-col gap-1 overflow-y-auto">
              {(encontrados?.items ?? []).map((producto) => (
                <li key={producto.id}>
                  <Button
                    type="button"
                    variant="outline"
                    className="h-auto w-full justify-start py-2 text-left"
                    data-testid={`add-product-${producto.id}`}
                    onClick={() => void agregar(producto)}
                  >
                    <span className="flex min-w-0 flex-col">
                      <span className="truncate font-medium">{producto.name}</span>
                      <span className="font-mono text-muted-foreground text-xs">
                        {producto.sku}
                      </span>
                    </span>
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {error !== null && (
        <p role="alert" className="rounded-md bg-destructive/10 px-3 py-2 text-destructive text-sm">
          {error}
        </p>
      )}

      {lineas.length === 0 ? (
        <p className="text-muted-foreground text-sm">{t("purchases.lines.empty")}</p>
      ) : (
        <ScrollableTable>
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b bg-muted/40 text-left hover:bg-transparent">
                <th className="p-2">{t("purchases.lines.product")}</th>
                <th className="p-2">{t("purchases.lines.presentation")}</th>
                <th className="p-2 text-right">{t("purchases.lines.quantity")}</th>
                <th className="p-2 text-right">{t("purchases.lines.unitCost")}</th>
                <th className="p-2 text-right">{t("purchases.lines.discount")}</th>
                <th className="p-2">{t("purchases.lines.lot")}</th>
                <th className="p-2">{t("purchases.lines.expiresAt")}</th>
                <th className="p-2 text-right">{t("purchases.lines.amount")}</th>
                {editable && <th className="p-2" />}
              </tr>
            </thead>
            <tbody>
              {lineas.map((linea, index) => {
                const producto = productoDe(linea.productId);
                const presentacion = producto?.presentations.find(
                  (p) => p.id === linea.presentationId,
                );
                return (
                  <tr
                    key={linea.uid}
                    data-testid={`purchase-line-${index}`}
                    className="border-b last:border-0 hover:bg-muted/50"
                  >
                    <td className="p-2">
                      <span className="block font-medium">{linea.description}</span>
                      <span className="font-mono text-muted-foreground text-xs">{linea.sku}</span>
                      {producto?.tracksLots === true && linea.lotCode.trim() === "" && (
                        <span className="block text-warning text-xs">
                          {t("purchases.lines.lotHint")}
                        </span>
                      )}
                    </td>
                    <td className="p-2">
                      <select
                        aria-label={t("purchases.lines.presentation")}
                        className="h-9 rounded-md border border-input bg-background px-2 text-sm"
                        value={linea.presentationId}
                        disabled={!editable}
                        onChange={(event) => cambiar(index, "presentationId", event.target.value)}
                      >
                        <option value="">{producto?.baseUnit || "—"}</option>
                        {(producto?.presentations ?? []).map((p) => (
                          <option key={p.id} value={p.id}>
                            {p.name}
                          </option>
                        ))}
                      </select>
                      {presentacion !== undefined && !presentacion.isPurchasable && (
                        <span className="block text-muted-foreground text-xs">
                          {t("purchases.lines.notPurchasable")}
                        </span>
                      )}
                    </td>
                    <td className="p-2 text-right">
                      <Input
                        aria-label={t("purchases.lines.quantity")}
                        className="w-24 text-right tabular-nums"
                        inputMode="decimal"
                        value={linea.quantity}
                        disabled={!editable}
                        onChange={(event) => cambiar(index, "quantity", event.target.value)}
                      />
                    </td>
                    <td className="p-2 text-right">
                      <MoneyInput
                        aria-label={t("purchases.lines.unitCost")}
                        value={linea.unitCost}
                        disabled={!editable}
                        onChange={(valor) => cambiar(index, "unitCost", valor)}
                      />
                      {linea.unitCostNet !== null && (
                        <span className="block text-muted-foreground text-xs">
                          {t("purchases.lines.netCost", { cost: dinero(linea.unitCostNet) })}
                        </span>
                      )}
                    </td>
                    <td className="p-2 text-right">
                      <MoneyInput
                        aria-label={t("purchases.lines.discount")}
                        value={linea.discount}
                        disabled={!editable}
                        onChange={(valor) => cambiar(index, "discount", valor)}
                      />
                    </td>
                    <td className="p-2">
                      <Input
                        aria-label={t("purchases.lines.lot")}
                        className="w-28"
                        value={linea.lotCode}
                        disabled={!editable}
                        onChange={(event) => cambiar(index, "lotCode", event.target.value)}
                      />
                    </td>
                    <td className="p-2">
                      <DateField
                        label={t("purchases.lines.expiresAt")}
                        className="[&>label]:sr-only"
                        value={linea.expiresAt}
                        disabled={!editable}
                        onChange={(event) => cambiar(index, "expiresAt", event.target.value)}
                      />
                    </td>
                    <td className="p-2 text-right tabular-nums">
                      {linea.lineTotal === null ? "—" : dinero(linea.lineTotal)}
                    </td>
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
                          {t("purchases.lines.remove")}
                        </Button>
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
            {guardar.isPending ? t("common.form.submitting") : t("purchases.lines.save")}
          </Button>
        </div>
      )}
    </section>
  );
}
