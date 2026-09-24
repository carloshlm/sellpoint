import type { Page } from "playwright";
import { card, type Screen } from "./kit.js";

/** El título de la pantalla, por su texto exacto o un patrón. */
const title = (page: Page, name: string | RegExp) =>
  page.getByRole("heading", { name, exact: typeof name === "string" });

/** Abre, con «Ver», el renglón del listado que contiene `text`. */
async function openRow(page: Page, text: string, url: RegExp): Promise<void> {
  await page.getByRole("row").filter({ hasText: text }).getByRole("link", { name: "Ver" }).click();
  await page.waitForURL(url);
  await page.waitForLoadState("networkidle");
}

/** La orden de compra a Lácteos San Juan, con su recepción parcial. */
const openOrder = (page: Page) => openRow(page, "OCO-000001", /\/purchase-orders\/[^/]+$/);

/** Parte 5 — Compras y gastos. */
export const PURCHASING: Screen[] = [
  // ── Capítulo 27 — Gastos ───────────────────────────────────────────────
  {
    id: "expenses-list",
    chapter: "05-purchasing/27-expenses.md",
    as: "owner",
    path: "/expenses",
    target: (page) => [title(page, "Gastos"), page.locator("table")],
  },
  {
    id: "expense-form",
    chapter: "05-purchasing/27-expenses.md",
    as: "owner",
    path: "/expenses/new",
    // La fecha nace con el foco puesto: se le quita para que no salga resaltada.
    prepare: async (page) => {
      await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
    },
    // De la fecha al pago: lo que se decide. Descripción y notas quedan abajo.
    target: (page) => [
      page.getByText("Registrar gasto", { exact: true }),
      page.getByLabel("Pago", { exact: true }),
      page.getByLabel("Vence", { exact: true }),
    ],
  },
  {
    id: "expense-pending",
    chapter: "05-purchasing/27-expenses.md",
    as: "owner",
    path: "/expenses",
    prepare: (page) => openRow(page, "GAS-000002", /\/expenses\/[^/]+$/),
    // La cabecera con sus botones y la ficha completa del gasto.
    target: (page) => [
      title(page, /^Gasto GAS-000002/),
      page.getByRole("button", { name: "Anular" }),
      page.locator("dl"),
    ],
  },

  // ── Capítulo 28 — Compras con la factura del proveedor ─────────────────
  {
    id: "purchases-list",
    chapter: "05-purchasing/28-purchases.md",
    as: "owner",
    path: "/purchases",
    target: (page) => [title(page, "Compras"), page.locator("table")],
  },
  {
    id: "purchase-new",
    chapter: "05-purchasing/28-purchases.md",
    as: "owner",
    path: "/purchases/new",
    target: (page) => [card(page, "Nueva compra")],
  },
  {
    id: "purchase-to-inventory",
    chapter: "05-purchasing/28-purchases.md",
    as: "owner",
    path: "/purchases",
    prepare: (page) => openRow(page, "COM-000001", /\/purchases\/[^/]+$/),
    target: (page) => [
      title(page, "Compra COM-000001"),
      page.getByRole("button", { name: "Anular compra" }),
      page.getByText("Esta compra ya está confirmada", { exact: false }),
    ],
  },

  // ── Capítulo 29 — Órdenes de compra y recepciones ──────────────────────
  {
    id: "purchase-orders-list",
    chapter: "05-purchasing/29-purchase-orders.md",
    as: "owner",
    path: "/purchase-orders",
    target: (page) => [title(page, "Órdenes de compra"), page.locator("table")],
  },
  {
    id: "purchase-order-received",
    chapter: "05-purchasing/29-purchase-orders.md",
    as: "owner",
    path: "/purchase-orders",
    // Lo pedido contra lo recibido, y la recepción que ya llegó. La tabla se
    // sube al borde de arriba para que todo quepa sin volver a desplazar.
    prepare: async (page) => {
      await openOrder(page);
      await title(page, "Productos del pedido").evaluate((el) =>
        el.scrollIntoView({ block: "start" }),
      );
    },
    target: (page) => [
      title(page, "Productos del pedido"),
      page.locator("table"),
      page.getByRole("link", { name: "RCP-000001" }),
    ],
  },
  {
    id: "purchase-receipt",
    chapter: "05-purchasing/29-purchase-orders.md",
    as: "owner",
    path: "/purchase-orders",
    prepare: async (page) => {
      await openOrder(page);
      await page.getByRole("link", { name: "RCP-000001" }).click();
      await page.waitForURL(/\/receipts\//);
      await title(page, "Lo que llegó").waitFor();
    },
    target: (page) => [title(page, /^Recepción RCP-000001/), page.locator("table")],
  },
  {
    id: "purchase-order-invoice",
    chapter: "05-purchasing/29-purchase-orders.md",
    as: "owner",
    path: "/purchase-orders",
    // Abre el aviso y se queda ahí: «Crear la compra» NO se presiona.
    prepare: async (page) => {
      await openOrder(page);
      await page.getByRole("button", { name: "Registrar compra de lo recibido" }).click();
      await page.getByRole("alertdialog").waitFor();
    },
    target: (page) => [title(page, "Recepciones"), page.getByRole("alertdialog")],
  },
];
