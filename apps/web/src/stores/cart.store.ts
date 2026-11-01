import {
  addQuantities,
  multiplyMoney,
  parseQuantity,
  prorateDiscountCents,
  splitDocumentTax,
  type TaxMode,
} from "@sellpoint/shared";
import { useLayoutEffect } from "react";
import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import type { LookupItem, LookupItemTax, LookupPresentation } from "@/lib/pos/api";
import { useAuthStore } from "./auth.store";

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
  /** F4-TAX-16: el impuesto que traía el ítem al agregarse; null = sin impuesto. */
  tax?: LookupItemTax | null;
  /** El renglón de la cotización del que salió, si vino de una (F4-CONCEPT-10). */
  quoteLineId?: string;
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
  /** `null` con «Mostrar existencias» apagado (F4-POSVIS): sin dato no hay aviso. */
  available: string | null;
  presentationId: string;
  presentations: LookupPresentation[];
  quantity: string;
}

/** La línea de un servicio: sin presentación y sin stock. No sale del anaquel. */
export interface CartServiceLine {
  key: string;
  type: "service";
  tax?: LookupItemTax | null;
  serviceId: string;
  /** El renglón de la cotización del que salió, si vino de una (F4-CONCEPT-10). */
  quoteLineId?: string;
  code: string;
  name: string;
  price: string | null;
  quantity: string;
}

/**
 * La línea de un concepto (F4-CONCEPT-08): descripción + precio, sin catálogo
 * ni stock. Llega SOLO desde una cotización cargada, y se cobra por la línea
 * de esa cotización (`quoteLineId`): el precio que guarda es para pintar, el
 * que se cobra lo copia el servidor del papel.
 */
export interface CartConceptLine {
  key: string;
  type: "concept";
  tax?: LookupItemTax | null;
  quoteLineId: string;
  description: string;
  unitPrice: string;
  quantity: string;
}

export type CartLine = CartProductLine | CartServiceLine | CartConceptLine;

/** Lo que se manda a `POST /pos/sales`: ids y cantidades. */
export interface SaleLinePayload {
  productId?: string;
  serviceId?: string;
  presentationId?: string;
  /**
   * En un concepto es su identidad; en un producto o servicio, el rastro del
   * renglón de la cotización del que salió (F4-CONCEPT-10).
   */
  quoteLineId?: string;
  quantity: number;
}

