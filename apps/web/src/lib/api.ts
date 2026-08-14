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
    const fallback: ApiError = {
      statusCode: 0,
      message: error.message,
      error: "Network Error",
    };
    return Promise.reject(error.response?.data ?? fallback);
  },
);
