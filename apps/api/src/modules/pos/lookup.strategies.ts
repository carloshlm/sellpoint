import { POS_FOLIO_PREFIXES } from "@sellpoint/shared";
import type { Prisma } from "../../generated/prisma/client";
import { sellableStock } from "./warehouse-availability";

/**
 * F4-CART-01 — el buscador del mostrador.
 *
 * ── Una sola caja de texto, varias maneras de buscar ────────────────────
 *
 * El cajero tiene UN input y lo usa para todo: escanea una caja, teclea un
 * SKU, escribe media palabra del nombre, pide un servicio, o tipea el folio
 * de una cotización que el cliente trae impresa. Todos esos son la misma
 * acción para quien está atrás del mostrador — "encontrame esto" — y por eso
 * no puede haber cinco campos.
 *
 * Lo que sí hay son cinco **strategies**, y el texto decide cuál corre. El
 * patrón importa por lo que permite después: `PrescriptionLookup` de F9 —"traé
 * lo que dice esta receta"— es una entrada más en la lista de abajo, sin tocar
 * el controller ni el input.
 *
 * ── Exactas y difusas: por qué hay dos clases ───────────────────────────
 *
 * Un código de barras identifica UNA presentación; un SKU, UN producto; un
 * folio, UNA cotización. Ante un acierto así no hay nada que elegir y la
 * búsqueda **corta** (`exclusive`) — el POS puede mandar eso derecho al
 * carrito, que es lo que hace que escanear se sienta instantáneo.
 *
 * Escribir "coca" es otra cosa: es una lista para que una persona elija. Ahí
 * las strategies difusas corren TODAS y sus resultados se suman, porque
 * "masaje" tiene que encontrar el servicio aunque también haya un producto que
 * se llame parecido.
 *
 * ── Todo pasa por el almacén del TURNO ──────────────────────────────────
 *
 * No es un filtro más: es la razón por la que el turno existe. Ofrecer algo
 * que no está en la bodega desde la que se está vendiendo termina en un cobro
 * que falla, y el cajero descubriéndolo con el cliente enfrente.
 */

export const LOOKUP_KINDS = ["barcode", "sku", "text", "service", "quote"] as const;
export type LookupKind = (typeof LOOKUP_KINDS)[number];

/** Una presentación vendible, con su precio y su código. */
export interface LookupPresentation {
  id: string;
  name: string;
  factor: string;
  price: string | null;
  barcode: string | null;
  isDefaultSale: boolean;
  allowFractionalInput: boolean;
}

export interface LookupProductItem {
  type: "product";
  matchedBy: LookupKind;
  id: string;
  sku: string;
  name: string;
  baseUnit: string;
  isComposite: boolean;
  /** Vendible HOY en el almacén del turno, en unidad base. */
  available: string;
  /** Lo que hay pero está vencido. Ver `SellableStock.expired`. */
  expired: string;
  presentations: LookupPresentation[];
  /**
   * Cuando el acierto fue por código de barras, CUÁL presentación lo llevaba.
   * El carrito la preselecciona: escanear la caja de 12 no puede preseleccionar
   * la pieza suelta.
   */
  matchedPresentationId: string | null;
}

export interface LookupServiceItem {
  type: "service";
  matchedBy: LookupKind;
  id: string;
  code: string;
  name: string;
  price: string | null;
}

export interface LookupQuoteItem {
  type: "quote";
  matchedBy: LookupKind;
  id: string;
  folio: string;
  status: string;
  total: string;
  lineCount: number;
}

export type LookupItem = LookupProductItem | LookupServiceItem | LookupQuoteItem;

export interface LookupContext {
  tx: Prisma.TransactionClient;
  tenantId: string;
  /** El del TURNO. No el asignado del usuario, no "todos". */
  warehouseId: string;
  q: string;
  limit: number;
}

export interface LookupStrategy {
  readonly kind: LookupKind;
  /** ¿Este texto es para mí? Pura: sin base, sin red — por eso se testea sola. */
  readonly matches: (q: string) => boolean;
  /** ¿Un acierto mío cierra la búsqueda? */
  readonly exclusive: boolean;
  readonly run: (ctx: LookupContext) => Promise<LookupItem[]>;
}

