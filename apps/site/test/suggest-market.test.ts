import { describe, expect, it } from "vitest";
import { suggestMarket } from "../src/geo/suggest-market";

// F11-SITE-GEO-01 — la tabla de SITIO-WEB-CONTENIDO.md §6 y la tarea GEO-01,
// caso por caso. Es la pieza que más se va a querer tocar: quien la cambie,
// que agregue aquí la fila que lo motivó.
//
// [zona horaria, idiomas del navegador, ruta sugerida, por qué]
const CASES: [string | undefined, string[], string, string][] = [
  // México: la zona manda, y México solo tiene español.
  ["America/Mexico_City", ["es-MX", "es"], "es-mx", "zona de México"],
  ["America/Cancun", [], "es-mx", "zona de México, sin idiomas"],
  ["America/Tijuana", ["en-US", "en"], "es-mx", "zona de México con el navegador en inglés"],
  ["America/Monterrey", ["es-419"], "es-mx", "zona de México"],
  ["Mexico/General", ["es"], "es-mx", "alias viejo de Ciudad de México"],

  // Canadá: inglés, salvo que el navegador pida francés o la zona sea Montreal.
  ["America/Toronto", ["en-CA", "fr-CA"], "en-ca", "Toronto, inglés primero"],
  ["America/Toronto", ["fr-CA", "en-CA"], "fr-ca", "Toronto con francés primero"],
  ["America/Montreal", ["en-CA"], "fr-ca", "la zona de Montreal"],
  ["America/Vancouver", ["fr-FR"], "fr-ca", "el navegador pide francés"],
  [
    "America/Halifax",
    ["de-DE", "en"],
    "en-ca",
    "ni inglés ni francés primero: gana el primero de los dos",
  ],
  ["America/Winnipeg", [], "en-ca", "zona de Canadá, sin idiomas"],
  ["Canada/Eastern", ["en"], "en-ca", "alias viejo de Toronto"],

  // Estados Unidos: inglés, o español si el navegador lo prefiere.
  ["America/New_York", ["en-US", "en"], "en-us", "zona de Estados Unidos"],
  ["America/Los_Angeles", ["es-US", "en-US"], "es-us", "el navegador prefiere español"],
  ["America/Chicago", ["en-US", "es"], "en-us", "el español va después del inglés"],
  ["America/Indiana/Indianapolis", ["es-MX"], "es-us", "subzona de Indiana"],
  ["America/Kentucky/Louisville", ["en"], "en-us", "subzona de Kentucky"],
  ["Pacific/Honolulu", ["en-US"], "en-us", "Hawái"],
  ["America/Anchorage", ["en-US"], "en-us", "Alaska"],
  ["US/Pacific", ["en"], "en-us", "alias viejo de Los Ángeles"],

  // Otro país: decide el idioma PRINCIPAL del navegador.
  ["America/Bogota", ["es-CO", "es"], "es-mx", "otro país, navegador en español"],
  ["Europe/Madrid", ["es-ES"], "es-mx", "otro país, navegador en español"],
  ["America/Guatemala", ["en-US"], "en-us", "otro país, navegador en inglés"],
  ["Europe/Paris", ["fr-FR"], "en-us", "otro país en otro idioma: Estados Unidos en inglés"],
  ["Asia/Tokyo", ["ja-JP", "es"], "en-us", "el español no es el principal"],

  // Sin zona útil: se busca el país en el idioma (`en-CA` dice Canadá).
  [undefined, ["en-CA"], "en-ca", "sin zona, el idioma dice Canadá"],
  [undefined, ["fr-CA"], "fr-ca", "sin zona, francés de Canadá"],
  [undefined, ["es-US"], "es-us", "sin zona, español de Estados Unidos"],
  [undefined, ["es-MX"], "es-mx", "sin zona, español de México"],
  ["UTC", ["en-US"], "en-us", "zona neutra (navegadores que la esconden)"],
  ["Etc/GMT+6", ["es"], "es-mx", "zona neutra, navegador en español"],
  [undefined, ["de"], "en-us", "sin zona ni país, otro idioma"],

  // Nada que adivinar → México (Carlos, 2026-09-18).
  [undefined, [], "es-mx", "sin zona y sin idiomas"],
  ["", [""], "es-mx", "valores vacíos"],
  ["Etc/UTC", [], "es-mx", "zona neutra y sin idiomas"],
];

describe("suggestMarket", () => {
  it.each(CASES)("%s %j → %s (%s)", (timeZone, languages, route) => {
    expect(suggestMarket({ timeZone, languages }).route).toBe(route);
  });

  it("no distingue mayúsculas en las etiquetas de idioma", () => {
    expect(suggestMarket({ timeZone: "America/Denver", languages: ["ES-us"] }).route).toBe("es-us");
  });

  it("siempre devuelve una ruta de la matriz, con su mercado y su idioma", () => {
    const suggestion = suggestMarket({ timeZone: "America/Toronto", languages: ["fr"] });
    expect(suggestion).toMatchObject({ route: "fr-ca", market: "ca", language: "fr" });
  });
});
