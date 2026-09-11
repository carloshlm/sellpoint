import { efectivoEsperado, gastosEnEfectivoPorSesion, sinGastos } from "./cashbox-expenses";

/**
 * F9-EXP-09 — los gastos en efectivo del cajón: una consulta para varios
 * turnos, solo activos + pagados + cash, y en cero los turnos sin gastos.
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

  it("el efectivo esperado es ventas cash menos gastos cash, en decimal", () => {
    expect(efectivoEsperado("500", "200")).toBe("300");
    expect(efectivoEsperado("10.10", "0.20")).toBe("9.9");
    expect(efectivoEsperado("0", "0")).toBe("0");
  });
});
