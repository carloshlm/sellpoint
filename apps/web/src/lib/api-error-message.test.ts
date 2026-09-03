import type { ApiError } from "./api";
import { apiErrorMessage } from "./api-error-message";

/**
 * Un listado que falla decía siempre lo mismo: «No pudimos cargar…». Con ese
 * texto, quien lo ve no sabe si se le venció la sesión, si no tiene permiso o
 * si el servidor se cayó — y quien tiene que arreglarlo, tampoco (Carlos,
 * 2026-09-04, con la pantalla de Usuarios en producción).
 */
describe("apiErrorMessage", () => {
  // El `t` de pruebas devuelve la clave: así se ve CUÁL se eligió.
  const t = (key: string) => key;
  const error = (over: Partial<ApiError>): ApiError => ({
    statusCode: 500,
    message: "",
    error: "Internal Server Error",
    ...over,
  });

  it("sin red lo dice: no es culpa del servidor ni del permiso", () => {
    expect(apiErrorMessage(t, error({ statusCode: 0 }), "users.list.error")).toBe(
      "common.errors.network",
    );
  });

  it("401 es sesión vencida y 403 es falta de permiso", () => {
    expect(apiErrorMessage(t, error({ statusCode: 401 }), "users.list.error")).toBe(
      "common.errors.sessionExpired",
    );
    expect(apiErrorMessage(t, error({ statusCode: 403 }), "users.list.error")).toBe(
      "common.errors.forbidden",
    );
  });

  it("otro 4xx muestra el motivo que el backend ya tradujo", () => {
    const dicho = "Tu plan no incluye esta función.";
    expect(apiErrorMessage(t, error({ statusCode: 402, message: dicho }), "users.list.error")).toBe(
      dicho,
    );
  });

  it("un 5xx no le echa la culpa al usuario", () => {
    expect(apiErrorMessage(t, error({ statusCode: 500 }), "users.list.error")).toBe(
      "common.errors.server",
    );
    // Aunque el servidor mande texto: un stack traducido no le sirve a nadie.
    expect(
      apiErrorMessage(
        t,
        error({ statusCode: 503, message: "upstream timeout" }),
        "users.list.error",
      ),
    ).toBe("common.errors.server");
  });

  it("sin error, o con un 4xx mudo, cae a la frase de la pantalla", () => {
    expect(apiErrorMessage(t, null, "users.list.error")).toBe("users.list.error");
    expect(apiErrorMessage(t, error({ statusCode: 409, message: "" }), "users.list.error")).toBe(
      "users.list.error",
    );
  });
});
