import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { I18nextProvider, useTranslation } from "react-i18next";
import { createI18n } from "@/i18n";
import { LanguageSwitcher } from "./language-switcher";

/**
 * Selector de idioma de las pantallas PÚBLICAS (decisión de Carlos,
 * 2026-08-16): la persona llega a `/login` o `/register` en inglés y tiene
 * que poder pasar a español ANTES de registrarse — el idioma elegido acá es
 * el que `register.tsx` manda como `locale` de la cuenta nueva.
 *
 * Se monta con la instancia CON detector porque el arranque en inglés y la
 * persistencia de la elección son parte de lo que se está verificando.
 */
function Probe() {
  const { t } = useTranslation();
  return <p data-testid="probe">{t("common.welcome")}</p>;
}

function renderSwitcher() {
  const i18n = createI18n({ withDetector: true });
  render(
    <I18nextProvider i18n={i18n}>
      <LanguageSwitcher />
      <Probe />
    </I18nextProvider>,
  );
}

describe("LanguageSwitcher", () => {
  afterEach(() => {
    localStorage.clear();
  });

  it("cambia el idioma de la pantalla y mueve la marca de activo", async () => {
    renderSwitcher();
    expect(screen.getByTestId("probe")).toHaveTextContent("Welcome to SellPoint");
    expect(screen.getByRole("button", { name: "English" })).toHaveAttribute("aria-pressed", "true");

    await userEvent.click(screen.getByRole("button", { name: "Español" }));

    expect(screen.getByTestId("probe")).toHaveTextContent("Bienvenido a SellPoint");
    expect(screen.getByRole("button", { name: "Español" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: "English" })).toHaveAttribute(
      "aria-pressed",
      "false",
    );
  });

  it("persiste la elección para la próxima visita", async () => {
    renderSwitcher();

    await userEvent.click(screen.getByRole("button", { name: "Español" }));

    expect(localStorage.getItem("sellpoint.locale")).toBe("es");
  });
});