// ─────────────────────────────────────────────────────────────────────────
// El reconocimiento del texto — puro
// ─────────────────────────────────────────────────────────────────────────

/**
 * `COT-000001`. El prefijo sale de `@sellpoint/shared` y no se escribe acá:
 * el día que la serie cambie de nombre, este reconocedor cambia con ella.
 */
const PATRON_FOLIO_COTIZACION = new RegExp(`^${POS_FOLIO_PREFIXES.quote}-\\d+$`, "i");

export function pareceFolioDeCotizacion(q: string): boolean {
  return PATRON_FOLIO_COTIZACION.test(q.trim());
}

/**
 * Un código de barras es **todo dígitos** y de 6 a 14 — EAN-8, UPC-A, EAN-13.
 *
 * El largo mínimo no es capricho: sin él, teclear "12" dispararía una búsqueda
 * exacta de código de barras en cada pulsación. Y el filtro de "solo dígitos"
 * es lo que deja pasar los SKU alfanuméricos a su propia strategy en vez de
 * gastarlos acá.
 *
 * Un catálogo con códigos alfanuméricos no queda afuera: cae en
 * `TextSearchLookup`, que también mira `barcode`. Lo que se pierde es el atajo
 * exacto, no el resultado.
 */
const PATRON_CODIGO_BARRAS = /^\d{6,14}$/;

export function pareceCodigoDeBarras(q: string): boolean {
  return PATRON_CODIGO_BARRAS.test(q.trim());
}

/**
 * Un SKU candidato: sin espacios y con algo de cuerpo.
 *
 * Con espacios ya es una frase, y buscar la frase exacta como SKU no encuentra
 * nada — que es peor que no intentarlo, porque `SkuLookup` es EXCLUSIVA y un
 * acierto suyo corta la búsqueda difusa que sí habría servido.
 */
export function pareceSku(q: string): boolean {
  const limpio = q.trim();
  return limpio.length >= 2 && !/\s/.test(limpio);
}

// ─────────────────────────────────────────────────────────────────────────
// Las consultas
// ─────────────────────────────────────────────────────────────────────────

/** Lo que se pide de una presentación vendible, siempre igual. */
const SELECT_PRESENTACION = {
  id: true,
  name: true,
  factor: true,
  price: true,
  barcode: true,
  isDefaultSale: true,
  allowFractionalInput: true,
} as const;

const SELECT_PRODUCTO = {
  id: true,
  sku: true,
  name: true,
  baseUnit: true,
  isComposite: true,
  presentations: {
    where: { isActive: true, isSellable: true },
    select: SELECT_PRESENTACION,
    orderBy: { factor: "asc" },
  },
} as const;

type ProductoCrudo = {
  id: string;
  sku: string;
  name: string;
  baseUnit: string;
  isComposite: boolean;
  presentations: {
    id: string;
    name: string;
    factor: Prisma.Decimal;
    price: Prisma.Decimal | null;
    barcode: string | null;
    isDefaultSale: boolean;
    allowFractionalInput: boolean;
  }[];
};

/**
 * Los productos crudos → items con su disponibilidad REAL en el almacén del
 * turno, y **sin lo que no se puede vender ahí**.
 *
 * El filtro va acá y no en el `where` de cada strategy porque la disponibilidad
 * no es una columna: un compuesto la deduce de sus componentes y un producto
 * con lotes descuenta lo vencido. Ninguna de las dos cosas se expresa en SQL
 * sobre `stock_by_warehouse` (ver `sellableStock`).
 *
 * Un producto SIN presentación vendible tampoco sale: no habría con qué
 * cobrarlo, y el 422 `pos.presentation_not_sellable` llegaría recién en la caja.
 */
