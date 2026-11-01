import { parseSpreadsheetDate } from "./spreadsheet-date";

/**
 * Carlos (2026-11-01): en los Excel la fecha va con formato Texto, así que lo
 * que alguien teclee llega como TEXTO y lo interpreta la importación. Un día
 * mal leído es peor que un error: lo que no es una fecha clara se rechaza.
 */
describe("parseSpreadsheetDate", () => {
  it("vacía no es error: la caducidad es opcional", () => {
    expect(parseSpreadsheetDate("", true)).toEqual({ date: null, invalid: false });
    expect(parseSpreadsheetDate("   ", true)).toEqual({ date: null, invalid: false });
  });

  it("AAAA-MM-DD siempre, también con la hora de una celda de fecha de un archivo viejo", () => {
    expect(parseSpreadsheetDate("2026-07-01", true).date).toBe("2026-07-01");
    expect(parseSpreadsheetDate("2026-07-01T00:00:00.000Z", false).date).toBe("2026-07-01");
  });

  it("día/mes/año como se escribe en México, con / o -", () => {
    expect(parseSpreadsheetDate("15/08/2026", true).date).toBe("2026-08-15");
    expect(parseSpreadsheetDate("5/8/2026", true).date).toBe("2026-08-05");
    expect(parseSpreadsheetDate("15-08-2026", true).date).toBe("2026-08-15");
  });

  it("en un negocio de Estados Unidos, mes/día/año", () => {
    expect(parseSpreadsheetDate("08/15/2026", false).date).toBe("2026-08-15");
    expect(parseSpreadsheetDate("5/8/2026", false).date).toBe("2026-05-08");
  });

  it("año de dos cifras es 20AA: una caducidad no está en el siglo pasado", () => {
    expect(parseSpreadsheetDate("01/01/50", true).date).toBe("2050-01-01");
  });

  it.each(["31/02/2026", "15/13/2026", "2026-02-30", "mañana", "46000", "15/08"])(
    "«%s» no es una fecha: se rechaza en vez de adivinar",
    (texto) => {
      expect(parseSpreadsheetDate(texto, true)).toEqual({ date: null, invalid: true });
    },
  );
});
