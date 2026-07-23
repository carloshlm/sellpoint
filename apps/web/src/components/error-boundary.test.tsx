import { render, screen } from "@testing-library/react";
import { ErrorBoundary } from "./error-boundary";

function Bomb(): never {
  throw new Error("explotó");
}

describe("ErrorBoundary", () => {
  it("renderiza los hijos cuando no hay error", () => {
    render(
      <ErrorBoundary>
        <p data-testid="contenido">todo bien</p>
      </ErrorBoundary>,
    );

    expect(screen.getByTestId("contenido")).toBeInTheDocument();
  });

  it("muestra el fallback cuando un hijo lanza", () => {
    // silencia el error esperado que React loguea en consola
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});

    render(
      <ErrorBoundary>
        <Bomb />
      </ErrorBoundary>,
    );

    expect(screen.getByTestId("error-fallback")).toBeInTheDocument();
    spy.mockRestore();
  });
});