async function conDisponibilidad(
  ctx: LookupContext,
  productos: ProductoCrudo[],
  matchedBy: LookupKind,
  presentacionPorProducto: Map<string, string> = new Map(),
): Promise<LookupProductItem[]> {
  const vendibles = productos.filter((p) => p.presentations.length > 0);
  if (vendibles.length === 0) {
    return [];
  }

  const stock = await sellableStock(
    ctx.tx,
    ctx.tenantId,
    ctx.warehouseId,
    vendibles.map((p) => p.id),
  );

  return vendibles
    .map((p) => {
      const disponible = stock.get(p.id);
      return {
        type: "product" as const,
        matchedBy,
        id: p.id,
        sku: p.sku,
        name: p.name,
        baseUnit: p.baseUnit,
        isComposite: p.isComposite,
        available: (disponible?.available ?? 0).toString(),
        expired: (disponible?.expired ?? 0).toString(),
        presentations: p.presentations.map((pr) => ({
          id: pr.id,
          name: pr.name,
          factor: pr.factor.toString(),
          price: pr.price?.toString() ?? null,
          barcode: pr.barcode,
          isDefaultSale: pr.isDefaultSale,
          allowFractionalInput: pr.allowFractionalInput,
        })),
        matchedPresentationId: presentacionPorProducto.get(p.id) ?? null,
      };
    })
    .filter((item) => Number(item.available) > 0);
}

/**
 * `BarcodeLookup` — lo que llega del escáner.
 *
 * Busca en `product_presentations.barcode`, que es donde vive el código en
 * este esquema: **el código identifica la PRESENTACIÓN, no el producto**. La
 * caja de 12 y la pieza suelta son dos códigos distintos del mismo producto, y
 * por eso el acierto viaja con `matchedPresentationId` — escanear la caja tiene
 * que preseleccionar la caja.
 *
 * El tablero hablaba de un `products.barcode` "legacy" como segundo intento.
 * **Esa columna nunca existió** en el esquema (verificado 2026-08-22): el
 * código de barras nació en la presentación con F2-PRESENT y ahí se quedó. No
 * se implementa un respaldo contra una columna fantasma.
 */
const barcodeLookup: LookupStrategy = {
  kind: "barcode",
  matches: pareceCodigoDeBarras,
  exclusive: true,
  run: async (ctx) => {
    const presentaciones = await ctx.tx.productPresentation.findMany({
      where: {
        tenantId: ctx.tenantId,
        barcode: ctx.q.trim(),
        isActive: true,
        isSellable: true,
        product: { isActive: true },
      },
      select: { id: true, productId: true, product: { select: SELECT_PRODUCTO } },
      take: ctx.limit,
    });
    if (presentaciones.length === 0) {
      return [];
    }

    const porProducto = new Map(presentaciones.map((p) => [p.productId, p.id]));
    return conDisponibilidad(
      ctx,
      presentaciones.map((p) => p.product),
      "barcode",
      porProducto,
    );
  },
};

/** `SkuLookup` — el código que el negocio le puso al producto. Exacto. */
const skuLookup: LookupStrategy = {
  kind: "sku",
  matches: pareceSku,
  exclusive: true,
  run: async (ctx) => {
    const productos = await ctx.tx.product.findMany({
      where: {
        tenantId: ctx.tenantId,
        isActive: true,
        // `equals` con `insensitive`: el cajero no teclea mayúsculas.
        sku: { equals: ctx.q.trim(), mode: "insensitive" },
      },
      select: SELECT_PRODUCTO,
      take: ctx.limit,
    });
    return conDisponibilidad(ctx, productos, "sku");
  },
};

/**
 * `TextSearchLookup` — media palabra del nombre.
 *
 * `contains` genera ILIKE, que el índice trigram de F2-DB-04 sabe usar. Mira
 * también el código de barras porque un catálogo con códigos alfanuméricos no
 * dispara `BarcodeLookup` y tiene que encontrarse igual.
 */
const textSearchLookup: LookupStrategy = {
  kind: "text",
  matches: (q) => q.trim().length >= 2,
  exclusive: false,
  run: async (ctx) => {
    const aguja = ctx.q.trim();
    const productos = await ctx.tx.product.findMany({
      where: {
        tenantId: ctx.tenantId,
        isActive: true,
        OR: [
          { sku: { contains: aguja, mode: "insensitive" } },
          { name: { contains: aguja, mode: "insensitive" } },
          { presentations: { some: { barcode: { contains: aguja, mode: "insensitive" } } } },
        ],
      },
      select: SELECT_PRODUCTO,
      orderBy: { name: "asc" },
      take: ctx.limit,
    });
    return conDisponibilidad(ctx, productos, "text");
  },
};

