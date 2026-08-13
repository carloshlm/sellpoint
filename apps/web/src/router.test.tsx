import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createMemoryHistory, createRouter, RouterProvider } from "@tanstack/react-router";
import { render, screen } from "@testing-library/react";
import { I18nextProvider } from "react-i18next";
import { createI18n } from "./i18n";
import { routeTree } from "./routeTree.gen";

async function renderRoute(path: string) {
  const router = createRouter({
    routeTree,
    history: createMemoryHistory({ initialEntries: [path] }),
  });
  await router.load();
  render(
    // Instancia hermética de i18n (sin detector → DEFAULT_LOCALE=es): el test
    // no depende del navigator.language de jsdom ni de localStorage.
    <I18nextProvider i18n={createI18n()}>
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
    expect(screen.getByTestId("tailwind-check")).toBeInTheDocument();
    expect(screen.getByTestId("shadcn-check")).toHaveTextContent("Click");
    expect(screen.getByTestId("i18n-check")).toHaveTextContent("Bienvenido a SellPoint");
  });

  it("la ruta /login renderiza el form real de inicio de sesión", async () => {
    await renderRoute("/login");

    expect(await screen.findByRole("button", { name: "Entrar" })).toBeInTheDocument();
    expect(screen.getByLabelText("Email")).toBeInTheDocument();
    expect(screen.getByLabelText("Contraseña")).toBeInTheDocument();
  });
});
