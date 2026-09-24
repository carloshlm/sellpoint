import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Page } from "playwright";
import { card, type Screen } from "./kit.js";

/**
 * Una ventana más alta para las tarjetas que no caben en 800 px: el recorte
 * se calcula sobre lo visible, y una tarjeta partida por el borde saldría
 * cortada.
 */
const tall = async (page: Page, height = 1600) => {
  await page.setViewportSize({ width: 1280, height });
};

/** Quita el foco del campo que se acaba de llenar: el anillo azul distrae en el papel. */
const blur = (page: Page) =>
  page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());

/** El encabezado de una tarjeta (título y subtítulo), para abrir un recorte parcial. */
const cardHeader = (page: Page, title: string) =>
  card(page, title).locator("[data-slot='card-header']");

/** El encabezado de una pantalla: su título grande, que abre los recortes de página. */
const pageTitle = (page: Page, name: string) => page.getByRole("heading", { level: 1, name });

/** Abre la ficha de un producto desde su renglón en la tabla y elige una pestaña. */
const openProduct = async (page: Page, name: string, tab?: string) => {
  await page
    .getByRole("row", { name: new RegExp(name) })
    .getByRole("button", { name: "Ver" })
    .click();
  if (tab) {
    await productTabs(page).getByRole("button", { name: tab, exact: true }).click();
  }
};
const productTabs = (page: Page) => page.locator("nav[aria-label='Secciones del producto']");

