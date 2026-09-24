import { QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { I18nextProvider } from "react-i18next";
import { createI18n } from "@/i18n";
import { createQueryClient } from "@/lib/query-client";
import { LanguagePreference } from "./language-preference";

/**
 * F10-MANFIX-03 — «Ancho del papel de esta computadora» vive en la MISMA
 * tarjeta que el idioma («Mi perfil › Preferencias», Carlos 2026-08-26): las
 * dos son preferencias de la PERSONA en ESTE navegador, no del negocio. La
 * diferencia es dónde persisten —el idioma en la cuenta (PATCH `/me`) y el
 * ancho en `localStorage`, porque la impresora está conectada a esta
 * computadora, no a la cuenta— pero la ubicación en pantalla es una sola.
 *
 * No se re-prueba acá el selector de idioma: ya funciona y no se tocó.
 */
function renderCard() {
  return render(
    <QueryClientProvider client={createQueryClient()}>
      <I18nextProvider i18n={createI18n()}>
        <LanguagePreference />
      </I18nextProvider>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  localStorage.clear();
});

describe("Ancho del papel de esta computadora (F10-MANFIX-03)", () => {
  it("sin nada guardado, abre en 58 mm", () => {
    renderCard();

    expect(screen.getByLabelText(/ancho del papel/i)).toHaveValue("58mm");
  });

  it("con 80mm ya guardado en este navegador, abre en 80 mm", () => {
    localStorage.setItem("sellpoint.ticketWidth", "80mm");

    renderCard();

    expect(screen.getByLabelText(/ancho del papel/i)).toHaveValue("80mm");
  });

  it("elegir 80 mm lo guarda en localStorage", async () => {
    const user = userEvent.setup();
    renderCard();

    await user.selectOptions(screen.getByLabelText(/ancho del papel/i), "80mm");

    expect(localStorage.getItem("sellpoint.ticketWidth")).toBe("80mm");
    expect(screen.getByLabelText(/ancho del papel/i)).toHaveValue("80mm");
  });

  it("ofrece exactamente 58 mm y 80 mm, nada más", () => {
    renderCard();

    const select = screen.getByLabelText(/ancho del papel/i);
    expect(select.querySelectorAll("option")).toHaveLength(2);
    expect(screen.getByRole("option", { name: "58 mm" })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: "80 mm" })).toBeInTheDocument();
  });
});
