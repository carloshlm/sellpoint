import { describe, expect, it } from "vitest";
import { effectiveDocumentDate, effectiveDocumentDateField } from "./document-date";

/**
 * Carlos (2026-09-02): «¿la fecha de un movimiento es la de abrir el folio o
 * la de asentarlo?». Era la de abrir, en todas partes. La decisión: la fecha
 * de un documento es la de su ESTADO ACTUAL — abierto, asentado o cancelado—
 * y la misma función decide en el API (filtro, PDF) y en el web (columna).
 */
describe("effectiveDocumentDate", () => {
  const base = {
    createdAt: "2026-09-01T10:00:00.000Z",
    confirmedAt: "2026-09-03T17:40:00.000Z",
    canceledAt: "2026-09-04T09:00:00.000Z",
  };

  it("un borrador vale por su apertura", () => {
    expect(effectiveDocumentDate({ ...base, status: "draft" })).toBe(base.createdAt);
  });

  it("un confirmado vale por su asiento", () => {
    expect(effectiveDocumentDate({ ...base, status: "confirmed" })).toBe(base.confirmedAt);
  });

  it("un cancelado vale por su cancelación", () => {
    expect(effectiveDocumentDate({ ...base, status: "canceled" })).toBe(base.canceledAt);
  });

  it("si la columna del estado viene vacía (dato legado), cae a la apertura", () => {
    expect(effectiveDocumentDate({ ...base, status: "confirmed", confirmedAt: null })).toBe(
      base.createdAt,
    );
  });

  it("sirve igual con Date, que es lo que maneja el API", () => {
    const abierto = new Date("2026-09-01T10:00:00.000Z");
    const asentado = new Date("2026-09-03T17:40:00.000Z");

    expect(
      effectiveDocumentDate({
        status: "confirmed",
        createdAt: abierto,
        confirmedAt: asentado,
        canceledAt: null,
      }),
    ).toBe(asentado);
  });

  it("el campo por estado es lo que el filtro del API necesita", () => {
    expect(effectiveDocumentDateField("draft")).toBe("createdAt");
    expect(effectiveDocumentDateField("confirmed")).toBe("confirmedAt");
    expect(effectiveDocumentDateField("canceled")).toBe("canceledAt");
  });
});
