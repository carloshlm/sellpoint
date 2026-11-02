import { describe, expect, it } from "vitest";
import {
  documentRejectsPastExpiry,
  isLotExpiryPast,
  isLotExpiryYearInRange,
  LOT_EXPIRY_MAX_DATE,
  LOT_EXPIRY_MIN_DATE,
  lotExpiryIsoDate,
  lotExpiryProblem,
  lotExpiryToday,
  lotExpiryTodayIso,
  rejectsPastExpiry,
} from "./lot-expiry";

/**
 * La caducidad de un lote (Carlos, 2026-11-02): un año fuera de 2000–2099 es
 * un error de captura, y una entrada de mercancía no trae algo ya caducado.
 *
 * Origen: el lote de «Materna c/30 tabletas» se guardó con 0027-10-01 porque
 * en el campo de fecha se tecleó solo «27» en el año.
 */
describe("lotExpiryToday", () => {
  it("es la medianoche UTC del instante, el mismo corte que el «Vencido» del stock", () => {
    // 23:30 en CDMX del 1 de noviembre ya es 2 de noviembre en UTC: la
    // caducidad se compara contra una columna DATE, y el corte es UTC.
    const instante = new Date(Date.UTC(2026, 10, 2, 5, 30));
    expect(lotExpiryToday(instante).toISOString()).toBe("2026-11-02T00:00:00.000Z");
    expect(lotExpiryTodayIso(instante)).toBe("2026-11-02");
  });

  it("no modifica el instante que recibe", () => {
    const instante = new Date(Date.UTC(2026, 10, 2, 15, 0));
    lotExpiryToday(instante);
    expect(instante.toISOString()).toBe("2026-11-02T15:00:00.000Z");
  });
});

describe("isLotExpiryYearInRange", () => {
  it("rechaza el año que deja el campo de fecha cuando se teclean dos cifras", () => {
    expect(isLotExpiryYearInRange("0027-10-01")).toBe(false);
    expect(isLotExpiryYearInRange(new Date("0027-10-01"))).toBe(false);
  });

  it("acepta 2000 y 2099, y rechaza lo que queda justo afuera", () => {
    expect(isLotExpiryYearInRange(LOT_EXPIRY_MIN_DATE)).toBe(true);
    expect(isLotExpiryYearInRange(LOT_EXPIRY_MAX_DATE)).toBe(true);
    expect(isLotExpiryYearInRange("1999-12-31")).toBe(false);
    expect(isLotExpiryYearInRange("2100-01-01")).toBe(false);
  });

  it("acepta una fecha guardada (DATE de Postgres) dentro del rango", () => {
    expect(isLotExpiryYearInRange(new Date("2027-10-01"))).toBe(true);
  });

  it("rechaza lo que no es una fecha", () => {
    expect(isLotExpiryYearInRange("mañana")).toBe(false);
    expect(isLotExpiryYearInRange(new Date(Number.NaN))).toBe(false);
  });
});

describe("isLotExpiryPast", () => {
  const ahora = new Date(Date.UTC(2026, 10, 2, 15, 0));

  it("ayer ya pasó; hoy y mañana no", () => {
    // El día que caduca, el lote todavía sirve: es el mismo criterio de FEFO
    // y de la pestaña de existencias.
    expect(isLotExpiryPast("2026-11-01", ahora)).toBe(true);
    expect(isLotExpiryPast("2026-11-02", ahora)).toBe(false);
    expect(isLotExpiryPast("2026-11-03", ahora)).toBe(false);
  });

  it("acepta la fecha como texto o como DATE guardada", () => {
    expect(isLotExpiryPast(new Date("2026-11-01"), ahora)).toBe(true);
    expect(isLotExpiryPast(new Date("2026-11-02"), ahora)).toBe(false);
  });
});

describe("lotExpiryProblem", () => {
  const ahora = new Date(Date.UTC(2026, 10, 2, 15, 0));

  it("primero el año: un 0027 es un error de captura antes que una fecha pasada", () => {
    expect(lotExpiryProblem("0027-10-01", { rejectPast: true, now: ahora })).toBe(
      "year_out_of_range",
    );
  });

  it("una fecha pasada solo es problema cuando la regla lo pide", () => {
    expect(lotExpiryProblem("2026-10-01", { rejectPast: true, now: ahora })).toBe("in_past");
    // «Editar lote» corrige un lote que de verdad caducó: ahí no se rechaza.
    expect(lotExpiryProblem("2026-10-01", { rejectPast: false, now: ahora })).toBeNull();
  });

  it("una fecha válida y futura no tiene problema", () => {
    expect(lotExpiryProblem("2027-10-01", { rejectPast: true, now: ahora })).toBeNull();
  });
});

describe("lotExpiryIsoDate", () => {
  it("da AAAA-MM-DD de un texto o de una DATE, con el año de cuatro cifras", () => {
    expect(lotExpiryIsoDate("2027-10-01")).toBe("2027-10-01");
    expect(lotExpiryIsoDate(new Date("2027-10-01"))).toBe("2027-10-01");
    expect(lotExpiryIsoDate(new Date("0027-10-01"))).toBe("0027-10-01");
  });
});

describe("rejectsPastExpiry", () => {
  it("las entradas de mercancía que se eligen en un formulario rechazan lo caducado", () => {
    expect(rejectsPastExpiry("invoice")).toBe(true);
    expect(rejectsPastExpiry("adjustment")).toBe(true);
    expect(rejectsPastExpiry("customer_return")).toBe(true);
  });

  it("lo que solo devuelve o reacomoda mercancía que ya era del negocio, no", () => {
    // El traspaso, la devolución del POS y el conteo físico mueven lotes que
    // ya estaban en el inventario: bloquearlos dejaría un traspaso en
    // tránsito para siempre o un conteo sin poder cuadrar.
    expect(rejectsPastExpiry("transfer")).toBe(false);
    expect(rejectsPastExpiry("sale_return")).toBe(false);
    expect(rejectsPastExpiry("physical_count")).toBe(false);
    expect(rejectsPastExpiry(null)).toBe(false);
  });
});

describe("documentRejectsPastExpiry", () => {
  it("una entrada de mercancía sí, también la que todavía no tiene motivo", () => {
    expect(documentRejectsPastExpiry({ type: "entry", reasonCode: "invoice" })).toBe(true);
    // Un borrador a medias: los motivos que se le pueden elegir rechazan todos.
    expect(documentRejectsPastExpiry({ type: "entry", reasonCode: null })).toBe(true);
  });

  it("la recepción de un traspaso, una salida y un conteo, no", () => {
    expect(documentRejectsPastExpiry({ type: "entry", reasonCode: "transfer" })).toBe(false);
    expect(documentRejectsPastExpiry({ type: "exit", reasonCode: "expired" })).toBe(false);
    expect(documentRejectsPastExpiry({ type: "physical_count", reasonCode: null })).toBe(false);
  });
});
