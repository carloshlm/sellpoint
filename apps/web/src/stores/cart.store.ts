import { addQuantities, multiplyMoney, parseQuantity } from "@sellpoint/shared";
import { create } from "zustand";
import type { LookupItem, LookupPresentation } from "@/lib/pos/api";

/**
 * F4-CART-02 — el carrito.
 *
 * ── El carrito vive en el CLIENTE ───────────────────────────────────────
 *
 * No hay borrador de venta en el servidor, y es una decisión, no una omisión:
 * el folio `VTA` se toma dentro de la transacción del cobro (F4-SALE-01), así
 * que un carrito abandonado —el cliente que se arrepiente, la pestaña que se
 * cierra— no gasta un número de la serie ni deja media venta que alguien tenga
 * que limpiar.
 *
 * ── Ids y cantidades, NUNCA precios ─────────────────────────────────────
 *
 * Los precios que guarda este store son **para pintar**. Lo que se manda al
 * cobrar son ids y cantidades, y el API relee el catálogo. Si el precio viajara
 * en el POST, alterarlo desde el navegador sería cambiar lo que se cobra, y no
 * habría forma de distinguir un descuento legítimo de una manipulación.
 *
 * ── Las cantidades son TEXTO ────────────────────────────────────────────
 *
 * `"12."` y `"0."` son estados legítimos de alguien tecleando en el numpad, y
 * ningún `number` puede representarlos: `Number("12.")` es `12`, así que el
 * punto recién escrito desaparecería de la pantalla en el mismo render. El
 * texto se convierte a número una sola vez, al armar el POST.
 */

/** La línea de un producto: se cobra por su PRESENTACIÓN. */
export interface CartProductLine {
  key: string;
  type: "product";
  productId: string;
  sku: string;
  name: string;
  baseUnit: string;
  isComposite: boolean;
  /**
   * Vendible en el almacén del turno, en unidad BASE, tal como lo calculó
   * `sellableStock`. Para un compuesto es cuántos se pueden ARMAR con lo que
   * hay de sus componentes — no un saldo propio, que no tiene.
   */
  available: string;
  presentationId: string;
  presentations: LookupPresentation[];
  quantity: string;
}

/** La línea de un servicio: sin presentación y sin stock. No sale del anaquel. */
export interface CartServiceLine {
  key: string;
  type: "service";
  serviceId: string;
  code: string;
  name: string;
  price: string | null;
  quantity: string;
}

export type CartLine = CartProductLine | CartServiceLine;

/** Lo que se manda a `POST /pos/sales`: ids y cantidades. */
export interface SaleLinePayload {
  productId?: string;
  serviceId?: string;
  presentationId?: string;
  quantity: number;
}

interface CartState {
  lines: CartLine[];
  /**
   * La cotización de la que salió este carrito (F4-QUOTE-04). Viaja al cobro
   * para que la venta quede vinculada y la cotización pase a `loaded`.
   */
  quoteId: string | null;
  add: (item: LookupItem, options?: { presentationId?: string; quantity?: string }) => void;
  remove: (key: string) => void;
  setQuantity: (key: string, quantity: string) => void;
  setPresentation: (key: string, presentationId: string) => void;
  setQuoteId: (quoteId: string | null) => void;
  clear: () => void;
}

/**
 * La identidad de una línea.
 *
 * Incluye la presentación a propósito: la caja de 12 y la pieza suelta del
 * mismo producto son DOS renglones del ticket, con precios distintos. Escanear
 * dos veces la misma caja, en cambio, es un solo renglón con cantidad 2 — que
 * es lo que hace cualquiera atrás de un mostrador.
 */
function claveDe(line: Pick<CartLine, "type"> & { id: string; presentationId?: string }): string {
  return line.type === "product"
    ? `product:${line.id}:${line.presentationId}`
    : `service:${line.id}`;
}

/** La presentación con la que nace una línea: la marcada por defecto. */
function presentacionInicial(
  presentations: LookupPresentation[],
  preferida?: string | null,
): string | undefined {
  if (preferida !== undefined && preferida !== null) {
    const existe = presentations.find((p) => p.id === preferida);
    if (existe !== undefined) {
      return existe.id;
    }
  }
  // `isDefaultSale` es la que el TenantAdmin marcó como "así se vende esto".
  // El respaldo es la de menor factor, que el API ya devuelve primera.
  return (presentations.find((p) => p.isDefaultSale) ?? presentations[0])?.id;
}

