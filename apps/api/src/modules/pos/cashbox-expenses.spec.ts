import { efectivoEsperado, gastosEnEfectivoPorSesion, sinGastos } from "./cashbox-expenses";

/**
 * F9-EXP-09 — los gastos en efectivo del cajón: una consulta para varios
 * turnos, solo activos + pagados + cash, y en cero los turnos sin gastos. Y el
 * efectivo esperado del arqueo, que desde F10-MANFIX-10 suma el fondo inicial.
 */
describe("gastosEnEfectivoPorSesion (F9-EXP-09)", () => {
  const groupBy = jest.fn();
  const tx = { expense: { groupBy } } as never;

  beforeEach(() => {
    groupBy.mockReset();
    groupBy.mockResolvedValue([
      { cashboxSessionId: "s1", _sum: { total: "200.00" }, _count: { _all: 2 } },
    ]);
  });

  it("arma el total por turno, en cero los que no tuvieron gastos", async () => {
    const mapa = await gastosEnEfectivoPorSesion(tx, "t1", ["s1", "s2"]);
    expect(mapa.get("s1")).toEqual({ total: "200.00", count: 2 });
    expect(mapa.get("s2")).toEqual(sinGastos());
  });

  it("solo cuenta gastos ACTIVOS, PAGADOS y en EFECTIVO de esos turnos, en UNA consulta", async () => {
    await gastosEnEfectivoPorSesion(tx, "t1", ["s1"]);
    expect(groupBy).toHaveBeenCalledTimes(1);
    expect(groupBy.mock.calls[0]?.[0]).toMatchObject({
      by: ["cashboxSessionId"],
      where: {
        tenantId: "t1",
        cashboxSessionId: { in: ["s1"] },
        status: "active",
        paymentStatus: "paid",
        paymentMethod: "cash",
      },
    });
  });

  it("sin turnos no consulta nada", async () => {
    expect((await gastosEnEfectivoPorSesion(tx, "t1", [])).size).toBe(0);
    expect(groupBy).not.toHaveBeenCalled();
  });

  it("sin fondo, el efectivo esperado es ventas cash menos gastos cash, en decimal", () => {
    expect(efectivoEsperado({ fondo: "0", ventas: "500", gastos: "200" })).toBe("300");
    expect(efectivoEsperado({ fondo: "0", ventas: "10.10", gastos: "0.20" })).toBe("9.9");
    expect(efectivoEsperado({ fondo: "0", ventas: "0", gastos: "0" })).toBe("0");
  });

  /**
   * F10-MANFIX-10 — el cajón que arranca con cambio: el fondo se SUMA. Sin
   * él, un turno que abre con $500 salía sobrando $500 cada día.
   */
  it("el fondo inicial se suma: fondo + ventas cash − gastos cash, en decimal", () => {
    expect(efectivoEsperado({ fondo: "500", ventas: "150", gastos: "0" })).toBe("650");
    expect(efectivoEsperado({ fondo: "500", ventas: "430.50", gastos: "90" })).toBe("840.5");
    // Un fondo sin ventas: lo que hay que contar es el fondo mismo.
    expect(efectivoEsperado({ fondo: "200.25", ventas: "0", gastos: "0" })).toBe("200.25");
  });
});
