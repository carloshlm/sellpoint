import "@testing-library/jest-dom/vitest";

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
