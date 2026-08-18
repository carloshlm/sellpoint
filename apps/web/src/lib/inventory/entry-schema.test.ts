import { SELECTABLE_ENTRY_REASONS, SELECTABLE_EXIT_REASONS } from "@sellpoint/shared";
import {
  headerErrors,
  headerSchemaFor,
  REASONS_WITH_AUTHORIZATION,
  selectableReasons,
} from "./entry-schema";

/**
 * F3-ENTRY-02 — las reglas del formulario salen de `REASON_RULES`, la MISMA
 * tabla que aplica el `superRefine` del API (`movement.dto.ts`).
 *
 * Que la fuente sea una sola es lo que evita el peor error de un formulario
 * reactivo: pedir un campo que el servidor no exige, o —peor— no pedir uno que
 * sí, y que el usuario se entere con un 400 sobre algo que la pantalla nunca
 * le mostró.
 */
describe("Reglas de la cabecera por motivo (F3-ENTRY-02)", () => {
  describe("selectableReasons", () => {
    it("una entrada ofrece los motivos de entrada y una salida los de salida", () => {
      expect(selectableReasons("entry")).toEqual([...SELECTABLE_ENTRY_REASONS]);
      expect(selectableReasons("exit")).toEqual([...SELECTABLE_EXIT_REASONS]);
    });

    /**
     * El conteo físico NO elige motivo: lo pone la aprobación del conteo. Un
     * desplegable vacío es más honesto que uno con opciones que el API rechaza.
     */
    it("el conteo físico no ofrece ninguno", () => {
      expect(selectableReasons("physical_count")).toEqual([]);
    });

    /**
     * `transfer` en ENTRADA no se elige a mano: la recepción se llega desde la
     * vista de tránsito, que precarga el documento. Ofrecerlo dejaría armar una
     * entrada por traspaso sin traspaso detrás.
     */
    it("la entrada no ofrece traspaso, pero la salida sí", () => {
      expect(selectableReasons("entry")).not.toContain("transfer");
      expect(selectableReasons("exit")).toContain("transfer");
    });
  });

  describe("headerErrors", () => {
    it("la factura de compra exige referencia", () => {
      expect(headerErrors("invoice", {}).get("reference")).toBe("inventory.reference_required");
      expect(headerErrors("invoice", { reference: "F-8891" }).size).toBe(0);
    });

    it("el ajuste exige nota, no referencia", () => {
      const errores = headerErrors("adjustment", {});

      expect(errores.get("reasonNote")).toBe("inventory.note_required");
      expect(errores.has("reference")).toBe(false);
    });

    it("el traspaso exige el otro almacén", () => {
      expect(headerErrors("transfer", {}).get("linkedWarehouseId")).toBe(
        "inventory.linked_warehouse_required",
      );
    });

    /**
     * Espacios no son una nota. Sin el `trim`, escribir " " dejaría confirmar
     * un ajuste sin explicación y el requisito sería decorativo.
     */
    it("una nota en blanco no cuenta como nota", () => {
      expect(headerErrors("adjustment", { reasonNote: "   " }).get("reasonNote")).toBe(
        "inventory.note_required",
      );
    });

    it("el consumo interno exige el área o concepto en la referencia", () => {
      expect(headerErrors("consumption", {}).get("reference")).toBe("inventory.reference_required");
    });

    it("la devolución de cliente exige nota", () => {
      expect(headerErrors("customer_return", {}).get("reasonNote")).toBe("inventory.note_required");
    });

    /**
     * El documento llega del API con los campos vacíos en `null`, NO en
     * `undefined`. Con `.optional()` (que solo acepta `undefined`) cada campo
     * nulo sumaba un error de tipo y el confirmar quedaba trabado para siempre,
     * sin decir por qué. Por eso el schema usa `.nullish()`, igual que el DTO.
     */
    it("un campo en null es un campo vacío, no un error de tipo", () => {
      const comoLlegaDelApi = {
        reference: null,
        reasonNote: "Sobrante de conteo",
        authorizedBy: null,
        linkedWarehouseId: null,
      };

      expect(headerErrors("adjustment", comoLlegaDelApi).size).toBe(0);
    });

    it("un null en el campo que el motivo exige sí es un error, y es el suyo", () => {
      expect(headerErrors("adjustment", { reasonNote: null }).get("reasonNote")).toBe(
        "inventory.note_required",
      );
    });

    /**
     * Sin motivo elegido todavía no hay nada que exigir: el formulario recién
     * empieza y marcarlo en rojo sería gritarle a quien no hizo nada mal.
     */
    it("sin motivo no reporta errores", () => {
      expect(headerErrors(null, {}).size).toBe(0);
    });
  });

  describe("headerSchemaFor", () => {
    it("acepta una cabecera completa y devuelve los valores ya recortados", () => {
      const result = headerSchemaFor("invoice").safeParse({
        reasonCode: "invoice",
        reference: "  F-8891  ",
      });

      expect(result.success).toBe(true);
      expect(result.data?.reference).toBe("F-8891");
    });

    it("rechaza la que le falta el campo del motivo", () => {
      expect(headerSchemaFor("adjustment").safeParse({ reasonCode: "adjustment" }).success).toBe(
        false,
      );
    });
  });

  /**
   * `authorizedBy` es OPCIONAL en el API: ningún motivo lo exige. Así que esto
   * no es una regla de validación sino de PRESENTACIÓN — a quién tiene sentido
   * ofrecerle firmar. Por eso vive acá y no en `REASON_RULES`: meterlo en la
   * tabla que consume el DTO haría creer que el servidor lo valida.
   */
  describe("REASONS_WITH_AUTHORIZATION", () => {
    it("ofrece firma en los motivos que mueven stock sin comprobante detrás", () => {
      expect(REASONS_WITH_AUTHORIZATION).toEqual(["adjustment", "loss", "expired"]);
    });

    it("la factura no la pide: la factura ES el comprobante", () => {
      expect(REASONS_WITH_AUTHORIZATION).not.toContain("invoice");
    });
  });
});
