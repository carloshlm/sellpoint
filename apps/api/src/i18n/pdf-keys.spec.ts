import * as fs from "node:fs";
import * as path from "node:path";
import { INVENTORY_DOCUMENT_TYPES, MOVEMENT_REASONS, PAYMENT_METHODS } from "@sellpoint/shared";

/**
 * Las claves DINÁMICAS del PDF, que ningún escáner de texto puede ver.
 *
 * `message-keys.spec.ts` encuentra `t("pdf.warehouse")` porque es un literal.
 * No puede encontrar `t(\`pdf.reason.${document.reasonCode}\`)`: la clave se
 * arma en tiempo de ejecución. El día que alguien agregue un motivo nuevo al
 * contrato —y va a pasar, `sale` y `sale_return` entran con el POS de F4— el
 * PDF lo imprimiría como `pdf.reason.sale` en crudo y nadie se enteraría hasta
 * que un cliente lo tuviera en la mano.
 *
 * Por eso este test no escanea código: recorre el CONTRATO. Si la lista de
 * motivos o de tipos crece, esto se pone rojo hasta que el catálogo la alcance.
 */
const LOCALES = ["es", "en"] as const;

function catalogo(locale: string, namespace = "pdf"): Record<string, unknown> {
  const file = path.join(__dirname, locale, `${namespace}.json`);
  return JSON.parse(fs.readFileSync(file, "utf8")) as Record<string, unknown>;
}

describe("Claves dinámicas del PDF", () => {
  for (const locale of LOCALES) {
    describe(locale, () => {
      it("tiene un nombre para CADA tipo de documento", () => {
        const tipos = catalogo(locale).type as Record<string, string>;
        const faltan = INVENTORY_DOCUMENT_TYPES.filter((t) => !tipos?.[t]);

        expect({ locale, faltan }).toEqual({ locale, faltan: [] });
      });

      it("tiene un nombre para CADA motivo de movimiento", () => {
        const motivos = catalogo(locale).reason as Record<string, string>;
        const faltan = MOVEMENT_REASONS.filter((r) => !motivos?.[r]);

        expect({ locale, faltan }).toEqual({ locale, faltan: [] });
      });
    });
  }
});

/**
 * F4-TICKET-01 — la MISMA trampa, en el otro papel.
 *
 * El ticket arma `t(\`ticket.method.${paymentMethod}\`)`, una clave que ningún
 * escáner de literales puede ver. El día que entre un método de pago nuevo
 * —vales, monedero, crédito— el ticket imprimiría `ticket.method.voucher` en
 * crudo y nadie se enteraría hasta que un cliente lo tuviera en la mano.
 *
 * Vive acá y no en su propio archivo porque es la misma clase de problema que
 * este test ya vigila: claves dinámicas de un documento impreso.
 */
describe("Claves dinámicas del TICKET", () => {
  for (const locale of LOCALES) {
    it(`${locale}: tiene un nombre para CADA método de pago`, () => {
      const metodos = catalogo(locale, "ticket").method as Record<string, string>;
      const faltan = PAYMENT_METHODS.filter((m) => !metodos?.[m]);

      expect({ locale, faltan }).toEqual({ locale, faltan: [] });
    });
  }
});
