import { AxiosError, type AxiosResponse } from "axios";
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

/**
 * Un error que NO viene del API —nginx rebotando un cuerpo grande con su
 * 413 en HTML— llegaba a las pantallas como un string pelado: sin
 * `statusCode` ni `message`, imposible de explicar. El interceptor tiene que
 * normalizarlo al shape de `ApiError` con el status HTTP real.
 */
describe("api — un error del borde sin JSON conserva su status", () => {
  it("un 413 en HTML de nginx se rechaza como ApiError con statusCode 413", async () => {
    const rechazo = api
      .put(
        "/probe",
        {},
        {
          // El transporte real (xhr/http) hace `settle` y rechaza con un
          // AxiosError que lleva la respuesta; un adaptador a medida tiene
          // que hacerlo a mano o axios resuelve aunque el status sea 413.
          adapter: async (config) => {
            const response = {
              data: "<html><body><h1>413 Request Entity Too Large</h1></body></html>",
              status: 413,
              statusText: "Request Entity Too Large",
              headers: { "content-type": "text/html" },
              config,
            } as AxiosResponse;
            throw new AxiosError(
              "Request failed with status code 413",
              AxiosError.ERR_BAD_REQUEST,
              config,
              undefined,
              response,
            );
          },
        },
      )
      .then(() => "resolvió");

    await expect(rechazo).rejects.toMatchObject({ statusCode: 413 });
    await expect(rechazo).rejects.toHaveProperty("message", expect.any(String));
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
