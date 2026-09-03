import { render, screen, waitFor } from "@testing-library/react";
import { StrictMode } from "react";
import { I18nextProvider } from "react-i18next";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createI18n } from "@/i18n";
import { PrintTicketButton } from "./print-ticket-button";

vi.mock("@/lib/pos/api", () => ({
  printTicket: vi.fn().mockResolvedValue(undefined),
}));

const api = vi.mocked(await import("@/lib/pos/api"));

function renderBoton(autoPrint: boolean) {
  render(
    <StrictMode>
      <I18nextProvider i18n={createI18n()}>
        <PrintTicketButton kind="sale" id="sale-9" folio="VTA-000009" autoPrint={autoPrint} />
      </I18nextProvider>
    </StrictMode>,
  );
}

/**
 * Con `autoPrint` el ticket sale al montar, UNA vez: StrictMode monta dos
 * veces y la térmica no lo sabe (mismo cuidado que el papel del turno).
 */
describe("PrintTicketButton", () => {
  beforeEach(() => {
    api.printTicket.mockReset();
    api.printTicket.mockResolvedValue(undefined);
  });

  it("con autoPrint imprime una sola vez aunque React monte dos veces", async () => {
    renderBoton(true);
    await waitFor(() =>
      expect(api.printTicket).toHaveBeenCalledWith("sale", "sale-9", "VTA-000009", undefined),
    );
    expect(api.printTicket).toHaveBeenCalledTimes(1);
  });

  it("sin autoPrint no imprime nada hasta el clic", async () => {
    renderBoton(false);
    expect(await screen.findByRole("button", { name: "Imprimir ticket" })).toBeInTheDocument();
    expect(api.printTicket).not.toHaveBeenCalled();
  });

  it("si la impresión automática falla, lo dice", async () => {
    api.printTicket.mockRejectedValue(new Error("bloqueado"));
    renderBoton(true);
    expect(await screen.findByRole("alert")).toHaveTextContent(/No pudimos abrir el ticket/);
  });
});
