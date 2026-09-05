import axios, { type AxiosError } from "axios";
import { i18n } from "@/i18n";
import { installAcceptLanguageInterceptor } from "./accept-language";
import { installRefreshInterceptor } from "./auth/refresh-interceptor";

export interface ApiError {
  statusCode: number;
  /** Texto YA traducido por el backend (Accept-Language) — apto para mostrar. */
  message: string;
  error: string;
  /** Clave i18n cruda (`auth.email_not_verified`, etc.) — para LÓGICA, no para mostrar. */
  code?: string;
  /**
   * Campos extra que el error trae para poder ACTUAR, no solo avisar: hoy el
   * 409 de «ya hay una consulta abierta» dice a cuál ir (F9-CLINIC-WEB-23).
   */
  recordId?: string | null;
  folio?: string | null;
  /** F7-LIFECYCLE: el 409 de «todavía no se puede eliminar» dice desde cuándo sí. */
  deletableAt?: string | null;
}

export const api = axios.create({
  baseURL: import.meta.env.VITE_API_URL ?? "http://localhost:3000",
  headers: { "Content-Type": "application/json" },
  timeout: 10_000,
  // La cookie de refresh es httpOnly host-only: sin esto nunca viaja.
  withCredentials: true,
});

// W2: sin esto el backend elige el idioma de la respuesta con la preferencia
// del NAVEGADOR, que no tiene relación con lo que el usuario eligió en la app.
// Convive con el de refresh sin importar el orden: tocan headers distintos.
installAcceptLanguageInterceptor(api, i18n);

// ORDEN IMPORTANTE: el interceptor de refresh va PRIMERO. Axios corre los
// interceptores de respuesta en orden de registro, así que este recibe el
// AxiosError CRUDO (con `config`, que necesita para reintentar la request).
// El normalizador de abajo corre después, sobre lo que el refresh rechace.
installRefreshInterceptor(api);

// Normaliza errores al shape del AllExceptionsFilter del API
api.interceptors.response.use(
  (response) => response,
  (error: AxiosError<ApiError>) => {
    // F7-WEB-08: cualquier 402 significa "tu plan no lo incluye" — se abre
    // el modal de planes ADEMÁS de rechazar (la pantalla que llamó igual
    // muestra su error). El import es dinámico y perezoso: este módulo lo
    // cargan también flujos sin sesión y el store no debe entrar al bundle
    // del login por un interceptor.
    if (error.response?.status === 402) {
      void import("@/stores/billing.store").then(({ useBillingStore }) => {
        useBillingStore.getState().openPlansModal();
      });
    }
    const respuesta = error.response;
    // Sin respuesta no hubo servidor: red caída, CORS, timeout.
    if (respuesta === undefined) {
      const sinRed: ApiError = { statusCode: 0, message: error.message, error: "Network Error" };
      return Promise.reject(sinRed);
    }
    // El API siempre contesta con este shape. Lo que NO lo trae vino del
    // borde —nginx rebotando un cuerpo grande con un 413 en HTML— y sin esta
    // normalización llegaba a las pantallas como un string pelado, sin
    // status ni mensaje, imposible de explicar.
    const cuerpo = respuesta.data;
    if (typeof cuerpo === "object" && cuerpo !== null && "statusCode" in cuerpo) {
      return Promise.reject(cuerpo);
    }
    const delBorde: ApiError = {
      statusCode: respuesta.status,
      message: error.message,
      error: respuesta.statusText || "Error",
    };
    return Promise.reject(delBorde);
  },
);
