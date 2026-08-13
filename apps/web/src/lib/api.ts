import axios, { type AxiosError } from "axios";
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
