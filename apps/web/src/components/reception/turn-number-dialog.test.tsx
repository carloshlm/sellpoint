import { render, screen, waitFor } from "@testing-library/react";
import { StrictMode } from "react";
import { I18nextProvider } from "react-i18next";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createI18n } from "@/i18n";
import type { Turn } from "@/lib/reception/api";
import { TurnNumberDialog } from "./turn-number-dialog";

vi.mock("@/lib/reception/api", () => ({
  printTurnTicket: vi.fn().mockResolvedValue(undefined),
}));

const api = vi.mocked(await import("@/lib/reception/api"));

const turn: Turn = {
  id: "t9",
  number: 9,
  businessDate: "2026-09-02",
  customerId: null,
  customerName: null,
  status: "waiting",
  attendedAt: null,
  createdAt: "2026-09-03T01:05:00.000Z",
};

/**
 * El papel sale UNA vez al abrir. Bajo StrictMode (el dev server) React
 * monta, desmonta y vuelve a montar: sin guarda, la térmica escupía dos
 * papeles por turno (visto en el navegador, 2026-09-02).
 */
describe("TurnNumberDialog", () => {
  beforeEach(() => api.printTurnTicket.mockClear());

  it("imprime una sola vez aunque React monte el diálogo dos veces", async () => {
    render(
      <StrictMode>
        <I18nextProvider i18n={createI18n()}>
          <TurnNumberDialog turn={turn} onClose={vi.fn()} />
        </I18nextProvider>
      </StrictMode>,
    );
    expect(await screen.findByTestId("turn-number")).toHaveTextContent("9");
    await waitFor(() => expect(api.printTurnTicket).toHaveBeenCalledWith("t9", 9));
    expect(api.printTurnTicket).toHaveBeenCalledTimes(1);
  });
});
