import { describe, expect, it } from "vitest";
import {
  featureGates,
  matchRoute,
  parentRoutes,
  parseRouteTree,
  routesReachedBy,
} from "./routes.js";

/** Un pedazo de `routeTree.gen.ts` con la misma forma que genera TanStack Router. */
const TREE = `/* eslint-disable */
// @ts-nocheck
import { Route as rootRouteImport } from './routes/__root'
import { Route as IndexRouteImport } from './routes/index'
import { Route as ExpensesIndexRouteImport } from './routes/expenses.index'
import { Route as ExpensesNewRouteImport } from './routes/expenses.new'
import { Route as ExpensesExpenseIdRouteImport } from './routes/expenses.$expenseId'
import { Route as CatalogProductsQuickRouteImport } from './routes/catalog.products_.quick'

export interface FileRoutesByFullPath {
  '/': typeof IndexRoute
  '/expenses/$expenseId': typeof ExpensesExpenseIdRoute
  '/expenses/new': typeof ExpensesNewRoute
  '/expenses/': typeof ExpensesIndexRoute
  '/catalog/products/quick': typeof CatalogProductsQuickRoute
}
export interface FileRoutesByTo {
  '/': typeof IndexRoute
}

declare module '@tanstack/react-router' {
  interface FileRoutesByPath {
    '/': {
      id: '/'
      path: '/'
      fullPath: '/'
      preLoaderRoute: typeof IndexRouteImport
      parentRoute: typeof rootRouteImport
    }
    '/expenses/': {
      id: '/expenses/'
      path: '/expenses'
      fullPath: '/expenses/'
      preLoaderRoute: typeof ExpensesIndexRouteImport
      parentRoute: typeof rootRouteImport
    }
    '/expenses/new': {
      id: '/expenses/new'
      path: '/expenses/new'
      fullPath: '/expenses/new'
      preLoaderRoute: typeof ExpensesNewRouteImport
      parentRoute: typeof rootRouteImport
    }
    '/expenses/$expenseId': {
      id: '/expenses/$expenseId'
      path: '/expenses/$expenseId'
      fullPath: '/expenses/$expenseId'
      preLoaderRoute: typeof ExpensesExpenseIdRouteImport
      parentRoute: typeof rootRouteImport
    }
    '/catalog/products_/quick': {
      id: '/catalog/products_/quick'
      path: '/catalog/products/quick'
      fullPath: '/catalog/products/quick'
      preLoaderRoute: typeof CatalogProductsQuickRouteImport
      parentRoute: typeof rootRouteImport
    }
  }
}
`;

const ROUTES = parseRouteTree(TREE);
const PATHS = ROUTES.map((route) => route.fullPath);

describe("parseRouteTree", () => {
  it("lee cada ruta con el archivo que la dibuja", () => {
    expect(ROUTES).toEqual([
      { fullPath: "/", module: "routes/index" },
      { fullPath: "/expenses/$expenseId", module: "routes/expenses.$expenseId" },
      { fullPath: "/expenses/new", module: "routes/expenses.new" },
      { fullPath: "/expenses/", module: "routes/expenses.index" },
      { fullPath: "/catalog/products/quick", module: "routes/catalog.products_.quick" },
    ]);
  });

  it("dice qué pasa si el archivo ya no tiene la forma que espera", () => {
    expect(() => parseRouteTree("export const x = 1;\n")).toThrow(/FileRoutesByFullPath/);
  });
});

describe("matchRoute", () => {
  it("empata la ruta sin importar la diagonal final ni la query", () => {
    expect(matchRoute("/expenses", PATHS)).toBe("/expenses/");
    expect(matchRoute("/expenses/new?from=manual#top", PATHS)).toBe("/expenses/new");
    expect(matchRoute("/", PATHS)).toBe("/");
  });

  it("un $param es un comodín, pero una ruta fija gana", () => {
    expect(matchRoute("/expenses/0f5e", PATHS)).toBe("/expenses/$expenseId");
    expect(matchRoute("/expenses/new", PATHS)).toBe("/expenses/new");
  });

  it("devuelve null si la ruta no existe", () => {
    expect(matchRoute("/gastos", PATHS)).toBeNull();
    expect(matchRoute("/expenses/0f5e/edit", PATHS)).toBeNull();
  });
});

describe("routesReachedBy", () => {
  it("las rutas con $param a las que lleva un waitForURL", () => {
    expect(routesReachedBy(["\\/expenses\\/[^/]+$"], PATHS)).toEqual(["/expenses/$expenseId"]);
  });

  it("una regex que no empata no lleva a ningún lado", () => {
    expect(routesReachedBy(["\\/purchases\\/"], PATHS)).toEqual([]);
  });
});

describe("parentRoutes", () => {
  it("las rutas de más arriba, de la más cercana a la raíz", () => {
    expect(parentRoutes("/expenses/$expenseId", PATHS)).toEqual(["/expenses/"]);
    expect(parentRoutes("/catalog/products/quick", PATHS)).toEqual([]);
  });
});

describe("featureGates", () => {
  it("lee el feature de cada <FeatureGate> de una ruta", () => {
    const source = `
      import { FeatureGate } from "@/components/billing/feature-gate";
      function Page() {
        return (
          <AppLayout>
            <FeatureGate feature="movements">
              <ExitsScreen />
            </FeatureGate>
          </AppLayout>
        );
      }`;
    expect(featureGates(source)).toEqual(["movements"]);
  });

  it("una ruta sin candado no tiene features", () => {
    expect(featureGates("export const Route = createFileRoute('/profile')({});")).toEqual([]);
  });
});
