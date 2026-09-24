import { describe, expect, it } from "vitest";
import {
  createCodeIndex,
  createTextIndex,
  demoLiterals,
  flattenMessages,
  missingTexts,
} from "./known-texts.js";
import type { Finding, ScreenFacts } from "./screen-source.js";

describe("flattenMessages", () => {
  it("devuelve cada texto de un JSON de traducciones con su clave", () => {
    expect(flattenMessages({ a: { b: "Uno", c: ["Dos"] }, d: "Tres", n: 3 })).toEqual([
      { key: "a.b", value: "Uno" },
      { key: "a.c.0", value: "Dos" },
      { key: "d", value: "Tres" },
    ]);
  });
});

describe("demoLiterals", () => {
  it("toma los datos de la demo, no sus mensajes, rutas ni SQL", () => {
    const source = `
const DEMO = { business: "Abarrotes La Esquina", firstName: "Luis" } as const;
await api("POST", "/warehouses", { name: "Sucursal Norte" });
for (const [code, value] of [["P1", "Bebidas"]] as const) {}
console.log("  · 2 sucursales");
throw new Error("El negocio nació sin sucursal.");
stack.sql(\`UPDATE sales SET created_at = now()\`);
`;
    expect(demoLiterals(source).sort()).toEqual(
      ["Abarrotes La Esquina", "Bebidas", "Luis", "P1", "Sucursal Norte"].sort(),
    );
  });
});

describe("createTextIndex", () => {
  const index = createTextIndex({
    app: [
      "Nuevo producto",
      "Nuevo",
      "producto",
      "Compra {{folio}}",
      "Recepción {folio}",
      "Lista de otro catálogo",
      "Esta compra ya está confirmada y su entrada también.",
    ],
    demo: ["Luis", "Ramírez", "Pasillos", "Agua natural 1 L"],
  });

  it("un texto exacto es un valor completo", () => {
    expect(index.has("Nuevo producto", true)).toBe(true);
    expect(index.has("Nuevo prod", true)).toBe(false);
    expect(index.has("nuevo producto", true)).toBe(false);
  });

  it("un texto no exacto puede ser parte de un valor, sin importar mayúsculas", () => {
    expect(index.has("ya está confirmada", false)).toBe(true);
    expect(index.has("nuevo PRODUCTO", false)).toBe(true);
  });

  it("junta los espacios como Playwright", () => {
    expect(index.has("  Nuevo   producto ", true)).toBe(true);
  });

  it("una interpolación ({{x}} del web, {x} del API) acepta cualquier valor", () => {
    expect(index.has("Compra COM-000001", true)).toBe(true);
    expect(index.has("Recepción RCP-000001", false)).toBe(true);
    expect(index.has("Compra", false)).toBe(true);
  });

  it("la interpolación no se traga cualquier texto", () => {
    expect(index.has("Venta COM-000001", false)).toBe(false);
    expect(index.has("algo que no existe", false)).toBe(false);
  });

  it("un dato de la demo vale entero, en parte o junto a otros datos", () => {
    expect(index.has("Agua natural 1 L", true)).toBe(true);
    expect(index.has("Agua natural", false)).toBe(true);
    expect(index.has("Luis Ramírez", false)).toBe(true);
  });

  it("un texto del web pegado a un dato de la demo también existe", () => {
    expect(index.has("Lista de otro catálogo → Pasillos", false)).toBe(true);
  });

  it("dos textos del web pegados no cuentan como uno", () => {
    expect(index.has("producto Nuevo", true)).toBe(false);
    expect(index.has("→", false)).toBe(false);
  });
});

describe("createCodeIndex", () => {
  const code = createCodeIndex([
    '<div data-testid="tax-group" />',
    "const id = 'transfers-destination';",
    // biome-ignore lint/suspicious/noTemplateCurlyInString: es código del web como texto, con su template adentro.
    "<Card data-testid={`feature-lock-${feature}`} />",
  ]);

  it("encuentra un id escrito entre comillas en el código del web", () => {
    expect(code.has("tax-group")).toBe(true);
    expect(code.has("transfers-destination")).toBe(true);
  });

  it("acepta un id armado con un template si empieza igual", () => {
    expect(code.has("feature-lock-movements")).toBe(true);
  });

  it("no acepta un pedazo de otro id", () => {
    expect(code.has("tax")).toBe(false);
    expect(code.has("feature-lock-")).toBe(false);
  });
});

describe("missingTexts", () => {
  const text = (value: string, screen: string | null = null): Finding => ({
    kind: "text",
    value,
    exact: true,
    flags: "",
    file: "screens/x.ts",
    line: 1,
    screen,
  });
  const login = text("Entrar");
  const spanish = text("Nuevo producto", "product-form");
  const english = text("New product", "product-form-en");
  const shared = text("Guardar");
  const folio = text("SAL-000001", "exit-confirmed");
  const screens: ScreenFacts[] = [
    { id: "product-form", file: "screens/x.ts", line: 1, findings: [spanish, shared] },
    { id: "product-form-en", file: "screens/x.ts", line: 9, findings: [english, shared] },
    { id: "exit-confirmed", file: "screens/x.ts", line: 20, findings: [folio] },
  ];
  const indexes = {
    es: createTextIndex({ app: ["Entrar", "Nuevo producto", "Guardar"], demo: [] }),
    en: createTextIndex({ app: ["Sign in", "New product"], demo: [] }),
  };
  const localeOf = (id: string) => (id === "product-form-en" ? "en" : "es");

  it("revisa cada texto en el idioma de las capturas que lo usan; sin captura, en español", () => {
    const missing = missingTexts(
      [login, spanish, english, shared, folio],
      screens,
      localeOf,
      indexes,
      { "SAL-000001": "folio que da el API" },
    );
    expect(missing.map((finding) => finding.value)).toEqual(["Guardar"]);
  });
});
