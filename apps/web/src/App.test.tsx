import { render, screen } from "@testing-library/react";
import App from "./App";

describe("App", () => {
  it("renderiza el landing con el import de shared funcionando", () => {
    render(<App />);

    expect(screen.getByTestId("shared-import")).toHaveTextContent("$1,234.56");
    expect(screen.getByTestId("tailwind-check")).toBeInTheDocument();
  });

  it("renderiza el Button de shadcn", () => {
    render(<App />);

    expect(screen.getByTestId("shadcn-check")).toHaveTextContent("Click");
  });
});
