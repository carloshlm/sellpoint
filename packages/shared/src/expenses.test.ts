import { describe, expect, it } from "vitest";
import {
  EXPENSE_CATEGORY_SEED,
  EXPENSE_PAYMENT_STATUSES,
  EXPENSE_STATUSES,
  expenseCategorySortOrder,
  expensePaymentStatusSchema,
  expenseStatusSchema,
} from "./expenses";

/** F9-EXP-01 — dos hechos ortogonales y 18 categorías de fábrica con nombre en los dos idiomas. */
describe("contratos de Gastos (F9-EXP-01)", () => {
  it("el estado y el estado de pago son dos preguntas distintas", () => {
    expect(EXPENSE_STATUSES).toEqual(["active", "canceled"]);
    expect(EXPENSE_PAYMENT_STATUSES).toEqual(["pending", "paid"]);
    expect(expenseStatusSchema.parse("canceled")).toBe("canceled");
    expect(() => expenseStatusSchema.parse("paid")).toThrow();
    expect(expensePaymentStatusSchema.parse("paid")).toBe("paid");
    expect(() => expensePaymentStatusSchema.parse("active")).toThrow();
  });

  it("son 18 categorías, con código único en snake_case y nombre en es y en", () => {
    expect(EXPENSE_CATEGORY_SEED).toHaveLength(18);
    const codigos = EXPENSE_CATEGORY_SEED.map((c) => c.code);
    expect(new Set(codigos).size).toBe(18);
    for (const categoria of EXPENSE_CATEGORY_SEED) {
      expect(categoria.code).toMatch(/^[a-z]+(_[a-z]+)*$/);
      expect(categoria.name.es.trim()).not.toBe("");
      expect(categoria.name.en.trim()).not.toBe("");
    }
    expect(codigos[0]).toBe("rent");
    expect(codigos[17]).toBe("other");
  });

  it("el orden deja hueco: índice × 10", () => {
    expect(expenseCategorySortOrder(0)).toBe(0);
    expect(expenseCategorySortOrder(17)).toBe(170);
  });
});
