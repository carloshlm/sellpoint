import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { DateField } from "./date-field";

/** F9-EXP-12 — `DateField`: label asociado, error anunciado y el hint descrito. */
describe("DateField", () => {
  it("asocia la etiqueta al input de fecha", () => {
    render(<DateField label="Fecha del gasto" value="2026-09-10" onChange={() => {}} />);
    const input = screen.getByLabelText("Fecha del gasto");
    expect(input).toHaveAttribute("type", "date");
    expect(input).toHaveValue("2026-09-10");
    expect(input).not.toHaveAttribute("aria-invalid");
  });

  it("con error el input es inválido y el mensaje se anuncia como alerta", () => {
    render(<DateField label="Vence" error="La fecha no es válida." onChange={() => {}} />);
    const input = screen.getByLabelText("Vence");
    expect(input).toHaveAttribute("aria-invalid", "true");
    const alerta = screen.getByRole("alert");
    expect(alerta).toHaveTextContent("La fecha no es válida.");
    expect(input.getAttribute("aria-describedby")).toBe(alerta.id);
  });

  it("con hint el aria-describedby apunta al hint; min y max llegan al input", () => {
    render(
      <DateField
        label="Vence"
        hint="Opcional"
        min="2026-01-01"
        max="2026-12-31"
        onChange={() => {}}
      />,
    );
    const input = screen.getByLabelText("Vence");
    const hint = screen.getByText("Opcional");
    expect(input.getAttribute("aria-describedby")).toBe(hint.id);
    expect(input).toHaveAttribute("min", "2026-01-01");
    expect(input).toHaveAttribute("max", "2026-12-31");
  });
});
