import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/api", () => ({ api: { get: vi.fn() } }));
vi.mock("@/lib/download", () => ({ imprimirPdf: vi.fn() }));

const { api } = vi.mocked(await import("@/lib/api"));
const download = vi.mocked(await import("@/lib/download"));
const { printTurnTicket } = await import("./api");

/**
 * F10-MANFIX-03 — el papel del turno de Recepción es el mismo caso que el
 * ticket del POS (`lib/pos/print-ticket.test.ts`): sin `width` explícito,
 * el default deja de ser el literal "58mm" y pasa a leer la preferencia de
 * ESTA computadora (`sellpoint.ticketWidth`, `lib/ticket-width.ts`).
 */
describe("printTurnTicket", () => {
  const blob = new Blob(["%PDF"]);
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    vi.mocked(api.get).mockResolvedValue({ data: blob });
  });

  it("sin ajuste guardado, manda 58mm", async () => {
    await printTurnTicket("t1", 6);

    expect(api.get).toHaveBeenCalledWith("/reception/turns/t1/ticket", {
      responseType: "blob",
      params: { width: "58mm" },
    });
    expect(download.imprimirPdf).toHaveBeenCalledWith(blob, "turno-6.pdf");
  });

  it("sin `width` explícito, manda el ancho elegido en esta computadora", async () => {
    localStorage.setItem("sellpoint.ticketWidth", "80mm");

    await printTurnTicket("t1", 6);

    expect(api.get).toHaveBeenCalledWith("/reception/turns/t1/ticket", {
      responseType: "blob",
      params: { width: "80mm" },
    });
  });

  it("un `width` explícito manda a ese, no al guardado", async () => {
    localStorage.setItem("sellpoint.ticketWidth", "80mm");

    await printTurnTicket("t1", 6, "58mm");

    expect(api.get).toHaveBeenCalledWith("/reception/turns/t1/ticket", {
      responseType: "blob",
      params: { width: "58mm" },
    });
  });
});
