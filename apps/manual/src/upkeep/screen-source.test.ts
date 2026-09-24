import { describe, expect, it } from "vitest";
import { analyzeScreens, type Finding } from "./screen-source.js";

const KIT = `import type { Locator, Page } from "playwright";

export interface Screen {
  id: string;
  chapter: string;
  path: string;
}

/** Las pantallas de acceso. */
export const authColumn = (page: Page) => [page.locator("main > div").first()];

export const card = (page: Page, title: string) =>
  page.locator("[data-slot='card']").filter({ has: page.getByText(title, { exact: true }) });
`;

const PART = `import type { Page } from "playwright";
import { today } from "../demo.js";
import { card, type Screen } from "./kit.js";

const EXPENSES = "05-purchasing/27-expenses.md";

/** El título, por su texto o un patrón. */
const title = (page: Page, name: string | RegExp) =>
  page.getByRole("heading", { name, exact: typeof name === "string" });

async function openRow(page: Page, text: string, url: RegExp): Promise<void> {
  await page.getByRole("row").filter({ hasText: text }).getByRole("link", { name: "Ver" }).click();
  await page.waitForURL(url);
}

const waitForCharts = async (page: Page) => {
  await page.getByText("Ventas: mes actual vs anterior", { exact: true }).waitFor();
};

export const PART: Screen[] = [
  {
    id: "expenses-list",
    chapter: EXPENSES,
    path: "/expenses",
    target: (page) => [title(page, "Gastos"), page.locator("table")],
  },
  {
    id: "expense-pending",
    chapter: EXPENSES,
    path: "/expenses",
    prepare: async (page) => {
      await page.getByLabel("Desde").fill(today(-10));
      await openRow(page, "GAS-000002", /\\/expenses\\/[^/]+$/);
    },
    target: (page) => [
      title(page, /^Gasto GAS-000002/),
      card(page, "Detalle del gasto"),
      page.getByLabel("Pago", { exact: true }),
    ],
  },
  {
    id: "dashboard-charts",
    chapter: "06-insights/30-dashboard.md",
    path: "/dashboard",
    prepare: waitForCharts,
    target: (page) => [page.getByTestId("sales-chart")],
  },
  {
    id: "sign-in",
    chapter: "01-start/02-sign-in.md",
    path: "/login",
    target: authColumn,
  },
];
`;

const FILES = [
  { path: "screens/kit.ts", source: KIT },
  { path: "screens/part.ts", source: PART },
];

/** Lo que importa de un hallazgo, sin su posición. */
const brief = (findings: Finding[]) =>
  findings.map(({ kind, value, exact }) => `${kind}:${exact ? "=" : "~"}${value}`).sort();

describe("analyzeScreens", () => {
  const { findings, screens } = analyzeScreens(FILES);

  it("encuentra cada texto, id y URL que buscan las capturas, también los que viajan por una función", () => {
    expect(brief(findings)).toEqual(
      [
        "code:=card",
        "code:=sales-chart",
        "text:=Detalle del gasto",
        "text:=Pago",
        "text:=Ventas: mes actual vs anterior",
        "text:~Desde",
        "text:~GAS-000002",
        "text:~Gastos",
        "text:~Ver",
        "url:=\\/expenses\\/[^/]+$",
      ].sort(),
    );
  });

  it("señala cada hallazgo en el renglón donde está escrito el literal", () => {
    const at = (value: string) => findings.find((finding) => finding.value === value);
    expect(at("Gastos")).toMatchObject({ file: "screens/part.ts", line: 25 });
    expect(at("Detalle del gasto")).toMatchObject({ file: "screens/part.ts", line: 37 });
    expect(at("card")).toMatchObject({ file: "screens/kit.ts", line: 13 });
  });

  it("junta en cada captura lo que busca ella y lo que buscan las funciones que usa", () => {
    const of = (id: string) => brief(screens.find((screen) => screen.id === id)?.findings ?? []);
    expect(screens.map((screen) => screen.id)).toEqual([
      "expenses-list",
      "expense-pending",
      "dashboard-charts",
      "sign-in",
    ]);
    expect(of("expenses-list")).toEqual(["text:~Gastos"]);
    expect(of("expense-pending")).toEqual(
      [
        "code:=card",
        "text:=Detalle del gasto",
        "text:=Pago",
        "text:~Desde",
        "text:~GAS-000002",
        "text:~Ver",
        "url:=\\/expenses\\/[^/]+$",
      ].sort(),
    );
    expect(of("dashboard-charts")).toEqual(
      ["code:=sales-chart", "text:=Ventas: mes actual vs anterior"].sort(),
    );
    expect(of("sign-in")).toEqual([]);
  });

  it("resuelve una constante local y el arreglo de un for…of", () => {
    const source = `export const X = [{
  id: "quick",
  chapter: "03-setup/16-products.md",
  path: "/catalog/products/quick",
  prepare: async (page) => {
    const store = "Sucursal Norte";
    await page.getByLabel("Sucursal").selectOption({ label: store });
    for (const code of ["7501055300013", "7509999000204"]) {
      await page.getByText(code, { exact: true }).waitFor();
    }
    await page.locator("tr", { hasText: "Luis Ramírez" }).click();
  },
}];`;
    const result = analyzeScreens([{ path: "screens/x.ts", source }]);
    expect(brief(result.findings)).toEqual(
      [
        "text:=7501055300013",
        "text:=7509999000204",
        "text:=Sucursal Norte",
        "text:~Luis Ramírez",
        "text:~Sucursal",
      ].sort(),
    );
  });

  it("lee los atributos que importan de un selector CSS", () => {
    const source = `export const pick = (page) => [
  page.locator("nav[aria-label='Secciones del producto']"),
  page.locator("#transfers-destination"),
  page.locator("label[for='sell-without-stock']").locator("xpath=../.."),
  page.locator("button[aria-haspopup='menu']"),
  page.locator('[data-testid="tax-group"]'),
];`;
    expect(brief(analyzeScreens([{ path: "screens/x.ts", source }]).findings)).toEqual(
      [
        "code:=sell-without-stock",
        "code:=tax-group",
        "code:=transfers-destination",
        "text:=Secciones del producto",
      ].sort(),
    );
  });

  it("omite las regex y los RegExp armados; de un template toma sus partes fijas", () => {
    const source = `export const pick = (page, name, folio) => [
  page.getByText(/^Ya tienes costos capturados/),
  page.getByRole("row", { name: new RegExp(name) }),
  page.getByRole("heading", { name: \`Compra \${folio}\` }),
];`;
    expect(brief(analyzeScreens([{ path: "screens/x.ts", source }]).findings)).toEqual([
      "text:~Compra",
    ]);
  });
});
