import { ExecutionContext, ForbiddenException } from "@nestjs/common";
import { TenantTransactionsGate } from "../tenant-transactions.gate";
import { TenantCurrencyChangeableGuard } from "./tenant-currency-changeable.guard";

function buildContext(body: unknown, user?: { tenantId: string }): ExecutionContext {
  return {
    switchToHttp: () => ({
      getRequest: () => ({ body, user }),
    }),
  } as unknown as ExecutionContext;
}

describe("TenantCurrencyChangeableGuard (F1-LOCALE-06)", () => {
  function buildGuard(hasTransactions: boolean) {
    const gate = {
      hasTransactions: jest.fn().mockResolvedValue(hasTransactions),
    } as unknown as TenantTransactionsGate;
    const guard = new TenantCurrencyChangeableGuard(gate);
    return { guard, gate };
  }

  it("body sin `currency`: deja pasar sin consultar el gate", async () => {
    const { guard, gate } = buildGuard(false);
    const context = buildContext({ name: "Acme" }, { tenantId: "tenant-1" });

    await expect(guard.canActivate(context)).resolves.toBe(true);
    expect(gate.hasTransactions).not.toHaveBeenCalled();
  });

  it("body con `currency` y tenant SIN transacciones (F1: siempre): permite", async () => {
    const { guard, gate } = buildGuard(false);
    const context = buildContext({ currency: "USD" }, { tenantId: "tenant-1" });

    await expect(guard.canActivate(context)).resolves.toBe(true);
    expect(gate.hasTransactions).toHaveBeenCalledWith("tenant-1");
  });

  it("body con `currency` y tenant CON transacciones (preparado para F2-F4): bloquea", async () => {
    const { guard } = buildGuard(true);
    const context = buildContext({ currency: "USD" }, { tenantId: "tenant-1" });

    await expect(guard.canActivate(context)).rejects.toBeInstanceOf(ForbiddenException);
    await expect(guard.canActivate(context)).rejects.toMatchObject({
      response: { message: "tenants.currency_locked" },
    });
  });

  it("sin req.user (no debería pasar detrás del guard global, pero no debe romper): permite", async () => {
    const { guard, gate } = buildGuard(true);
    const context = buildContext({ currency: "USD" }, undefined);

    await expect(guard.canActivate(context)).resolves.toBe(true);
    expect(gate.hasTransactions).not.toHaveBeenCalled();
  });
});