interface CartState {
  lines: CartLine[];
  /**
   * La cotización de la que salió este carrito (F4-QUOTE-04). Viaja al cobro
   * para que la venta quede vinculada y la cotización pase a `loaded`.
   */
  quoteId: string | null;
  /**
   * El SKU del renglón que el servidor rechazó (F4-UI-02).
   *
   * Vive en el STORE y no en el panel de cobro porque quien lo pinta es la
   * línea, que está en otro árbol de componentes. Pasarlo por props obligaría
   * a atravesar toda la pantalla con un dato que solo dos puntas usan.
   */
  errorSku: string | null;
  /**
   * La última línea que entró o subió por `add` —un escaneo, la búsqueda, una
   * cotización—, con un contador: escanear dos veces el mismo producto son dos
   * avisos. El panel le pasa ahí la selección (Carlos, 2026-11-01).
   */
  lastAdded: { key: string; seq: number } | null;
  /** El sello de dueño del carrito guardado: `tenantId:userId`. */
  owner: string | null;
  /** El turno en que se armó; `null` si se armó sin turno (una cotización). */
  sessionId: string | null;
  /**
   * Reclama el carrito guardado para quien está en la pantalla. Lo de otra
   * cuenta se descarta; en la venta (con `sessionId`), también lo de otro
   * turno. Uno armado sin turno se adopta.
   */
  claim: (owner: string, sessionId?: string) => void;
  add: (item: LookupItem, options?: { presentationId?: string; quantity?: string }) => void;
  remove: (key: string) => void;
  setQuantity: (key: string, quantity: string) => void;
  setPresentation: (key: string, presentationId: string) => void;
  setQuoteId: (quoteId: string | null) => void;
  setErrorSku: (sku: string | null) => void;
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
function claveDe(
  line: Pick<CartLine, "type"> & { id: string; presentationId?: string; quoteLineId?: string },
): string {
  // Lo cargado de una cotización NO se funde con lo escaneado del mismo
  // producto: son dos renglones con procedencia distinta, y fundirlos haría
  // que la venta atribuyera al módulo una cantidad que no autorizó.
  const origen = line.quoteLineId === undefined ? "" : `:${line.quoteLineId}`;
  if (line.type === "product") {
    return `product:${line.id}:${line.presentationId}${origen}`;
  }
  // El concepto se identifica por la línea de su cotización: dos cotizaciones
  // con «Flete» son dos renglones, porque son dos precios autorizados.
  return line.type === "concept" ? `concept:${line.id}` : `service:${line.id}${origen}`;
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
  // `isDefaultSale` es la que el Admin marcó como "así se vende esto".
  // El respaldo es la de menor factor, que el API ya devuelve primera.
  return (presentations.find((p) => p.isDefaultSale) ?? presentations[0])?.id;
}

/** El estado tras un `add`: las líneas nuevas y cuál fue la última. */
function trasAgregar(state: CartState, key: string, lines: CartLine[]): Partial<CartState> {
  return { lines, lastAdded: { key, seq: (state.lastAdded?.seq ?? 0) + 1 } };
}

/**
 * Carlos (2026-11-01): con un ticket de muchos productos, recargar la página
 * borraba el carrito. Se guarda en el navegador con el MISMO patrón que el
 * borrador de la carga rápida (`quick-catalog.store.ts`): `persist`, solo los
 * datos, un cambio de forma descarta y el sello de dueño (`claim`).
 *
 * ── Dos sellos: la cuenta y el turno ────────────────────────────────────
 *
 * La cuenta, para que quien entra después en la misma computadora no vea el
 * carrito ajeno. El turno, porque el carrito es de ESE turno: el de uno ya
 * cerrado no reaparece en el siguiente. La cotización usa el mismo carrito y
 * se arma sin turno: por eso reclama solo con la cuenta, y la venta adopta lo
 * que se armó ahí.
 *
 * ── Si el navegador no deja guardar ─────────────────────────────────────
 *
 * Modo privado o cuota llena: el carrito sigue en memoria, como antes de
 * guardarse. Perderlo en una recarga es lo de siempre, no un error nuevo.
 */
const VERSION = 1;
const SIN_CARRITO = { lines: [], quoteId: null, errorSku: null, lastAdded: null } as const;
const almacen = createJSONStorage<CartState>(() => localStorage);

export const useCartStore = create<CartState>()(
  persist(
    (set) => ({
      lines: [],
      quoteId: null,
      errorSku: null,
      lastAdded: null,
      owner: null,
      sessionId: null,

      claim: (owner, sessionId) =>
        set((state) => {
          const ajeno = state.owner !== owner;
          const deOtroTurno =
            sessionId !== undefined && state.sessionId !== null && state.sessionId !== sessionId;
          if (ajeno || deOtroTurno) {
            return { ...SIN_CARRITO, lines: [], owner, sessionId: sessionId ?? null };
          }
          // Un carrito VACÍO reclamado sin turno (la cotización) nace sin
          // turno: si conservara el del turno ya cerrado, la venta del turno
          // siguiente lo tomaría por viejo y lo descartaría.
          if (sessionId === undefined && state.lines.length === 0) {
            return { sessionId: null };
          }
          return { sessionId: sessionId ?? state.sessionId };
        }),

      add: (item, options) =>
        set((state) => {
          const cantidad = options?.quantity ?? "1";

          if (item.type === "quote") {
            // Una cotización no es una línea: se vuelca con `F4-QUOTE-04`, que
            // agrega SUS líneas una por una. Ignorarla acá es más honesto que
            // inventar un renglón que el ticket no sabría imprimir.
            return state;
          }

          if (item.type === "concept") {
            const key = claveDe({ type: "concept", id: item.id });
            const existente = state.lines.find((l) => l.key === key);
            if (existente !== undefined) {
              return trasAgregar(
                state,
                key,
                state.lines.map((l) =>
                  l.key === key ? { ...l, quantity: addQuantities(l.quantity, cantidad) } : l,
                ),
              );
            }
            const nueva: CartConceptLine = {
              key,
              type: "concept",
              tax: item.tax ?? null,
              quoteLineId: item.id,
              description: item.description,
              unitPrice: item.unitPrice,
              quantity: cantidad,
            };
            return trasAgregar(state, key, [...state.lines, nueva]);
          }

          if (item.type === "service") {
            const key = claveDe({ type: "service", id: item.id, quoteLineId: item.quoteLineId });
            const existente = state.lines.find((l) => l.key === key);
            if (existente !== undefined) {
              return trasAgregar(
                state,
                key,
                state.lines.map((l) =>
                  l.key === key ? { ...l, quantity: addQuantities(l.quantity, cantidad) } : l,
                ),
              );
            }
            const nueva: CartServiceLine = {
              key,
              type: "service",
              tax: item.tax ?? null,
              serviceId: item.id,
              ...(item.quoteLineId !== undefined && { quoteLineId: item.quoteLineId }),
              code: item.code,
              name: item.name,
              price: item.price,
              quantity: cantidad,
            };
            return trasAgregar(state, key, [...state.lines, nueva]);
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

          const key = claveDe({
            type: "product",
            id: item.id,
            presentationId,
            quoteLineId: item.quoteLineId,
          });
          const existente = state.lines.find((l) => l.key === key);
          if (existente !== undefined) {
            return trasAgregar(
              state,
              key,
              state.lines.map((l) =>
                l.key === key ? { ...l, quantity: addQuantities(l.quantity, cantidad) } : l,
              ),
            );
          }

          const nueva: CartProductLine = {
            key,
            type: "product",
            tax: item.tax ?? null,
            ...(item.quoteLineId !== undefined && { quoteLineId: item.quoteLineId }),
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
          return trasAgregar(state, key, [...state.lines, nueva]);
        }),

      remove: (key) =>
        set((state) => ({ lines: state.lines.filter((l) => l.key !== key), errorSku: null })),

      setQuantity: (key, quantity) =>
        set((state) => ({
          lines: state.lines.map((l) => (l.key === key ? { ...l, quantity } : l)),
          // Corregir la cantidad borra la marca del rechazo: el mensaje hablaba del
          // estado anterior y dejarlo puesto haría creer que la corrección tampoco
          // sirvió.
          errorSku: null,
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

      setErrorSku: (errorSku) => set({ errorSku }),

      clear: () => set({ ...SIN_CARRITO, lines: [] }),
    }),
    {
      name: "sellpoint.cart",
      version: VERSION,
      storage: {
        getItem: (name) => {
          try {
            return almacen?.getItem(name) ?? null;
          } catch {
            // Modo privado o almacenamiento bloqueado: se arranca en blanco.
            return null;
          }
        },
        setItem: (name, value) => {
          try {
            almacen?.setItem(name, value);
          } catch {
            // Sin espacio o sin permiso: el carrito sigue en memoria.
          }
        },
        removeItem: (name) => {
          try {
            almacen?.removeItem(name);
          } catch {
            // No poder borrar no rompe nada: el sello de dueño ya lo descarta.
          }
        },
      },
      // Solo el carrito y su sello: `errorSku` y `lastAdded` describen ESTA
      // pantalla, y de la sesión no se guarda nada.
      partialize: (state) =>
        ({
          lines: state.lines,
          quoteId: state.quoteId,
          owner: state.owner,
          sessionId: state.sessionId,
        }) as unknown as CartState,
      migrate: () =>
        ({ lines: [], quoteId: null, owner: null, sessionId: null }) as unknown as CartState,
    },
  ),
);

/**
 * El carrito muere con la sesión (Carlos, 2026-10-31): cerró sesión con un
 * negocio, entró con otro en la misma pestaña y la caja le mostró el producto
 * del primero. El carrito vive en memoria, así que sobrevivía al logout.
 *
 * Misma regla que la caché de React Query (`watchSessionIdentity` en
 * `lib/query-client.ts`): se vacía al DEJAR una identidad —logout, sesión
 * muerta o entrar con otra cuenta encima—, no al estrenarla ni al renovar el
 * token o cambiar el idioma, que son la misma sesión. Vive aquí y no en cada
 * botón de salir: hay varios caminos que cierran la sesión y ninguno tiene
 * que acordarse.
 */
let identidadDelCarrito = useAuthStore.getState().user?.id ?? null;
useAuthStore.subscribe((state) => {
  const actual = state.user?.id ?? null;
  if (actual === identidadDelCarrito) {
    return;
  }
  const dejaUnaIdentidad = identidadDelCarrito !== null;
  identidadDelCarrito = actual;
  if (dejaUnaIdentidad) {
    useCartStore.getState().clear();
  }
});

/**
 * Reclama el carrito guardado al entrar a una pantalla que lo usa: la venta
 * con su turno, la cotización sin él. `useLayoutEffect` y no `useEffect`: el
 * carrito de otra cuenta no llega a pintarse ni un instante.
 */
export function useClaimCart(sessionId?: string): void {
  const owner = useAuthStore((s) => (s.user ? `${s.user.tenant.id}:${s.user.id}` : null));
  useLayoutEffect(() => {
    if (owner !== null) {
      useCartStore.getState().claim(owner, sessionId);
    }
  }, [owner, sessionId]);
}

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
  if (line.type === "concept") {
    return line.unitPrice;
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
  if (line.type === "service" || line.type === "concept") {
    // Ni el servicio ni el concepto salen del anaquel: nunca faltan.
    return false;
  }
  if (line.available === null) {
    // F4-POSVIS: el API no mandó la existencia. Decir «hay menos de N» ya
    // sería enseñarla por la puerta de atrás.
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
  return lines.map((l) => {
    if (l.type === "product") {
      return {
        productId: l.productId,
        presentationId: l.presentationId,
        ...(l.quoteLineId !== undefined && { quoteLineId: l.quoteLineId }),
        quantity: parseQuantity(l.quantity),
      };
    }
    if (l.type === "concept") {
      // Solo el id de la línea cotizada: el precio y el texto los copia el
      // servidor de la cotización, nunca de acá.
      return { quoteLineId: l.quoteLineId, quantity: parseQuantity(l.quantity) };
    }
    return {
      serviceId: l.serviceId,
      ...(l.quoteLineId !== undefined && { quoteLineId: l.quoteLineId }),
      quantity: parseQuantity(l.quantity),
    };
  });
}

/** El desglose del impuesto del carrito, por componente. */
export interface ImpuestosDelCarrito {
  /** Σ impuesto de todas las líneas, en pesos. */
  total: number;
  /** El neto tras el impuesto (la base): `total del carrito − impuesto`. */
  base: number;
  byComponent: { code: string; name: string; rate: string; amount: number }[];
}

/**
 * F4-TAX-16 — el impuesto del carrito, con la MISMA función que usa el
 * servidor (`splitDocumentTax`, shared): por tasa sobre la suma, en
 * centavos, con el mismo redondeo. Si el carrito dividiera por su cuenta, el
 * cajero vería un total y el papel imprimiría otro.
 */
/**
 * F4-DISC — el descuento del ticket repartido entre las líneas, en centavos,
 * con la MISMA función que usa el servidor (`prorateDiscountCents`): lo que
 * el cajero ve como total es lo que el papel imprime.
 */
export function descuentoPorLinea(lines: CartLine[], discountCents: number): number[] {
  return prorateDiscountCents(
    discountCents,
    lines.map((l) => Math.round(totalDeLinea(l) * 100)),
  );
}

export function impuestosDelCarrito(
  lines: CartLine[],
  mode: TaxMode,
  discountCents = 0,
): ImpuestosDelCarrito {
  const partes = descuentoPorLinea(lines, discountCents);
  const reparto = splitDocumentTax({
    mode,
    lines: lines.map((line, i) => ({
      amountCents: Math.round(totalDeLinea(line) * 100) - (partes[i] ?? 0),
      components: line.tax?.components ?? [],
    })),
  });
  return {
    total: reparto.taxCents / 100,
    base: reparto.netCents / 100,
    byComponent: reparto.byComponent.map((c) => ({
      code: c.code,
      name: c.name,
      rate: c.rate,
      amount: c.taxCents / 100,
    })),
  };
}

/**
 * Lo que se COBRA: en `included` es el subtotal tal cual (el impuesto va
 * adentro); en `excluded` es el subtotal más el impuesto.
 */
export function totalDelCarrito(lines: CartLine[], mode: TaxMode, discountCents = 0): number {
  const subtotalCents = Math.round(subtotalDelCarrito(lines) * 100);
  // El descuento nunca deja el ticket en negativo: quien llama lo valida
  // contra el subtotal; acá solo se recorta por seguridad.
  const descontado = subtotalCents - Math.min(discountCents, subtotalCents);
  if (mode !== "excluded") return descontado / 100;
  const impuesto = Math.round(impuestosDelCarrito(lines, mode, discountCents).total * 100);
  return (descontado + impuesto) / 100;
}
