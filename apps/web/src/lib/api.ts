import axios, { type AxiosError } from "axios";

export interface ApiError {
  statusCode: number;
  message: string;
  error: string;
}

export const api = axios.create({
  baseURL: import.meta.env.VITE_API_URL ?? "http://localhost:3000",
  headers: { "Content-Type": "application/json" },
  timeout: 10_000,
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
