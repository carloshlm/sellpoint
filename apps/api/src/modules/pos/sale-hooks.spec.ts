import type { SaleAnnotation } from "@sellpoint/shared";
import { runSaleHooks, type SaleHook, type SaleHookContext, SaleHooksRegistry } from "./sale-hooks";

/**
 * F9-RECEP-23 — el punto de extensión de la venta (ley 31 de la Fase 9).
 *
 * El POS no importa ningún módulo vertical (ley 16): define el puerto y los
 * módulos se registran. Lo que este spec fija es el contrato del lado del
 * POS: corre solo los ganchos de los módulos ACTIVOS, valida lo que le
 * devuelven antes de guardarlo y deja pasar el error de un gancho (la venta,
 * que corre todo en una transacción, se deshace).
 */

const ctx = {
  tx: {},
  tenantId: "t-1",
  userId: "u-1",
  timeZone: "America/Mexico_City",
  sale: { id: "s-1", folio: "VTA-000001", createdAt: new Date(), warehouseId: "w-1" },
  items: [{ lineNo: 1, kind: "service", productId: null, serviceId: "svc-1", quantity: "1" }],
} as unknown as SaleHookContext;

function gancho(sourceModule: SaleHook["sourceModule"], devuelve: SaleAnnotation[]): SaleHook {
  return { sourceModule, afterSale: jest.fn().mockResolvedValue(devuelve) };
}

const turno: SaleAnnotation = {
  sourceModule: "reception",
  labelKey: "reception.saleAnnotation.turn",
  value: "7",
  emphasis: true,
};

describe("SaleHooksRegistry", () => {
  it("devuelve solo los ganchos de los módulos ACTIVOS del negocio", () => {
    const registro = new SaleHooksRegistry();
    const recepcion = gancho("reception", []);
    const compras = gancho("purchases", []);
    registro.register(recepcion);
    registro.register(compras);

    expect(registro.activeFor(["reception"])).toEqual([recepcion]);
    expect(registro.activeFor([])).toEqual([]);
    expect(registro.activeFor(["purchases", "reception"])).toEqual([recepcion, compras]);
  });

  it("un módulo no se registra dos veces: sería un turno doble por venta", () => {
    const registro = new SaleHooksRegistry();
    registro.register(gancho("reception", []));

    expect(() => registro.register(gancho("reception", []))).toThrow(/reception/);
  });
});

describe("runSaleHooks", () => {
  it("sin ganchos no hay anotaciones ni llamadas", async () => {
    await expect(runSaleHooks([], ctx)).resolves.toEqual([]);
  });

  it("junta las anotaciones de cada gancho en orden de registro", async () => {
    const otra: SaleAnnotation = { ...turno, sourceModule: "purchases", emphasis: false };
    const recepcion = gancho("reception", [turno]);
    const compras = gancho("purchases", [otra]);

    await expect(runSaleHooks([recepcion, compras], ctx)).resolves.toEqual([turno, otra]);
    expect(recepcion.afterSale).toHaveBeenCalledWith(ctx);
  });

  it("una anotación inválida es un bug del módulo: lanza, y la venta se deshace", async () => {
    const roto = gancho("reception", [{ ...turno, labelKey: "Turno 7" }]);

    await expect(runSaleHooks([roto], ctx)).rejects.toThrow();
  });

  it("un gancho no firma a nombre de otro módulo", async () => {
    const impostor = gancho("reception", [{ ...turno, sourceModule: "medical_clinic" }]);

    await expect(runSaleHooks([impostor], ctx)).rejects.toThrow(/medical_clinic/);
  });

  it("el error de un gancho NO se traga: sube y deshace la venta", async () => {
    const falla: SaleHook = {
      sourceModule: "reception",
      afterSale: jest.fn().mockRejectedValue(new Error("se cayó la base")),
    };

    await expect(runSaleHooks([falla], ctx)).rejects.toThrow("se cayó la base");
  });

  it("más de diez anotaciones en una venta se rechazan", async () => {
    const muchas = gancho(
      "reception",
      Array.from({ length: 11 }, () => turno),
    );

    await expect(runSaleHooks([muchas], ctx)).rejects.toThrow();
  });
});
