import type { SaleHookContext } from "../pos/sale-hooks";
import { ReceptionSaleHook } from "./reception-sale.hook";

/**
 * F9-RECEP-26 — el gancho de Recepción: la venta de un servicio MARCADO crea
 * el turno del paciente (ley 31; decisión de Carlos, 2026-10-21).
 *
 * F9-RECEP-31 — y UNA venta es UN turno (Carlos, 2026-10-21, con el ticket de
 * «TURNO 2 / TURNO 3» en la mano): quien paga dos servicios marcados, o dos
 * unidades del mismo, es un paciente con un número.
 *
 * Lo que fija:
 *  - sin servicios marcados entre los vendidos no hace nada (ni crea ni anota);
 *  - con uno o más marcados, crea UN turno, del instante de la venta (ley 12),
 *    ligado a ella y auditado, y lo devuelve como anotación enfática.
 */
type Mock = jest.Mock;

const TENANT = "11111111-1111-1111-1111-111111111111";
const CONSULTA = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const OTRO = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const VISTA = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const VENDIDA = new Date("2026-10-21T16:00:00.000Z");

function contexto(items: SaleHookContext["items"], marcados: string[]) {
  const tx = {
    receptionTurnService: {
      // Como la base: la primera fila marcada entre las pedidas, o nada.
      findFirst: jest.fn().mockImplementation(({ where }) => {
        const pedidos: string[] = where.serviceId.in;
        const fila = pedidos.find((id) => marcados.includes(id));
        return Promise.resolve(fila === undefined ? null : { serviceId: fila });
      }),
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

describe("ReceptionSaleHook (F9-RECEP-26 / F9-RECEP-31)", () => {
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
    expect(tx.receptionTurnService.findFirst).not.toHaveBeenCalled();
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

    expect(tx.receptionTurnService.findFirst).toHaveBeenCalledWith({
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

  it("el turno se audita en la transacción de la venta, con su origen", async () => {
    const { ctx } = contexto([linea(CONSULTA)], [CONSULTA]);

    await hook.afterSale(ctx);

    expect(audit.record).toHaveBeenCalledTimes(1);
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

  it("cantidad 2 del servicio marcado es UN turno: una venta, un paciente", async () => {
    const { ctx } = contexto([linea(CONSULTA, "2")], [CONSULTA]);

    const anotaciones = await hook.afterSale(ctx);

    expect(anotaciones.map((a) => a.value)).toEqual(["7"]);
    expect(turns.createIn).toHaveBeenCalledTimes(1);
  });

  it("dos servicios marcados en la misma venta son UN turno", async () => {
    const { ctx, tx } = contexto([linea(CONSULTA), linea(VISTA, "3")], [CONSULTA, VISTA]);

    const anotaciones = await hook.afterSale(ctx);

    expect(anotaciones.map((a) => a.value)).toEqual(["7"]);
    expect(turns.createIn).toHaveBeenCalledTimes(1);
    // Una sola consulta con los dos: basta con saber si ALGUNO genera turno.
    expect(tx.receptionTurnService.findFirst).toHaveBeenCalledTimes(1);
    expect(tx.receptionTurnService.findFirst.mock.calls[0][0].where.serviceId.in).toEqual([
      CONSULTA,
      VISTA,
    ]);
  });

  it("un marcado junto a uno que no lo está también es UN turno", async () => {
    const { ctx } = contexto([linea(OTRO), linea(CONSULTA)], [CONSULTA]);

    const anotaciones = await hook.afterSale(ctx);

    expect(anotaciones).toHaveLength(1);
    expect(turns.createIn).toHaveBeenCalledTimes(1);
  });
});