/**
 * `ServiceLookup` — lo que se cobra sin sacar nada del anaquel.
 *
 * El filtro por almacén es **explícito y al revés que el de usuarios**: sin
 * filas en `service_warehouses`, el servicio no se ofrece en ningún lado
 * (decisión de Carlos, 2026-08-19). Consecuencia directa: un almacén recién
 * creado nace SIN servicios, y un turno abierto ahí no ofrece ninguno. Eso no
 * es un error ni una lista rota — es la respuesta correcta, y el POS la muestra
 * vacía sin quejarse.
 */
const serviceLookup: LookupStrategy = {
  kind: "service",
  matches: (q) => q.trim().length >= 2,
  exclusive: false,
  run: async (ctx) => {
    const aguja = ctx.q.trim();
    const servicios = await ctx.tx.service.findMany({
      where: {
        tenantId: ctx.tenantId,
        isActive: true,
        warehouses: { some: { warehouseId: ctx.warehouseId } },
        OR: [
          { code: { contains: aguja, mode: "insensitive" } },
          { name: { contains: aguja, mode: "insensitive" } },
        ],
      },
      select: { id: true, code: true, name: true, price: true },
      orderBy: { name: "asc" },
      take: ctx.limit,
    });

    return servicios.map((s) => ({
      type: "service" as const,
      matchedBy: "service" as const,
      id: s.id,
      code: s.code,
      name: s.name,
      price: s.price?.toString() ?? null,
    }));
  },
};

/**
 * `QuoteLookup` — el folio que el cliente trae impreso.
 *
 * Devuelve la CABECERA y nada más. Las líneas con sus precios recalculados
 * salen de `GET /pos/quotes/folio/:folio/for-sale` (F4-QUOTE-02), y tiene que
 * ser así: la cotización no congela precios, de modo que devolver acá las
 * líneas guardadas sería mostrar números viejos como si fueran los de hoy.
 *
 * **Sin filtro de almacén, a propósito.** Una cotización se hace en un almacén
 * y se puede cobrar en otro — el cliente cotiza en la sucursal y pasa por la
 * central. Lo que sí se resuelve contra el almacén del turno es la
 * DISPONIBILIDAD de sus líneas, y eso pasa al cargarla.
 */
const quoteLookup: LookupStrategy = {
  kind: "quote",
  matches: pareceFolioDeCotizacion,
  exclusive: true,
  run: async (ctx) => {
    const cotizacion = await ctx.tx.quote.findFirst({
      where: { tenantId: ctx.tenantId, folio: ctx.q.trim().toUpperCase() },
      select: {
        id: true,
        folio: true,
        status: true,
        total: true,
        _count: { select: { lines: true } },
      },
    });
    if (cotizacion === null) {
      return [];
    }

    return [
      {
        type: "quote" as const,
        matchedBy: "quote" as const,
        id: cotizacion.id,
        folio: cotizacion.folio,
        // Una `loaded` o `canceled` se DEVUELVE marcada, no se esconde: quien
        // busca un folio ya usado necesita enterarse de eso, no recibir un
        // "no existe" que lo mande a recapturar todo.
        status: cotizacion.status,
        total: cotizacion.total.toString(),
        lineCount: cotizacion._count.lines,
      },
    ];
  },
};

/**
 * La cadena, EN ORDEN.
 *
 * Las exclusivas primero y de la más específica a la más general: un texto que
 * es folio de cotización no es un SKU, y uno que es todo dígitos es un código
 * de barras antes que un SKU. Al final las difusas, que corren juntas.
 */
export const LOOKUP_STRATEGIES: readonly LookupStrategy[] = [
  quoteLookup,
  barcodeLookup,
  skuLookup,
  textSearchLookup,
  serviceLookup,
];
