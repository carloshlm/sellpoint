import axios, { type AxiosError } from "axios";

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
