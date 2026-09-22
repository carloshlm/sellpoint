import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { I18nextProvider } from "react-i18next";
import { createI18n } from "@/i18n";
import { PasswordField } from "./password-field";

/** El campo de contraseña con el ojo: se escribe a ciegas, y se puede ver (Carlos, 2026-09-22). */
describe("PasswordField", () => {
  function renderCampo(props: Partial<React.ComponentProps<typeof PasswordField>> = {}) {
    return render(
      <I18nextProvider i18n={createI18n()}>
        <PasswordField label="Contraseña" {...props} />
      </I18nextProvider>,
    );
  }

  it("nace oculta y vacía, y el label enfoca el input", async () => {
    renderCampo();
    const campo = screen.getByLabelText("Contraseña");
    expect(campo).toHaveAttribute("type", "password");
    expect(campo).toHaveValue("");
    await userEvent.click(screen.getByText("Contraseña"));
    expect(campo).toHaveFocus();
  });

  it("el ojo muestra y vuelve a ocultar lo escrito, y dice lo que hace", async () => {
    renderCampo();
    const user = userEvent.setup();
    const campo = screen.getByLabelText("Contraseña");
    await user.type(campo, "mi clave larga");
    const ojo = screen.getByRole("button", { name: "Mostrar contraseña" });
    expect(ojo).toHaveAttribute("aria-pressed", "false");
    await user.click(ojo);
    expect(campo).toHaveAttribute("type", "text");
    expect(campo).toHaveValue("mi clave larga");
    expect(screen.getByRole("button", { name: "Ocultar contraseña" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    await user.click(screen.getByRole("button", { name: "Ocultar contraseña" }));
    expect(campo).toHaveAttribute("type", "password");
  });

  it("el ojo no envía el formulario ni roba el orden del teclado", async () => {
    const onSubmit = vi.fn((e: React.FormEvent) => e.preventDefault());
    render(
      <I18nextProvider i18n={createI18n()}>
        <form onSubmit={onSubmit}>
          <PasswordField label="Contraseña" />
          <button type="submit">Entrar</button>
        </form>
      </I18nextProvider>,
    );
    const ojo = screen.getByRole("button", { name: "Mostrar contraseña" });
    expect(ojo).toHaveAttribute("type", "button");
    await userEvent.click(ojo);
    expect(onSubmit).not.toHaveBeenCalled();
    // Con el teclado: del input se salta al ojo y luego al botón de enviar.
    const campo = screen.getByLabelText("Contraseña");
    campo.focus();
    await userEvent.tab();
    expect(ojo).toHaveFocus();
  });

  it("hint y error siguen funcionando como en TextField", () => {
    renderCampo({ hint: "Mínimo 12 caracteres", error: "Muy corta" });
    expect(screen.getByLabelText("Contraseña")).toHaveAttribute("aria-invalid", "true");
    expect(screen.getByRole("alert")).toHaveTextContent("Muy corta");
  });
});
