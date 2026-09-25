import type { Locator, Page } from "playwright";

/**
 * Como quién se toma una captura. Cada uno entra por la pantalla de acceso,
 * como cualquier persona, y lo que ve es lo que su cuenta le deja ver:
 *
 * - `visitor`: sin sesión.
 * - `owner`: Ana Pérez, la dueña de «Abarrotes La Esquina» (rol Administrador),
 *   con su turno de caja abierto hoy en la Sucursal Centro.
 * - `cashier`: Luis Ramírez, su cajero (rol Cajero), con SU turno abierto hoy
 *   en la misma sucursal: cada cajero cuadra su propio cajón.
 * - `newcomer`: Sofía Luna, de «Papelería Luna»: una cuenta NUEVA, con el
 *   correo verificado y el asistente de alta sin terminar. Ya guardó el paso 1
 *   (sin eso el asistente no deja ver los otros dos): entra al paso 3, y con
 *   `?step=1` o `?step=2` se ven los anteriores.
 */
export type Actor = "visitor" | "owner" | "cashier" | "newcomer";

/** Lo que una captura de PDF puede preguntarle al API, con la sesión de quien la toma. */
export interface ApiSession {
  /** Un GET al API; devuelve su JSON. */
  get<T>(path: string): Promise<T>;
}

/**
 * Cómo se describe una captura del manual: qué ruta abrir, como quién, qué
 * hacer antes de tomarla y qué parte recortar. Si una pantalla cambia, se
 * corre el manual otra vez y la captura se renueva sola; nadie pega imágenes
 * a mano.
 *
 * Una captura MIRA, no modifica: `prepare` puede abrir un menú, escribir en un
 * campo o elegir un filtro, pero nunca guardar, cobrar ni confirmar. Todas
 * comparten la misma tienda de ejemplo y el orden en que se toman no debe
 * importar.
 */
export interface Screen {
  /** Lo que cita el capítulo: `![…](screen:<id>)`. */
  id: string;
  /** El capítulo que la usa, relativo a `docs/manual/es/`. */
  chapter: string;
  as: Actor;
  /**
   * La ruta del web que se abre. En una captura de PDF (`pdf`), la pantalla
   * desde la que se imprime ese papel: dice de dónde sale, pero no se abre.
   */
  path: string;
  /**
   * El tamaño de la ventana, si no es la de escritorio (1280 × 800). Un
   * celular: `{ width: 390, height: 844 }`.
   */
  viewport?: { width: number; height: number };
  /**
   * `dark` pinta la app con el tema oscuro (Grafito). El tema es del NEGOCIO
   * y se guarda en el servidor: aquí solo se le hace creer a esta pestaña que
   * el negocio lo eligió, sin guardar nada. Las pantallas sin sesión siempre
   * salen claras, como en la app.
   */
  colorScheme?: "light" | "dark";
  /**
   * El idioma de la app en esta captura (sin él, español). Tampoco se guarda
   * nada: la pestaña cree que la cuenta está en ese idioma. Lo que traduce el
   * API (los mensajes de error, el ticket) sigue el idioma guardado de la
   * cuenta, que en la tienda de ejemplo es el español.
   */
  locale?: "es" | "en";
  /**
   * Lecturas (GET) del API que SOLO esta pestaña ve distintas, por ruta; nada
   * se escribe. Sirve para mostrar un estado REAL al que la tienda de ejemplo
   * no puede llegar sin romper otra captura. Por ejemplo, la caja de Luis
   * antes de abrir su turno, que para las demás capturas sigue abierto:
   * `{ "/pos/session": { session: null } }`. Nunca para inventar datos: se
   * responde lo que el API respondería en ese estado.
   */
  apiOverrides?: Record<string, unknown>;
  /** Lo que se hace antes de la captura: escribir, abrir un menú… */
  prepare?: (page: Page) => Promise<void>;
  /**
   * Qué recortar. Sin esto, la ventana entera. Con varios, el rectángulo que
   * los contiene a todos (un botón y el menú que abre, por ejemplo).
   */
  target?: (page: Page) => Locator[];
  /**
   * Una captura de un PDF del API (el ticket) en lugar de una pantalla: se
   * pide con la sesión de `as` y su primera página se convierte en imagen al
   * doble de densidad, como las demás capturas. Devuelve la ruta del API del
   * PDF, resuelta EN EL MOMENTO (el id de una venta nunca se escribe a mano):
   * ver `latestSaleTicket` y `latestQuoteTicket`. Con `pdf`, lo de la
   * pantalla (`viewport`, `prepare`, `target`…) no aplica.
   */
  pdf?: (api: ApiSession) => Promise<string>;
}

/** El ancho del papel térmico: 58 mm es el de mostrador, 80 mm el de mesa. */
type PaperWidth = "58mm" | "80mm";

/**
 * El ticket de la venta COBRADA más reciente de quien toma la captura (las
 * canceladas no cuentan), al ancho de papel que se pida.
 */
export const latestSaleTicket =
  (width: PaperWidth = "58mm") =>
  async (api: ApiSession): Promise<string> => {
    const me = await api.get<{ id: string }>("/me");
    const { rows } = await api.get<{ rows: { id: string }[] }>(
      `/pos/sales?sellerId=${me.id}&status=completed&page=1&pageSize=1`,
    );
    const sale = rows[0];
    if (!sale) throw new Error("Quien toma la captura no tiene ventas cobradas.");
    return `/pos/sales/${sale.id}/ticket?width=${width}`;
  };

/**
 * El papel de la cotización más reciente en ese estado: `open` es la vigente
 * (la que el cliente se lleva para volver), `loaded` la que ya se cobró.
 */
export const latestQuoteTicket =
  (status: "open" | "loaded" = "open", width: PaperWidth = "58mm") =>
  async (api: ApiSession): Promise<string> => {
    const { rows } = await api.get<{ rows: { id: string }[] }>(
      `/pos/quotes?status=${status}&page=1&pageSize=1`,
    );
    const quote = rows[0];
    if (!quote) throw new Error(`No hay cotizaciones en estado «${status}».`);
    return `/pos/quotes/${quote.id}/ticket?width=${width}`;
  };

/** Las pantallas de acceso: el idioma, el logotipo, la tarjeta y el enlace de abajo, sin el fondo vacío. */
export const authColumn = (page: Page) => [page.locator("main > div").first()];

export const card = (page: Page, title: string) =>
  page.locator("[data-slot='card']").filter({ has: page.getByText(title, { exact: true }) });
