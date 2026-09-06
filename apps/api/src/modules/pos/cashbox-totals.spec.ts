import { totalesEnCero, totalesPorSesion } from "./cashbox-totals";

/**
 * Una consulta para varios turnos; cada uno vuelve con los tres métodos en el
 * orden del catálogo, en cero cuando no vendió con ese. Las anuladas no
 * entran: el filtro `completed` es parte del contrato.
 */
describe("totalesPorSesion (F5-SHIFT-01)", () => {
  const groupBy = jest.fn();
  const tx = { sale: { groupBy } } as never;

  beforeEach(() => {
    groupBy.mockReset();
    groupBy.mockResolvedValue([
      {
        cashboxSessionId: "s1",
        paymentMethod: "cash",
        _sum: { total: "150.00" },
        _count: { _all: 2 },
      },
      {
        cashboxSessionId: "s1",
        paymentMethod: "card",
        _sum: { total: "40.00" },
        _count: { _all: 1 },
      },
      {
        cashboxSessionId: "s2",
        paymentMethod: "transfer",
        _sum: { total: "9.50" },
        _count: { _all: 1 },
      },
    ]);
  });

  it("arma los tres métodos por turno, en cero los que no vendieron", async () => {
    const mapa = await totalesPorSesion(tx, "t1", ["s1", "s2", "s3"]);
    expect(mapa.get("s1")).toEqual([
      { method: "cash", total: "150.00", count: 2 },
      { method: "card", total: "40.00", count: 1 },
      { method: "transfer", total: "0", count: 0 },
    ]);
    expect(mapa.get("s2")?.[2]).toEqual({ method: "transfer", total: "9.50", count: 1 });
    expect(mapa.get("s3")).toEqual(totalesEnCero());
  });

  it("solo cuenta ventas completadas y solo de esos turnos, en UNA consulta", async () => {
    await totalesPorSesion(tx, "t1", ["s1", "s2"]);
    expect(groupBy).toHaveBeenCalledTimes(1);
    expect(groupBy.mock.calls[0]?.[0]).toMatchObject({
      by: ["cashboxSessionId", "paymentMethod"],
      where: { tenantId: "t1", cashboxSessionId: { in: ["s1", "s2"] }, status: "completed" },
    });
  });

  it("sin turnos no consulta nada", async () => {
    expect((await totalesPorSesion(tx, "t1", [])).size).toBe(0);
    expect(groupBy).not.toHaveBeenCalled();
  });
});
