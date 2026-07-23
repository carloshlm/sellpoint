import { act, render, screen } from "@testing-library/react";
import { I18nextProvider, useTranslation } from "react-i18next";
import { createI18n } from "./index";

function WelcomeProbe() {
  const { t } = useTranslation();
  return <p data-testid="welcome-probe">{t("common.welcome")}</p>;
}

function MissingKeyProbe() {
  const { t } = useTranslation();
  return <p data-testid="missing-key-probe">{t("common.nope")}</p>;
}

describe("i18n wiring", () => {
  afterEach(() => {
    localStorage.clear();
  });

  it("renderiza el texto en español por default (instancia sin detector)", () => {
    const i18n = createI18n();

    render(
      <I18nextProvider i18n={i18n}>
        <WelcomeProbe />
      </I18nextProvider>,
    );

    expect(screen.getByTestId("welcome-probe")).toHaveTextContent("Bienvenido a SellPoint");
  });

  it("cambia el texto renderizado tras changeLanguage('en')", async () => {
    const i18n = createI18n();

    render(
      <I18nextProvider i18n={i18n}>
        <WelcomeProbe />
      </I18nextProvider>,
    );

    await act(async () => {
      await i18n.changeLanguage("en");
    });

    expect(screen.getByTestId("welcome-probe")).toHaveTextContent("Welcome to SellPoint");
  });

  it("una clave inexistente no rompe: devuelve la clave (fallback default de i18next)", () => {
    const i18n = createI18n();

    render(
      <I18nextProvider i18n={i18n}>
        <MissingKeyProbe />
      </I18nextProvider>,
    );

    expect(screen.getByTestId("missing-key-probe")).toHaveTextContent("common.nope");
  });

  it("persiste el idioma elegido en localStorage cuando el detector está activo", async () => {
    const i18n = createI18n({ withDetector: true });

    await act(async () => {
      await i18n.changeLanguage("en");
    });

    expect(localStorage.getItem("sellpoint.locale")).toBe("en");
  });
});
