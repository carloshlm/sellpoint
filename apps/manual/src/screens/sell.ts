import type { Page } from "playwright";
import { DEMO } from "../demo.js";
import { latestQuoteTicket, latestSaleTicket, type Screen } from "./kit.js";

const SHIFT = "02-sell/05-cash-shift.md";
const SALE = "02-sell/06-make-a-sale.md";
const TICKET = "02-sell/07-ticket.md";
const HISTORY = "02-sell/08-sales-history.md";
const QUOTES = "02-sell/09-quotes.md";
const DRAWER = "02-sell/10-drawer-expenses.md";
const PANEL = "02-sell/11-seller-dashboard.md";

/**
 * La caja de Luis ANTES de abrir su turno. Para las demás capturas su turno
 * sigue abierto; esta pestaña solo lee que no hay ninguno, que es lo que el
 * API responde a quien todavía no abre.
 */
const NO_SHIFT = { "/pos/session": { session: null } };

/** El código de barras del agua: seed.ts lo calcula con `ean13("750105530001")`. */
const WATER_BARCODE = "7501055300013";

/** Una ventana angosta: el menú y el panel caben juntos sin encoger el texto. */
const NARROW = { width: 1000, height: 700 };

/** Quita el foco del campo que se acaba de llenar: el anillo azul distrae en el papel. */
const blur = (page: Page) =>
  page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());

/**
 * Cada renglón del carrito que cambia DESTELLA (800 ms, y 700 más en lo que
 * se desvanece): se espera a que se apague, o saldría pintado de azul. El
 * ratón se retira: se queda donde hizo el último clic y resalta lo que quede
 * debajo, como un resultado de la búsqueda.
 */
const calm = async (page: Page) => {
  await page.mouse.move(0, 0);
  await page.waitForFunction(() => document.querySelector("[data-flash]") === null);
  await page.waitForTimeout(800);
};

/** El único campo del carrito: el lector, el código, el nombre o el folio de una cotización. */
const cartSearch = (page: Page) => page.getByLabel("Buscar", { exact: true });
const cartPanel = (page: Page) => page.getByTestId("cart-panel");
/** El renglón del carrito de un producto o servicio, por su nombre. */
const cartLine = (page: Page, name: string) =>
  cartPanel(page).locator("li").filter({ hasText: name });

/** Escanea un código: si es de un solo producto, entra solo al carrito. */
async function scan(page: Page, code: string, name: string): Promise<void> {
  await cartSearch(page).fill(code);
  await cartLine(page, name).waitFor();
}

/** Busca por nombre y agrega el resultado que se elige de la lista. */
async function addFromSearch(page: Page, query: string, name: string): Promise<void> {
  await cartSearch(page).fill(query);
  await page.getByTestId("cart-search").getByRole("button", { name }).click();
  await cartLine(page, name).waitFor();
}

/** Abre el teclado de la pantalla sobre un renglón y le escribe la cantidad. */
async function setQuantity(page: Page, name: string, quantity: string): Promise<void> {
  await cartLine(page, name).getByRole("button", { name }).click();
  await page.getByLabel("Cantidad", { exact: true }).fill(quantity);
}

/**
 * El carrito de la venta VTA-000482, la del ticket del capítulo 7: una caja
 * de 12 aguas, una porción de queso y dos leches.
 */
async function ticketCart(page: Page): Promise<void> {
  await scan(page, WATER_BARCODE, "Agua natural 1 L");
  await cartLine(page, "Agua natural 1 L")
    .getByLabel("Presentación")
    .selectOption({ label: "Caja con 12" });
  await addFromSearch(page, "queso", "Queso mozzarella");
  await cartLine(page, "Queso mozzarella")
    .getByLabel("Presentación")
    .selectOption({ label: "Porción 250 g" });
  await addFromSearch(page, "leche", "Leche entera 1 L");
  await setQuantity(page, "Leche entera 1 L", "2");
  await page.getByRole("button", { name: "Ocultar teclado" }).click();
}

/** El título de una pantalla, por su texto exacto. */
const title = (page: Page, name: string) => page.getByRole("heading", { name, exact: true });

