import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createMemoryHistory, createRouter, RouterProvider } from "@tanstack/react-router";
import { render, screen } from "@testing-library/react";
import { routeTree } from "./routeTree.gen";

async function renderRoute(path: string) {
  const router = createRouter({
    routeTree,
    history: createMemoryHistory({ initialEntries: [path] }),
  });
  await router.load();
  render(
    <QueryClientProvider client={new QueryClient()}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
  return router;
}

describe("Router", () => {
  it("la ruta / renderiza la home con los canarios de integración", async () => {
    await renderRoute("/");

    expect(await screen.findByTestId("shared-import")).toHaveTextContent("$1,234.56");
    expect(screen.getByTestId("tailwind-check")).toBeInTheDocument();
    expect(screen.getByTestId("shadcn-check")).toHaveTextContent("Click");
  });

  it("la ruta /login renderiza el placeholder", async () => {
    await renderRoute("/login");

    expect(await screen.findByTestId("login-title")).toHaveTextContent("Login");
  });
});
