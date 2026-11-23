import { movimientosPorSesion, sinMovimientos } from "./cash-movements";

/**
 * F10-CASHMOV-03 — las entradas y los retiros de efectivo de uno o varios
 * turnos, en UNA consulta: solo los ACTIVOS (uno anulado ya no movió nada), por
 * tipo, y en cero los turnos sin movimientos.
 */
describe("movimientosPorSesion (F10-CASHMOV-03)", () => {
  const groupBy = jest.fn();
  const tx = { cashMovement: { groupBy } } as never;

  beforeEach(() => {
    groupBy.mockReset();
    groupBy.mockResolvedValue([
      { cashboxSessionId: "s1", type: "in", _sum: { amount: "400.00" } },
      { cashboxSessionId: "s1", type: "out", _sum: { amount: "2000.00" } },
      { cashboxSessionId: "s2", type: "out", _sum: { amount: "150.50" } },
    ]);
  });

  it("separa entradas y retiros por turno, y deja en cero lo que no tuvo", async () => {
    const mapa = await movimientosPorSesion(tx, "t1", ["s1", "s2", "s3"]);
    expect(mapa.get("s1")).toEqual({ cashIn: "400", cashOut: "2000" });
    expect(mapa.get("s2")).toEqual({ cashIn: "0", cashOut: "150.5" });
    expect(mapa.get("s3")).toEqual(sinMovimientos());
  });

  it("solo cuenta los movimientos ACTIVOS de esos turnos del negocio, en UNA consulta", async () => {
    await movimientosPorSesion(tx, "t1", ["s1"]);
    expect(groupBy).toHaveBeenCalledTimes(1);
    expect(groupBy.mock.calls[0]?.[0]).toEqual({
      by: ["cashboxSessionId", "type"],
      where: { tenantId: "t1", cashboxSessionId: { in: ["s1"] }, status: "active" },
      _sum: { amount: true },
    });
  });

  it("sin turnos no consulta nada", async () => {
    expect((await movimientosPorSesion(tx, "t1", [])).size).toBe(0);
    expect(groupBy).not.toHaveBeenCalled();
  });

  it("sin movimientos, entradas y retiros son «0»", () => {
    expect(sinMovimientos()).toEqual({ cashIn: "0", cashOut: "0" });
  });
});
