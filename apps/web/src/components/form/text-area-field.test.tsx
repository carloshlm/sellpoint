import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { TextAreaField } from "./text-area-field";

/** F9-CLINIC-WEB-02 — el gemelo de `TextField` para texto largo. */
describe("TextAreaField", () => {
  it("el label enfoca el textarea y el hint se anuncia", async () => {
    render(<TextAreaField label="Motivo" hint="En palabras del paciente." rows={4} />);
    const campo = screen.getByLabelText("Motivo");
    expect(campo.tagName).toBe("TEXTAREA");
    expect(campo).toHaveAttribute("rows", "4");
    expect(campo).toHaveAccessibleDescription("En palabras del paciente.");
    await userEvent.click(screen.getByText("Motivo"));
    expect(campo).toHaveFocus();
  });

  it("con error queda inválido, el mensaje sale por alert y el hint se retira", () => {
    render(<TextAreaField label="Motivo" hint="Ayuda" error="Escribe el motivo." />);
    const campo = screen.getByLabelText("Motivo");
    expect(campo).toHaveAttribute("aria-invalid", "true");
    expect(screen.getByRole("alert")).toHaveTextContent("Escribe el motivo.");
    expect(screen.queryByText("Ayuda")).not.toBeInTheDocument();
  });
});
