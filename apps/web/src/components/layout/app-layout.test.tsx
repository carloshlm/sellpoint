import { readFileSync } from "node:fs";
import { join } from "node:path";
import { QueryClientProvider } from "@tanstack/react-query";
import { createMemoryHistory, createRouter, RouterProvider } from "@tanstack/react-router";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { I18nextProvider } from "react-i18next";
import { createI18n } from "@/i18n";
import { createQueryClient } from "@/lib/query-client";
import { routeTree } from "@/routeTree.gen";
import { type AuthUser, useAuthStore } from "@/stores/auth.store";
import { SUBSCRIPTION_PLUS } from "@/test/subscription-fixture";

/**
 * BARRERA de layout: el contenedor del contenido puede ENCOGER.
 *
 * **Honestidad sobre su alcance (medido en navegador, 2026-08-20):** esto NO
 * es lo que arregla un desborde en celular hoy. Se midió la estructura real
 * con el CSS del proyecto a 390 px, con `min-w-0` y sin él: el `<main>` da 390
 * en los dos casos. La razón es que `main` es hijo de un flex COLUMNA, y ahí
 * `min-width: auto` no aplica al eje horizontal — el `min-w-0` que de verdad
 * importa ya lo tiene la columna (hijo del flex raíz, que sí es fila).
 *
 * Entonces, ¿para qué la barrera? Porque el día que alguien convierta esa
 * columna en fila, o mueva el `<main>` bajo otro flex horizontal, el
 * `min-width: auto` VUELVE a aplicar y la página entera se desborda de nuevo:
 * el `<main>` se niega a ser más angosto que su tabla más ancha. Es un
 * guardarraíl contra una refactorización futura, no un parche de hoy.
 *
 * La lección ya estaba escrita en `routes/catalog.schema.tsx` para las
 * tarjetas del grid: el conocimiento existía, la barrera no.
 */
const LAYOUT = join(__dirname, "app-layout.tsx");

describe("layout que encoge (LEY de responsive)", () => {
  it("el <main> del layout puede encoger: sin min-w-0 la página se desborda", () => {
    const contenido = readFileSync(LAYOUT, "utf-8");
    // `<main` a principio de etiqueta, no la palabra suelta: el propio
    // comentario del archivo la menciona y agarrarlo daría un falso rojo.
    const main = contenido.split("\n").find((linea) => /<main\s/.test(linea));

    expect(main).toBeDefined();
    expect(main).toContain("min-w-0");
  });

  /**
   * El contenedor de la columna también: es hijo del flex raíz.
   *
   * El selector busca un `<div` con `flex-1` y `flex-col`, no CUALQUIER línea
   * que los tenga: el 2026-08-22 el `<nav>` del menú ganó `flex-1 flex-col`
   * (para poder desplazarse) y, por estar antes en el archivo, se convirtió en
   * el primer match — este test se puso rojo señalando un elemento que no es
   * el que vigila. Un selector que agarra "la primera línea que se parezca"
   * mide lo que encuentra, no lo que le importa.
   */
  it("la columna que contiene header y main también encoge", () => {
    const contenido = readFileSync(LAYOUT, "utf-8");
    const columna = contenido
      .split("\n")
      .find(
        (linea) => /<div\s/.test(linea) && linea.includes("flex-1") && linea.includes("flex-col"),
      );

    expect(columna).toBeDefined();
    expect(columna).toContain("min-w-0");
  });

  /**
   * BLINDAJE, no diagnóstico. Carlos reportó que la página entera se desliza
   * de lado en su celular; se midió la estructura a 390 px con el CSS real y
   * NO se reprodujo, así que el elemento culpable sigue sin identificarse.
   *
   * En vez de un cuarto intento a ciegas, `overflow-x-hidden` en el `<main>`
   * hace la clase entera IMPOSIBLE: pase lo que pase adentro, la página no
   * arrastra el menú de lado. Es seguro porque todo lo ancho que tenemos
   * (las tablas) ya vive en su propia caja con scroll — nada queda
   * inaccesible, solo deja de empujar.
   */
  it("el <main> no deja que la página se deslice de lado", () => {
    const contenido = readFileSync(LAYOUT, "utf-8");
    const main = contenido.split("\n").find((linea) => /<main\s/.test(linea));

    expect(main).toContain("overflow-x-hidden");
  });
});

