import { TenantTransactionsGate } from "./tenant-transactions.gate";

describe("TenantTransactionsGate (F1-LOCALE-06)", () => {
  it("en F1 no hay transacciones todavía: siempre responde false", async () => {
    const gate = new TenantTransactionsGate();

    await expect(gate.hasTransactions("tenant-1")).resolves.toBe(false);
  });
});
