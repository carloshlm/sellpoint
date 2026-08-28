import { SalesPlanGate } from "./sales-plan.gate";

/**
 * F7-POS-04 — el límite diario cuenta en el calendario del NEGOCIO y las
 * canceladas devuelven cupo.
 */
describe("SalesPlanGate", () => {
  const gate = new SalesPlanGate();
  const TENANT = "11111111-1111-1111-1111-111111111111";
  const CDMX = "America/Mexico_City";

  const txCon = (count: number) => ({ sale: { count: jest.fn().mockResolvedValue(count) } });

  it("plan de pago (límite NULL): cero queries", async () => {
    const tx = txCon(0);
    // biome-ignore lint/suspicious/noExplicitAny: mock parcial a propósito
    await gate.assertDailySaleAllowed(tx as any, TENANT, null, CDMX, new Date());
    expect(tx.sale.count).not.toHaveBeenCalled();
  });

  it("bajo el límite pasa; en el límite responde 402 con el tope en args", async () => {
    const bajo = txCon(9);
    // biome-ignore lint/suspicious/noExplicitAny: mock parcial a propósito
    await expect(
      gate.assertDailySaleAllowed(bajo as any, TENANT, 10, CDMX, new Date()),
    ).resolves.toBeUndefined();

    const alTope = txCon(10);
    // biome-ignore lint/suspicious/noExplicitAny: mock parcial a propósito
    await expect(
      gate.assertDailySaleAllowed(alTope as any, TENANT, 10, CDMX, new Date()),
    ).rejects.toMatchObject({
      status: 402,
      response: { message: "billing.daily_sales_limit_reached", args: { limit: 10 } },
    });
  });

  it("el «hoy» es el del NEGOCIO: a las 23:30 de CDMX el rango sigue siendo el día local, no el de UTC", async () => {
    const tx = txCon(0);
    // 23:30 locales del 5-ago en CDMX = 05:30 UTC del 6-ago.
    const instante = new Date("2026-08-06T05:30:00.000Z");
    // biome-ignore lint/suspicious/noExplicitAny: mock parcial a propósito
    await gate.assertDailySaleAllowed(tx as any, TENANT, 10, CDMX, instante);

    const where = tx.sale.count.mock.calls[0][0].where;
    // El día del negocio (5-ago) arranca a las 06:00 UTC del 5 y termina al
    // arranque del 6 local (06:00 UTC del 6) — límite abierto.
    expect(where.createdAt.gte.toISOString()).toBe("2026-08-05T06:00:00.000Z");
    expect(where.createdAt.lt.toISOString()).toBe("2026-08-06T06:00:00.000Z");
    // Las canceladas devuelven el cupo.
    expect(where.canceledAt).toBeNull();
  });
});