export const useCartStore = create<CartState>((set) => ({
  lines: [],
  quoteId: null,

  add: (item, options) =>
    set((state) => {
      const cantidad = options?.quantity ?? "1";

      if (item.type === "quote") {
        // Una cotización no es una línea: se vuelca con `F4-QUOTE-04`, que
        // agrega SUS líneas una por una. Ignorarla acá es más honesto que
        // inventar un renglón que el ticket no sabría imprimir.
        return state;
      }

      if (item.type === "service") {
        const key = claveDe({ type: "service", id: item.id });
        const existente = state.lines.find((l) => l.key === key);
        if (existente !== undefined) {
          return {
            lines: state.lines.map((l) =>
              l.key === key ? { ...l, quantity: addQuantities(l.quantity, cantidad) } : l,
            ),
          };
        }
        const nueva: CartServiceLine = {
          key,
          type: "service",
          serviceId: item.id,
          code: item.code,
          name: item.name,
          price: item.price,
          quantity: cantidad,
        };
        return { lines: [...state.lines, nueva] };
      }

      // `matchedPresentationId` gana sobre la predeterminada: si el acierto vino
      // de escanear la caja de 12, la línea nace siendo la caja. Preseleccionar
      // la pieza cobraría una en vez de doce.
      const presentationId = presentacionInicial(
        item.presentations,
        options?.presentationId ?? item.matchedPresentationId,
      );
      if (presentationId === undefined) {
        // Sin presentación vendible no hay con qué cobrar. El API tampoco lo
        // ofrece, así que llegar acá significaría un catálogo cambiado a mitad
        // de venta — agregar la línea igual solo movería el error a la caja.
        return state;
      }

      const key = claveDe({ type: "product", id: item.id, presentationId });
      const existente = state.lines.find((l) => l.key === key);
      if (existente !== undefined) {
        return {
          lines: state.lines.map((l) =>
            l.key === key ? { ...l, quantity: addQuantities(l.quantity, cantidad) } : l,
          ),
        };
      }

      const nueva: CartProductLine = {
        key,
        type: "product",
        productId: item.id,
        sku: item.sku,
        name: item.name,
        baseUnit: item.baseUnit,
        isComposite: item.isComposite,
        available: item.available,
        presentationId,
        presentations: item.presentations,
        quantity: cantidad,
      };
      return { lines: [...state.lines, nueva] };
    }),

  remove: (key) => set((state) => ({ lines: state.lines.filter((l) => l.key !== key) })),

  setQuantity: (key, quantity) =>
    set((state) => ({
      lines: state.lines.map((l) => (l.key === key ? { ...l, quantity } : l)),
    })),

  /**
   * Cambiar la presentación **cambia la identidad de la línea**, porque la
   * clave la incluye. Si ya hay un renglón de esa otra presentación, los dos se
   * FUNDEN: dejar dos renglones de "Caja ×12" en el mismo ticket sería un
   * error de captura que el cajero tendría que corregir a mano.
   */
  setPresentation: (key, presentationId) =>
    set((state) => {
      const linea = state.lines.find((l) => l.key === key);
      if (linea === undefined || linea.type !== "product") {
        return state;
      }
      if (!linea.presentations.some((p) => p.id === presentationId)) {
        return state;
      }

      const nuevaClave = claveDe({ type: "product", id: linea.productId, presentationId });
      if (nuevaClave === key) {
        return state;
      }

      const destino = state.lines.find((l) => l.key === nuevaClave);
      if (destino !== undefined) {
        return {
          lines: state.lines
            .filter((l) => l.key !== key)
            .map((l) =>
              l.key === nuevaClave
                ? { ...l, quantity: addQuantities(l.quantity, linea.quantity) }
                : l,
            ),
        };
      }

      return {
        lines: state.lines.map((l) =>
          l.key === key ? { ...l, key: nuevaClave, presentationId } : l,
        ),
      };
    }),

  setQuoteId: (quoteId) => set({ quoteId }),

  clear: () => set({ lines: [], quoteId: null }),
}));

// ─────────────────────────────────────────────────────────────────────────
// Derivados
// ─────────────────────────────────────────────────────────────────────────
//
// Funciones sueltas y no estado guardado: un total que se guarda es un total
// que se puede desincronizar de las líneas que lo produjeron. Se calcula.

/** El precio unitario que la línea PINTA. El que se cobra lo pone el API. */
export function precioDeLinea(line: CartLine): string | null {
  if (line.type === "service") {
    return line.price;
  }
  return line.presentations.find((p) => p.id === line.presentationId)?.price ?? null;
}

/** El importe de la línea, al centavo. */
export function totalDeLinea(line: CartLine): number {
  return multiplyMoney(precioDeLinea(line), line.quantity);
}

/** El subtotal del carrito: la suma de sus renglones. */
export function subtotalDelCarrito(lines: CartLine[]): number {
  // Se suman los importes YA redondeados al centavo, no los productos crudos:
  // es lo que hace que el total coincida con la suma de lo que el cliente ve
  // impreso renglón por renglón. Sumar primero y redondear después daría un
  // total que no cuadra con el papel por un centavo, y esa discusión en el
  // mostrador no la gana nadie.
  const centavos = lines.reduce((acc, l) => acc + Math.round(totalDeLinea(l) * 100), 0);
  return centavos / 100;
}

/**
 * ¿Esta línea pide más de lo que hay?
 *
 * Se compara en unidad BASE: dos cajas ×12 son 24 piezas. **No bloquea** —
 * marca. Quien decide es el API al cobrar, que tiene el saldo del instante y
 * no el de cuando se armó el carrito; una pantalla que bloquea con datos de
 * hace un minuto impide ventas que sí se podían hacer.
 */
export function excedeElStock(line: CartLine): boolean {
  if (line.type === "service") {
    // Un servicio no sale del anaquel: nunca falta.
    return false;
  }
  const factor = line.presentations.find((p) => p.id === line.presentationId)?.factor ?? "1";
  const pedidoBase = parseQuantity(line.quantity) * Number(factor);
  if (!Number.isFinite(pedidoBase)) {
    return false;
  }

  // Media diezmilésima de tolerancia: es la escala de la columna. Sin ella, un
  // `0.1 + 0.2` marcaría faltante en un carrito donde el saldo alcanza EXACTO,
  // y el cajero vería una alerta roja sobre una venta perfectamente posible.
  return pedidoBase - Number(line.available) > 0.00005;
}

/** El carrito → el cuerpo de `POST /pos/sales`. Acá y solo acá, texto → número. */
export function aLineasDeVenta(lines: CartLine[]): SaleLinePayload[] {
  return lines.map((l) =>
    l.type === "product"
      ? {
          productId: l.productId,
          presentationId: l.presentationId,
          quantity: parseQuantity(l.quantity),
        }
      : { serviceId: l.serviceId, quantity: parseQuantity(l.quantity) },
  );
}
