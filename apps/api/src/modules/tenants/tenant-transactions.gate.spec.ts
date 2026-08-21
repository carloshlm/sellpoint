import type { PrismaService } from "../../infrastructure/prisma/prisma.service";
import { TenantTransactionsGate } from "./tenant-transactions.gate";

/**
 * F3-GUARDS-04 — el gate ya no miente.
 *
 * En F1 devolvía `false` siempre porque no existían las tablas. Ahora cuenta
 * `stock_movements`: **un solo movimiento asentado congela la moneda del
 * tenant**, y la razón es que los importes ya escritos no tienen unidad
 * propia — la heredan del tenant. Cambiarla reinterpretaría toda la historia
 * sin tocar un número.
 */
describe("TenantTransactionsGate (F3-GUARDS-04)", () => {
  /** Un doble que corre el callback con un `tx` falso, como hace el real. */
  function prismaCon(movimientos: number, ventas = 0): PrismaService {
    return {
      withTenantContext: (_tenantId: string, fn: (tx: unknown) => Promise<boolean>) =>
        fn({
          stockMovement: { count: async () => movimientos },
          sale: { count: async () => ventas },
        }),
    } as unknown as PrismaService;
  }

  it("sin movimientos, el tenant todavía no operó", async () => {
    const gate = new TenantTransactionsGate(prismaCon(0));

    await expect(gate.hasTransactions("tenant-1")).resolves.toBe(false);
  });

  /** UNO alcanza: no hay un umbral de "ya operó lo suficiente". */
  it("con un solo movimiento, ya operó", async () => {
    const gate = new TenantTransactionsGate(prismaCon(1));

    await expect(gate.hasTransactions("tenant-1")).resolves.toBe(true);
  });

  /**
   * F4-SALE-01. **Una venta de servicio puro no escribe un solo
   * `stock_movement`** —un servicio no tiene existencias—, así que contar solo
   * el ledger habría dejado a un negocio de puros servicios cambiando su
   * moneda con el cajón lleno de tickets ya cobrados en la moneda vieja.
   */
  it("una VENTA cuenta aunque no haya movido stock (servicios)", async () => {
    const gate = new TenantTransactionsGate(prismaCon(0, 1));

    await expect(gate.hasTransactions("tenant-1")).resolves.toBe(true);
  });

  it("la cuenta va DENTRO del contexto del tenant", async () => {
    const vistos: string[] = [];
    const prisma = {
      withTenantContext: (tenantId: string, fn: (tx: unknown) => Promise<boolean>) => {
        vistos.push(tenantId);
        return fn({
          stockMovement: { count: async () => 0 },
          sale: { count: async () => 0 },
        });
      },
    } as unknown as PrismaService;

    await new TenantTransactionsGate(prisma).hasTransactions("tenant-9");

    // Sin el contexto, la RLS no acota y el gate contaría los movimientos de
    // TODO el sistema: cualquier tenant congelaría a los demás.
    expect(vistos).toEqual(["tenant-9"]);
  });
});
