import { QueryClientProvider } from "@tanstack/react-query";
import { createRouter, RouterProvider } from "@tanstack/react-router";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { I18nextProvider } from "react-i18next";
import "./index.css";
import { ErrorBoundary } from "./components/error-boundary";
import { i18n } from "./i18n";
import { installAccountLanguageSync } from "./lib/auth/ui-language";
import { registerServiceWorker } from "./lib/pwa/register-service-worker";
import { createQueryClient } from "./lib/query-client";
import { applyBrand } from "./lib/theme/apply-brand";
import { routeTree } from "./routeTree.gen";

// Marca por defecto ANTES del primer render: el login se pinta con la marca
// de la plataforma porque todavía no sabemos a qué tenant pertenece quien
// escribe su email (login por email global, decisión de f1-auth). Cuando el
// login devuelva la config del tenant, se vuelve a llamar con `tenant.theme`.
applyBrand();

// Las pantallas públicas arrancan en inglés (`INITIAL_LOCALE`), pero apenas
// hay sesión manda el idioma de la CUENTA. Se instala una sola vez, acá, para
// que ningún camino que cree sesión pueda olvidarse de aplicarlo — ver
// `lib/auth/ui-language.ts`. Vive lo que vive la pestaña: no se desuscribe.
installAccountLanguageSync(i18n);

// F4-PWA-01: el worker que hace que la app abra sin red. Fuego y olvido — si
// falla, la app funciona igual y solo pierde el modo instalable.
registerServiceWorker();

// UN cliente por pestaña, construido SIEMPRE con la factory: trae la política
// de reintentos (W5) y la purga de caché atada al cambio de sesión (C1).
// Instanciarlo a mano acá se salta las dos cosas — ver `lib/query-client.ts`.
const queryClient = createQueryClient();
const router = createRouter({ routeTree });

declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router;
  }
}

const rootElement = document.getElementById("root");
if (!rootElement) {
  throw new Error("No se encontró el elemento #root en index.html");
}

createRoot(rootElement).render(
  <StrictMode>
    <ErrorBoundary>
      <I18nextProvider i18n={i18n}>
        <QueryClientProvider client={queryClient}>
          <RouterProvider router={router} />
        </QueryClientProvider>
      </I18nextProvider>
    </ErrorBoundary>
  </StrictMode>,
);
