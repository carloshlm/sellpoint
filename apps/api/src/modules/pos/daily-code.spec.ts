import { dailyTicketCode } from "./daily-code";

describe("dailyTicketCode", () => {
  it("compone fecha compacta + consecutivo de 4", () => {
    expect(dailyTicketCode("UTC", new Date("2026-08-24T12:00:00Z"), 45n)).toBe("202608240045");
  });

  /**
   * ⚠ LA ASERCIÓN QUE EL E2E NO PUEDE HACER. A las 23:30 de CDMX, UTC ya va
   * en el día siguiente: si la fecha se cortara en UTC, el consecutivo
   * reiniciaría a las 6 PM del negocio — el mismo defecto del filtro de
   * fechas, ahora en el nacimiento del código.
   */
  it("el día es el del NEGOCIO, no el de UTC", () => {
    const instante = new Date("2026-08-25T05:30:00Z"); // 23:30 del 24 en CDMX

    expect(dailyTicketCode("America/Mexico_City", instante, 1n)).toBe("202608240001");
    expect(dailyTicketCode("UTC", instante, 1n)).toBe("202608250001");
  });

  it("la venta 10,000 del día crece a 5 dígitos en vez de romper el cobro", () => {
    expect(dailyTicketCode("UTC", new Date("2026-08-24T12:00:00Z"), 10_000n)).toBe("2026082410000");
  });
});
