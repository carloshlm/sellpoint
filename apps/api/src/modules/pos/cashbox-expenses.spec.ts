import {
  efectivoEsperado,
  gastosDelCajon,
  gastosEnEfectivoPorSesion,
  sinGastos,
} from "./cashbox-expenses";

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

  /** F10-CASHMOV-03: sin entradas ni retiros (`"0"`), la cuenta de siempre al centavo. */
  const sinMovimientos = { entradas: "0", retiros: "0" };

  it("sin fondo, el efectivo esperado es ventas cash menos gastos cash, en decimal", () => {
    expect(efectivoEsperado({ fondo: "0", ventas: "500", gastos: "200", ...sinMovimientos })).toBe(
      "300",
    );
    expect(
      efectivoEsperado({ fondo: "0", ventas: "10.10", gastos: "0.20", ...sinMovimientos }),
    ).toBe("9.9");
    expect(efectivoEsperado({ fondo: "0", ventas: "0", gastos: "0", ...sinMovimientos })).toBe("0");
  });

  /**
   * F10-MANFIX-10 — el cajón que arranca con cambio: el fondo se SUMA. Sin
   * él, un turno que abre con $500 salía sobrando $500 cada día.
   */
  it("el fondo inicial se suma: fondo + ventas cash − gastos cash, en decimal", () => {
    expect(efectivoEsperado({ fondo: "500", ventas: "150", gastos: "0", ...sinMovimientos })).toBe(
      "650",
    );
    expect(
      efectivoEsperado({ fondo: "500", ventas: "430.50", gastos: "90", ...sinMovimientos }),
    ).toBe("840.5");
    // Un fondo sin ventas: lo que hay que contar es el fondo mismo.
    expect(efectivoEsperado({ fondo: "200.25", ventas: "0", gastos: "0", ...sinMovimientos })).toBe(
      "200.25",
    );
  });

  /**
   * F10-CASHMOV-03 — el efectivo que entra o sale del cajón sin ser venta ni
   * gasto: fondo + ventas + entradas − retiros − gastos.
   */
  it("una entrada suma y un retiro resta, cada uno por su lado", () => {
    const enCero = { fondo: "0", ventas: "0", gastos: "0" };
    expect(efectivoEsperado({ ...enCero, entradas: "400", retiros: "0" })).toBe("400");
    expect(efectivoEsperado({ ...enCero, entradas: "0", retiros: "2000" })).toBe("-2000");
  });

  it("todo junto, al centavo: 500 + 3000.50 + 400 − 2000 − 100.25 = 1800.25", () => {
    expect(
      efectivoEsperado({
        fondo: "500",
        ventas: "3000.50",
        entradas: "400",
        retiros: "2000",
        gastos: "100.25",
      }),
    ).toBe("1800.25");
  });
});

/**
 * Carlos (2026-11-01): el arqueo de un turno detalla cada gasto del cajón con
 * quién lo registró, con el MISMO filtro que el total.
 */
describe("gastosDelCajon", () => {
  const findMany = jest.fn();
  const tx = { expense: { findMany } } as never;

  it("trae cada gasto activo, pagado y en efectivo del turno, con nombre y primer apellido de quien lo registró", async () => {
    findMany.mockResolvedValue([
      {
        id: "e1",
        folio: "GAS-000012",
        description: "Garrafón de agua",
        total: { toString: () => "50" },
        creator: { id: "u1", firstName: "Ana", lastName: "Pérez" },
      },
    ]);

    await expect(gastosDelCajon(tx, "t1", "s1")).resolves.toEqual([
      {
        id: "e1",
        folio: "GAS-000012",
        description: "Garrafón de agua",
        total: "50",
        createdBy: { id: "u1", name: "Ana Pérez" },
      },
    ]);
    expect(findMany.mock.calls[0]?.[0]).toMatchObject({
      where: {
        tenantId: "t1",
        cashboxSessionId: "s1",
        status: "active",
        paymentStatus: "paid",
        paymentMethod: "cash",
      },
      orderBy: [{ createdAt: "asc" }, { folio: "asc" }],
    });
  });
});
