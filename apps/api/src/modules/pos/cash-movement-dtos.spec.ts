import { MONEY_MAX } from "@sellpoint/shared";
import { cancelCashMovementSchema, createCashMovementSchema } from "./dto/cash-movement.dto";

/**
 * F10-CASHMOV-02 — lo que el cajero manda para registrar una entrada o un
 * retiro de efectivo, y para anularlo. El DTO rebota lo que se ve en la forma;
 * lo que depende del negocio (el código, el cajón) lo decide el service.
 */
describe("createCashMovementSchema (F10-CASHMOV-02)", () => {
  const registrar = (body: Record<string, unknown>) => createCashMovementSchema.safeParse(body);
  const issues = (body: Record<string, unknown>) => JSON.stringify(registrar(body).error?.issues);

  it("acepta una entrada y un retiro con cada motivo que les corresponde", () => {
    for (const [type, reason] of [
      ["in", "change_fund"],
      ["out", "safe"],
      ["out", "bank_deposit"],
      ["out", "owner"],
    ]) {
      expect(registrar({ type, reason, amount: 100 }).success).toBe(true);
    }
    expect(registrar({ type: "in", reason: "other", amount: 1, note: "Cambio" }).success).toBe(
      true,
    );
    expect(
      registrar({ type: "out", reason: "other", amount: 1, note: "Garrafón", code: "1234" }).data,
    ).toEqual({ type: "out", reason: "other", amount: 1, note: "Garrafón", code: "1234" });
  });

  it("un motivo que no corresponde al tipo rebota con su clave", () => {
    for (const [type, reason] of [
      ["in", "safe"],
      ["in", "bank_deposit"],
      ["in", "owner"],
      ["out", "change_fund"],
    ]) {
      expect(issues({ type, reason, amount: 100 })).toContain("pos.cash_movement_reason_invalid");
    }
  });

  it("un tipo o un motivo fuera de la lista rebotan con su clave", () => {
    expect(issues({ type: "sideways", reason: "safe", amount: 1 })).toContain(
      "pos.cash_movement_type_invalid",
    );
    expect(issues({ type: "out", reason: "lunch", amount: 1 })).toContain(
      "pos.cash_movement_reason_invalid",
    );
  });

  it("el importe es mayor que cero, con hasta 2 decimales y el tope del fondo inicial", () => {
    expect(registrar({ type: "out", reason: "safe", amount: 0.01 }).success).toBe(true);
    expect(registrar({ type: "out", reason: "safe", amount: MONEY_MAX }).success).toBe(true);
    for (const amount of [0, -5, 10.005, MONEY_MAX + 1, "100"]) {
      expect(issues({ type: "out", reason: "safe", amount })).toContain(
        "pos.cash_movement_amount_invalid",
      );
    }
  });

  it("«Otro» exige una nota que no esté en blanco", () => {
    for (const note of [undefined, null, "", "   "]) {
      expect(issues({ type: "out", reason: "other", amount: 1, note })).toContain(
        "pos.cash_movement_note_required",
      );
    }
  });

  it("la nota se recorta y admite hasta 300 caracteres", () => {
    expect(
      registrar({ type: "out", reason: "safe", amount: 1, note: "  A la caja  " }).data?.note,
    ).toBe("A la caja");
    expect(
      registrar({ type: "out", reason: "safe", amount: 1, note: "x".repeat(300) }).success,
    ).toBe(true);
    expect(issues({ type: "out", reason: "safe", amount: 1, note: "x".repeat(301) })).toContain(
      "pos.cash_movement_note_too_long",
    );
  });

  it("un código que no son 4 a 8 dígitos rebota como el del descuento", () => {
    expect(issues({ type: "out", reason: "safe", amount: 1, code: "12ab" })).toContain(
      "pos.discount_code_invalid",
    );
  });

  it("un campo de más rebota: el cuerpo es estricto", () => {
    expect(registrar({ type: "out", reason: "safe", amount: 1, authorized: true }).success).toBe(
      false,
    );
  });
});

describe("cancelCashMovementSchema (F10-CASHMOV-02)", () => {
  const anular = (body: Record<string, unknown>) => cancelCashMovementSchema.safeParse(body);

  it("pide un motivo que no esté en blanco, recortado, de hasta 300 caracteres", () => {
    expect(anular({ reason: "  Se capturó dos veces " }).data).toEqual({
      reason: "Se capturó dos veces",
    });
    expect(anular({ reason: "x".repeat(300), code: "1234" }).success).toBe(true);
    for (const reason of [undefined, "", "   "]) {
      expect(JSON.stringify(anular({ reason }).error?.issues)).toContain(
        "pos.cash_movement_cancel_reason_required",
      );
    }
    expect(JSON.stringify(anular({ reason: "x".repeat(301) }).error?.issues)).toContain(
      "pos.cash_movement_cancel_reason_too_long",
    );
  });
});
