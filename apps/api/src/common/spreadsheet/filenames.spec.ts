import { spreadsheetFilenameBase } from "./filenames";

describe("nombre del archivo por idioma", () => {
  it("en español es el nombre de siempre", () => {
    expect(spreadsheetFilenameBase("productos", "es")).toBe("productos");
    expect(spreadsheetFilenameBase("conteo-fisico", "es")).toBe("conteo-fisico");
  });

  it("en inglés, su traducción", () => {
    expect(spreadsheetFilenameBase("productos", "en")).toBe("products");
    expect(spreadsheetFilenameBase("estudios-laboratorio", "en")).toBe("lab-studies");
    expect(spreadsheetFilenameBase("stock-por-lote", "en")).toBe("stock-by-lot");
  });

  it("una clave desconocida vuelve tal cual: no se inventan nombres", () => {
    expect(spreadsheetFilenameBase("lo-que-sea", "en")).toBe("lo-que-sea");
  });
});
