import { createMemoryHistory, createRouter, RouterProvider } from "@tanstack/react-router";
import { render, screen } from "@testing-library/react";
import { routeTree } from "./routeTree.gen";

async function renderRoute(path: string) {
  const router = createRouter({
    routeTree,
    history: createMemoryHistory({ initialEntries: [path] }),
  });
  await router.load();
  render(<RouterProvider router={router} />);
  return router;
}

describe("Router", () => {
  it("la ruta / renderiza el landing", async () => {
    await renderRoute("/");

    expect(await screen.findByTestId("shared-import")).toBeInTheDocument();
  });

  it("la ruta /login renderiza el placeholder", async () => {
    await renderRoute("/login");

    expect(await screen.findByTestId("login-title")).toHaveTextContent("Login");
  });
});
