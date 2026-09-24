import type { Page } from "playwright";
import { today } from "../demo.js";
import type { Screen } from "./kit.js";

const DASHBOARD = "06-insights/30-dashboard.md";
const REPORTS = "06-insights/31-reports.md";

/**
 * La rejilla del panel que contiene un texto: los mosaicos, las dos gráficas,
 * las dos listas. Se busca dentro de `main` para no chocar con el menú, que
 * repite algunos títulos («Próximos a vencer»).
 */
const gridWith = (page: Page, text: string) =>
  page
    .locator("main")
    .getByText(text, { exact: true })
    .locator("xpath=ancestor::div[contains(concat(' ', @class, ' '), ' grid ')][1]");

/** Las gráficas se dibujan con animación: se espera a que terminen. */
const waitForCharts = async (page: Page) => {
  await page.getByText("Ventas: mes actual vs anterior", { exact: true }).waitFor();
  await page.waitForTimeout(1800);
};

/** Parte 6 — Cómo va tu negocio. */
export const INSIGHTS: Screen[] = [
  // ── Capítulo 30 — El panel ─────────────────────────────────────────────
  {
    id: "dashboard-kpis",
    chapter: DASHBOARD,
    as: "owner",
    path: "/dashboard",
    target: (page) => [gridWith(page, "Ventas de hoy")],
  },
  {
    id: "dashboard-charts",
    chapter: DASHBOARD,
    as: "owner",
    path: "/dashboard",
    prepare: waitForCharts,
    target: (page) => [gridWith(page, "Ventas: mes actual vs anterior")],
  },
  {
    id: "dashboard-top-products",
    chapter: DASHBOARD,
    as: "owner",
    path: "/dashboard",
    target: (page) => [
      page.locator("main fieldset").filter({ has: page.getByRole("button", { name: "Hoy" }) }),
      gridWith(page, "Más vendidos"),
    ],
  },
  {
    id: "dashboard-inventory",
    chapter: DASHBOARD,
    as: "owner",
    path: "/dashboard",
    prepare: waitForCharts,
    target: (page) => [gridWith(page, "Métodos de pago")],
  },

  // ── Capítulo 31 — Reportes y exportarlos a Excel ───────────────────────
  {
    id: "reports-hub",
    chapter: REPORTS,
    as: "owner",
    path: "/reports",
    target: (page) => [page.getByTestId("reports-hub")],
  },
  {
    id: "reports-sales",
    chapter: REPORTS,
    as: "owner",
    path: "/reports/sales",
    // El título, los filtros, el botón de Excel y las primeras ventas: la
    // tabla completa no cabe en la hoja.
    target: (page) => [
      page.getByTestId("sales-report").locator("h1"),
      page.getByRole("row").nth(6),
    ],
  },
  {
    id: "reports-shifts",
    chapter: REPORTS,
    as: "owner",
    path: "/reports/shifts",
    // Los días alrededor del turno al que le faltaron $20: se ve una
    // diferencia y su nota junto a dos turnos que cuadraron.
    prepare: async (page) => {
      await page.getByLabel("Desde").fill(today(-10));
      await page.getByLabel("Hasta").fill(today(-8));
      await page.getByLabel("Hasta").blur();
      await page.getByRole("row").nth(3).waitFor();
    },
    target: (page) => [page.getByTestId("shifts-report")],
  },
  {
    id: "reports-taxes",
    chapter: REPORTS,
    as: "owner",
    path: "/reports/taxes",
    target: (page) => [page.getByTestId("tax-report")],
  },
];
