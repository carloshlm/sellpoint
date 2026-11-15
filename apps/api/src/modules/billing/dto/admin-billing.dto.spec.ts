import { recordPaymentSchema } from "./admin-billing.dto";

/**
 * «Cubre hasta» (Carlos, 2026-11-14) llega como `YYYY-MM-DD`. Una fecha con
 * forma de fecha pero que no existe es un dedazo: `Date` la recorre al mes
 * siguiente y el ancla saldría en 0 o en otro día.
 */
describe("recordPaymentSchema: «Cubre hasta»", () => {
  const base = {
    billingCycle: "monthly",
    method: "transfer",
    paidAt: "2026-11-14",
    amountReceived: "499.00",
  };

  it("acepta un día que existe", () => {
    expect(recordPaymentSchema.safeParse({ ...base, periodEnd: "2028-02-29" }).success).toBe(true);
  });

  it.each(["2026-02-31", "2026-12-00", "2027-02-29", "2026-13-01"])(
    "rechaza «%s», que no existe",
    (dia) => {
      const resultado = recordPaymentSchema.safeParse({ ...base, periodEnd: dia });
      expect(resultado.success).toBe(false);
      expect(resultado.error?.issues[0]?.message).toBe("billing.period_end_invalid");
    },
  );
});
