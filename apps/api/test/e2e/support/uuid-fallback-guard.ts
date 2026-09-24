import { Logger } from "@nestjs/common";
import { UUID_FALLBACK_WARNING } from "../../../src/common/filters/all-exceptions.filter";

/**
 * F10-MANFIX-20 — ninguna e2e pisa el respaldo de los uuid.
 *
 * Cuando un id mal formado llega crudo a Postgres, el filtro de excepciones lo
 * contesta igual que la validación (400 `common.invalid_id`) y deja un aviso
 * en el log para encontrar la entrada que se escapó. En las e2e ese aviso NO
 * se ve: `@nestjs/testing` cambia el logger de Nest por su `TestingLogger`,
 * que se traga los `warn` (solo imprime los `error`). Una entrada sin validar
 * pasaría en verde con su 400 correcto, y buscar el aviso en la salida de la
 * suite daría cero siempre, se disparara o no (medido el 2026-09-24).
 *
 * Por eso este archivo (`setupFilesAfterEnv` de `jest-e2e.json`) intercepta el
 * aviso en `Logger.prototype.warn`, ANTES de que llegue al `TestingLogger`, y
 * hace fallar la prueba que lo provocó. El id se valida donde nace
 * (`idField()` en su DTO, `@UuidParam` en la ruta); el respaldo queda como red
 * de producción. Que el filtro siga avisando por ese camino y con ese texto lo
 * fija su prueba unitaria (`all-exceptions.filter.spec.ts`).
 */
const fallbacks: string[] = [];
const originalWarn = Logger.prototype.warn;

Logger.prototype.warn = function (this: Logger, message: unknown, ...rest: unknown[]) {
  if (typeof message === "string" && message.startsWith(UUID_FALLBACK_WARNING)) {
    fallbacks.push(message);
  }
  return Reflect.apply(originalWarn, this, [message, ...rest]);
} as typeof Logger.prototype.warn;

function failIfFallbackFired(): void {
  if (fallbacks.length === 0) {
    return;
  }
  const detail = fallbacks.splice(0).join("\n  ");
  throw new Error(
    "Un id llegó crudo a Postgres y lo contestó el respaldo del filtro de excepciones. " +
      "Valídalo donde nace: `idField()` en su DTO o `@UuidParam` en la ruta.\n  " +
      detail,
  );
}

afterEach(failIfFallbackFired);
afterAll(failIfFallbackFired);
