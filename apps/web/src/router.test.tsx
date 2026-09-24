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
  // Instancia hermética de i18n (sin detector → DEFAULT_LOCALE=es): el test
  // no depende del navigator.language de jsdom ni de localStorage.
  render(
    <I18nextProvider i18n={createI18n()}>
      <QueryClientProvider client={new QueryClient()}>
        <RouterProvider router={router} />
      </QueryClientProvider>
    </I18nextProvider>,
  );
  return router;
}

/**
 * La home de la Fase 0 y sus cuatro canarios (shared, Tailwind, shadcn e
 * i18n) se retiraron con F10-MANFIX-09: `/` redirige al panel (lo prueba
 * `auth-flows.test.tsx`). El cableado que vigilaban lo prueban las pantallas
 * reales (shared y shadcn), `i18n/i18n.test.tsx` (i18n) y
 * `lib/theme/themes.test.ts` (los tokens de Tailwind; jsdom no calcula CSS).
 */
describe("Router", () => {
  it("la ruta /login renderiza el form real de inicio de sesión", async () => {
    await renderRoute("/login");

    expect(await screen.findByRole("button", { name: "Entrar" })).toBeInTheDocument();
    expect(screen.getByLabelText("Email")).toBeInTheDocument();
    expect(screen.getByLabelText("Contraseña")).toBeInTheDocument();
  });
});
