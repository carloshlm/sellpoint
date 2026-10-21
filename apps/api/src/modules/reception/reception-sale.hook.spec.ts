import type { SaleHookContext } from "../pos/sale-hooks";
import { ReceptionSaleHook, TURNOS_POR_VENTA_MAX, turnosDeLinea } from "./reception-sale.hook";

/**
 * F9-RECEP-26 — el gancho de Recepción: la venta de un servicio MARCADO crea
 * el turno del paciente (ley 31; decisión de Carlos, 2026-10-21).
 *
 * Lo que fija:
 *  - sin servicios marcados entre los vendidos no hace nada (ni crea ni anota);
 *  - un turno por unidad, con un tope por VENTA que es también el de las
 *    anotaciones que la caja acepta;
 *  - todos los turnos de la venta salen del MISMO instante (ley 12): el de la
 *    venta;
 *  - cada turno queda ligado a su venta, auditado, y devuelve su número como
 *    anotación enfática.
 */
type Mock = jest.Mock;

const TENANT = "11111111-1111-1111-1111-111111111111";
const CONSULTA = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const OTRO = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const VENDIDA = new Date("2026-10-21T16:00:00.000Z");

function contexto(items: SaleHookContext["items"], marcados: string[]) {
  const tx = {
    receptionTurnService: {
      findMany: jest.fn().mockResolvedValue(marcados.map((serviceId) => ({ serviceId }))),
    },
  };
  const ctx = {
    tx,
    tenantId: TENANT,
    userId: "u-cajero",
    timeZone: "America/Mexico_City",
    sale: { id: "venta-1", folio: "VTA-000123", createdAt: VENDIDA, warehouseId: "w-1" },
    items,
  } as unknown as SaleHookContext;
  return { ctx, tx };
}

const linea = (serviceId: string | null, quantity = "1", kind = "service") => ({
  lineNo: 1,
  kind,
  productId: kind === "product" ? "p-1" : null,
  serviceId,
  quantity,
});

describe("ReceptionSaleHook (F9-RECEP-26)", () => {
  let registry: { register: Mock };
  let turns: { createIn: Mock };
  let audit: { record: Mock };
  let hook: ReceptionSaleHook;
  let siguiente: number;

  beforeEach(() => {
    siguiente = 7;
    registry = { register: jest.fn() };
    turns = {
      createIn: jest.fn().mockImplementation(() => {
        const numero = siguiente++;
        return Promise.resolve({
          turno: { id: `turno-${numero}`, number: numero },
          fechaLocal: "2026-10-21",
        });
      }),
    };
    audit = { record: jest.fn() };
    // biome-ignore lint/suspicious/noExplicitAny: mocks parciales a propósito
    hook = new ReceptionSaleHook(registry as any, turns as any, audit as any);
  });

  it("se registra en el punto de extensión del POS al arrancar", () => {
    hook.onModuleInit();
    expect(registry.register).toHaveBeenCalledWith(hook);
    expect(hook.sourceModule).toBe("reception");
  });

  it("una venta sin servicios no consulta nada ni crea turnos", async () => {
    const { ctx, tx } = contexto([linea(null, "2", "product")], [CONSULTA]);

    await expect(hook.afterSale(ctx)).resolves.toEqual([]);
    expect(tx.receptionTurnService.findMany).not.toHaveBeenCalled();
    expect(turns.createIn).not.toHaveBeenCalled();
  });

  it("un servicio NO marcado no crea turnos", async () => {
    const { ctx } = contexto([linea(OTRO)], []);

    await expect(hook.afterSale(ctx)).resolves.toEqual([]);
    expect(turns.createIn).not.toHaveBeenCalled();
  });

  it("el servicio marcado crea el turno ligado a la venta y devuelve su número", async () => {
    const { ctx, tx } = contexto([linea(CONSULTA)], [CONSULTA]);

    const anotaciones = await hook.afterSale(ctx);

    expect(tx.receptionTurnService.findMany).toHaveBeenCalledWith({
      where: { tenantId: TENANT, serviceId: { in: [CONSULTA] } },
      select: { serviceId: true },
    });
    expect(turns.createIn).toHaveBeenCalledWith(ctx.tx, {
      tenantId: TENANT,
      timeZone: "America/Mexico_City",
      instant: VENDIDA,
      customerId: null,
      customerName: null,
      saleId: "venta-1",
      createdBy: "u-cajero",
    });
    expect(anotaciones).toEqual([
      {
        sourceModule: "reception",
        labelKey: "reception.saleAnnotation.turn",
        value: "7",
        emphasis: true,
      },
    ]);
  });

  it("cada turno se audita en la transacción de la venta, con su origen", async () => {
    const { ctx } = contexto([linea(CONSULTA)], [CONSULTA]);

    await hook.afterSale(ctx);

    expect(audit.record).toHaveBeenCalledWith(ctx.tx, {
      tenantId: TENANT,
      userId: "u-cajero",
      action: "reception.turn.create",
      resourceType: "reception_turn",
      resourceId: "turno-7",
      after: {
        number: 7,
        businessDate: "2026-10-21",
        customerId: null,
        source: "sale",
        saleFolio: "VTA-000123",
      },
    });
  });

  it("cantidad 2 son dos turnos seguidos, del MISMO instante", async () => {
    const { ctx } = contexto([linea(CONSULTA, "2")], [CONSULTA]);

    const anotaciones = await hook.afterSale(ctx);

    expect(anotaciones.map((a) => a.value)).toEqual(["7", "8"]);
    const instantes = turns.createIn.mock.calls.map((c) => c[1].instant);
    expect(instantes).toEqual([VENDIDA, VENDIDA]);
  });

  it("el tope es por VENTA: nunca más turnos que anotaciones acepta la caja", async () => {
    const { ctx } = contexto([linea(CONSULTA, "8"), linea(CONSULTA, "8")], [CONSULTA]);

    const anotaciones = await hook.afterSale(ctx);

    expect(anotaciones).toHaveLength(TURNOS_POR_VENTA_MAX);
    expect(turns.createIn).toHaveBeenCalledTimes(TURNOS_POR_VENTA_MAX);
  });
});

describe("turnosDeLinea", () => {
  it("una unidad es un turno; una fracción no suma un turno más", () => {
    expect(turnosDeLinea("1")).toBe(1);
    expect(turnosDeLinea("1.5")).toBe(1);
    expect(turnosDeLinea("2.0000")).toBe(2);
  });

  it("nunca menos de uno: si se vendió, se atiende", () => {
    expect(turnosDeLinea("0.5")).toBe(1);
    expect(turnosDeLinea("no-es-numero")).toBe(1);
  });

  it("el tope es 10, el mismo de las anotaciones de una venta", () => {
    expect(TURNOS_POR_VENTA_MAX).toBe(10);
    expect(turnosDeLinea("50")).toBe(10);
  });
});