/** Parte 3 — Preparar tu negocio. */
export const SETUP: Screen[] = [
  // ── Capítulo 12 — Datos del negocio y el ticket ────────────────────────
  {
    id: "business-details",
    chapter: "03-setup/12-business-and-ticket.md",
    as: "owner",
    path: "/profile",
    prepare: (page) => tall(page),
    target: (page) => [
      cardHeader(page, "Datos del negocio"),
      page.getByText("Por ejemplo ABC010101AB1", { exact: true }),
    ],
  },
  {
    id: "business-switches",
    chapter: "03-setup/12-business-and-ticket.md",
    as: "owner",
    path: "/profile",
    prepare: (page) => tall(page),
    target: (page) => [
      page.locator("label[for='sell-without-stock']").locator("xpath=../.."),
      page.locator("label[for='uses-purchase-orders']").locator("xpath=../.."),
    ],
  },
  {
    id: "ticket-settings",
    chapter: "03-setup/12-business-and-ticket.md",
    as: "owner",
    path: "/profile",
    prepare: (page) => tall(page),
    target: (page) => [card(page, "Configuración del ticket")],
  },

  // ── Capítulo 13 — Impuestos ────────────────────────────────────────────
  {
    id: "taxes-modes",
    chapter: "03-setup/13-taxes.md",
    as: "owner",
    path: "/profile",
    prepare: (page) => tall(page),
    target: (page) => [
      cardHeader(page, "Impuestos"),
      page.getByText(/^Ya tienes costos capturados/),
    ],
  },
  {
    id: "taxes-groups",
    chapter: "03-setup/13-taxes.md",
    as: "owner",
    path: "/profile",
    prepare: (page) => tall(page),
    target: (page) => [
      page.getByText("Grupos de impuesto", { exact: true }),
      page.getByTestId("tax-group").nth(1),
    ],
  },

  // ── Capítulo 14 — Descuentos y su código de autorización ───────────────
  {
    id: "discounts",
    chapter: "03-setup/14-discounts.md",
    as: "owner",
    path: "/profile",
    target: (page) => [card(page, "Descuentos en caja")],
  },

  // ── Capítulo 15 — Sucursales ───────────────────────────────────────────
  {
    id: "stores-list",
    chapter: "03-setup/15-stores.md",
    as: "owner",
    path: "/warehouses",
    target: (page) => [pageTitle(page, "Sucursales"), page.getByRole("table")],
  },
  {
    id: "store-form",
    chapter: "03-setup/15-stores.md",
    as: "owner",
    path: "/warehouses",
    prepare: async (page) => {
      await page.getByRole("button", { name: "Nueva sucursal" }).click();
      await page.getByLabel("Código", { exact: true }).fill("SUR");
      await page.getByLabel("Nombre de la sucursal").fill("Sucursal Sur");
      await blur(page);
    },
    target: (page) => [card(page, "Sucursales")],
  },

  // ── Capítulo 16 — Productos ────────────────────────────────────────────
  {
    id: "products-list",
    chapter: "03-setup/16-products.md",
    as: "owner",
    path: "/catalog/products",
    target: (page) => [pageTitle(page, "Productos"), page.getByRole("table")],
  },
  {
    id: "product-form",
    chapter: "03-setup/16-products.md",
    as: "owner",
    path: "/catalog/products",
    prepare: async (page) => {
      await tall(page);
      await page.getByRole("button", { name: "Nuevo producto" }).click();
      await page.getByLabel("Código interno").fill("JABON-150");
      await page.getByLabel("Nombre", { exact: true }).fill("Jabón de barra 150 g");
      await page.getByLabel("Costo (sin impuesto)").fill("11");
      await page.getByLabel("Precio de venta (con impuesto incluido)").fill("18.50");
      await blur(page);
    },
    target: (page) => [
      // Del primer campo al precio, al ancho del formulario: el encabezado de
      // la tarjeta es de página completa y dejaría media captura en blanco.
      card(page, "Nuevo producto").getByText("Código de barras", { exact: true }),
      page.locator("fieldset").filter({ hasText: "Impuesto, costo y precio" }),
    ],
  },
  {
    id: "product-presentations",
    chapter: "03-setup/16-products.md",
    as: "owner",
    path: "/catalog/products",
    prepare: (page) => openProduct(page, "Agua natural 1 L", "Presentaciones"),
    target: (page) => [
      pageTitle(page, "Agua natural 1 L"),
      page.getByRole("table"),
      page.getByRole("button", { name: "Agregar presentación" }),
    ],
  },
  {
    id: "products-quick",
    chapter: "03-setup/16-products.md",
    as: "owner",
    path: "/catalog/products/quick",
    prepare: async (page) => {
      // Un código que ya es del negocio (el agua) y uno nuevo, de la serie
      // ficticia 750999…: la lista, sin darlos de alta.
      const scan = page.getByLabel("Código de barras");
      for (const code of ["7501055300013", "7509999000204"]) {
        await scan.fill(code);
        await scan.press("Enter");
        await page.getByText(code, { exact: true }).waitFor();
      }
      await page
        .getByText(/^(Escribe el nombre|Ya lo tienes)$/)
        .nth(1)
        .waitFor();
      const nueva = page.getByRole("row").filter({ hasText: "7509999000204" });
      await nueva.getByRole("textbox").first().fill("Jabón de barra 150 g");
      await nueva.getByRole("textbox").last().fill("18.50");
      const agua = page.getByRole("row").filter({ hasText: "7501055300013" });
      await agua.getByRole("textbox").last().fill("15");
      await page.getByLabel("Código de barras").focus();
    },
    target: (page) => [
      pageTitle(page, "Carga rápida"),
      page.locator("[data-slot='card']").filter({ hasText: "Escanea, pon el precio y da de alta" }),
    ],
  },

  // ── Capítulo 17 — Productos compuestos: recetas y kits ─────────────────
  {
    id: "composite-composition",
    chapter: "03-setup/17-composite-products.md",
    as: "owner",
    path: "/catalog/products",
    prepare: (page) => openProduct(page, "Despensa básica", "Composición"),
    target: (page) => [pageTitle(page, "Despensa básica"), page.getByTestId("composition-summary")],
  },

  // ── Capítulo 18 — Servicios ────────────────────────────────────────────
  {
    id: "services-list",
    chapter: "03-setup/18-services.md",
    as: "owner",
    path: "/catalog/services",
    target: (page) => [pageTitle(page, "Servicios"), page.getByRole("table")],
  },
  {
    id: "service-form",
    chapter: "03-setup/18-services.md",
    as: "owner",
    path: "/catalog/services",
    prepare: async (page) => {
      await tall(page);
      await page.getByRole("button", { name: "Nuevo servicio" }).click();
      await page.getByLabel("Código", { exact: true }).fill("PLANCHADO");
      await page.getByLabel("Nombre", { exact: true }).fill("Planchado de camisa");
      await page.getByLabel("Precio de venta (con impuesto incluido)").fill("25");
      await blur(page);
    },
    target: (page) => [card(page, "Nuevo servicio")],
  },

  // ── Capítulo 19 — Proveedores ──────────────────────────────────────────
  {
    id: "suppliers-list",
    chapter: "03-setup/19-suppliers.md",
    as: "owner",
    path: "/suppliers",
    target: (page) => [pageTitle(page, "Proveedores"), page.getByRole("table")],
  },
  {
    id: "supplier-duplicate",
    chapter: "03-setup/19-suppliers.md",
    as: "owner",
    path: "/suppliers/new",
    prepare: async (page) => {
      // El RFC de Distribuidora del Valle: al salir del campo, el aviso.
      await page.getByLabel("Nombre o razón social").fill("Distribuidora Valle Sur");
      const rfc = page.getByLabel("Registro fiscal (RFC)");
      await rfc.fill("DVA050101AB2");
      await rfc.blur();
      await blur(page);
      await page.getByText(/^Ya hay 1 proveedor con este registro fiscal/).waitFor();
    },
    target: (page) => [
      card(page, "Registrar proveedor").locator("[data-slot='card-header']"),
      page.getByTestId("duplicate-supplier"),
    ],
  },

  // ── Capítulo 20 — Importar y exportar con Excel ────────────────────────
  {
    id: "import-products",
    chapter: "03-setup/20-spreadsheets.md",
    as: "owner",
    path: "/catalog/products",
    prepare: async (page) => {
      // La plantilla tal como sale, subida de vuelta: el reporte previo dice
      // que cada fila ACTUALIZA un producto que ya existe. Solo el reporte;
      // nunca se presiona «Importar».
      await page.getByRole("button", { name: "Importar", exact: true }).click();
      const [download] = await Promise.all([
        page.waitForEvent("download"),
        page.getByText("Plantilla Excel", { exact: true }).click(),
      ]);
      const file = join(tmpdir(), `manual-${download.suggestedFilename()}`);
      await download.saveAs(file);
      await page.locator("input[type='file']").setInputFiles(file);
      await page.getByText(/para actualizar$/).waitFor();
    },
    target: (page) => [card(page, "Importar productos")],
  },

  // ── Capítulo 21 — Campos y subcatálogos propios ────────────────────────
  {
    id: "custom-fields",
    chapter: "03-setup/21-custom-catalogs.md",
    as: "owner",
    path: "/catalog/schema",
    prepare: async (page) => {
      await page
        .getByLabel("Catálogo", { exact: true })
        .selectOption({ label: "Catálogo de Productos" });
      await page.getByText("Lista de otro catálogo → Pasillos").waitFor();
    },
    target: (page) => [pageTitle(page, "Campos del catálogo"), card(page, "Previsualización")],
  },
  {
    id: "custom-field-form",
    chapter: "03-setup/21-custom-catalogs.md",
    as: "owner",
    path: "/catalog/schema",
    prepare: async (page) => {
      await page
        .getByLabel("Catálogo", { exact: true })
        .selectOption({ label: "Catálogo de Productos" });
      await page.getByText("Lista de otro catálogo → Pasillos").waitFor();
      await page.getByRole("button", { name: "Agregar campo" }).click();
      await page.getByLabel("Nombre del campo").fill("Marca");
      await blur(page);
    },
    target: (page) => [card(page, "Campos")],
  },
  {
    id: "subcatalog-records",
    chapter: "03-setup/21-custom-catalogs.md",
    as: "owner",
    path: "/catalog/lists",
    target: (page) => [page.getByText("Subcatálogo", { exact: true }), page.getByRole("table")],
  },
];
