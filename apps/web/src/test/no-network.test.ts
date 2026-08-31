import { describe, expect, it } from "vitest";
import { api } from "@/lib/api";

/**
 * Los tests unitarios NO salen a la red — nunca, en ninguna máquina.
 *
 * jsdom ejecuta XHR de verdad. Sin esta barrera, cualquier llamada que un
 * test no mockee viaja al `localhost:3000` REAL: en CI no hay nadie y muere
 * al instante (inofensivo), pero en una máquina con el stack de desarrollo
 * levantado el API contesta — y un 401 del `refresh` sin cookie LIMPIA la
 * sesión en mitad del test que toque. Así nació el flaky de pos-sales
 * (2026-08-31): un fallo por corrida, un test distinto cada vez, y la
 * pantalla de login donde debía estar la aplicación. "Corres los tests con
 * el sistema levantado" no puede ser una causa de rojo.
 *
 * La barrera responde lo mismo que el CI (un error de RED, no un 4xx): las
 * rutas de "fallo temporal" del bootstrap se comportan idéntico en todas
 * partes, y el mensaje delator señala al test que olvidó su mock.
 */
describe("la barrera de red de los tests", () => {
  it("una llamada sin mock rechaza con el error centinela, sin tocar la red", async () => {
    // La forma es la NORMALIZADA (el shape de ApiError que ven todos los
    // consumidores): statusCode 0 = "no hubo respuesta", que es exactamente
    // lo que el bootstrap trata como fallo temporal — igual que en CI.
    await expect(api.get("/health")).rejects.toMatchObject({
      statusCode: 0,
      error: "Network Error",
      message: expect.stringContaining("los tests no salen a la red"),
    });
  });
});
