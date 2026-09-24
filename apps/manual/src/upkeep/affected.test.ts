import { describe, expect, it } from "vitest";
import {
  buildReport,
  changedMessages,
  findOldText,
  importersOf,
  type ReportInput,
  routesReached,
  type ScreenInfo,
  screensForRoute,
} from "./affected.js";
import type { WebRoute } from "./routes.js";

describe("changedMessages", () => {
  it("devuelve los textos que cambiaron o se borraron, no los nuevos ni los iguales", () => {
    const file = "apps/web/src/i18n/es/products.json";
    expect(
      changedMessages(
        file,
        { list: { new: "Nuevo producto", title: "Productos" }, gone: "Se va" },
        { list: { new: "Alta de producto", title: "Productos", extra: "Nuevo" } },
      ),
    ).toEqual([
      { file, key: "list.new", before: "Nuevo producto", after: "Alta de producto" },
      { file, key: "gone", before: "Se va", after: null },
    ]);
  });
});

describe("findOldText", () => {
  const chapter = {
    path: "docs/manual/es/03-setup/16-products.md",
    source: [
      "---",
      "title: Productos",
      "---",
      "",
      "Presiona **Nuevo producto** para dar de alta",
      "uno. El nuevo producto queda en la lista.",
      "",
      "Si ves «Ya tienes costos capturados sin",
      "impuesto», revisa el modo.",
    ].join("\n"),
  };

  it("en un capítulo, un texto corto solo cuenta marcado como de la pantalla", () => {
    expect(findOldText("Nuevo producto", [chapter], "chapter")).toEqual([
      { file: chapter.path, line: 5 },
    ]);
  });

  it("un texto largo se encuentra aunque el Markdown lo parta en dos renglones", () => {
    expect(findOldText("Ya tienes costos capturados sin impuesto", [chapter], "chapter")).toEqual([
      { file: chapter.path, line: 8 },
    ]);
  });

  it("en el código de una captura, con su interpolación o dentro de una regex", () => {
    const code = {
      path: "apps/manual/src/screens/setup.ts",
      source: [
        'await page.getByRole("button", { name: "Guardar" }).click();',
        "// Guardar no se presiona nunca.",
        "await page.getByText(/^Ya hay 1 proveedor con este registro fiscal/).waitFor();",
      ].join("\n"),
    };
    expect(findOldText("Guardar", [code], "code")).toEqual([{ file: code.path, line: 1 }]);
    expect(
      findOldText("Ya hay {{count}} proveedor con este registro fiscal", [code], "code"),
    ).toEqual([{ file: code.path, line: 3 }]);
  });

  it("un texto de menos de tres letras no se busca: aparecería en todos lados", () => {
    expect(findOldText("Sí", [chapter], "chapter")).toEqual([]);
  });
});

const WEB = [
  {
    path: "routes/expenses.$expenseId.tsx",
    source: 'import { ExpenseDetail } from "@/components/expenses/expense-detail";',
  },
  {
    path: "routes/expenses.index.tsx",
    source: 'import { ExpensesList } from "@/components/expenses/expenses-list";',
  },
  {
    path: "components/expenses/expense-detail.tsx",
    source:
      'import { Lines } from "./expense-lines";\nimport { Button } from "@/components/ui/button";',
  },
  { path: "components/expenses/expense-lines.tsx", source: "export const Lines = 1;" },
  {
    path: "components/expenses/expenses-list.tsx",
    source: 'import { Button } from "../ui/button";',
  },
  { path: "components/ui/button.tsx", source: "export const Button = 1;" },
  {
    path: "routeTree.gen.ts",
    source:
      "import { Route as A } from './routes/expenses.$expenseId'\nimport { Route as B } from './routes/expenses.index'",
  },
];
const ROUTES: WebRoute[] = [
  { fullPath: "/expenses/$expenseId", module: "routes/expenses.$expenseId" },
  { fullPath: "/expenses/", module: "routes/expenses.index" },
  { fullPath: "/purchases/", module: "routes/purchases.index" },
  { fullPath: "/purchases/$purchaseId", module: "routes/purchases.$purchaseId" },
  {
    fullPath: "/movements/documents/$documentId",
    module: "routes/movements.documents.$documentId",
  },
];

