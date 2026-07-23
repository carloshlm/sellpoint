import { ReactQueryDevtools } from "@tanstack/react-query-devtools";
import { createRootRoute, Link, Outlet } from "@tanstack/react-router";

export const Route = createRootRoute({
  component: RootLayout,
});

function RootLayout() {
  return (
    <>
      <nav className="flex gap-4 border-b p-4">
        <Link to="/" className="[&.active]:font-bold">
          Inicio
        </Link>
        <Link to="/login" className="[&.active]:font-bold">
          Login
        </Link>
      </nav>
      <Outlet />
      {import.meta.env.DEV && <ReactQueryDevtools buttonPosition="bottom-right" />}
    </>
  );
}
