import { Prisma } from "../../generated/prisma/client";
import {
  movimientosDeSesion,
  movimientosPorSesion,
  sinMovimientos,
  toCashMovementRow,
} from "./cash-movements";

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

/**
 * F10-CASHMOV-06 — la fila de un movimiento, en UN solo lugar: la usan la
 * caja (`GET /pos/session/movements`, del más nuevo al más viejo) y el detalle
 * de «Cierres de turno» (del más viejo al más nuevo). Si cada uno armara la
 * suya, un día dirían cosas distintas del mismo retiro.
 */
describe("la fila de un movimiento (F10-CASHMOV-06)", () => {
  const ana = { id: "u1", firstName: "Ana", lastName: "Pérez" };
  const beto = { id: "u2", firstName: "Beto", lastName: "Caja" };
  const crudo = {
    id: "m1",
    tenantId: "t1",
    cashboxSessionId: "s1",
    type: "out" as const,
    reason: "safe" as const,
    amount: new Prisma.Decimal("2000.50"),
    note: null,
    authorized: false,
    status: "canceled" as const,
    createdBy: "u1",
    createdAt: new Date("2026-11-23T15:00:00.000Z"),
    canceledBy: "u2",
    canceledAt: new Date("2026-11-23T15:05:00.000Z"),
    cancelReason: "Duplicado",
    creator: ana,
    canceler: beto,
  };

  it("tiene la forma del contrato con el web, en su orden, y el dinero como texto", () => {
    const fila = toCashMovementRow(crudo);
    expect(Object.keys(fila)).toEqual([
      "id",
      "type",
      "reason",
      "amount",
      "note",
      "authorized",
      "status",
      "createdAt",
      "createdBy",
      "canceledAt",
      "canceledBy",
      "cancelReason",
    ]);
    expect(fila).toEqual({
      id: "m1",
      type: "out",
      reason: "safe",
      amount: "2000.5",
      note: null,
      authorized: false,
      status: "canceled",
      createdAt: "2026-11-23T15:00:00.000Z",
      createdBy: { id: "u1", name: "Ana Pérez" },
      canceledAt: "2026-11-23T15:05:00.000Z",
      canceledBy: { id: "u2", name: "Beto Caja" },
      cancelReason: "Duplicado",
    });
  });

  it("uno activo no trae quién ni cuándo se anuló", () => {
    const fila = toCashMovementRow({
      ...crudo,
      status: "active",
      canceledBy: null,
      canceledAt: null,
      cancelReason: null,
      canceler: null,
    });
    expect(fila).toMatchObject({ canceledAt: null, canceledBy: null, cancelReason: null });
  });

  it("lee los del turno, del negocio, con los anulados y en el orden que se pida", async () => {
    const findMany = jest.fn().mockResolvedValue([crudo]);
    const tx = { cashMovement: { findMany } } as never;

    const filas = await movimientosDeSesion(tx, "t1", "s1", "asc");
    await movimientosDeSesion(tx, "t1", "s1", "desc");

    expect(filas).toEqual([toCashMovementRow(crudo)]);
    expect(findMany.mock.calls[0]?.[0]).toEqual({
      where: { tenantId: "t1", cashboxSessionId: "s1" },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      include: {
        creator: { select: { id: true, firstName: true, lastName: true } },
        canceler: { select: { id: true, firstName: true, lastName: true } },
      },
    });
    expect(findMany.mock.calls[1]?.[0]).toMatchObject({
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    });
  });
});
