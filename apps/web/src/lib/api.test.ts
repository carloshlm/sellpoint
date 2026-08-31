import type { AxiosResponse } from "axios";
import { i18n } from "@/i18n";
import { api } from "./api";

const probe = await fetch("http://localhost:3000/health")
  .then((r) => r.ok)
  .catch(() => false);

describe("api instance", () => {
  it("tiene baseURL configurada", () => {
    expect(api.defaults.baseURL).toBe("http://localhost:3000");
  });
});

/**
 * W2: no alcanza con que el interceptor exista y esté testeado — tiene que
 * estar ENCHUFADO a la instancia que usa la app. Este test corre contra el
 * `api` exportado, con un adaptador por request (sin red).
 */
describe("api — declara el idioma de la UI (W2)", () => {
  const idiomaOriginal = i18n.language;

  afterAll(async () => {
    await i18n.changeLanguage(idiomaOriginal);
  });

  async function pedirYCapturarIdioma(): Promise<string> {
    let declarado = "";
    await api.get("/probe", {
      adapter: async (config) => {
        declarado = String(config.headers.get("Accept-Language") ?? "");
        return { data: {}, status: 200, statusText: "OK", headers: {}, config } as AxiosResponse;
      },
    });
    return declarado;
  }

  it("con la UI en español manda Accept-Language: es", async () => {
    await i18n.changeLanguage("es");

    expect(await pedirYCapturarIdioma()).toBe("es");
  });

  it("con la UI en inglés manda Accept-Language: en", async () => {
    await i18n.changeLanguage("en");

    expect(await pedirYCapturarIdioma()).toBe("en");
  });
});

// Integración real contra el API — se saltea si el API no está corriendo.
//
// Es la ÚNICA excepción a la barrera de red de src/test/setup.ts, y por eso
// pide el transporte real (`adapter: ["xhr", "http"]`) a propósito: salir a
// la red acá es la intención declarada del test, no un mock olvidado. Todo
// lo demás sigue bloqueado.
describe.runIf(probe)("api /health (integración)", () => {
  it("el frontend puede consumir /health", async () => {
    const { data } = await api.get("/health", { adapter: ["xhr", "http"] });

    expect(data).toEqual({ status: "ok", db: "ok", redis: "ok" });
  });
});
