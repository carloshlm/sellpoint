import { parseCsv, toCsv, UTF8_BOM } from "./csv";

/**
 * F2-IMPORT. Los casos que un `split(",")` rompe en silencio son justamente
 * los que aparecen en datos reales de un catálogo.
 */
describe("CSV de importación (F2-IMPORT)", () => {
  describe("parseCsv", () => {
    it("parsea filas y columnas simples", () => {
      expect(parseCsv("sku,nombre\nPAR-500,Paracetamol")).toEqual([
        ["sku", "nombre"],
        ["PAR-500", "Paracetamol"],
      ]);
    });

    it("respeta comas DENTRO de comillas", () => {
      // "Jarabe 120ml, sabor cereza" es un nombre perfectamente normal.
      expect(parseCsv('sku,nombre\nJAR,"Jarabe 120ml, sabor cereza"')).toEqual([
        ["sku", "nombre"],
        ["JAR", "Jarabe 120ml, sabor cereza"],
      ]);
    });

    it("respeta comillas escapadas y saltos de línea dentro de un campo", () => {
      expect(parseCsv('nombre\n"Bolsa ""grande""\ncon nota"')).toEqual([
        ["nombre"],
        ['Bolsa "grande"\ncon nota'],
      ]);
    });

    it("ignora el BOM que Excel escribe al guardar", () => {
      expect(parseCsv(`${UTF8_BOM}sku\nPAR`)).toEqual([["sku"], ["PAR"]]);
    });

    it("descarta filas totalmente vacías, que Excel agrega al final", () => {
      expect(parseCsv("sku\nPAR\n\n,,\n")).toEqual([["sku"], ["PAR"]]);
    });

    it("tolera CRLF de Windows", () => {
      expect(parseCsv("sku,nombre\r\nPAR,Paracetamol\r\n")).toEqual([
        ["sku", "nombre"],
        ["PAR", "Paracetamol"],
      ]);
    });
  });

  describe("toCsv", () => {
    it("escribe el BOM para que Excel muestre bien los acentos", () => {
      expect(toCsv([["Código"]])).toBe(`${UTF8_BOM}Código`);
    });

    it("cita solo las celdas que lo necesitan", () => {
      expect(toCsv([["simple", "con,coma", 'con"comilla']])).toBe(
        `${UTF8_BOM}simple,"con,coma","con""comilla"`,
      );
    });

    it("lo que escribe se puede volver a leer sin perder nada", () => {
      const rows = [
        ["sku", "nombre"],
        ["JAR", 'Jarabe, "especial"\ncon salto'],
      ];

      expect(parseCsv(toCsv(rows))).toEqual(rows);
    });
  });
});