/** Parte 2 — Vender. */
export const SELL: Screen[] = [
  // ── Capítulo 5 — Tu turno de caja: abrir, cerrar y arqueo ──────────────
  {
    id: "open-shift",
    chapter: SHIFT,
    as: "cashier",
    path: "/pos",
    apiOverrides: NO_SHIFT,
    // Los $500 de cambio con que Luis abre cada día. «Abrir turno» NO se presiona.
    prepare: async (page) => {
      await page.getByLabel("Fondo inicial (opcional)").fill("500");
      await blur(page);
    },
    target: (page) => [page.getByTestId("open-session")],
  },
  {
    id: "close-shift",
    chapter: SHIFT,
    as: "cashier",
    path: "/pos/close",
    // Lo que Luis contó: $20 menos de lo esperado, con su nota. NO se cierra.
    // Esperaba $840.50: $500.00 de fondo + $430.50 en efectivo − $90.00 del
    // gasto del cajón (seed.ts).
    prepare: async (page) => {
      await page.getByLabel("Efectivo contado en caja").fill("820.50");
      await page.getByLabel("Nota (opcional)").fill("Faltaron $20 del cambio.");
      await blur(page);
    },
    target: (page) => [page.getByTestId("close-session")],
  },

  // ── Capítulo 6 — Hacer una venta ───────────────────────────────────────
  {
    id: "sale-screen",
    chapter: SALE,
    as: "cashier",
    path: "/pos",
    // Una caja de 12 aguas (escaneada), una porción de queso y la recarga de
    // garrafón, y a la izquierda lo que aparece al teclear «ga».
    prepare: async (page) => {
      await scan(page, WATER_BARCODE, "Agua natural 1 L");
      await cartLine(page, "Agua natural 1 L")
        .getByLabel("Presentación")
        .selectOption({ label: "Caja con 12" });
      await addFromSearch(page, "queso", "Queso mozzarella");
      await cartLine(page, "Queso mozzarella")
        .getByLabel("Presentación")
        .selectOption({ label: "Porción 250 g" });
      await addFromSearch(page, "garraf", "Recarga de garrafón 20 L");
      await cartSearch(page).fill("ga");
      await page
        .getByTestId("cart-search")
        .getByRole("button", { name: "Galletas de avena 170 g" })
        .waitFor();
      await calm(page);
      await blur(page);
    },
    target: (page) => [page.getByTestId("sale-screen")],
  },
  {
    id: "sale-weight",
    chapter: SALE,
    as: "cashier",
    path: "/pos",
    // Kilo y medio de frijol, tecleado en el teclado de la pantalla.
    prepare: async (page) => {
      await addFromSearch(page, "frijol", "Frijol negro a granel");
      await setQuantity(page, "Frijol negro a granel", "1.5");
      await calm(page);
      await blur(page);
    },
    target: (page) => [cartPanel(page)],
  },
  {
    id: "sale-checkout",
    chapter: SALE,
    as: "cashier",
    path: "/pos",
    // El cobro de la venta del ticket, con su descuento autorizado, pagada con
    // $300 en efectivo. «Cobrar» NO se presiona.
    prepare: async (page) => {
      await ticketCart(page);
      await page.getByRole("button", { name: "Cobrar", exact: true }).click();
      const checkout = page.getByTestId("checkout-panel");
      await checkout.getByRole("button", { name: "Aplicar descuento" }).click();
      await checkout.getByLabel("Descuento", { exact: true }).fill("15");
      await checkout.getByLabel("Código de autorización").fill(DEMO.discountCode);
      await checkout.getByLabel("Motivo (opcional)").fill("Cliente frecuente");
      await checkout.getByLabel("Con cuánto paga").fill("300");
      await blur(page);
      await calm(page);
    },
    target: (page) => [page.getByTestId("checkout-panel"), cartPanel(page)],
  },
  {
    id: "sale-no-stock",
    chapter: SALE,
    as: "cashier",
    path: "/pos",
    // Diez frascos de café cuando la sucursal tiene menos: el aviso en rojo, y
    // a la izquierda la búsqueda que dice cuántos hay.
    prepare: async (page) => {
      await addFromSearch(page, "café", "Café soluble 200 g");
      await setQuantity(page, "Café soluble 200 g", "10");
      await page.getByRole("button", { name: "Ocultar teclado" }).click();
      await cartSearch(page).fill("café");
      await page
        .getByTestId("cart-search")
        .getByRole("button", { name: "Café soluble 200 g" })
        .waitFor();
      await calm(page);
      await blur(page);
    },
    target: (page) => [page.getByTestId("cart-search"), cartPanel(page)],
  },

  // ── Capítulo 7 — El ticket: imprimirlo y reimprimirlo ──────────────────
  {
    id: "ticket",
    chapter: TICKET,
    as: "cashier",
    path: "/pos/sales",
    pdf: latestSaleTicket("58mm"),
  },
  {
    id: "ticket-reprint",
    chapter: TICKET,
    as: "cashier",
    path: "/pos/sales",
    // El código de barras de la última venta cobrada de Luis (la del ticket),
    // escrito en el buscador como lo haría el lector.
    prepare: async (page) => {
      const row = page
        .getByRole("row")
        .filter({ hasText: "Luis Ramírez" })
        .filter({ hasText: "Cobrada" })
        .first();
      const code = (await row.getByRole("cell").nth(1).innerText()).trim();
      await page.getByLabel("Folio o código").fill(code);
      await page.getByRole("row").nth(2).waitFor({ state: "detached" });
      await blur(page);
    },
    target: (page) => [title(page, "Historial de ventas"), page.getByRole("table")],
  },

  // ── Capítulo 8 — Historial de ventas ───────────────────────────────────
  {
    id: "sales-history",
    chapter: HISTORY,
    as: "cashier",
    path: "/pos/sales",
    // Los filtros y las ventas más recientes: una con descuento, una cancelada
    // y una de otra caja.
    target: (page) => [title(page, "Historial de ventas"), page.getByRole("row").nth(5)],
  },

  // ── Capítulo 9 — Cotizaciones ──────────────────────────────────────────
  {
    id: "quotes-list",
    chapter: QUOTES,
    as: "cashier",
    path: "/pos/quotes",
    target: (page) => [
      title(page, "Cotizaciones"),
      page.getByRole("link", { name: "Nueva cotización" }),
      page.getByRole("table"),
    ],
  },
  {
    id: "quote-new",
    chapter: QUOTES,
    as: "cashier",
    path: "/pos/quotes/new",
    // Dos cajas de agua y el envío, con su nota. «Generar cotización» NO se presiona.
    prepare: async (page) => {
      await scan(page, WATER_BARCODE, "Agua natural 1 L");
      await cartLine(page, "Agua natural 1 L")
        .getByLabel("Presentación")
        .selectOption({ label: "Caja con 12" });
      await setQuantity(page, "Agua natural 1 L", "2");
      await page.getByRole("button", { name: "Ocultar teclado" }).click();
      await addFromSearch(page, "envio", "Envío a domicilio");
      await page
        .getByLabel("Nota (opcional)")
        .fill("Para la fiesta del sábado. Llamar antes de enviar.");
      await calm(page);
      await blur(page);
    },
    target: (page) => [title(page, "Nueva cotización"), page.getByTestId("quote-builder")],
  },
  {
    id: "quote-paper",
    chapter: QUOTES,
    as: "cashier",
    path: "/pos/quotes",
    pdf: latestQuoteTicket("open"),
  },
  {
    id: "quote-load",
    chapter: QUOTES,
    as: "cashier",
    path: "/pos",
    // El folio de la cotización vigente, tecleado en el buscador de la caja:
    // abre su revisión. «Cargar al carrito» NO se presiona.
    prepare: async (page) => {
      await cartSearch(page).fill("COT-000002");
      await page.getByTestId("quote-load-panel").waitFor();
      await blur(page);
    },
    target: (page) => [page.getByTestId("session-bar"), page.getByTestId("quote-load-panel")],
  },

  // ── Capítulo 10 — Gastos pagados desde el cajón ────────────────────────
  {
    id: "drawer-expense",
    chapter: DRAWER,
    as: "owner",
    path: "/expenses/new",
    // El rol Cajero no registra gastos: lo hace la dueña y elige el turno de
    // Luis como caja de origen. Nada se guarda.
    prepare: async (page) => {
      await page.getByLabel("Monto", { exact: true }).fill("90");
      await page.getByLabel("Pago", { exact: true }).selectOption({ label: "Efectivo" });
      await page
        .getByLabel("Caja de origen")
        .selectOption({ label: "Turno de Luis Ramírez (Sucursal Centro)" });
      await blur(page);
    },
    // Del monto a la caja de origen: lo que decide de dónde salió el dinero.
    // La cuenta de caja marca el borde derecho: el campo del descuento deja
    // fuera su «MXN».
    target: (page) => [
      page.getByText("Monto", { exact: true }),
      page.locator("#expense-account"),
      page.getByText(
        "Un gasto pagado del cajón se resta del efectivo esperado al cerrar ese turno.",
        { exact: true },
      ),
    ],
  },
  {
    id: "drawer-expense-close",
    chapter: DRAWER,
    as: "cashier",
    path: "/pos/close",
    // Solo las cuentas del cierre: el gasto del cajón restado del efectivo.
    target: (page) => [
      title(page, "Cierre de turno"),
      page.getByTestId("expected-cash").locator("xpath=../.."),
    ],
  },

  // ── Capítulo 11 — Tu panel de vendedor ─────────────────────────────────
  {
    id: "seller-panel",
    chapter: PANEL,
    as: "cashier",
    path: "/dashboard",
    viewport: NARROW,
    // El menú del cajero junto a su panel: lo primero que ve al entrar.
    target: (page) => [
      page.getByTestId("sidebar-brand"),
      page.getByTestId("app-version"),
      page.getByTestId("seller-panel"),
    ],
  },
  {
    id: "seller-panel-no-shift",
    chapter: PANEL,
    as: "cashier",
    path: "/dashboard",
    viewport: NARROW,
    apiOverrides: NO_SHIFT,
    target: (page) => [page.getByTestId("seller-panel")],
  },
];
