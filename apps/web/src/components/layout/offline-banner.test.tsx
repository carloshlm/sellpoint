import { render, screen } from "@testing-library/react";
import { act } from "react";
import { I18nextProvider } from "react-i18next";
import { createI18n } from "@/i18n";
import { OfflineBanner } from "./offline-banner";

/**
 * F4-PWA-01 — el aviso de sin conexión.
 *
 * Lo que se protege no es que aparezca un banner: es que diga **qué no se
 * puede hacer**. La app abre sin red porque el worker guarda el cascarón, así
 * que el cajero ve la pantalla de venta completa y teclea sin que pase nada.
 * Un aviso que solo informa el estado lo deja deduciendo las consecuencias, y
 * en un mostrador con gente esperando nadie deduce nada.
 */
function renderBanner() {
  render(
    <I18nextProvider i18n={createI18n()}>
      <OfflineBanner />
    </I18nextProvider>,
  );
}

function setOnline(value: boolean) {
  Object.defineProperty(navigator, "onLine", { value, configurable: true });
}

describe("OfflineBanner (F4-PWA-01)", () => {
  afterEach(() => setOnline(true));

  it("con red no se pinta nada", () => {
    setOnline(true);
    renderBanner();

    expect(screen.queryByTestId("offline-banner")).not.toBeInTheDocument();
  });

  /**
   * ⚠ Si la pestaña se abre YA sin red, ningún evento `offline` va a
   * dispararse nunca. Sin leer `navigator.onLine` al montar, el aviso no
   * aparecería jamás — justo en el caso que más importa.
   */
  it("si arranca sin red, avisa de entrada", () => {
    setOnline(false);
    renderBanner();

    expect(screen.getByTestId("offline-banner")).toBeInTheDocument();
  });

  it("dice qué NO se puede hacer, no solo que no hay conexión", () => {
    setOnline(false);
    renderBanner();

    const aviso = screen.getByRole("alert");
    expect(aviso).toHaveTextContent(/cobrar/i);
    expect(aviso).toHaveTextContent(/cotizar/i);
  });

  it("reacciona a perder y recuperar la red sin recargar", () => {
    setOnline(true);
    renderBanner();

    act(() => {
      setOnline(false);
      window.dispatchEvent(new Event("offline"));
    });
    expect(screen.getByTestId("offline-banner")).toBeInTheDocument();

    act(() => {
      setOnline(true);
      window.dispatchEvent(new Event("online"));
    });
    expect(screen.queryByTestId("offline-banner")).not.toBeInTheDocument();
  });
});