describe("routesReached", () => {
  const importers = importersOf(WEB);

  it("sigue los imports hasta las rutas que dibujan un componente", () => {
    expect(routesReached("components/expenses/expense-lines.tsx", importers, ROUTES)).toEqual([
      "/expenses/$expenseId",
    ]);
    expect(routesReached("components/ui/button.tsx", importers, ROUTES)).toEqual([
      "/expenses/$expenseId",
      "/expenses/",
    ]);
  });

  it("un archivo de ruta llega a su propia ruta", () => {
    expect(routesReached("routes/expenses.index.tsx", importers, ROUTES)).toEqual(["/expenses/"]);
  });
});

const screen = (partial: Partial<ScreenInfo> & Pick<ScreenInfo, "id" | "path">): ScreenInfo => ({
  chapter: "05-purchasing/27-expenses.md",
  file: "screens/purchasing.ts",
  reaches: [],
  pdf: false,
  ...partial,
});
const SCREENS: ScreenInfo[] = [
  screen({ id: "expenses-list", path: "/expenses" }),
  screen({ id: "expense-pending", path: "/expenses", reaches: [/\/expenses\/[^/]+$/] }),
  screen({
    id: "exit-confirmed",
    path: "/movements/exits",
    chapter: "04-inventory/23-entries-and-exits.md",
    file: "screens/inventory.ts",
    reaches: [/\/movements\/documents\//],
  }),
  screen({ id: "purchases-list", path: "/purchases", chapter: "05-purchasing/28-purchases.md" }),
];
const PATHS = ROUTES.map((route) => route.fullPath);
const ids = (found: ReturnType<typeof screensForRoute>) =>
  found.map((item) => `${item.screen.id}:${item.via}`);

describe("screensForRoute", () => {
  it("las capturas que abren la ruta", () => {
    expect(ids(screensForRoute("/expenses/", SCREENS, PATHS))).toEqual([
      "expenses-list:path",
      "expense-pending:path",
    ]);
  });

  it("las que llegan a ella desde otra pantalla, por su waitForURL", () => {
    expect(ids(screensForRoute("/expenses/$expenseId", SCREENS, PATHS))).toEqual([
      "expense-pending:url",
    ]);
    expect(ids(screensForRoute("/movements/documents/$documentId", SCREENS, PATHS))).toEqual([
      "exit-confirmed:url",
    ]);
  });

  it("si ninguna la retrata, las que abren la ruta de más arriba, por si llegan a ella", () => {
    expect(ids(screensForRoute("/purchases/$purchaseId", SCREENS, PATHS))).toEqual([
      "purchases-list:parent",
    ]);
  });
});

describe("buildReport", () => {
  const input: ReportInput = {
    base: "origin/main",
    changedFiles: [
      "apps/web/src/components/expenses/expense-lines.tsx",
      "apps/web/src/i18n/es/expenses.json",
      "apps/manual/src/seed.ts",
      "docs/manual/es/05-purchasing/27-expenses.md",
    ],
    web: WEB,
    routes: ROUTES,
    screens: SCREENS,
    textChanges: [
      {
        file: "apps/web/src/i18n/es/expenses.json",
        key: "detail.void",
        before: "Anular gasto",
        after: "Cancelar gasto",
      },
      {
        file: "apps/web/src/i18n/es/expenses.json",
        key: "x",
        before: "Nadie lo cita",
        after: null,
      },
    ],
    chapters: [
      {
        path: "docs/manual/es/05-purchasing/27-expenses.md",
        source: "---\ntitle: Gastos\n---\n\nCon **Anular gasto** lo cancelas.\n",
      },
    ],
    screenSources: [],
  };

  it("dice qué capítulos y capturas revisar, y por qué", () => {
    const report = buildReport(input);
    expect(report).toContain("docs/manual/es/05-purchasing/27-expenses.md");
    expect(report).toContain("expense-pending");
    expect(report).toContain("components/expenses/expense-lines.tsx");
    expect(report).toContain("«Anular gasto» → «Cancelar gasto»");
    expect(report).toContain("docs/manual/es/05-purchasing/27-expenses.md:5");
    expect(report).toContain("1 texto más cambió y no aparece en el manual");
    expect(report).toContain("seed.ts");
    expect(report).toContain("retoma todas las capturas");
    expect(report).not.toContain("expenses-list");
  });

  it("si nada del manual depende de lo que cambió, lo dice en una línea", () => {
    expect(
      buildReport({ ...input, changedFiles: ["apps/api/src/main.ts"], textChanges: [] }).trim(),
    ).toBe("Nada del manual depende de lo que cambió desde origin/main.");
  });
});
