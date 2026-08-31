import "@testing-library/jest-dom/vitest";
import { AxiosError } from "axios";
import { api } from "@/lib/api";

/**
 * BARRERA DE RED: los tests unitarios no salen a la red — nunca (2026-08-31).
 *
 * jsdom ejecuta XHR de verdad. Cualquier llamada que un test no mockee
 * viajaba al `localhost:3000` REAL: en CI no hay nadie escuchando y el error
 * de conexión es instantáneo, pero en una máquina con `pnpm dev` levantado el
 * API contesta — y su 401 al `refresh` sin cookie LIMPIA la sesión en mitad
 * del test que toque. Ese era el flaky de pos-sales: un fallo por corrida, un
 * test distinto cada vez, la pantalla de login donde debía estar la app, y
 * "verde en CI" porque allá no hay servidor. El gate no puede depender de qué
 * tenga levantado la máquina que lo corre.
 *
 * El adaptador rechaza imitando el fallo de CONEXIÓN (ERR_NETWORK), no un
 * 4xx: así las rutas de "fallo temporal" del bootstrap se comportan igual en
 * todas las máquinas, y el mensaje nombra la URL para delatar al test que
 * olvidó su mock. Guardián: src/test/no-network.test.ts.
 */
api.defaults.adapter = (config) =>
  Promise.reject(
    new AxiosError(
      `los tests no salen a la red (${config.method?.toUpperCase()} ${config.url}): mockea esta llamada`,
      AxiosError.ERR_NETWORK,
      config,
    ),
  );

// jsdom no implementa ResizeObserver. `radix-ui`'s Checkbox (F1-WEB-USERS
// WU4, `ui/checkbox.tsx`) lo usa internamente vía `useSize` — sin este stub
// cualquier test que monte un Checkbox tira una excepción no capturada que
// el error boundary de TanStack Router convierte en una pantalla de error.
if (typeof globalThis.ResizeObserver === "undefined") {
  class ResizeObserverStub {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
  globalThis.ResizeObserver = ResizeObserverStub as unknown as typeof ResizeObserver;
}
