import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createMemoryHistory, createRouter, RouterProvider } from "@tanstack/react-router";
import { render, screen } from "@testing-library/react";
import { I18nextProvider } from "react-i18next";
import { createI18n } from "./i18n";
import { routeTree } from "./routeTree.gen";

async function renderRoute(path: string, lng?: "es" | "en") {
  const router = createRouter({
    routeTree,
    history: createMemoryHistory({ initialEntries: [path] }),
  });
  await router.load();
  // Instancia hermética de i18n (sin detector → DEFAULT_LOCALE=es): el test
  // no depende del navigator.language de jsdom ni de localStorage.
  const i18n = createI18n();
  if (lng) {
    await i18n.changeLanguage(lng);
  }
  render(
    <I18nextProvider i18n={i18n}>
      <QueryClientProvider client={new QueryClient()}>
        <RouterProvider router={router} />
      </QueryClientProvider>
    </I18nextProvider>,
  );
  return router;
}

describe("Router", () => {
  it("la ruta / renderiza la home con los canarios de integración", async () => {
    await renderRoute("/");

    expect(await screen.findByTestId("shared-import")).toHaveTextContent("$1,234.56");
    expect(screen.getByTestId("tailwind-check")).toHaveTextContent("Tailwind activo");
    expect(screen.getByTestId("shadcn-check")).toHaveTextContent("Probar");
    expect(screen.getByTestId("i18n-check")).toHaveTextContent("Bienvenido a SellPoint");
  });

  /**
   * S1 del verify: la home es ruta PÚBLICA (200 en producción) y tenía 3
   * strings clavados en español. Renderizarla en inglés es la única forma de
   * probar que salen de `t()`: en español el texto traducido y el hardcodeado
   * se ven idénticos, así que un test en español solo pasa por casualidad.
   */
  it("la home no tiene copy hardcodeado: en inglés se traduce entera", async () => {
    await renderRoute("/", "en");

    expect(await screen.findByTestId("shared-import")).toHaveTextContent("Demo total:");
    expect(screen.getByTestId("tailwind-check")).toHaveTextContent("Tailwind is live");
    expect(screen.getByTestId("shadcn-check")).toHaveTextContent("Try it");
    expect(screen.getByTestId("i18n-check")).toHaveTextContent("Welcome to SellPoint");
  });

  it("la ruta /login renderiza el form real de inicio de sesión", async () => {
    await renderRoute("/login");

    expect(await screen.findByRole("button", { name: "Entrar" })).toBeInTheDocument();
    expect(screen.getByLabelText("Email")).toBeInTheDocument();
    expect(screen.getByLabelText("Contraseña")).toBeInTheDocument();
  });
});
