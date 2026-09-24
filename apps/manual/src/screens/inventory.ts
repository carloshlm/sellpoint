import type { Page } from "playwright";
import { card, type Screen } from "./kit.js";

/** El título de la pantalla, por su texto exacto. */
const title = (page: Page, name: string | RegExp) =>
  page.getByRole("heading", { name, exact: typeof name === "string" });

/**
 * La ficha de un producto en una de sus pestañas: se entra como la dueña, por
 * el nombre en el listado de Productos, y se elige la pestaña. Solo mira.
 */
async function openProductTab(page: Page, product: string, tab: string): Promise<void> {
  await page.getByRole("button", { name: product, exact: true }).click();
  await page.getByRole("button", { name: tab, exact: true }).click();
  await page.locator("table").first().waitFor();
}

/** Un documento de inventario del listado, por su folio. */
async function openDocument(page: Page, folio: string): Promise<void> {
  await page.getByRole("link", { name: folio, exact: true }).click();
  await page.waitForURL(/\/movements\/documents\//);
  await title(page, folio).waitFor();
}

/** Los traspasos que van hacia la Sucursal Norte: ahí está el que sigue en camino. */
async function transfersToNorte(page: Page): Promise<void> {
  await page.locator("#transfers-destination").selectOption({ label: "Sucursal Norte" });
  await page.getByRole("link", { name: "SAL-000003" }).waitFor();
}

/** Parte 4 — Inventario. */
export const INVENTORY: Screen[] = [
  // ── Capítulo 22 — Existencias y kardex ─────────────────────────────────
  {
    id: "stock-by-store",
    chapter: "04-inventory/22-stock-and-kardex.md",
    as: "owner",
    path: "/catalog/products",
    prepare: (page) => openProductTab(page, "Agua natural 1 L", "Stock por sucursal"),
    target: (page) => [
      title(page, "Agua natural 1 L"),
      page.getByRole("navigation", { name: "Secciones del producto" }),
      page.getByRole("link", { name: "Registrar salida" }),
    ],
  },
  {
    id: "kardex",
    chapter: "04-inventory/22-stock-and-kardex.md",
    as: "owner",
    path: "/catalog/products",
    prepare: (page) => openProductTab(page, "Agua natural 1 L", "Kardex"),
    // Los filtros y los primeros renglones: el resto de la página es más de lo mismo.
    target: (page) => [
      page.getByRole("navigation", { name: "Secciones del producto" }),
      page.locator("table tbody tr").nth(6),
    ],
  },

  // ── Capítulo 23 — Entradas y salidas ───────────────────────────────────
  {
    id: "exits-list",
    chapter: "04-inventory/23-entries-and-exits.md",
    as: "owner",
    path: "/movements/exits",
    target: (page) => [title(page, "Salida"), page.locator("table")],
  },
  {
    id: "exit-confirmed",
    chapter: "04-inventory/23-entries-and-exits.md",
    as: "owner",
    path: "/movements/exits",
    prepare: (page) => openDocument(page, "SAL-000001"),
    target: (page) => [title(page, "SAL-000001"), page.locator("table")],
  },

  // ── Capítulo 24 — Traspasos entre sucursales ───────────────────────────
  {
    id: "transfers-in-transit",
    chapter: "04-inventory/24-transfers.md",
    as: "owner",
    path: "/movements/transfers",
    prepare: transfersToNorte,
    target: (page) => [title(page, "Traspasos en tránsito"), page.locator("table")],
  },
  {
    id: "transfer-receive",
    chapter: "04-inventory/24-transfers.md",
    as: "owner",
    path: "/movements/transfers",
    // Abre el aviso de «Recibir» y se queda ahí: «Crear entrada» NO se presiona.
    prepare: async (page) => {
      await transfersToNorte(page);
      await page.getByRole("button", { name: "Recibir", exact: true }).click();
      await page.getByRole("alertdialog").waitFor();
    },
    target: (page) => [page.locator("table"), page.getByRole("alertdialog")],
  },
  {
    id: "transfer-cancel",
    chapter: "04-inventory/24-transfers.md",
    as: "owner",
    path: "/movements/transfers",
    // Abre el aviso de cancelar y se queda ahí: nada se cancela.
    prepare: async (page) => {
      await transfersToNorte(page);
      await page.getByRole("button", { name: "Cancelar traspaso" }).click();
      await page.getByRole("alertdialog").waitFor();
    },
    target: (page) => [page.locator("table"), page.getByRole("alertdialog")],
  },

  // ── Capítulo 25 — Inventario físico: el conteo ─────────────────────────
  {
    id: "count-sheet",
    chapter: "04-inventory/25-physical-count.md",
    as: "owner",
    path: "/movements/counts",
    prepare: (page) => openDocument(page, "INV-000001"),
    target: (page) => [title(page, "INV-000001"), card(page, "Subir el conteo")],
  },
  {
    id: "count-differences",
    chapter: "04-inventory/25-physical-count.md",
    as: "owner",
    path: "/movements/counts",
    prepare: (page) => openDocument(page, "INV-000001"),
    target: (page) => [page.getByTestId("count-summary"), page.locator("table")],
  },

  // ── Capítulo 26 — Lotes y próximos a vencer ────────────────────────────
  {
    id: "lots-stock",
    chapter: "04-inventory/26-lots-and-expiry.md",
    as: "owner",
    path: "/catalog/products",
    prepare: (page) => openProductTab(page, "Leche entera 1 L", "Stock por sucursal"),
    target: (page) => [
      page.getByRole("navigation", { name: "Secciones del producto" }),
      page.locator("table"),
    ],
  },
  {
    id: "expiring-soon",
    chapter: "04-inventory/26-lots-and-expiry.md",
    as: "owner",
    path: "/movements/expiring",
    // 90 días: además del lote que vence esta semana, los que vienen después.
    prepare: async (page) => {
      await page.getByRole("button", { name: "90 días" }).click();
      await page.locator("table tbody tr").nth(1).waitFor();
    },
    target: (page) => [title(page, "Próximos a vencer"), page.locator("table")],
  },
];
