import { INVENTORY_AUDIT_ACTIONS, recordMovementAudit } from "./movement-audit";

/**
 * F3-CORE-07 — el rastro de un movimiento.
 *
 * Se ancla en el DOCUMENTO y no en cada línea: quien audita busca por folio,
 * no por uuid de movimiento. Y el folio viaja en el payload justamente porque
 * es lo único que una persona tiene en la mano cuando pregunta "¿qué pasó con
 * la entrada ENT-000042?".
 */
describe("recordMovementAudit (F3-CORE-07)", () => {
  const base = {
    user: { userId: "u1", tenantId: "t1" },
    action: "inventory.entry" as const,
    documentId: "d1",
    folio: "ENT-000042",
    warehouseId: "w1",
    reasonCode: "invoice" as const,
    lines: [
      { productId: "p1", quantity: "36", balanceAfter: "136" },
      { productId: "p2", quantity: "50", balanceAfter: "50" },
    ],
  };

  it("registra contra el documento, no contra una línea suelta", async () => {
    const audit = { record: jest.fn() };
    const tx = {} as never;

    await recordMovementAudit(tx, audit as never, base);

    expect(audit.record).toHaveBeenCalledWith(
      tx,
      expect.objectContaining({
        action: "inventory.entry",
        resourceType: "inventory_document",
        resourceId: "d1",
      }),
    );
  });

  /**
   * Corre DENTRO de la transacción que asentó los movimientos: si el registro
   * fuera aparte, un fallo entre medio dejaría stock movido sin rastro de
   * quién lo movió.
   */
  it("usa la MISMA tx que el ledger, no una propia", async () => {
    const audit = { record: jest.fn() };
    const tx = { marca: "la-tx-del-ledger" } as never;

    await recordMovementAudit(tx, audit as never, base);

    expect(audit.record.mock.calls[0]?.[0]).toBe(tx);
  });

  it("el payload lleva el folio: es lo que una persona busca", async () => {
    const audit = { record: jest.fn() };

    await recordMovementAudit({} as never, audit as never, base);
    const after = audit.record.mock.calls[0]?.[1]?.after;

    expect(after).toMatchObject({ folio: "ENT-000042", reasonCode: "invoice", warehouseId: "w1" });
  });

  it("guarda el saldo POSTERIOR por línea: sin él no se puede reconstruir el kardex", async () => {
    const audit = { record: jest.fn() };

    await recordMovementAudit({} as never, audit as never, base);
    const after = audit.record.mock.calls[0]?.[1]?.after as { lines: unknown[] };

    expect(after.lines).toEqual([
      expect.objectContaining({ productId: "p1", quantity: "36", balanceAfter: "136" }),
      expect.objectContaining({ productId: "p2", quantity: "50", balanceAfter: "50" }),
    ]);
  });

  it("las acciones canónicas cubren el ciclo entero de la fase", () => {
    expect(INVENTORY_AUDIT_ACTIONS).toEqual([
      "inventory.entry",
      "inventory.exit",
      "inventory.transfer_dispatch",
      "inventory.transfer_receive",
      "inventory.transfer_cancel",
      "inventory.physical_count_approve",
    ]);
  });
});
