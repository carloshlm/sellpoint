import type { AxiosAdapter, AxiosResponse } from "axios";
import axios from "axios";
import { createI18n } from "@/i18n";
import { installAcceptLanguageInterceptor, resolveUiLanguage } from "./accept-language";

/**
 * W2 del verify de f1-web-auth. El backend SÍ traduce (verificado contra
 * producción: el mismo `code` devuelve texto distinto según `Accept-Language`),
 * pero el front nunca mandaba el header, así que el idioma lo elegía el
 * NAVEGADOR. Con la UI en español y el navegador en inglés, el usuario veía el
 * formulario en español y el error en inglés — en TODA pantalla no
 * autenticada: login, register, forgot/reset password y el 429 del throttle.
 */
describe("resolveUiLanguage — qué idioma se declara", () => {
  it("usa el idioma resuelto: es el que el usuario está leyendo en pantalla", () => {
    expect(resolveUiLanguage({ language: "es-MX", resolvedLanguage: "es" })).toBe("es");
  });

  it("sin idioma resuelto cae al declarado (i18next todavía inicializando)", () => {
    expect(resolveUiLanguage({ language: "en", resolvedLanguage: undefined })).toBe("en");
  });
});

describe("installAcceptLanguageInterceptor", () => {
  function buildHarness() {
    const i18n = createI18n();
    const capturados: string[] = [];

    const adapter: AxiosAdapter = async (config) => {
      capturados.push(String(config.headers.get("Accept-Language") ?? ""));
      return { data: {}, status: 200, statusText: "OK", headers: {}, config } as AxiosResponse;
    };

    const client = axios.create({ baseURL: "http://api.test", adapter });
    installAcceptLanguageInterceptor(client, i18n);
    return { client, i18n, capturados };
  }

  it("cada request declara el idioma activo de la UI", async () => {
    const { client, capturados } = buildHarness();

    await client.get("/auth/login");

    expect(capturados).toEqual(["es"]);
  });

  /**
   * EL TEST QUE JUSTIFICA EL INTERCEPTOR. Clavar el idioma en los `headers`
   * por defecto de la instancia (la alternativa de una línea) pasaría el test
   * de arriba y fallaría acá: el header quedaría congelado en el idioma que
   * había al arrancar la app, no en el que el usuario eligió después.
   */
  it("si el usuario cambia de idioma, la request SIGUIENTE ya viaja con el nuevo", async () => {
    const { client, i18n, capturados } = buildHarness();

    await client.get("/auth/login");
    await i18n.changeLanguage("en");
    await client.get("/auth/login");

    expect(capturados).toEqual(["es", "en"]);
  });
});