/**
 * El logotipo del sidebar (Carlos, 2026-09-06).
 *
 * Dos archivos, uno por familia de tema, porque el logotipo es un círculo
 * MACIZO: el negro desaparece sobre un sidebar oscuro y el blanco sobre uno
 * claro. Se resuelve con las dos variantes en el DOM y `dark:` decidiendo
 * cuál se ve — el tema se aplica con la clase `.dark` en <html>
 * (`lib/theme/apply-theme.ts`), no con `prefers-color-scheme`, así que
 * `<picture media>` no serviría.
 *
 * jsdom no calcula layout: acá se fija QUÉ está en el DOM y con qué nombre
 * accesible. Que se VEA bien se verifica en el navegador.
 */
const usuarioDemo = (): AuthUser => ({
  id: "u1",
  email: "ana@acme.mx",
  firstName: "Ana",
  lastNamePaternal: "Pérez",
  lastNameMaternal: null,
  locale: "es",
  permissions: [],
  subscription: SUBSCRIPTION_PLUS,
  tenant: {
    id: "t1",
    name: "Acme",
    legalName: null,
    taxId: null,
    phone: null,
    theme: null,
    address: null,
    timezone: "America/Mexico_City",
    currency: "MXN",
    templateChoice: null,
    country: "MX",
    onboarded: true,
    sellWithoutStock: false,
    usesLocations: false,
    posShowsStock: true,
    monthlySalesGoal: null,
  },
});

async function renderLayout() {
  useAuthStore.getState().setAuth("jwt-demo", usuarioDemo());
  const router = createRouter({
    routeTree,
    history: createMemoryHistory({ initialEntries: ["/dashboard"] }),
  });
  await router.load();
  render(
    <I18nextProvider i18n={createI18n()}>
      <QueryClientProvider client={createQueryClient()}>
        <RouterProvider router={router} />
      </QueryClientProvider>
    </I18nextProvider>,
  );
  return await screen.findByRole("complementary");
}

afterEach(() => {
  useAuthStore.getState().clearAuth();
});

describe("el logotipo del sidebar", () => {
  it("expandido: la palabra «SellPointy» y el logotipo a la derecha del recuadro", async () => {
    const sidebar = await renderLayout();
    const encabezado = within(sidebar).getByTestId("sidebar-brand");

    expect(within(encabezado).getByText("SellPointy")).toBeVisible();
    // `justify-between` es lo que manda el logotipo al extremo derecho.
    expect(encabezado.className).toContain("justify-between");
    expect(within(encabezado).getAllByRole("presentation", { hidden: true }).length).toBe(2);
  });

  it("contraído: el logotipo REEMPLAZA a «SP», y con nombre accesible", async () => {
    const sidebar = await renderLayout();
    const usuario = userEvent.setup();

    await usuario.click(screen.getByRole("button", { name: "Abrir o cerrar el menú" }));

    const encabezado = within(sidebar).getByTestId("sidebar-brand");
    expect(within(encabezado).queryByText("SP")).not.toBeInTheDocument();
    expect(within(encabezado).queryByText("SellPointy")).not.toBeInTheDocument();
    // Sin texto al lado, el logotipo deja de ser decorativo y NOMBRA la marca.
    expect(within(encabezado).getAllByAltText("SellPointy")).toHaveLength(2);
  });

  it("cada tema tiene su archivo: el claro se esconde en oscuro y al revés", async () => {
    const sidebar = await renderLayout();
    const encabezado = within(sidebar).getByTestId("sidebar-brand");
    const logos = within(encabezado).getAllByRole("presentation", { hidden: true });

    const claro = logos.find((l) => l.getAttribute("src")?.includes("logo-light"));
    const oscuro = logos.find((l) => l.getAttribute("src")?.includes("logo-dark"));
    expect(claro?.className).toContain("dark:hidden");
    expect(oscuro?.className).toContain("hidden");
    expect(oscuro?.className).toContain("dark:block");
  });
});
